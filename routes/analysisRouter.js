const express = require("express");
const router = express.Router();
const analysisController = require("../controllers/analysisController");
const { validateObjectId } = require("../middleware/validation");
const rateLimit = require("../utils/rateLimiter");

router.post("/camera/:cameraId/start", 
  rateLimit(10, 60000), // 10 requests per minute
  validateObjectId("cameraId"), 
  analysisController.startAnalysis
);
router.get("/camera/:cameraId/results", 
  rateLimit(60, 60000), // 60 requests per minute (for polling)
  validateObjectId("cameraId"), 
  analysisController.getAnalysisResults
);
router.get("/camera/:cameraId/stream",
  validateObjectId("cameraId"),
  analysisController.getRealtimeStream
);

module.exports = router;

