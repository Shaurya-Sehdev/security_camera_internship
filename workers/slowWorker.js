require("dotenv").config();
const { Worker } = require("bullmq");
const { exec } = require("child_process");
const path = require("path");
const { connection, SLOW_QUEUE } = require("../config/redis");
const Analysis = require("../models/analysis");
const checkRedis = require("../utils/redisCheck");
const mongoose = require("mongoose");
const logger = require("../utils/logger");

const PYTHON_PATH = process.env.PYTHON_PATH || "python";
const SLOW_CHUNK_TIME = 6;

const slowWorker = new Worker(
  SLOW_QUEUE,
  async (job) => {
    const { name, data } = job;

    logger.info(`[SLOW WORKER] Job ID: ${job.id}, Type: ${name}`);

    if (name === "detailedAnalysis") {
      const { slowChunkId, slowChunkDir, userId, cameraId, videoPath, totalChunks, triggeredByFastChunk } = data;

      const chunkFileName = `slow_chunk_${slowChunkId
        .toString()
        .padStart(4, "0")}.mp4`;
      const chunkPath = path.join(slowChunkDir, chunkFileName);
      const timestamp = slowChunkId * SLOW_CHUNK_TIME;

      logger.info(`[SLIDE] Analyzing chunk ${slowChunkId}/${totalChunks} (${formatTime(timestamp)})...`);

      // Save pending analysis record
      await Analysis.findOneAndUpdate(
        { cameraId, chunkId: slowChunkId, chunkType: "slow" },
        {
          cameraId,
          videoPath,
          chunkType: "slow",
          chunkId: slowChunkId,
          timestamp,
          status: "processing",
          personDetected: true,
        },
        { upsert: true, new: true }
      );

      try {
        const pythonScript = path.join(__dirname, "..", "slide_processor.py");
        const command = `"${PYTHON_PATH}" "${pythonScript}" "${chunkPath}" "${userId}"`;

        // Run OCR and audio transcription analysis
        const slideAnalysis = await new Promise((resolve, reject) => {
          exec(
            command,
            {
              maxBuffer: 20 * 1024 * 1024,
              timeout: 60000,
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
    concurrency: 1,
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
    await mongoose.connection.close();
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

  // Check MongoDB connection
  const DB_PATH = process.env.MONGO_URL;
  if (!DB_PATH) {
    logger.error('MONGO_URL not found in environment variables');
    process.exit(1);
  }

  try {
    await mongoose.connect(DB_PATH, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    logger.success('Slow Worker connected to MongoDB');
  } catch (error) {
    logger.error('MongoDB connection failed', error);
    process.exit(1);
  }

  // Handle MongoDB connection errors
  mongoose.connection.on("error", (err) => {
    logger.error("MongoDB connection error in Slow Worker", err);
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected in Slow Worker");
  });

  logger.info(`Slow Worker Active. Python: ${PYTHON_PATH}`);
  logger.info(`Listening on queue: ${SLOW_QUEUE}`);
}

startWorker();
