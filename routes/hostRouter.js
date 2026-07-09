const express = require("express");
const router = express.Router();
const hostController = require("../controllers/hostController");
const isAuth = require("../middleware/isAuth");

router.get("/add-camera", isAuth, hostController.getAddCamera);
router.post("/add-camera", isAuth, hostController.postAddCamera);

router.get("/edit-camera/:cameraId", isAuth, hostController.getEditCamera);
router.post("/edit-camera", isAuth, hostController.postEditCamera);

router.post("/delete-camera/:cameraId", isAuth, hostController.postDeleteCamera);

router.get("/host-camera-list", isAuth, hostController.getHostCameras);

module.exports = router;
