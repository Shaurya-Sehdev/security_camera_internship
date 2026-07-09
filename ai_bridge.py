import os
import sys
import json
import torch
import cv2
import whisper
import easyocr
import numpy as np
from ultralytics import YOLO
from PIL import Image
from http.server import BaseHTTPRequestHandler, HTTPServer
import time

# --- MODEL CACHE ---
MODELS = {
    'yolo': None,
    'whisper': None,
    'ocr': None,
    'vlm': None,
    'vlm_processor': None
}

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

def load_models():
    print(f"🚀 Initializing AI Bridge on {DEVICE}...")
    
    # YOLO
    start = time.time()
    MODELS['yolo'] = YOLO('yolov8s-worldv2.pt')
    MODELS['yolo'].set_classes(["person", "handgun", "rifle", "knife", "mask", "backpack", "bag"])
    MODELS['yolo'].to(DEVICE)
    print(f"✅ YOLO Loaded ({time.time()-start:.2f}s)")
    
    # OCR
    start = time.time()
    MODELS['ocr'] = easyocr.Reader(['en'], gpu=(DEVICE == "cuda"))
    print(f"✅ EasyOCR Ready ({time.time()-start:.2f}s)")
    
    # Whisper
    start = time.time()
    MODELS['whisper'] = whisper.load_model("base", device=DEVICE)
    print(f"✅ Whisper Ready ({time.time()-start:.2f}s)")
    
    # VLM (BLIP)
    try:
        start = time.time()
        from transformers import BlipProcessor, BlipForConditionalGeneration
        model_id = "Salesforce/blip-image-captioning-large"
        MODELS['vlm_processor'] = BlipProcessor.from_pretrained(model_id)
        MODELS['vlm'] = BlipForConditionalGeneration.from_pretrained(model_id).to(DEVICE).eval()
        if DEVICE == "cuda":
            MODELS['vlm'] = MODELS['vlm'].half()
        print(f"✅ VLM (BLIP) Ready ({time.time()-start:.2f}s)")
    except Exception as e:
        print(f"❌ VLM Load Failed: {e}")

class AIHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        data = json.loads(post_data.decode('utf-8'))
        
        task = data.get('task')
        video_path = data.get('videoPath')
        
        if not video_path or not os.path.exists(video_path):
            self.send_response(400)
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'Invalid video path'}).encode())
            return

        result = {'success': False}
        
        try:
            if task == 'fast_yolo':
                result = self.handle_fast_yolo(video_path)
            elif task == 'deep_dive':
                result = self.handle_deep_dive(video_path)
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
            
        except Exception as e:
            print(f"Error processing task {task}: {e}")
            self.send_response(500)
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def handle_fast_yolo(self, video_path):
        model = MODELS['yolo']
        results = list(model(video_path, stream=True, verbose=False, device=DEVICE))
        
        person_detected = False
        max_conf = 0.0
        tracked = []
        
        for r in results:
            for box in r.boxes:
                conf = float(box.conf[0])
                cls = int(box.cls[0])
                if conf > 0.4:
                    label = r.names[cls]
                    if label == "person":
                        person_detected = True
                        max_conf = max(max_conf, conf)
                    tracked.append({'label': label, 'confidence': conf})
                    
        return {
            'success': True,
            'person_detected': person_detected,
            'confidence': max_conf,
            'objects_tracked': tracked[:10] # Limit for noise
        }

    def handle_deep_dive(self, video_path):
        # Implementation of the complex slide_processor logic
        # but using the cached models
        from slide_processor import SlideAnalyzer
        
        # Inject our cached models into the analyzer
        analyzer = SlideAnalyzer()
        analyzer.yolo_model = MODELS['yolo']
        analyzer.whisper_model = MODELS['whisper']
        analyzer.reader = MODELS['ocr']
        analyzer.moondream_model = MODELS['vlm']
        analyzer.vlm_processor = MODELS['vlm_processor']
        analyzer.device = DEVICE
        
        return analyzer.analyze_slide(video_path)

def run_server(port=5000):
    load_models()
    server_address = ('', port)
    httpd = HTTPServer(server_address, AIHandler)
    print(f"🔥 AI Bridge Server running on port {port}")
    httpd.serve_forever()

if __name__ == "__main__":
    run_server()
