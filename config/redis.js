const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
};

const FAST_QUEUE = "fast-video-analysis";
const SLOW_QUEUE = "slow-video-analysis";

module.exports = {
  connection,
  FAST_QUEUE,
  SLOW_QUEUE,
};
