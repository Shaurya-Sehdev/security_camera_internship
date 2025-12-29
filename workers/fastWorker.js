require("dotenv").config();
const { exec } = require("child_process");
const { Worker, Queue } = require("bullmq");
const path = require("path");
const { connection, FAST_QUEUE, SLOW_QUEUE } = require("../config/redis");
const { splitVideo } = require("../utils/ffmpeg");
const Analysis = require("../models/analysis");
const checkRedis = require("../utils/redisCheck");
const mongoose = require("mongoose");
const logger = require("../utils/logger");

// Video chunking configuration
const FAST_CHUNK_TIME = 1; // 1 second chunks for fast YOLO detection
const SLOW_CHUNK_TIME = 6; // 6 second chunks for detailed analysis
const SLOW_OVERLAP_TIME = 0;

const PYTHON_PATH = process.env.PYTHON_PATH || "python";

const fastQueue = new Queue(FAST_QUEUE, { connection });
const slowQueue = new Queue(SLOW_QUEUE, { connection });

const fastWorker = new Worker(
  FAST_QUEUE,
  async (job) => {
    const { name, data } = job;
    logger.info(`[FAST WORKER] Job ID: ${job.id}, Type: ${name}`);

    if (name === "initialVideoSplit") {
      const { videoPath, fastTempDir, slowTempDir, userId, cameraId } = data;

      logger.info(`[FFmpeg] Starting SLOW splitting (${SLOW_CHUNK_TIME}s)...`);
      const { totalChunks: slowChunks } = await splitVideo(
        videoPath,
        slowTempDir,
        SLOW_CHUNK_TIME,
        "slow_chunk",
        SLOW_OVERLAP_TIME
      );

      logger.info(`[FFmpeg] Starting FAST splitting (${FAST_CHUNK_TIME}s)...`);
      const { totalChunks: fastChunks } = await splitVideo(
        videoPath,
        fastTempDir,
        FAST_CHUNK_TIME,
        "fast_chunk"
      );

      logger.success(`Video split complete: ${fastChunks} fast chunks, ${slowChunks} slow chunks`);
      logger.info("Waiting for file system sync...");
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Queue analysis jobs for each fast chunk
      for (let i = 0; i < fastChunks; i++) {
        const chunkFileName = `fast_chunk_${i.toString().padStart(4, "0")}.mp4`;
        const chunkPath = path.join(fastTempDir, chunkFileName);
        const slowChunkId = Math.floor(i / SLOW_CHUNK_TIME);

        await fastQueue.add(
          "analyzeChunk",
          {
            chunkPath,
            chunkId: i,
            slowChunkId,
            userId,
            cameraId,
            videoPath,
            totalFastChunks: fastChunks,
            slowTempDir,
            totalSlowChunks: slowChunks,
          },
          {
            jobId: `fast-chunk-analysis-${i}-${Date.now()}`,
            delay: i < 10 ? i * 100 : 0,
          }
        );
      }
      return { status: "Split Complete", fastChunks, slowChunks };
    }

    if (name === "analyzeChunk") {
      const {
        chunkId,
        slowChunkId,
        chunkPath,
        userId,
        cameraId,
        videoPath,
        slowTempDir,
        totalSlowChunks,
      } = data;
      const script = path.join(__dirname, "..", "yolo_processor.py");

      try {
        const fs = require("fs");
        if (!fs.existsSync(chunkPath)) {
          throw new Error(`Chunk file not found: ${chunkPath}`);
        }

        const timestamp = chunkId * FAST_CHUNK_TIME;

        // Save pending analysis record
        await Analysis.findOneAndUpdate(
          { cameraId, chunkId, chunkType: "fast" },
          {
            cameraId,
            videoPath,
            chunkType: "fast",
            chunkId,
            slowChunkId,
            timestamp,
            status: "processing",
            personDetected: false,
          },
          { upsert: true, new: true }
        );

        // Run YOLO detection on video chunk
        const fastResult = await new Promise((resolve, reject) => {
          const options = {
            timeout: 20000,
            env: { ...process.env },
          };

          exec(
            `"${PYTHON_PATH}" "${script}" "${chunkPath}"`,
            options,
            (err, stdout, stderr) => {
              if (err) {
                console.error(
                  `[ERROR] YOLO processing failed for chunk ${chunkId}:\n${stderr}`
                );
                return reject(err);
              }
              try {
                const res = JSON.parse(stdout.trim());
                if (res.confidence) {
                  logger.info(`Chunk ${chunkId}: Detection confidence: ${(res.confidence * 100).toFixed(1)}%`);
                }
                if (res.error) {
                  logger.warn(`YOLO processing warning for chunk ${chunkId}: ${res.error}`);
                }
                resolve(res.person_detected);
              } catch (e) {
                logger.error(`JSON Parse Error for chunk ${chunkId}`, e, { stdout });
                reject(new Error(`JSON Parse Error: ${stdout}`));
              }
            }
          );
        });

        // Update analysis record with result
        await Analysis.findOneAndUpdate(
          { cameraId, chunkId, chunkType: "fast" },
          {
            personDetected: fastResult,
            status: "completed",
          }
        );

        // If person detected, queue detailed analysis
        if (fastResult === true) {
          logger.info(
            `Chunk ${chunkId} (${formatTime(timestamp)}): Person detected → Queuing slow analysis for chunk ${slowChunkId}`
          );

          await slowQueue.add(
            "detailedAnalysis",
            {
              slowChunkId,
              slowChunkDir: slowTempDir,
              userId,
              cameraId,
              videoPath,
              totalChunks: totalSlowChunks,
              triggeredByFastChunk: chunkId,
            },
            {
              jobId: `slow-chunk-analysis-${slowChunkId}`,
              removeOnComplete: true,
              removeOnFail: false,
            }
          );
          return { status: "Detected", chunkId, timestamp };
        } else {
          logger.info(
            `Chunk ${chunkId} (${formatTime(timestamp)}): No person detected`
          );
        }
        return { status: "Clear", chunkId, timestamp };
      } catch (error) {
        logger.error(`YOLO failed for chunk ${chunkId}`, error);
        
        // Update analysis record with error
        await Analysis.findOneAndUpdate(
          { cameraId, chunkId, chunkType: "fast" },
          {
            status: "error",
            error: error.message,
          }
        );
        
        return { status: "Error", chunkId, error: error.message };
      }
    }
  },
  { connection, concurrency: 4 }
);

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

