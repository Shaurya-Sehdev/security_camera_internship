const mongoose = require("mongoose");
const Redis = require("ioredis");
const { connection } = require("../config/redis");
const logger = require("../utils/logger");

exports.healthCheck = async (req, res) => {
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {},
  };

  // Check MongoDB
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.admin().ping();
      health.services.mongodb = { status: "healthy" };
    } else {
      health.services.mongodb = { status: "disconnected" };
      health.status = "degraded";
    }
  } catch (error) {
    health.services.mongodb = { 
      status: "unhealthy", 
      error: error.message 
    };
    health.status = "unhealthy";
  }

  // Check Redis
  try {
    const redis = new Redis(connection);
    await redis.ping();
    await redis.quit();
    health.services.redis = { status: "healthy" };
  } catch (error) {
    health.services.redis = { 
      status: "unhealthy", 
      error: error.message 
    };
    health.status = "unhealthy";
  }

  const statusCode = health.status === "ok" ? 200 : 
                     health.status === "degraded" ? 200 : 503;

  res.status(statusCode).json(health);
};

exports.readinessCheck = async (req, res) => {
  try {
    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ 
        ready: false, 
        reason: "MongoDB not connected" 
      });
    }

    // Check if Redis is accessible
    const redis = new Redis(connection);
    await redis.ping();
    await redis.quit();

    res.json({ ready: true });
  } catch (error) {
    logger.error("Readiness check failed", error);
    res.status(503).json({ 
      ready: false, 
      reason: error.message 
    });
  }
};

