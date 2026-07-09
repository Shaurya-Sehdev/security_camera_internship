const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "logs");
const ERROR_LOG = path.join(LOG_DIR, "error.log");
const INFO_LOG = path.join(LOG_DIR, "info.log");

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function formatTimestamp() {
  return new Date().toISOString();
}

function writeToFile(filename, message) {
  try {
    fs.appendFileSync(filename, message + "\n", { encoding: "utf8" });
  } catch (error) {
    console.error("[ERROR] Failed to write to log file:", error.message);
  }
}

const logger = {
  info: (message) => {
    const logMessage = `[${formatTimestamp()}] [INFO] ${message}`;
    console.log(logMessage);
    writeToFile(INFO_LOG, logMessage);
  },

  error: (message, error = null) => {
    const errorDetails = error ? `\nStack: ${error.stack}` : "";
    const logMessage = `[${formatTimestamp()}] [ERROR] ${message}${errorDetails}`;
    console.error(logMessage);
    writeToFile(ERROR_LOG, logMessage);
  },

  warn: (message) => {
    const logMessage = `[${formatTimestamp()}] [WARN] ${message}`;
    console.warn(logMessage);
    writeToFile(INFO_LOG, logMessage);
  },

  success: (message) => {
    const logMessage = `[${formatTimestamp()}] [SUCCESS] ${message}`;
    console.log(logMessage);
    writeToFile(INFO_LOG, logMessage);
  },
};

module.exports = logger;