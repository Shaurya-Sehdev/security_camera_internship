const mongoose = require("mongoose");

const cameraSchema = new mongoose.Schema({
  cameraName: {
    type: String,
    required: [true, "Camera name is required"],
    trim: true,
    maxlength: [200, "Camera name cannot exceed 200 characters"],
  },
  location: {
    type: String,
    required: [true, "Location is required"],
    trim: true,
    maxlength: [500, "Location cannot exceed 500 characters"],
  },
  videoUrl: {
    type: String,
    required: [true, "Video URL is required"],
    trim: true,
  },
  status: {
    type: String,
    enum: ["Online", "Offline", "Active"],
    default: "Active"
  },
  detectionStatus: {
    type: String,
    default: "No detection data"
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, "Description cannot exceed 1000 characters"],
  },
  userEmail: {
    type: String,
    required: [true, "User email is required for compartmentalization"],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Cascade delete: remove camera from favourites when deleted
cameraSchema.pre("findOneAndDelete", async function (next) {
  try {
    const Favourite = require("./favourite");

    const cameraId = this.getQuery()._id;
    await Favourite.deleteMany({ cameraId: cameraId });

    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model("Camera", cameraSchema);
