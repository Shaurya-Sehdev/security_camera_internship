module.exports = (req, res, next) => {
  try {
    if (!req.session || !req.session.isLoggedIn) {
      return res.redirect("/login");
    }
    next();
  } catch (err) {
    console.error("[WARNING] Auth middleware error:", err);
    res.redirect("/login");
  }
};
