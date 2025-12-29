const logger = require("../utils/logger");

exports.pageNotFound = (req, res, next) => {
  logger.warn(`404 - Page not found: ${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
  
  res.status(404).render("404", {
    pageTitle: "Page Not Found",
    currentPage: "404",
    isLoggedIn: req.isLoggedIn || false,
  });
};
