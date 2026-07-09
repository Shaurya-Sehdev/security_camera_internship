# 🚀 Deep Insight AI - Project Startup & Deployment Guide

This document contains instructions to completely deploy and run the "Deep Insight" AI Security Surveillance pipeline on a new machine. 

If you are an AI assistant (like Antigravity) reading this on a new machine, **use this document as your primary context** to set up the environment and run the system.

---

## 1. System Architecture Overview
The system is built on a split-stack architecture:
*   **Backend UI / API**: Node.js (Express), MongoDB, Redis (via BullMQ)
*   **AI Inference Engine**: Python 3.10 (YOLOv8-World, BLIP-Large, Whisper, EasyOCR)
*   **Message Broker**: Redis handles job queues (`fast-queue` and `slow-queue`) between Node and Python.

---

## 2. Dependency Master List

### 🖥️ Native Services Required
1.  **Node.js**: v18 or higher
2.  **Miniconda3**: For Python environment management
3.  **MongoDB**: Running locally on port `27017` (MongoDB Compass is recommended)
4.  **Redis-Server**: Must be running locally on port `6379` (critical for BullMQ).

### 📦 Node.js Dependencies (`package.json`)
The following must map to `npm install`:
*   `express`
*   `mongoose`
*   `bullmq`
*   `ioredis`
*   `dotenv`
*   `ejs`

### 🐍 Python AI Dependencies (`security_cam` conda environment)
The Python environment **MUST** use GPU acceleration (CUDA 11.8+):
1.  **AI Engine Framework**: `torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118`
2.  **Vision & Text**: `ultralytics easyocr openai-whisper transformers`
3.  **Data & Utility**: `pymongo pillow numpy opencv-python ffmpeg`
4.  **Special Dependency**: YOLO-World requires CLIP -> `pip install git+https://github.com/ultralytics/CLIP.git`

---

## 3. Environment Variable Configuration (`.env`)
A `.env` file must exist in the root directory. If it is missing, create it with the following structure:

```env
# Database Connections
MONGO_URL=mongodb://localhost:27017/airbnb
REDIS_URL=redis://localhost:6379

# The exact absolute path to the Python executable in the conda environment
PYTHON_PATH=/home/username/miniconda3/envs/security_cam/bin/python

# Threat Analysis Engine Key
GROQ_API_KEY=YOUR_GROQ_KEY_HERE

# Alerting Mailer
ALERT_SENDER_EMAIL=your.email@gmail.com
EMAIL_APP_PASSWORD=your-gmail-app-password-here
```

---

## 4. Boot Sequence (Strict Order)

To launch the system successfully, services must be brought online in this exact order:

### Phase 1: Core Storage & Messaging
Verify that **MongoDB** and **Redis** are actively running on the system.
*   *(Linux/Ubuntu)*: `sudo systemctl status redis-server` and `sudo systemctl status mongod`

### Phase 2: Background Application Workers
Open two separate terminal background processes to handle the BullMQ queues:
*   **Worker 1**: `node workers/fastWorker.js` 
*   **Worker 2**: `node workers/slowWorker.js`
*   *Note: These workers will listen for split chunks and spawn Python sub-processes.*

### Phase 3: The Dashboard App
Finally, in the root directory, launch the frontend server:
*   `npm start`
*   Access the interface at: `http://localhost:3000`

---

## 5. Critical Troubleshooting Notes for the AI Assistant

*   **Path Resolution Bug**: If the AI Deep Dive clicks but immediately crashes or gets stuck on the loading circle, **the video path in the MongoDB `cameras` collection is broken.**
    *   *Fix*: Ask the user to add a new camera in the UI and use the **absolute local path** to `robbery.mp4` on their new hard drive (e.g., `/home/user/downloads/robbery.mp4`).
*   **Redis Disconnections**: If `analysisController.js` throws connection errors, the local Redis server is not running. Start it.
*   **Model Weights Delay**: On the *first* execution of `slide_processor.py`, HuggingFace will download ~3GB of BLIP models. The worker might time out. This is expected. Restart the worker after the disk cache completes.
*   **VRAM Out of Memory**: If the system crashes with CUDA errors, the laptop GPU (e.g., RTX 5060/GTX 1650) is out of VRAM. Ensure no other apps (like Chrome or Games) are using GPU memory during initialization.
