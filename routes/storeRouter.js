const express = require("express");
const storeRouter = express.Router();
const storeController = require("../controllers/storeController");

storeRouter.get("/", storeController.getIndex);

storeRouter.get("/cameras", storeController.getCameras);

storeRouter.get("/cameras/:cameraId/aisecure", storeController.getAISecure);

storeRouter.get("/cameras/:cameraId", storeController.getCameraDetails);

module.exports = storeRouter;