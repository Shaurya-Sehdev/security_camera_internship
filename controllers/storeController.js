const Camera = require("../models/camera");
const mongoose = require("mongoose");
const logger = require("../utils/logger");

exports.getIndex = (req, res, next) => {
  Camera.find()
    .sort({ createdAt: -1 })
    .then((registeredCameras) => {
      res.render("store/camera_index", {
        pageTitle: "Smart Surveillance Dashboard",
        registeredCameras: registeredCameras || [],
        currentPage: "index",
        isLoggedIn: req.isLoggedIn,
      });
    })
    .catch((err) => {
      logger.error("Error loading index", err);
      next(err);
    });
};

exports.getCameras = (req, res, next) => {
  Camera.find()
    .sort({ cameraName: 1 })
    .then((registeredCameras) => {
      res.render("store/camera_list", {
        pageTitle: "Available Surveillance Cameras",
        registeredCameras: registeredCameras || [],
        currentPage: "camera",
        isLoggedIn: req.isLoggedIn,
      });
    })
    .catch((err) => {
      logger.error("Error loading cameras", err);
      next(err);
    });
};

exports.getCameraDetails = (req, res, next) => {
  const cameraId = req.params.cameraId;

  if (!cameraId || !mongoose.Types.ObjectId.isValid(cameraId)) {
    logger.warn(`Invalid camera ID provided: ${cameraId}`);
    return res.redirect("/cameras");
  }

  Camera.findById(cameraId)
    .then((camera) => {
      if (!camera) {
        logger.warn(`Camera not found: ${cameraId}`);
        return res.redirect("/cameras");
      }

      res.render("store/camera_detail", {
        camera,
        pageTitle: `${camera.cameraName || "Camera"} - Details`,
        currentPage: "camera",
        isLoggedIn: req.isLoggedIn,
      });
    })
    .catch((err) => {
      logger.error("Error loading camera details", err);
      next(err);
    });
};

exports.getAISecure = async (req, res, next) => {
  try {
    const cameraId = req.params.cameraId;

    if (!cameraId || !mongoose.Types.ObjectId.isValid(cameraId)) {
      logger.warn(`Invalid camera ID for AISecure: ${cameraId}`);
      return res.redirect('/cameras');
    }

    const camera = await Camera.findById(cameraId);
    
    if (!camera) {
      logger.warn(`Camera not found for AISecure: ${cameraId}`);
      return res.redirect('/cameras');
    }

    if (!camera.videoUrl || !camera.videoUrl.trim()) {
      logger.warn(`Camera ${cameraId} has no video URL for AISecure`);
      return res.redirect(`/cameras/${cameraId}`);
    }
    
    res.render('store/aisecure', { 
      camera,
      pageTitle: `AISecure - ${camera.cameraName}`,
      currentPage: 'camera',
      isLoggedIn: req.isLoggedIn,
    });
  } catch (error) {
    logger.error('Error loading AISecure page', error);
    res.redirect('/cameras');
  }
};