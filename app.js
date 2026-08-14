require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoDBStore = require("connect-mongodb-session")(session);
const { validateConfig } = require("./utils/configValidator");
const logger = require("./utils/logger");
const healthController = require("./controllers/healthController");
const { connectMongoDB, closeMongoDB } = require("./utils/mongodb");

// Validate configuration before starting
if (!validateConfig()) {
  logger.error("Configuration validation failed. Please check your .env file.");
  process.exit(1);
}

const app = express();
const storeRouter = require("./routes/storeRouter");
const hostRouter = require("./routes/hostRouter");
const authRouter = require("./routes/authRouter");
const favouriteRouter = require("./routes/favouriteRouter");
const analysisRouter = require("./routes/analysisRouter");
const errorsController = require("./controllers/errors");
const rootDir = require("./utils/pathUtil");
const { sanitizeInput } = require("./middleware/validation");

app.set("view engine", "ejs");
app.set("views", "views");
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.json({ limit: "10mb" }));

app.use("/videos", express.static(path.join(__dirname, "videos")));
app.use(express.static(path.join(__dirname, "public")));
app.use(sanitizeInput);

const DB_PATH = process.env.MONGO_URL;
if (!DB_PATH) {
  logger.error("FATAL: MONGO_URL not found in environment variables!");
  process.exit(1);
}

let store;
try {
  store = new MongoDBStore({
    uri: DB_PATH,
    collection: "sessions",
    connectionOptions: {
      serverSelectionTimeoutMS: 10000
    }
  });
  store.on("error", (error) => {
    logger.warn("MongoDB Session Store error ignored, session running:", error.message);
  });
} catch (e) {
  logger.warn("Session store initialized with memory fallback.");
}

// Suppress unhandled connect-mongodb-session errors from crashing the process
process.on('uncaughtException', (err) => {
  if (err && err.message && err.message.includes('connect-mongodb-session')) {
    logger.warn("Caught connect-mongodb-session DNS error:", err.message);
  } else {
    logger.error("Uncaught Exception:", err);
    process.exit(1);
  }
});

app.use(
  session({
    secret: process.env.SESSION_SECRET || "CHANGE_THIS_IN_PRODUCTION",
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

app.use((req, res, next) => {
  res.locals.isLoggedIn = req.session.isLoggedIn || false;
  req.isLoggedIn = req.session.isLoggedIn || false;
  next();
});

app.use(authRouter);
app.use(storeRouter);
app.use("/favourites", favouriteRouter);
app.use("/api/analysis", analysisRouter);

function ensureAuth(req, res, next) {
  if (req.session.isLoggedIn) return next();
  res.redirect("/login");
}

app.use("/host", ensureAuth, hostRouter);

// Health check endpoints
app.get("/health", healthController.healthCheck);
app.get("/ready", healthController.readinessCheck);

app.use(errorsController.pageNotFound);

// Global error handler (must be last)
const errorHandler = require("./middleware/errorHandler");
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

// Start server with MongoDB connection
async function startServer() {
  try {
    await connectMongoDB({ workerName: "Main App" });
    
    app.listen(PORT, () => {
      logger.success(`Server running at http://localhost:${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
    });
  } catch (err) {
    logger.error("Failed to start server", err);
    process.exit(1);
  }
}

// Start background video normalization engine
require("./utils/videoOptimizer").startOptimizer();

startServer();

const shutdown = async () => {
  logger.info("Shutting down gracefully...");
  try {
    await closeMongoDB("Main App");
    process.exit(0);
  } catch (err) {
    logger.error("Error during shutdown", err);
    process.exit(1);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);