const mongoose = require("mongoose");

const favouriteSchema = new mongoose.Schema({
  cameraId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Camera",
    required: true,
  },
  // TODO: Add userId when user authentication is implemented
  // userId: {
  //   type: mongoose.Schema.Types.ObjectId,
  //   ref: "User",
  //   required: true,
  // },
}, {
  timestamps: true, // Adds createdAt and updatedAt automatically
});

// Compound unique index: prevents duplicate favourites per user
// For now, unique on cameraId only (global favourites)
// When users are added, change to: { cameraId: 1, userId: 1 }, { unique: true }
favouriteSchema.index({ cameraId: 1 }, { unique: true });

module.exports = mongoose.model("Favourite", favouriteSchema);
