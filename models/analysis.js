const mongoose = require("mongoose");

const analysisSchema = new mongoose.Schema({
  cameraId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Camera",
    required: true,
    index: true,
  },
  videoPath: { 
    type: String, 
    required: true,
  },
  chunkType: { 
    type: String, 
    enum: ["fast", "slow"], 
    required: true,
  },
  chunkId: { 
    type: Number, 
    required: true,
  },
  slowChunkId: { 
    type: Number,
  },
  timestamp: { 
    type: Number, 
    required: true,
    index: true,
  },
  personDetected: { 
    type: Boolean, 
    default: false,
  },
  objectsTracked: [{
    label: String,
    confidence: Number,
    position: String,
  }],
  analysis: {
    title: {
      type: String,
      default: "",
    },
    textContent: [{
      type: String,
    }],
    transcription: {
      type: String,
      default: "",
    },
    summary: {
      type: String,
      default: "",
    },
    keyPoints: [{
      type: String,
    }],
  },
  status: { 
    type: String, 
    enum: ["pending", "processing", "initializing_ai", "completed", "error"], 
    default: "pending",
    index: true,
  },
  statusMessage: {
    type: String,
    default: "",
  },
  groqVerdict: {
    isSuspicious: { type: Boolean, default: false },
    reason: { type: String, default: "" },
  },
  error: {
    type: String,
    default: "",
  },
}, {
  timestamps: true,
});

// Compound indexes for efficient queries
analysisSchema.index({ cameraId: 1, chunkId: 1, chunkType: 1 }, { unique: true });
analysisSchema.index({ cameraId: 1, timestamp: 1 });
analysisSchema.index({ cameraId: 1, status: 1, chunkType: 1 });

// TTL index to auto-delete old analysis after 30 days
analysisSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model("Analysis", analysisSchema);

