import os
os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'
os.environ['DISABLE_MODEL_SOURCE_CHECK'] = 'True'

import sys
import json
import cv2
import whisper
import numpy as np
import logging

logging.getLogger("ppocr").setLevel(logging.ERROR)

from paddleocr import PaddleOCR
from pymongo import MongoClient

class SlideAnalyzer:
    def __init__(self):
        self.ocr = None
        self.whisper_model = None
        self.mongo_uri = os.environ.get('MONGO_URL')
        self.db_name = "airbnb"
        self.client = None

    def get_db(self):
        if self.client is None and self.mongo_uri:
            try:
                self.client = MongoClient(self.mongo_uri)
                return self.client[self.db_name]
            except Exception:
                return None
        return None

    def get_ocr(self):
        if self.ocr is None:
            self.ocr = PaddleOCR(
                lang='en', 
                use_textline_orientation=False
            )
        return self.ocr

    def get_whisper(self):
        if self.whisper_model is None:
            self.whisper_model = whisper.load_model("base")
        return self.whisper_model

    def extract_key_frames(self, video_path, num_frames=3):
        frames = []
        cap = cv2.VideoCapture(video_path)
        
        if not cap.isOpened():
            return frames
        
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames <= 0:
            cap.release()
            return frames
            
        frame_indices = np.linspace(0, total_frames - 1, num_frames, dtype=int)
        
        for idx in frame_indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, frame = cap.read()
            if ret:
                frames.append(frame)
        
        cap.release()
        return frames

    def extract_slide_text(self, frames):
        ocr = self.get_ocr()
        all_text = []
        
        for frame in frames:
            try:
                result = ocr.ocr(frame)
                
                if result and len(result) > 0 and result[0]:
                    for line in result[0]:
                        try:
                            text_info = line[1]
                            text = text_info[0]
                            conf = text_info[1]
                            
                            if conf > 0.5 and text:
                                all_text.append(str(text))
                        except (IndexError, TypeError):
                            continue
            except Exception as e:
                sys.stderr.write(f"OCR Frame Error: {str(e)}\n")
                continue
        
        return list(dict.fromkeys(all_text))

    def transcribe_audio(self, video_path):
        try:
            model = self.get_whisper()
            result = model.transcribe(video_path, fp16=False)
            return result.get('text', '')
        except Exception:
            return ""

    def analyze_slide(self, video_path, user_id=None):
        try:
            frames = self.extract_key_frames(video_path, num_frames=3)
            if not frames:
                return {'success': False, 'error': 'Could not extract frames', 'video_path': video_path}

            text_lines = self.extract_slide_text(frames)
            transcription = self.transcribe_audio(video_path)
            
            summary = ""
            if text_lines:
                summary += f"Title: {text_lines[0]}\n"
            summary += f"Found {len(text_lines)} lines of text."
            
            if transcription:
                summary += f"\nAudio transcription available ({len(transcription)} characters)."

            result = {
                'success': True,
                'video_path': video_path,
                'slide_analysis': {
                    'title': text_lines[0] if text_lines else "No Title",
                    'text_content': text_lines,
                    'transcription': transcription,
                    'summary': summary,
                    'key_points': text_lines[:5] if len(text_lines) > 0 else []
                },
                'metadata': {
                    'frames_analyzed': len(frames),
                    'text_lines_found': len(text_lines),
                    'has_transcription': bool(transcription)
                }
            }
            
            if user_id:
                db = self.get_db()
                if db:
                    try:
                        db['video_analyses'].insert_one({**result, "userId": user_id})
                    except:
                        pass

            return result
            
        except Exception as e:
            return {'success': False, 'error': str(e), 'video_path': video_path}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No video path'}))
        sys.exit(1)
    
    video_path = sys.argv[1]
    
    analyzer = SlideAnalyzer()
    result = analyzer.analyze_slide(video_path)
    
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main()