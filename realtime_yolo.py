import cv2
import sys
import os
import torch
import subprocess
import json
import time
from ultralytics import YOLO

def get_video_fps(cap):
    """Accurately get video FPS natively through OpenCV"""
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps > 0 and fps < 120:
            return float(fps)
        return 30.0
    except Exception:
        return 30.0

def main(video_path):
    if not os.path.exists(video_path):
        print(f"Error: File {video_path} not found")
        return

    # Open video first to extract precise meta-data
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Error: Could not open video {video_path}")
        return

    # Accurate Native FPS detection
    fps = get_video_fps(cap)
    frame_delay = 1.0 / fps
    
    # Load model with maximum GPU optimization
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(script_dir, 'yolov8n.pt')
    
    # Silence Ultralytics startup logs to prevent corrupting the raw MJPEG boundary feed
    old_stdout = sys.stdout
    sys.stdout = open(os.devnull, 'w')
    
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = YOLO(model_path)
    model.to(device)
    
    if device == 'cuda':
        model.model.fuse()
        torch.backends.cudnn.benchmark = True
        
    sys.stdout = old_stdout

    # IMPORTANT: Do NOT set BUFFERSIZE for local files. 
    # This ensures we read and process EVERY frame for robustness.
    
    # YOLO Tracker optimizations: Cap deep inference to 10 FPS for fluid stream
    inference_interval = max(1, int(fps / 10)) 
    frame_counter = 0
    last_results = None
    stream_start = time.time()
    
    try:
        while cap.isOpened():
            # ABSOLUTE REAL-TIME CLOCK SYNC
            current_time = time.time() - stream_start
            expected_frame = int(current_time * fps)
            
            # Use a more precise sleep to prevent fast-forwarding
            if frame_counter > expected_frame:
                wait_time = (frame_counter - expected_frame) / fps
                if wait_time > 0.001:
                    time.sleep(wait_time)
                continue
                
            # If the GPU lagged behind real life, silently drop video frames until we catch back up to real time!
            # CRITICAL: We use cap.grab() instead of cap.read() here to advance the video pointer natively
            # WITHOUT decoding the actual 4K/high-res pixels into memory, escaping the decompression death spiral!
            while frame_counter < expected_frame:
                success = cap.grab()
                frame_counter += 1
                if not success:
                    break
                    
            success, frame = cap.read()
            if not success:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                stream_start = time.time()
                frame_counter = 0
                continue
                
            frame_counter += 1

            # Run GPU inference ONLY on throttled interval
            if frame_counter % inference_interval == 0 or last_results is None:
                results = model.predict(
                    frame, 
                    device=device, 
                    half=(device == 'cuda'), 
                    imgsz=640, 
                    verbose=False
                )
                annotated_frame = results[0].plot()
                last_results = results
            else:
                # Dynamic Projection: The background video plays flawlessly, and we dynamically paint
                # the latest GPU bounding boxes onto the fresh movement frame!
                annotated_frame = frame.copy()
                for box in last_results[0].boxes:
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    cls_id = int(box.cls[0])
                    conf = float(box.conf[0])
                    label = f"{model.names[cls_id]} {conf:.2f}"
                    # Draw a vibrant security box
                    cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), (255, 85, 85), 2)
                    cv2.putText(annotated_frame, label, (x1, max(y1 - 10, 0)), 
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

            # High-speed encoding
            _, buffer = cv2.imencode('.jpg', annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
            frame_bytes = buffer.tobytes()
            
            # Stream out via MJPEG format
            sys.stdout.buffer.write(b'--frame\r\n')
            sys.stdout.buffer.write(b'Content-Type: image/jpeg\r\n\r\n')
            sys.stdout.buffer.write(frame_bytes)
            sys.stdout.buffer.write(b'\r\n\r\n')
            sys.stdout.buffer.flush()
                
    except BrokenPipeError:
        pass
    except Exception as e:
        sys.stderr.write(f"Stream error: {str(e)}\n")
    finally:
        cap.release()

if __name__ == "__main__":
    if len(sys.argv) > 1:
        main(sys.argv[1])
