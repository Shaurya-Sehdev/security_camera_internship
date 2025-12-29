# Videos Folder

This folder contains test videos for the security camera system.

## Usage

When adding a camera, you can reference videos in this folder using:

```
/videos/your-video-file.mp4
```

For example:
- `/videos/test-camera-1.mp4`
- `/videos/sample-feed.mp4`

## Supported Formats

- MP4 (recommended)
- WebM
- OGG

## Notes

- Videos in this folder are served as static files
- Access them via: `http://localhost:3000/videos/filename.mp4`
- Use relative paths like `/videos/filename.mp4` in the camera `videoUrl` field

