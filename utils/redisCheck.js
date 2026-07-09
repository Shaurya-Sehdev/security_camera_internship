const Redis = require('ioredis');
const { connection } = require('../config/redis');

async function checkRedisConnection() {
  const redis = new Redis(connection);
  
  try {
    await redis.ping();
    console.log('[SUCCESS] Redis connection established');
    await redis.quit();
    return true;
  } catch (error) {
    console.error('[ERROR] Redis connection failed:', error.message);
    console.error('[INFO] Make sure Redis is running on', `${connection.host}:${connection.port}`);
    await redis.quit();
    return false;
  }
}

module.exports = checkRedisConnection;

