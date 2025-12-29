const logger = require("../utils/logger");

const errorHandler = (err, req, res, next) => {
  logger.error("Unhandled error in middleware", err, {
    url: req.url,
    method: req.method,
    ip: req.ip,
  });

  if (req.accepts("json")) {
    return res.status(err.status || 500).json({
      success: false,
      error: err.message || "Internal server error",
      details: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  }

  res.status(err.status || 500).render("404", {
    pageTitle: "Error",
    currentPage: "error",
    isLoggedIn: req.isLoggedIn || false,
    error: err.message || "An error occurred",
  });
};

module.exports = errorHandler;

