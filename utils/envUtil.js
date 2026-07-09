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

    // Fallback: Try to find conda env
    const condaPython = "/home/shaurya/miniconda3/envs/security_cam/bin/python";
    if (fs.existsSync(condaPython)) return condaPython;

    // Windows Fallback
    if (os.platform() === "win32") {
        return "python"; 
    }

    return "python3";
  },

  getFfmpegPath() {
    const condaFfmpeg = "/home/shaurya/miniconda3/envs/security_cam/bin/ffmpeg";
    if (fs.existsSync(condaFfmpeg)) return condaFfmpeg;

    if (os.platform() === "win32") {
        return "ffmpeg";
    }

    return "ffmpeg";
  },

  getFfprobePath() {
    const condaFfprobe = "/home/shaurya/miniconda3/envs/security_cam/bin/ffprobe";
    if (fs.existsSync(condaFfprobe)) return condaFfprobe;

    if (os.platform() === "win32") {
        return "ffprobe";
    }

    return "ffprobe";
  }
};

module.exports = envUtil;
