const logger = require("../utils/logger");

exports.getLogin = (req, res, next) => {
  try {
    if (req.session.isLoggedIn) {
      return res.redirect("/host/add-camera");
    }

    res.render("auth/login", {
      pageTitle: "Login",
      currentPage: "login",
      isLoggedIn: false,
    });
  } catch (err) {
    logger.error("Error rendering login page", err);
    next(err);
  }
};

exports.postLogin = (req, res, next) => {
  try {
    req.session.isLoggedIn = true;

    req.session.save((err) => {
      if (err) {
        logger.error("Session save error during login", err);
        return next(err);
      }
      logger.info(`User logged in: ${req.sessionID}`);
      res.redirect("/host/add-camera");
    });
  } catch (err) {
    logger.error("Error during login", err);
    next(err);
  }
};

exports.postLogout = (req, res, next) => {
  try {
    const sessionId = req.sessionID;
    req.session.destroy((err) => {
      if (err) {
        logger.error("Error destroying session", err);
        return next(err);
      }
      res.clearCookie("connect.sid");
      logger.info(`User logged out: ${sessionId}`);
      res.redirect("/");
    });
  } catch (err) {
    logger.error("Error during logout", err);
    next(err);
  }
};
