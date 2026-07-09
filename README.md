# AI Security Camera System

A real-time security camera monitoring interface with AI-powered video analysis. The platform combines a web dashboard for camera management with automated object detection, OCR, and audio transcription pipelines for intelligent surveillance.

Built during an internship at **SoCTeamup Semiconductors Pvt Ltd** (Noida-based semiconductor and chip-design startup) as an **ML & Web Developer Intern** (Jul 2025 – Nov 2025).

## Tech Stack

**Backend & Web**
- Node.js, Express, EJS
- MongoDB (Mongoose), Redis, BullMQ
- Passport-style session auth with bcrypt password hashing

**AI / ML**
- Python, Ultralytics YOLO (object detection)
- EasyOCR, OpenAI Whisper (text and audio analysis)
- FFmpeg for video chunking and processing

**Infrastructure**
- Docker Compose (Redis)
- Concurrent worker architecture (fast + slow queues)

## Key Features

- Live camera dashboard with browse, filter, and feed viewing
- Camera registration and host management
- User authentication, favourites, and role-based access
- Fast worker: YOLO-based object detection on video chunks
- Slow worker: OCR and audio transcription for deeper analysis
- AI bridge for real-time inference coordination
- REST API architecture with queued background processing

## Prerequisites

- Node.js (v16+, v18 recommended)
- MongoDB
- Redis
- Python 3.8+ (3.10+ recommended for ML workers)
- FFmpeg

## Setup

Install Node dependencies:

```bash
npm install
```

Install Python packages (minimum set):

```bash
pip install ultralytics opencv-python easyocr openai-whisper pymongo numpy
```

Or use the full pinned list:

```bash
pip install -r requirements.txt
```

Create a `.env` file in the project root (see `.env.example`):

```env
MONGO_URL=mongodb://localhost:27017/security_camera
SESSION_SECRET=your-secret-key-here
PORT=3000
NODE_ENV=development
PYTHON_PATH=python
REDIS_HOST=localhost
REDIS_PORT=6379
```

Start Redis (local install or Docker):

```bash
npm run docker:redis
```

Make sure MongoDB and Redis are running, then start the full stack:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Running Components Separately

For debugging, run each part in its own terminal:

```bash
# Terminal 1 — web server
npm start

# Terminal 2 — fast YOLO worker
npm run fast_worker

# Terminal 3 — slow OCR / transcription worker
npm run slow_worker
```

## How It Works

1. The Express server handles web requests, authentication, and camera CRUD.
2. Uploaded or linked videos are split into chunks via FFmpeg.
3. The **fast worker** runs YOLO detection on chunks through the Python AI bridge.
4. The **slow worker** performs OCR and Whisper transcription for detailed analysis.
5. Results are stored in MongoDB; Redis (BullMQ) queues jobs between Node and Python.

## Environment Variables

| Variable | Description |
|---|---|
| `MONGO_URL` | MongoDB connection string |
| `SESSION_SECRET` | Secret key for express sessions |
| `PORT` | Server port (default `3000`) |
| `NODE_ENV` | `development` or `production` |
| `PYTHON_PATH` | Python executable (`python` or `python3`) |
| `REDIS_HOST` | Redis host (default `localhost`) |
| `REDIS_PORT` | Redis port (default `6379`) |

Do not commit your `.env` file to version control.

## Troubleshooting

- **Server won't start** — verify MongoDB and Redis are running; check `.env` values and that port 3000 is free.
- **Workers idle** — confirm both workers are running and Redis is reachable.
- **Python import errors** — reinstall requirements and test with `python -c "from ultralytics import YOLO; print('OK')"`.
- **First ML run is slow** — model weights are downloaded on first use; restart workers after caching completes.
