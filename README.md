# Security Camera System

A security camera management platform with AI-powered video analysis. Built with Node.js, Express, MongoDB, and Redis.

## Getting Started

You'll need these installed first:

- Node.js (v16+)
- MongoDB
- Redis
- Python (3.8+)
- FFmpeg

Install Node dependencies:

```bash
npm install
```

Install Python packages:

```bash
pip install ultralytics opencv-python paddleocr openai-whisper pymongo numpy
```

Create a `.env` file in the root directory:

```
MONGO_URL=mongodb://localhost:27017/security_camera
SESSION_SECRET=your-secret-key-here
PORT=3000
NODE_ENV=development
PYTHON_PATH=python
```

Make sure MongoDB and Redis are running, then start the app:

```bash
npm run dev
```

This starts the main server and both workers. Open http://localhost:3000 in your browser.

## Running Separately

If you want to run things separately for debugging:

Terminal 1:

```bash
npm start
```

Terminal 2:

```bash
npm run fast_worker
```

Terminal 3:

```bash
npm run slow_worker
```

## How It Works

The system has three main parts:

- Express server handles web requests and serves pages
- Fast worker does quick YOLO object detection on videos
- Slow worker does OCR and audio transcription for detailed analysis

Videos get split into chunks, analyzed, and results are stored in MongoDB. Redis queues the work between workers.

## Troubleshooting

If the server won't start, check:

- MongoDB is running (test with `mongod --version`)
- Redis is running (test with `redis-cli ping`)
- Your `.env` file exists and has correct values
- Port 3000 isn't already in use

If workers aren't processing:

- Make sure both workers are running
- Check Redis connection
- Verify MongoDB connection string in `.env`

For Python errors, make sure all packages are installed and test with:

```bash
python -c "from ultralytics import YOLO; print('OK')"
```

## Environment Variables

- `MONGO_URL` - MongoDB connection string
- `SESSION_SECRET` - Secret key for sessions (use a random string)
- `PORT` - Server port (default 3000)
- `NODE_ENV` - Set to `development` or `production`
- `PYTHON_PATH` - Python command (`python` or `python3`)

Don't commit your `.env` file to git.
