const { Queue } = require("bullmq");
const path = require("path");
const fs = require("fs");
const rootDir = require("../utils/pathUtil");
const { spawn } = require("child_process");
const { connection, FAST_QUEUE } = require("../config/redis");
const Analysis = require("../models/analysis");
const Camera = require("../models/camera");
const mongoose = require("mongoose");
const logger = require("../utils/logger");
const { fork } = require("child_process");

let fastWorkerProcess = null;
let slowWorkerProcess = null;

function ensureWorkersRunning() {
  if (!fastWorkerProcess) {
    logger.info("🚀 [SYSTEM] Auto-starting Fast Worker in background...");
    fastWorkerProcess = fork(path.join(rootDir, "workers", "fastWorker.js"));
    fastWorkerProcess.on("exit", () => { fastWorkerProcess = null; });
  }
  
  if (!slowWorkerProcess) {
    logger.info("🚀 [SYSTEM] Auto-starting Slow Worker in background...");
    slowWorkerProcess = fork(path.join(rootDir, "workers", "slowWorker.js"));
    slowWorkerProcess.on("exit", () => { slowWorkerProcess = null; });
  }
}

const videoQueue = new Queue(FAST_QUEUE, { connection });

exports.startAnalysis = async (req, res) => {
  try {
    ensureWorkersRunning();
    
    const { cameraId } = req.params;
    const camera = await Camera.findOne({ _id: cameraId, userEmail: req.session.userEmail || "anonymous@security.com" });

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

    // Get absolute video path - Universal Resolver
    let videoPath = camera.videoUrl.trim();
    
    // Normalize path (Remove leading slash for easier relative checks)
    const relativePath = videoPath.startsWith("/") ? videoPath.substring(1) : videoPath;
    
    // Search Order:
    // 1. Direct Absolute Path
    // 2. Project Root + relativePath
    // 3. Project Root + public + relativePath
    // 4. Project Root + public + videos + relativePath
    
    const possiblePaths = [
        videoPath,                                      // Absolute
        path.join(rootDir, relativePath),              // Root relative
        path.join(rootDir, "public", relativePath),    // Public relative
        path.join(rootDir, "public", "videos", relativePath), // Public/videos relative
        path.join(rootDir, "videos", relativePath)     // Root/videos relative
    ];

    let finalPath = "";
    for (const p of possiblePaths) {
        if (path.isAbsolute(p) && fs.existsSync(p)) {
            finalPath = p;
            break;
        }
    }

    if (!finalPath) {
        logger.warn(`Video file not found at any location: ${videoPath}`);
        return res.status(400).json({ 
            success: false,
            error: "Video file not found. Please check the path." 
        });
    }
    
    videoPath = finalPath;
    logger.info(`[RESOLVER] Resolved video to: ${videoPath}`);

    // Ensure video file exists
    if (!fs.existsSync(videoPath)) {
      logger.warn(`Video file not found: ${videoPath}`);
      return res.status(400).json({ 
        success: false,
        error: "Video file not found at specified path" 
      });
    }

    const fastTempDir = path.join(rootDir, "public", "videos", "temp", "fast_" + cameraId);
    const slowTempDir = path.join(rootDir, "public", "videos", "temp", "slow_" + cameraId);

    // Ensure temp directories exist
    if (!fs.existsSync(fastTempDir)) {
      fs.mkdirSync(fastTempDir, { recursive: true });
    }
    if (!fs.existsSync(slowTempDir)) {
      fs.mkdirSync(slowTempDir, { recursive: true });
    }

    // Clear existing analysis for this camera
    await Analysis.deleteMany({ cameraId });

    // Queue the initial video split job with highest priority so the UI starts Deep Dive immediately
    const job = await videoQueue.add(
      "initialVideoSplit",
      {
        videoPath,
        fastTempDir,
        slowTempDir,
        userId: req.session.userId || req.sessionID || "default",
        userEmail: req.session.userEmail || null, // Logged-in user's email for alert emails
        cameraId: cameraId,
      },
      {
        jobId: `video-split-${cameraId}-${Date.now()}`,
        priority: 1, // Bypass all leftover chunks from previous sessions!
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

    // First ensure the camera belongs to the user
    const camera = await Camera.findOne({ _id: cameraId, userEmail: req.session.userEmail || "anonymous@security.com" });
    if (!camera) {
      return res.status(403).json({ success: false, error: "Unauthorized access to these results" });
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
      .filter((a) => a.chunkType === "slow")
      .map((a) => ({
        chunkId: a.chunkId,
        timestamp: a.timestamp,
        analysis: a.analysis || {},
        groqVerdict: a.groqVerdict || { isSuspicious: false, reason: '' },
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

    // Ensure the camera belongs to the user
    const camera = await Camera.findOne({ _id: cameraId, userEmail: req.session.userEmail || "anonymous@security.com" });
    if (!camera) {
      return res.status(403).json({ success: false, error: "Unauthorized access to this status" });
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

exports.getRealtimeStream = async (req, res) => {
  try {
    const { cameraId } = req.params;
    const camera = await Camera.findOne({ _id: cameraId, userEmail: req.session.userEmail || "anonymous@security.com" });

    if (!camera || !camera.videoUrl) {
      return res.status(404).send("Camera or video not found");
    }

    let videoPath = camera.videoUrl.trim();
    
    // Normalize path (Remove leading slash for easier relative checks)
    const relativePath = videoPath.startsWith("/") ? videoPath.substring(1) : videoPath;
    
    const possiblePaths = [
        videoPath,                                      // Absolute
        path.join(rootDir, relativePath),              // Root relative
        path.join(rootDir, "public", relativePath),    // Public relative
        path.join(rootDir, "public", "videos", relativePath), // Public/videos relative
        path.join(rootDir, "videos", relativePath)     // Root/videos relative
    ];

    let finalPath = "";
    for (const p of possiblePaths) {
        if (path.isAbsolute(p) && fs.existsSync(p)) {
            finalPath = p;
            break;
        }
    }

    if (!finalPath) {
        return res.status(404).send("Video file not found. Path resolution failed.");
    }
    videoPath = finalPath;

    if (!fs.existsSync(videoPath)) {
      return res.status(404).send("Video file not found");
    }

    const pythonPath = process.env.PYTHON_PATH || "python";
    const scriptPath = path.join(rootDir, "realtime_yolo.py");

    res.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=frame",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Pragma": "no-cache",
    });

    // Use conda run if needed, but here we assume the pythonPath is correct if it points to the conda env
    // or we can wrap it in conda run
    const pythonProcess = spawn(pythonPath, [scriptPath, videoPath]);

    pythonProcess.stdout.pipe(res);

    pythonProcess.stderr.on("data", (data) => {
      logger.error(`[STREAM PYTHON ERROR]: ${data}`);
    });

    req.on("close", () => {
      pythonProcess.kill();
    });

  } catch (error) {
    logger.error("Error in realtime stream", error);
    if (!res.headersSent) {
      res.status(500).send("Internal Server Error");
    }
  }
};
