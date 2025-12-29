const Favourite = require("../models/favourite");
const Camera = require("../models/camera");
const mongoose = require("mongoose");
const logger = require("../utils/logger");

exports.getFavouriteList = (req, res, next) => {
  Favourite.find()
    .populate("cameraId")
    .sort({ createdAt: -1 })
    .then((favourites) => {
      const cameras = favourites
        .map((f) => f.cameraId)
        .filter((camera) => camera !== null);

      res.render("store/favourite_cameras", {
        pageTitle: "My Favourite Cameras",
        cameras: cameras || [],
        currentPage: "favourites",
        isLoggedIn: req.isLoggedIn,
      });
    })
    .catch((err) => {
      logger.error("Error loading favourites", err);
      next(err);
    });
};

exports.postAddToFavourite = async (req, res, next) => {
  try {
    const cameraId = req.params.cameraId || req.body.id;

    if (!cameraId || !mongoose.Types.ObjectId.isValid(cameraId)) {
      logger.warn(`Invalid camera ID provided for favourite: ${cameraId}`);
      return res.redirect("/favourites");
    }

    const camera = await Camera.findById(cameraId);
    if (!camera) {
      logger.warn(`Camera not found for favourite: ${cameraId}`);
      return res.redirect("/favourites");
    }

    const existingFav = await Favourite.findOne({ cameraId });
    if (existingFav) {
      logger.info(`Camera already in favourites: ${cameraId}`);
      return res.redirect("/favourites");
    }

    await new Favourite({ cameraId }).save();
    logger.info(`Favourite added successfully: ${cameraId}`);
    return res.redirect("/favourites");
  } catch (err) {
    logger.error("Error adding to favourites", err);
    return res.redirect("/favourites");
  }
};

exports.postRemoveFromFavourite = async (req, res, next) => {
  try {
    const cameraId = req.params.cameraId;

    if (!cameraId || !mongoose.Types.ObjectId.isValid(cameraId)) {
      logger.warn(`Invalid camera ID provided for removing favourite: ${cameraId}`);
      return res.redirect("/favourites");
    }

    const deletedFav = await Favourite.findOneAndDelete({ cameraId });
    if (!deletedFav) {
      logger.warn(`Favourite not found: ${cameraId}`);
      return res.redirect("/favourites");
    }
    
    logger.info(`Removed from favourites: ${cameraId}`);
    res.redirect("/favourites");
  } catch (err) {
    logger.error("Error removing favourite", err);
    res.redirect("/favourites");
  }
};
