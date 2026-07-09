const Camera = require("../models/camera");
const logger = require("../utils/logger");

// Normalizes video URLs to ensure consistent path format
const normalizeVideoUrl = (videoUrl) => {
  if (!videoUrl || typeof videoUrl !== "string") {
    return videoUrl;
  }

  const trimmedUrl = videoUrl.trim();

  if (trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://")) {
    return trimmedUrl;
  }

  if (trimmedUrl.startsWith("/videos/")) {
    return trimmedUrl;
  }

  if (trimmedUrl.startsWith("/") && !trimmedUrl.startsWith("/videos/")) {
    // If it's a root-relative path (e.g. /home/...) check if it's actually an absolute file system path
    if (trimmedUrl.includes("/home/") || trimmedUrl.includes("/Users/") || trimmedUrl.includes("/mnt/")) {
      return trimmedUrl; // Keep absolute paths as-is
    }
    return `/videos${trimmedUrl}`;
  }

  return `/videos/${trimmedUrl}`;
};

// Automatically determines camera status based on video URL presence
const determineStatus = (videoUrl) => {
  if (videoUrl && typeof videoUrl === "string" && videoUrl.trim() !== "") {
    return "Online";
  }
  return "Offline";
};

exports.getAddCamera = (req, res, next) => {
  res.render("host/edit_camera", {
    pageTitle: "Add Surveillance Camera",
    currentPage: "addCamera",
    editing: false,
    camera: {},
    isLoggedIn: req.isLoggedIn,
  });
};

exports.getEditCamera = (req, res, next) => {
  const cameraId = req.params.cameraId;
  const editing = req.query.editing === "true";

  if (!cameraId || !require("mongoose").Types.ObjectId.isValid(cameraId)) {
    console.log("[WARNING] Invalid camera ID provided");
    return res.redirect("/host/host-camera-list");
  }

  Camera.findOne({ _id: cameraId, userEmail: req.session.userEmail || "anonymous@security.com" })
    .then((camera) => {
      if (!camera) {
        console.log("[ERROR] Camera not found or Unauthorized access attempt");
        return res.redirect("/host/host-camera-list");
      }
      res.render("host/edit_camera", {
        pageTitle: "Edit Surveillance Camera",
        currentPage: "host-cameras",
        editing: editing,
        camera: camera,
        isLoggedIn: req.isLoggedIn,
      });
    })
    .catch((err) => {
      console.error("[ERROR] Error fetching camera:", err);
      res.redirect("/host/host-camera-list");
    });
};

exports.getHostCameras = (req, res, next) => {
  Camera.find({ userEmail: req.session.userEmail || "anonymous@security.com" })
    .then((cameras) => {
      res.render("host/host_camera_list", {
        pageTitle: "Host Camera List",
        cameras: cameras || [],
        currentPage: "host-cameras",
        isLoggedIn: req.isLoggedIn,
      });
    })
    .catch((err) => {
      console.error("[ERROR] Error fetching cameras:", err);
      next(err);
    });
};

