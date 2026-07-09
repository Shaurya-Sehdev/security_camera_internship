require("dotenv").config();
const logger = require("./logger");

const requiredEnvVars = {
  MONGO_URL: process.env.MONGO_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
};

const optionalEnvVars = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || "development",
  PYTHON_PATH: process.env.PYTHON_PATH || "python",
};

function validateConfig() {
  const missing = [];
  const warnings = [];

  // Check required variables
  Object.keys(requiredEnvVars).forEach(key => {
    if (!requiredEnvVars[key] || requiredEnvVars[key].trim() === "") {
      missing.push(key);
    }
  });

  // Check SESSION_SECRET in production
  if (process.env.NODE_ENV === "production" && 
      requiredEnvVars.SESSION_SECRET === "CHANGE_THIS_IN_PRODUCTION") {
    warnings.push("SESSION_SECRET is using default value in production!");
  }

  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(", ")}`);
    return false;
  }

  if (warnings.length > 0) {
    warnings.forEach(warning => logger.warn(warning));
  }

  return true;
}

function getConfig() {
  return {
    ...requiredEnvVars,
    ...optionalEnvVars,
  };
}

module.exports = {
  validateConfig,
  getConfig,
};

