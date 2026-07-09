require("dotenv").config();
const { exec } = require("child_process");
const { Worker, Queue } = require("bullmq");
const path = require("path");
const { connection, FAST_QUEUE, SLOW_QUEUE } = require("../config/redis");
const { splitVideo } = require("../utils/ffmpeg");
const Analysis = require("../models/analysis");
const checkRedis = require("../utils/redisCheck");
const { connectMongoDB, closeMongoDB } = require("../utils/mongodb");
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
      const { videoPath, fastTempDir, slowTempDir, userId, userEmail, cameraId } = data;

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

      // Queue ALL slow chunks for Deep Dive analysis upfront
      for (let j = 0; j < slowChunks; j++) {
        await slowQueue.add(
          "detailedAnalysis",
          {
            slowChunkId: j,
            slowChunkDir: slowTempDir,
            userId,
            userEmail,   // <-- forwarded from logged-in session
            cameraId,
            videoPath,
            totalChunks: slowChunks,
            triggeredByFastChunk: null, // Since we process all chunks now
          },
          {
            jobId: `slow-chunk-analysis-${cameraId}-${j}-${Date.now()}`,
            removeOnComplete: true,
            removeOnFail: false,
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
        const axios = require("axios");

// Run YOLO detection on video chunk
const fastResult = await new Promise(async (resolve, reject) => {
  try {
    // Attempt to use the Persistent AI Bridge first (Ultra Fast)
    const bridgeResponse = await axios.post("http://localhost:5000", {
        task: "fast_yolo",
        videoPath: chunkPath
    }, { timeout: 10000 });
    
    if (bridgeResponse.data && bridgeResponse.data.success) {
        logger.info(`[BRIDGE] Chunk ${chunkId}: Analysis complete via persistent engine.`);
        return resolve({ 
            personDetected: bridgeResponse.data.person_detected, 
            objectsTracked: bridgeResponse.data.objects_tracked || [] 
        });
    }
  } catch (bridgeErr) {
    logger.warn(`[BRIDGE] Persistent engine unavailable, falling back to legacy spawning...`);
  }

  // Fallback to Legacy Process Spawning (Slow)
  const options = {
    timeout: 20000,
    env: { ...process.env },
  };

  exec(
    `"${PYTHON_PATH}" "${script}" "${chunkPath}"`,
    options,
    (err, stdout, stderr) => {
      if (stderr && stderr.trim()) {
        logger.error(`[PYTHON STDERR] Chunk ${chunkId}:\n${stderr.trim()}`);
      }

      const raw = (stdout || "").trim();
      if (raw) {
        try {
          const res = JSON.parse(raw);
          if (res.error) {
            logger.error(`[YOLO SCRIPT ERROR] Chunk ${chunkId}: ${res.error}`);
            return reject(new Error(res.error));
          }
          return resolve({ personDetected: res.person_detected, objectsTracked: res.objects_tracked || [] });
        } catch (parseErr) {
          return reject(new Error(`JSON Parse Error: ${raw}`));
        }
      }

      if (err) {
        logger.error(`[YOLO CRASH] Chunk ${chunkId} failed.`);
        return reject(err);
      }
      return reject(new Error(`Empty output from YOLO script for chunk ${chunkId}`));
    }
  );
});

        // Update analysis record with result
        await Analysis.findOneAndUpdate(
          { cameraId, chunkId, chunkType: "fast" },
          {
            personDetected: fastResult.personDetected,
            objectsTracked: fastResult.objectsTracked,
            status: "completed",
          }
        );

        // If person detected, we just log it since slow analysis is now queued for all chunks upfront
        if (fastResult.personDetected === true) {
          logger.info(
            `Chunk ${chunkId} (${formatTime(timestamp)}): Person detected`
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
  { connection, concurrency: 2 }
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
    await closeMongoDB("Fast Worker");
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

  // Connect to MongoDB with retry logic
  try {
    await connectMongoDB({ workerName: "Fast Worker" });
  } catch (error) {
    logger.error('MongoDB connection failed', error);
    process.exit(1);
  }

  logger.info(`Fast Worker Active. Python Path: ${PYTHON_PATH}`);
  logger.info(`Listening on queue: ${FAST_QUEUE}`);
}

startWorker();
