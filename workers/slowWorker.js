require("dotenv").config();
const { Worker } = require("bullmq");
const { exec } = require("child_process");
const path = require("path");
const { connection, SLOW_QUEUE } = require("../config/redis");
const Analysis = require("../models/analysis");
const checkRedis = require("../utils/redisCheck");
const { connectMongoDB, closeMongoDB } = require("../utils/mongodb");
const logger = require("../utils/logger");

const PYTHON_PATH = process.env.PYTHON_PATH || "python";
const SLOW_CHUNK_TIME = 6;

const slowWorker = new Worker(
  SLOW_QUEUE,
  async (job) => {
    const { name, data } = job;

    logger.info(`[SLOW WORKER] Job ID: ${job.id}, Type: ${name}`);

    if (name === "detailedAnalysis") {
      const { slowChunkId, slowChunkDir, userId, userEmail, cameraId, videoPath, totalChunks, triggeredByFastChunk } = data;

      const chunkFileName = `slow_chunk_${slowChunkId
        .toString()
        .padStart(4, "0")}.mp4`;
      const chunkPath = path.join(slowChunkDir, chunkFileName);
      const timestamp = slowChunkId * SLOW_CHUNK_TIME;

      logger.info(`[SLIDE] Analyzing chunk ${slowChunkId}/${totalChunks} (${formatTime(timestamp)})...`);

      // Save initial record with status
      await Analysis.findOneAndUpdate(
        { cameraId, chunkId: slowChunkId, chunkType: "slow" },
        {
          cameraId,
          videoPath,
          chunkType: "slow",
          chunkId: slowChunkId,
          timestamp,
          status: "initializing_ai",
          statusMessage: "Initializing Whisper & EasyOCR...",
          personDetected: true,
        },
        { upsert: true, new: true }
      );

      try {
        // Update status for the Python phase
        await Analysis.findOneAndUpdate(
            { cameraId, chunkId: slowChunkId, chunkType: "slow" },
            { status: "processing", statusMessage: "Deep Deep Analysis in progress..." }
        );

        const pythonScript = path.join(__dirname, "..", "slide_processor.py");
        const command = `"${PYTHON_PATH}" "${pythonScript}" "${chunkPath}" "${userId}" "${userEmail || ''}"`;

        const axios = require("axios");

        // Run OCR and audio transcription analysis
        const slideAnalysis = await new Promise(async (resolve, reject) => {
          try {
            // Attempt to use the Persistent AI Bridge (Ultra Fast)
            const bridgeResponse = await axios.post("http://localhost:5000", {
                task: "deep_dive",
                videoPath: chunkPath
            }, { timeout: 120000 }); // Longer timeout for deep analysis
            
            if (bridgeResponse.data && bridgeResponse.data.success) {
                logger.info(`[BRIDGE] Chunk ${slowChunkId}: Deep analysis complete via persistent engine.`);
                return resolve(bridgeResponse.data);
            }
          } catch (bridgeErr) {
            logger.warn(`[BRIDGE] Persistent engine unavailable for slow worker, falling back to legacy spawning...`);
          }

          // Legacy Fallback
          exec(
            command,
            {
              maxBuffer: 20 * 1024 * 1024,
              timeout: 120000, // Increased timeout for heavy loading
              env: { ...process.env },
            },
            (error, stdout, stderr) => {
              if (error) {
                logger.error(`Slide processor error for chunk ${slowChunkId}`, error, { stderr });
                return reject(error);
              }

              try {
                const result = JSON.parse(stdout.trim());
                if (!result.success) {
                  return reject(new Error(result.error || "Analysis failed"));
                }
                resolve(result);
              } catch (parseError) {
                logger.error("Failed to parse slide processor output", parseError, { stdout });
                reject(new Error("Invalid output format"));
              }
            }
          );
        });

        const analysis = slideAnalysis.slide_analysis;
        const groqVerdict = slideAnalysis.groq_verdict || { is_suspicious: false, reason: '' };

        // Save analysis results to database
        await Analysis.findOneAndUpdate(
          { cameraId, chunkId: slowChunkId, chunkType: "slow" },
          {
            status: "completed",
            analysis: {
              title: analysis.title,
              textContent: analysis.text_content || [],
              transcription: analysis.transcription || "",
              summary: analysis.summary || "",
              keyPoints: analysis.key_points || [],
            },
            groqVerdict: {
              isSuspicious: groqVerdict.is_suspicious || false,
              reason: groqVerdict.reason || "",
            },
          }
        );

        logger.success(`[SLOW] Chunk ${slowChunkId} (${formatTime(timestamp)}) completed`);
        logger.info(`  Title: ${analysis.title || "No title"}`);
        logger.info(`  Text lines detected: ${analysis.text_content?.length || 0}`);
        if (analysis.transcription) {
          logger.info(`  Transcription: ${analysis.transcription.substring(0, 50)}${analysis.transcription.length > 50 ? "..." : ""}`);
        }
        if (analysis.text_content && analysis.text_content.length > 0) {
          logger.info(`  Detected text: ${analysis.text_content.slice(0, 3).join(", ")}${analysis.text_content.length > 3 ? "..." : ""}`);
        }

        return {
          status: "Complete",
          chunkId: slowChunkId,
          timestamp,
          totalChunks,
          slide: {
            title: analysis.title,
            keyPoints: analysis.key_points,
            transcription: analysis.transcription,
            summary: analysis.summary,
            textContent: analysis.text_content,
          },
        };
      } catch (error) {
        logger.error(
          `[SLOW] Failed for chunk ${slowChunkId} (${formatTime(timestamp)})`,
          error
        );

        // Update analysis record with error
        await Analysis.findOneAndUpdate(
          { cameraId, chunkId: slowChunkId, chunkType: "slow" },
          {
            status: "error",
            error: error.message,
          }
        );

        return {
          status: "Error",
          chunkId: slowChunkId,
          timestamp,
          error: error.message,
        };
      }
    }
  },
  {
    connection,
    concurrency: 2,
    removeOnComplete: {
      count: 100,
      age: 24 * 3600,
    },
    removeOnFail: {
      count: 500,
    },
  }
);

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

slowWorker.on("completed", (job) => {
  const { status, chunkId, timestamp } = job.returnvalue;
  const timeStr = timestamp !== undefined ? ` (${formatTime(timestamp)})` : '';
  logger.info(`[SLOW] Chunk ${chunkId}${timeStr}: ${status}`);
});

slowWorker.on("failed", (job, err) => {
  logger.error(`[SLOW] Job ${job?.id} failed`, err);
});

const shutdown = async () => {
  logger.info("Slow Worker shutting down...");
  
  try {
    await slowWorker.close();
    await closeMongoDB("Slow Worker");
    logger.success("Slow Worker closed successfully");
    process.exit(0);
  } catch (error) {
    logger.error("Error during Slow Worker shutdown", error);
    process.exit(1);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function startWorker() {
  // Check Redis connection
  const redisConnected = await checkRedis();
  if (!redisConnected) {
    logger.error('Cannot start Slow Worker: Redis connection failed');
    process.exit(1);
  }

  // Connect to MongoDB with retry logic
  try {
    await connectMongoDB({ workerName: "Slow Worker" });
  } catch (error) {
    logger.error('MongoDB connection failed', error);
    process.exit(1);
  }

  logger.info(`Slow Worker Active. Python: ${PYTHON_PATH}`);
  logger.info(`Listening on queue: ${SLOW_QUEUE}`);
}

startWorker();
