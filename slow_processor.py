import os
os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'

import sys
import json
from ultralytics import YOLO
from collections import Counter

MONGO_URL = os.environ.get('MONGO_URL')

def analyze_detailed(video_path):
    model = YOLO('yolov8n.pt') 
    
    results = list(model.track(video_path, stream=True, verbose=False, persist=True))
    
    objects_by_class = {}
    all_tracked_ids = set()
    
    for result in results:
        if result.boxes is not None:
            if not hasattr(result.boxes, 'id') or result.boxes.id is None:
                continue
                
            for box in result.boxes:
                cls = int(box.cls[0])
                conf = float(box.conf[0])
                class_name = model.names[cls]
                track_id = int(box.id[0])
                
                if conf > 0.4:
                    all_tracked_ids.add(track_id)
                    if class_name not in objects_by_class:
                        objects_by_class[class_name] = set()
                    objects_by_class[class_name].add(track_id)
    
    unique_objects = {cls: len(ids) for cls, ids in objects_by_class.items()}

    return {
        'success': True,
        'unique_objects': unique_objects,
        'summary': summary
    }

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No path provided'}))
        sys.exit(1)

    try:
        result = analyze_detailed(sys.argv[1])
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))