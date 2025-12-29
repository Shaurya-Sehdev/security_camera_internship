const fs = require('fs/promises');
const path = require('path');

const baseDir = path.join('C:', 'Shaurya', 'BACK-END', 'security_camera', 'public', 'videos');

const DIRS_TO_CLEAN = [
    path.join(baseDir, 'fast_temp_chunks'),
    path.join(baseDir, 'slow_temp_chunks')
];

async function cleanTempChunks() {
    console.log(`[CLEANUP] Starting chunk cleanup for dual directories.`);
    
    for (const dirPath of DIRS_TO_CLEAN) {
        try {
            console.log(`[CLEANUP] Cleaning: ${dirPath}`);
            await fs.rm(dirPath, { recursive: true, force: true });
            
            await fs.mkdir(dirPath, { recursive: true });
            console.log(`[CLEANUP] Successfully cleaned and recreated ${path.basename(dirPath)}.`);
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                await fs.mkdir(dirPath, { recursive: true });
                console.log(`[CLEANUP] Directory did not exist, created ${path.basename(dirPath)}.`);
            } else {
                console.error(`[CLEANUP] An unexpected error occurred in ${dirPath}: ${error.message}`);
            }
        }
    }
}

cleanTempChunks()
    .then(() => console.log('[CLEANUP] Chunk cleanup process finished.'))
    .catch((err) => console.error(`[CLEANUP] Fatal error: ${err.message}`));