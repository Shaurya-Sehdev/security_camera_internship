const { Queue } = require("bullmq");
const { connection, FAST_QUEUE, SLOW_QUEUE } = require("./config/redis");

async function cleanupQueue(queueName) {
  const queue = new Queue(queueName, { connection });

  console.log(`Clearing all jobs from the queue: ${queueName}...`);

  await queue.obliterate({ force: true });

  console.log(`Cleanup complete. Queue ${queueName} is empty!`);
  await queue.close();
}

async function runCleanup() {
    await cleanupQueue(FAST_QUEUE);
    await cleanupQueue(SLOW_QUEUE);
}

runCleanup().catch(console.error);