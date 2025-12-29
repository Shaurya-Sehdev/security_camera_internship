const { Queue } = require("bullmq");
const path = require("path");
const { connection, FAST_QUEUE } = require("../config/redis");

const videoQueue = new Queue(FAST_QUEUE, { connection });

async function addJob(jobName, data) {
  const job = await videoQueue.add(jobName, data, {
    jobId: `${jobName}-${Date.now()}`,
  });
  console.log(`Job '${jobName}' added to the queue with ID: ${job.id}`);
  return job;
}

const baseDir = path.join(
  "C:",
  "Shaurya",
  "BACK-END",
  "security_camera",
  "public",
  "videos"
);

const videoData = {
  videoPath: path.join(baseDir, "video1.mp4"),
  fastTempDir: path.join(baseDir, "fast_temp_chunks"),
  slowTempDir: path.join(baseDir, "slow_temp_chunks"),
  userId: "user-123",
  analysisType: "Full",
};

addJob("initialVideoSplit", videoData);

console.log(`Producer is running and added the first job to ${FAST_QUEUE}.`);
