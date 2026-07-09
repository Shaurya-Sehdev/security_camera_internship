/**
 * MongoDB Connection Utility
 * Handles DNS resolution issues with MongoDB Atlas SRV on Windows
 */

const dns = require("dns");
const { Resolver } = require("dns").promises;
const mongoose = require("mongoose");
const logger = require("./logger");

// Create a custom resolver with Google DNS
const resolver = new Resolver();
resolver.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1"]);

// Also set global DNS servers as fallback
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1"]);

/**
 * Manually resolve MongoDB SRV connection string to direct format
 * This bypasses Windows DNS issues by using Google DNS directly
 */
async function resolveSrvToDirectUrl(srvUrl) {
  if (!srvUrl.startsWith("mongodb+srv://")) {
    return srvUrl; // Already direct format
  }

  try {
    // Parse the SRV URL
    const match = srvUrl.match(/mongodb\+srv:\/\/([^:]+):([^@]+)@([^/?]+)(.*)/);
    if (!match) {
      throw new Error("Invalid MongoDB SRV URL format");
    }

    const [, username, password, host, queryPart] = match;
    const srvHost = `_mongodb._tcp.${host}`;

    logger.info(`Resolving SRV record: ${srvHost}`);

    // Resolve SRV records using Google DNS
    const srvRecords = await resolver.resolveSrv(srvHost);
    
    if (!srvRecords || srvRecords.length === 0) {
      throw new Error("No SRV records found");
    }

    logger.info(`Found ${srvRecords.length} MongoDB hosts`);

    // Build hosts string
    const hosts = srvRecords
      .map((record) => `${record.name}:${record.port}`)
      .join(",");

    // Try to get TXT records for additional options
    let txtOptions = "";
    try {
      const txtRecords = await resolver.resolveTxt(host);
      if (txtRecords && txtRecords.length > 0) {
        txtOptions = txtRecords[0].join("");
      }
    } catch (txtErr) {
      // TXT records are optional, ignore errors
    }

    // Parse existing query params
    let queryString = queryPart.startsWith("?") ? queryPart.slice(1) : queryPart.slice(1);
    
    // Build the final query string
    const params = new URLSearchParams();
    
    // Add TXT options first
    if (txtOptions) {
      const txtParams = new URLSearchParams(txtOptions);
      txtParams.forEach((value, key) => params.set(key, value));
    }
    
    // Add original query params (override TXT if duplicate)
    if (queryString) {
      const originalParams = new URLSearchParams(queryString);
      originalParams.forEach((value, key) => params.set(key, value));
    }
    
    // Ensure SSL is enabled for Atlas
    if (!params.has("ssl") && !params.has("tls")) {
      params.set("ssl", "true");
    }
    
    // Add authSource if not present
    if (!params.has("authSource")) {
      params.set("authSource", "admin");
    }

    const directUrl = `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${hosts}/?${params.toString()}`;
    
    // Log sanitized URL (hide password)
    const sanitizedUrl = `mongodb://${username}:****@${hosts}/?${params.toString()}`;
    logger.success(`Resolved to: ${sanitizedUrl}`);

    return directUrl;
  } catch (error) {
    logger.error(`SRV resolution failed: ${error.message}`);
    throw error;
  }
}

/**
 * Connect to MongoDB with automatic SRV resolution and retries
 */
async function connectMongoDB(options = {}) {
  const {
    maxRetries = 3,
    retryDelay = 2000,
    workerName = "App",
  } = options;

  const MONGO_URL = process.env.MONGO_URL;

  if (!MONGO_URL) {
    throw new Error("MONGO_URL not found in environment variables");
  }

  const connectionOptions = {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
    family: 4, // Force IPv4
    maxPoolSize: 10,
    minPoolSize: 2,
    retryWrites: true,
    retryReads: true,
    ...options.mongooseOptions,
  };

  let lastError;
  let connectionUrl = MONGO_URL;

  // If SRV format, resolve it first
  if (MONGO_URL.startsWith("mongodb+srv://")) {
    logger.info(`[${workerName}] Resolving MongoDB SRV connection...`);
    try {
      connectionUrl = await resolveSrvToDirectUrl(MONGO_URL);
    } catch (resolveError) {
      logger.warn(`[${workerName}] SRV resolution failed, will try direct connection`);
      // Continue with original URL as fallback
    }
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`[${workerName}] MongoDB connection attempt ${attempt}/${maxRetries}...`);

      await mongoose.connect(connectionUrl, connectionOptions);

      // Get database info for logging (hide credentials)
      const dbInfo = connectionUrl.includes("@")
        ? connectionUrl.split("@")[1]?.split("?")[0] || "connected"
        : "local";

      logger.success(`[${workerName}] Connected to MongoDB`);
      logger.info(`[${workerName}] Hosts: ${dbInfo}`);

      // Setup connection event handlers
      setupConnectionHandlers(workerName);

      return mongoose.connection;
    } catch (error) {
      lastError = error;
      logger.error(`[${workerName}] Connection attempt ${attempt} failed: ${error.message}`);

      if (attempt < maxRetries) {
        const waitTime = retryDelay * attempt;
        logger.info(`Waiting ${waitTime / 1000}s before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  throw new Error(
    `MongoDB connection failed after ${maxRetries} attempts: ${lastError.message}`
  );
}

/**
 * Setup MongoDB connection event handlers
 */
function setupConnectionHandlers(workerName = "App") {
  mongoose.connection.on("error", (err) => {
    logger.error(`[${workerName}] MongoDB error: ${err.message}`);
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn(`[${workerName}] MongoDB disconnected`);
  });

  mongoose.connection.on("reconnected", () => {
    logger.info(`[${workerName}] MongoDB reconnected`);
  });
}

/**
 * Gracefully close MongoDB connection
 */
async function closeMongoDB(workerName = "App") {
  try {
    await mongoose.connection.close();
    logger.success(`[${workerName}] MongoDB connection closed`);
  } catch (error) {
    logger.error(`[${workerName}] Error closing MongoDB: ${error.message}`);
    throw error;
  }
}

/**
 * Check if MongoDB is connected
 */
function isConnected() {
  return mongoose.connection.readyState === 1;
}

module.exports = {
  connectMongoDB,
  closeMongoDB,
  isConnected,
  resolveSrvToDirectUrl,
};
