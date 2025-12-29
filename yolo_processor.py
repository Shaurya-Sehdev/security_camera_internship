import sys
import json
import os
from ultralytics import YOLO

MONGO_URL = os.environ.get('MONGO_URL')

def process_video():
    try:
        if len(sys.argv) < 2:
            print(json.dumps({'person_detected': False, 'error': 'No video path provided'}))
            return

        video_path = sys.argv[1]

        model = YOLO('yolov8n.pt')

        results = list(model(video_path, stream=True, verbose=False))

        person_detected = False
        max_confidence = 0.0
        detection_count = 0
        
        for r in results:
            for box in r.boxes:
                class_id = int(box.cls[0])
                confidence = float(box.conf[0])
                
                if class_id == 0 and confidence > 0.5:
                    person_detected = True
                    detection_count += 1
                    if confidence > max_confidence:
                        max_confidence = confidence
            if person_detected: 
                break

        result = {
            'person_detected': person_detected,
            'confidence': round(max_confidence, 3) if person_detected else 0.0,
            'detections': detection_count
        }
        
        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({'person_detected': False, 'error': str(e)}), file=sys.stderr)

if __name__ == "__main__":
    process_video()