const shutdown = async () => {
  logger.info("Fast Worker shutting down...");
  
  try {
    await fastWorker.close();
    await mongoose.connection.close();
    logger.success("Fast Worker closed successfully");
    process.exit(0);
  } catch (error) {
    logger.error("Error during Fast Worker shutdown", error);
    process.exit(1);
  }
};

fastWorker.on("completed", (job) => {
  if (job.name === "analyzeChunk") {
    const { status, chunkId, timestamp } = job.returnvalue;
    const timeStr = timestamp !== undefined ? ` (${formatTime(timestamp)})` : '';
    logger.info(`[FAST] Chunk ${chunkId}${timeStr}: ${status}`);
  }
});

fastWorker.on("failed", (job, err) => {
  logger.error(`[FAST] Job ${job?.id} failed`, err);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function startWorker() {
  // Check Redis connection
  const redisConnected = await checkRedis();
  if (!redisConnected) {
    logger.error('Cannot start Fast Worker: Redis connection failed');
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
    logger.success('Fast Worker connected to MongoDB');
  } catch (error) {
    logger.error('MongoDB connection failed', error);
    process.exit(1);
  }

  // Handle MongoDB connection errors
  mongoose.connection.on("error", (err) => {
    logger.error("MongoDB connection error in Fast Worker", err);
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected in Fast Worker");
  });

  logger.info(`Fast Worker Active. Python Path: ${PYTHON_PATH}`);
  logger.info(`Listening on queue: ${FAST_QUEUE}`);
}

startWorker();
