const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { getFfmpegPath } = require('./envUtil');

const videoDirs = [
    path.join(__dirname, '..', 'public', 'videos'),
    path.join(__dirname, '..', 'videos')
];
const ffmpegPath = getFfmpegPath();

// Memory locks
const processing = new Set();

const loadRecords = (dirPath) => {
    try {
        const recordPath = path.join(dirPath, '.optimized_records.json');
        if (fs.existsSync(recordPath)) {
            return JSON.parse(fs.readFileSync(recordPath));
        }
    } catch(e) {}
    return [];
};

const saveRecords = (dirPath, records) => {
    fs.writeFileSync(path.join(dirPath, '.optimized_records.json'), JSON.stringify(records, null, 2));
};

const processedFiles = new Set(); // We will initialize correctly in startOptimizer

const optimizeVideo = (videoDir, filename) => {
    if (!filename || !filename.endsWith('.mp4')) return;
    if (processedFiles.has(filename) || processing.has(filename)) return;

    // Prevent infinitely processing internal temp files
    if (filename.startsWith('temp_') || filename.startsWith('fast_') || filename.startsWith('slow_')) return;

    processing.add(filename);
    const filepath = path.join(videoDir, filename);
    const tempPath = path.join(videoDir, `temp_${filename}`);

    console.log(`\n[VIDEO NORMALIZER] Handshake detected on new video: ${filename}`);
    console.log(`[VIDEO NORMALIZER] Normalizing strictly to 30 FPS / 720p H264 for Flawless YOLO Compatibility...`);

    const ffmpeg = spawn(ffmpegPath, [
        '-y', 
        '-i', filepath,
        '-r', '30', // Hard lock to 30 FPS to stabilize streaming loops
        '-vf', 'scale=-2:720', // Cap at 720p preventing decoder death-spirals on 4k footage
        '-vcodec', 'libx264',
        '-preset', 'fast',
        '-tune', 'fastdecode',
        tempPath
    ], { stdio: 'ignore' });

    ffmpeg.on('close', (code) => {
        if (code === 0) {
            console.log(`[VIDEO NORMALIZER] Successfully normalized ${filename}! Moving to original path...`);
            fs.renameSync(tempPath, filepath);
            processedFiles.add(filename);
            // Save records for just this directory to maintain persistence smoothly
            saveRecords(videoDir, loadRecords(videoDir).concat([filename]).filter((v,i,a) => a.indexOf(v)===i));
        } else {
            console.error(`[VIDEO NORMALIZER] FFmpeg compilation failed for ${filename} with code ${code}.`);
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        }
        process.nextTick(() => processing.delete(filename));
    });
};

const startOptimizer = () => {
    videoDirs.forEach(videoDir => {
        console.log(`[VIDEO NORMALIZER] Background tracking engine listening on ${videoDir}`);
        
        // Check if directory exists
        if (!fs.existsSync(videoDir)) {
            try { fs.mkdirSync(videoDir, { recursive: true }); } catch (e) {}
        }
        
        // Load initial state
        loadRecords(videoDir).forEach(f => processedFiles.add(f));

        // Pass 1: Instantly flush any existing videos natively on boot
        if (fs.existsSync(videoDir)) {
            fs.readdirSync(videoDir).forEach(f => optimizeVideo(videoDir, f));
        }

        // Pass 2: Watch directory for drag-and-drop or web uploads safely
        if (fs.existsSync(videoDir)) {
            try {
                fs.watch(videoDir, { persistent: false }, (eventType, filename) => {
                    if (filename && eventType === 'rename') {
                        setTimeout(() => {
                            if (fs.existsSync(path.join(videoDir, filename))) {
                                optimizeVideo(videoDir, filename);
                            }
                        }, 500);
                    }
                });
            } catch (err) {
                console.warn(`[VIDEO NORMALIZER] Directory watch fallback on ${videoDir}: ${err.message}`);
            }
        }
    });
};

module.exports = { startOptimizer };
