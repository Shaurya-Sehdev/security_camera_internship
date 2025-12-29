const { exec } = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const logger = require("./logger");

async function getVideoDuration(inputPath) {
  return new Promise((resolve, reject) => {
    const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`;
    exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        logger.error(`FFprobe error for ${inputPath}`, error, { stderr });
        reject(error);
      } else {
        const duration = parseFloat(stdout.trim());
        if (isNaN(duration) || duration <= 0) {
          reject(new Error(`Invalid video duration: ${stdout.trim()}`));
        } else {
          resolve(duration);
        }
      }
    });
  });
}

async function splitVideo(
  inputPath,
  outputDir,
  segmentTime,
  prefix,
  segmentOverlap = 0
) {
  // Validate input file exists
  try {
    await fs.access(inputPath);
  } catch (error) {
    throw new Error(`Input video file not found: ${inputPath}`);
  }

  await fs.mkdir(outputDir, { recursive: true });
  
  const totalDuration = await getVideoDuration(inputPath);
  const padding = Math.max(
    4,
    Math.ceil(totalDuration / segmentTime).toString().length
  );
  const outputPattern = path.join(outputDir, `${prefix}_%0${padding}d.mp4`);

  let command = `ffmpeg -y -i "${inputPath}" -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -force_key_frames "expr:gte(t,n_forced*${segmentTime})" -c:a aac -b:a 128k -ar 44100 -movflags +faststart -f segment -segment_time ${segmentTime} -reset_timestamps 1 "${outputPattern}"`;

  logger.info(`[FFMPEG] Processing: ${inputPath}`);

  await new Promise((resolve, reject) => {
    exec(command, { 
      maxBuffer: 20 * 1024 * 1024,
      timeout: 300000, // 5 minutes timeout
    }, (error, stdout, stderr) => {
      if (error) {
        logger.error(`FFmpeg error for ${inputPath}`, error, { stderr });
        return reject(error);
      }
      resolve();
    });
  });

  const files = await fs.readdir(outputDir);
  let chunkFiles = files
    .filter((f) => f.startsWith(prefix) && f.endsWith(".mp4"))
    .sort();
  let coveredTime = (chunkFiles.length - 1) * segmentTime;

  return { totalChunks: chunkFiles.length, actualDuration: totalDuration };
}

module.exports = { splitVideo };
