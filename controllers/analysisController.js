const { Queue } = require("bullmq");
const path = require("path");
const { connection, FAST_QUEUE } = require("../config/redis");
const Analysis = require("../models/analysis");
const Camera = require("../models/camera");
const mongoose = require("mongoose");
const logger = require("../utils/logger");

const videoQueue = new Queue(FAST_QUEUE, { connection });

exports.startAnalysis = async (req, res) => {
  try {
    const { cameraId } = req.params;
    const camera = await Camera.findById(cameraId);

    if (!camera) {
      return res.status(404).json({ 
        success: false,
        error: "Camera not found" 
      });
    }

    if (!camera.videoUrl || !camera.videoUrl.trim()) {
      return res.status(400).json({ 
        success: false,
        error: "No video URL available for this camera" 
      });
    }

    // Get absolute video path
    let videoPath = camera.videoUrl;
    const rootDir = require("../utils/pathUtil");
    
    if (videoPath.startsWith("/videos/")) {
      videoPath = path.join(rootDir, "public", videoPath);
    } else if (!path.isAbsolute(videoPath)) {
      // If relative path, make it absolute
      videoPath = path.join(rootDir, "public", "videos", videoPath);
    }

    // Ensure video file exists
    const fs = require("fs");
    if (!fs.existsSync(videoPath)) {
      logger.warn(`Video file not found: ${videoPath}`);
      return res.status(400).json({ 
        success: false,
        error: "Video file not found at specified path" 
      });
    }

    const baseDir = path.dirname(videoPath);
    const fastTempDir = path.join(baseDir, "fast_temp_chunks");
    const slowTempDir = path.join(baseDir, "slow_temp_chunks");

    // Ensure temp directories exist
    if (!fs.existsSync(fastTempDir)) {
      fs.mkdirSync(fastTempDir, { recursive: true });
    }
    if (!fs.existsSync(slowTempDir)) {
      fs.mkdirSync(slowTempDir, { recursive: true });
    }

    // Clear existing analysis for this camera
    await Analysis.deleteMany({ cameraId });

    // Queue the initial video split job
    const job = await videoQueue.add(
      "initialVideoSplit",
      {
        videoPath,
        fastTempDir,
        slowTempDir,
        userId: req.session.userId || req.sessionID || "default",
        cameraId: cameraId,
      },
      {
        jobId: `video-split-${cameraId}-${Date.now()}`,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
      }
    );

    logger.info(`Analysis job queued for camera ${cameraId}`, { jobId: job.id });

    res.json({
      success: true,
      message: "Analysis started",
      cameraId,
      jobId: job.id,
    });
  } catch (error) {
    logger.error("Error starting analysis", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to start analysis",
      details: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
};

exports.getAnalysisResults = async (req, res) => {
  try {
    const { cameraId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(cameraId)) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid camera ID format" 
      });
    }

    const analyses = await Analysis.find({ cameraId })
      .sort({ timestamp: 1 })
      .lean();

    // Group by type and format for frontend
    const fastResults = analyses
      .filter((a) => a.chunkType === "fast")
      .map((a) => ({
        chunkId: a.chunkId,
        timestamp: a.timestamp,
        personDetected: a.personDetected,
        status: a.status,
      }));

    const slowResults = analyses
      .filter((a) => a.chunkType === "slow" && a.status === "completed")
      .map((a) => ({
        chunkId: a.chunkId,
        timestamp: a.timestamp,
        analysis: a.analysis,
        status: a.status,
      }));

    res.json({
      success: true,
      fastResults,
      slowResults,
      totalFastChunks: fastResults.length,
      completedSlowChunks: slowResults.length,
    });
  } catch (error) {
    logger.error("Error fetching analysis results", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch analysis results" 
    });
  }
};

exports.getAnalysisStatus = async (req, res) => {
  try {
    const { cameraId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(cameraId)) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid camera ID format" 
      });
    }

    const stats = await Analysis.aggregate([
      { $match: { cameraId: new mongoose.Types.ObjectId(cameraId) } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const statusCounts = {};
    stats.forEach((stat) => {
      statusCounts[stat._id] = stat.count;
    });

    const totalFast = await Analysis.countDocuments({
      cameraId,
      chunkType: "fast",
    });
    const totalSlow = await Analysis.countDocuments({
      cameraId,
      chunkType: "slow",
    });
    const completedSlow = await Analysis.countDocuments({
      cameraId,
      chunkType: "slow",
      status: "completed",
    });

    res.json({
      success: true,
      statusCounts,
      totalFast,
      totalSlow,
      completedSlow,
      isComplete: completedSlow === totalSlow && totalSlow > 0,
    });
  } catch (error) {
    logger.error("Error fetching analysis status", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch analysis status" 
    });
  }
};

