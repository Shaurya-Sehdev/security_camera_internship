const path = require("path");
const fs = require("fs");
const os = require("os");

/**
 * Environment-aware path resolver for critical binaries
 */
const envUtil = {
  getPythonPath() {
    const envPath = process.env.PYTHON_PATH;
    if (envPath && fs.existsSync(envPath)) return envPath;
    const condaPython = "/home/shaurya/miniconda3/envs/security_cam/bin/python";
    if (fs.existsSync(condaPython)) return condaPython;
    return "python3";
  },

  getFfmpegPath() {
    const envPath = process.env.FFMPEG_PATH;
    if (envPath && fs.existsSync(envPath)) return envPath;
    const condaFfmpeg = "/home/shaurya/miniconda3/envs/security_cam/bin/ffmpeg";
    if (fs.existsSync(condaFfmpeg)) return condaFfmpeg;
    return "ffmpeg";
  },

  getFfprobePath() {
    const envPath = process.env.FFPROBE_PATH;
    if (envPath && fs.existsSync(envPath)) return envPath;
    const condaFfprobe = "/home/shaurya/miniconda3/envs/security_cam/bin/ffprobe";
    if (fs.existsSync(condaFfprobe)) return condaFfprobe;
    return "ffprobe";
  }
};

module.exports = envUtil;
