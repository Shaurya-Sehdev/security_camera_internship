const bcrypt = require("bcryptjs");
const User = require("../models/user");
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
      error: null
    });
  } catch (err) {
    logger.error("Error rendering login page", err);
    next(err);
  }
};

exports.postLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).render("auth/login", {
        pageTitle: "Login",
        currentPage: "login",
        isLoggedIn: false,
        error: "Invalid email or password."
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).render("auth/login", {
        pageTitle: "Login",
        currentPage: "login",
        isLoggedIn: false,
        error: "Invalid email or password."
      });
    }

    req.session.isLoggedIn = true;
    req.session.userEmail = user.email;
    req.session.userId = user._id;

    req.session.save((err) => {
      if (err) {
        logger.error("Session save error during login", err);
        return next(err);
      }
      logger.info(`User logged in: ${user.email}`);
      res.redirect("/host/add-camera");
    });
  } catch (err) {
    logger.error("Error during login", err);
    next(err);
  }
};

exports.getSignup = (req, res, next) => {
  res.render("auth/signup", {
    pageTitle: "Signup",
    currentPage: "signup",
    isLoggedIn: false,
    error: null
  });
};

exports.postSignup = async (req, res, next) => {
  try {
    const { email, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      return res.status(400).render("auth/signup", {
        pageTitle: "Signup",
        currentPage: "signup",
        isLoggedIn: false,
        error: "Passwords do not match."
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).render("auth/signup", {
        pageTitle: "Signup",
        currentPage: "signup",
        isLoggedIn: false,
        error: "Email already exists. Please login."
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = new User({
      email: email.toLowerCase().trim(),
      password: hashedPassword
    });

    await user.save();
    logger.success(`New user registered: ${email}`);
    res.redirect("/login");
  } catch (err) {
    logger.error("Error during signup", err);
    next(err);
  }
};

exports.postLogout = (req, res, next) => {
  try {
    const email = req.session.userEmail;
    req.session.destroy((err) => {
      if (err) {
        logger.error("Error destroying session", err);
        return next(err);
      }
      res.clearCookie("connect.sid");
      logger.info(`User logged out: ${email}`);
      res.redirect("/");
    });
  } catch (err) {
    logger.error("Error during logout", err);
    next(err);
  }
};