exports.postAddCamera = async (req, res, next) => {
  try {
    const { cameraName, location, videoUrl, description } = req.body;

    if (!cameraName || !cameraName.trim()) {
      return res.status(400).render("host/edit_camera", {
        pageTitle: "Add Surveillance Camera",
        currentPage: "addCamera",
        editing: false,
        camera: req.body,
        isLoggedIn: req.isLoggedIn,
        error: "Camera name is required",
      });
    }

    if (!location || !location.trim()) {
      return res.status(400).render("host/edit_camera", {
        pageTitle: "Add Surveillance Camera",
        currentPage: "addCamera",
        editing: false,
        camera: req.body,
        isLoggedIn: req.isLoggedIn,
        error: "Location is required",
      });
    }

    const normalizedVideoUrl = normalizeVideoUrl(videoUrl);
    const status = determineStatus(normalizedVideoUrl);

    const camera = new Camera({
      cameraName: cameraName.trim(),
      location: location.trim(),
      videoUrl: normalizedVideoUrl,
      description: description ? description.trim() : "",
      userEmail: req.session.userEmail || "anonymous@security.com",
      status: status,
      createdAt: new Date(),
    });

    await camera.save();
    logger.info(`Camera added successfully: ${camera._id}`);

    res.render("host/camera_added", {
      pageTitle: "Camera Added Successfully",
      cameraName,
      currentPage: "addCamera",
      isLoggedIn: req.isLoggedIn,
    });
  } catch (err) {
    logger.error("Error adding camera", err);
    if (err.name === "ValidationError") {
      return res.status(400).render("host/edit_camera", {
        pageTitle: "Add Surveillance Camera",
        currentPage: "addCamera",
        editing: false,
        camera: req.body,
        isLoggedIn: req.isLoggedIn,
        error: Object.values(err.errors).map(e => e.message).join(", "),
      });
    }
    res.status(500).render("host/edit_camera", {
      pageTitle: "Add Surveillance Camera",
      currentPage: "addCamera",
      editing: false,
      camera: req.body,
      isLoggedIn: req.isLoggedIn,
      error: "Failed to add camera. Please try again.",
    });
  }
};

exports.postEditCamera = async (req, res, next) => {
  try {
    const { id, cameraName, location, videoUrl, description } = req.body;

    if (!id || !require("mongoose").Types.ObjectId.isValid(id)) {
      logger.warn("Invalid camera ID provided for edit");
      return res.redirect("/host/host-camera-list");
    }

    if (!cameraName || !cameraName.trim() || !location || !location.trim()) {
      const camera = await Camera.findOne({ _id: id, userEmail: req.session.userEmail || "anonymous@security.com" });
      if (!camera) {
        return res.redirect("/host/host-camera-list");
      }
      return res.status(400).render("host/edit_camera", {
        pageTitle: "Edit Surveillance Camera",
        currentPage: "host-cameras",
        editing: true,
        camera: camera,
        isLoggedIn: req.isLoggedIn,
        error: "Camera name and location are required",
      });
    }

    const camera = await Camera.findOne({ _id: id, userEmail: req.session.userEmail || "anonymous@security.com" });
    if (!camera) {
      logger.warn(`Camera not found for edit or unauthorized access: ${id}`);
      return res.redirect("/host/host-camera-list");
    }

    const normalizedVideoUrl = normalizeVideoUrl(videoUrl);
    const status = determineStatus(normalizedVideoUrl);

    camera.cameraName = cameraName.trim();
    camera.location = location.trim();
    camera.videoUrl = normalizedVideoUrl;
    camera.description = description ? description.trim() : "";
    camera.status = status;

    await camera.save();
    logger.info(`Camera updated successfully: ${camera._id}`);
    res.redirect("/host/host-camera-list");
  } catch (err) {
    logger.error("Error updating camera", err);
    res.redirect("/host/host-camera-list");
  }
};

exports.postDeleteCamera = async (req, res, next) => {
  try {
    const cameraId = req.params.cameraId;

    if (!cameraId || !require("mongoose").Types.ObjectId.isValid(cameraId)) {
      logger.warn("Invalid camera ID provided for deletion");
      return res.redirect("/host/host-camera-list");
    }

    const Favourite = require("../models/favourite");
    const Analysis = require("../models/analysis");

    const camera = await Camera.findOneAndDelete({ _id: cameraId, userEmail: req.session.userEmail || "anonymous@security.com" });
    if (camera) {
      logger.info(`Camera deleted: ${cameraId}`);
      
      // Clean up related data
      await Promise.all([
        Favourite.deleteMany({ cameraId: cameraId }),
        Analysis.deleteMany({ cameraId: cameraId }),
      ]);
      
      logger.info(`Cleaned up favourites and analysis for camera: ${cameraId}`);
    }

    res.redirect("/host/host-camera-list");
  } catch (err) {
    logger.error("Error deleting camera", err);
    res.redirect("/host/host-camera-list");
  }
};
