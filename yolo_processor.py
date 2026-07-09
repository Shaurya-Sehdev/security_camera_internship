import sys
import json
import os

def process_video():
    try:
        from ultralytics import YOLO
    except Exception as e:
        print(json.dumps({'person_detected': False, 'error': f'Import failed: {str(e)}'}))
        sys.stdout.flush()
        return

    def get_position(x_center, y_center, width, height):
        x_pos, y_pos = "Center", "Center"
        if x_center < width * 0.33: x_pos = "Left"
        elif x_center > width * 0.66: x_pos = "Right"
        if y_center < height * 0.33: y_pos = "Top"
        elif y_center > height * 0.66: y_pos = "Bottom"
        if x_pos == "Center" and y_pos == "Center": return "Center Screen"
        return f"{y_pos}-{x_pos}"

    try:
        if len(sys.argv) < 2:
            print(json.dumps({'person_detected': False, 'error': 'No video path provided'}))
            sys.stdout.flush()
            return

        video_path = sys.argv[1]

        if not os.path.exists(video_path):
            print(json.dumps({'person_detected': False, 'error': f'File not found: {video_path}'}))
            sys.stdout.flush()
            return

        model = YOLO('yolov8n.pt')
        results = list(model(video_path, stream=True, verbose=False))

        person_detected = False
        max_confidence = 0.0
        detected_objects = []

        for r in results:
            img_h, img_w = r.orig_shape
            current_frame_objects = []
            frame_has_person = False

            for box in r.boxes:
                class_id = int(box.cls[0])
                confidence = float(box.conf[0])

                if confidence > 0.4:
                    class_name = r.names[class_id].capitalize()
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    x_c, y_c = (x1 + x2) / 2, (y1 + y2) / 2
                    
                    pos = get_position(x_c, y_c, img_w, img_h)
                    current_frame_objects.append({
                        "label": class_name,
                        "confidence": round(confidence, 2),
                        "position": pos
                    })

                    if class_id == 0:
                        frame_has_person = True
                        if confidence > max_confidence:
                            max_confidence = confidence

            if frame_has_person:
                person_detected = True
                detected_objects = current_frame_objects
                break

        result = {
            'person_detected': person_detected,
            'confidence': round(max_confidence, 3) if person_detected else 0.0,
            'objects_tracked': detected_objects
        }

        print(json.dumps(result))
        sys.stdout.flush()

    except Exception as e:
        print(json.dumps({'person_detected': False, 'error': str(e)}))
        sys.stdout.flush()

if __name__ == "__main__":
    process_video()