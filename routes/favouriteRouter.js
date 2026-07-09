const express = require("express");
const router = express.Router();
const favouriteController = require("../controllers/favouriteController");
const isAuth = require("../middleware/isAuth");

router.get("/", isAuth, favouriteController.getFavouriteList);

router.post("/:cameraId/add", isAuth, favouriteController.postAddToFavourite);

router.post(
  "/:cameraId/remove",
  isAuth,
  favouriteController.postRemoveFromFavourite
);

module.exports = router;
