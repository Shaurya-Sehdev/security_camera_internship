const mongoose = require("mongoose");

const favouriteSchema = new mongoose.Schema({
  cameraId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Camera",
    required: true,
  },
  userEmail: {
    type: String,
    required: [true, "User email is required for favorites"],
  }
}, {
  timestamps: true,
});

// Compound unique index: prevents duplicate favourites per user
favouriteSchema.index({ cameraId: 1, userEmail: 1 }, { unique: true });

module.exports = mongoose.model("Favourite", favouriteSchema);
