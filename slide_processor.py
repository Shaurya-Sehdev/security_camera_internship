import os
os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'

import sys
import json
import cv2
import whisper
import numpy as np
import easyocr  # Swapped from PaddleOCR
import torch
from ultralytics import YOLO
from pymongo import MongoClient
from PIL import Image

import threading
import smtplib
from email.message import EmailMessage
import urllib.request
import urllib.error

class SlideAnalyzer:
    def __init__(self):
        self.reader = None
        self.whisper_model = None
        self.mongo_uri = os.environ.get('MONGO_URL')
        self.db_name = "airbnb"
        self.client = None
        
        # Models
        self.yolo_model = None
        self.moondream_model = None
        self.tokenizer = None
        self.vlm_processor = None
        
        # Check if CUDA is available for the RTX 5060
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

    def get_db(self):
        if self.client is None and self.mongo_uri:
            try:
                self.client = MongoClient(self.mongo_uri)
                return self.client[self.db_name]
            except Exception:
                return None
        return None

    def get_ocr(self):
        if self.reader is None:
            # Initialize EasyOCR with GPU
            self.reader = easyocr.Reader(['en'], gpu=(self.device == "cuda"))
        return self.reader

    def get_whisper(self):
        if self.whisper_model is None:
            # Load Whisper on the RTX 5060
            self.whisper_model = whisper.load_model("base", device=self.device)
        return self.whisper_model

    def get_yolo(self):
        if self.yolo_model is None:
            # Upgrade to YOLO-World (Small) for Open Vocabulary detection
            self.yolo_model = YOLO('yolov8s-worldv2.pt')
            # Broaden the threat vocabulary for a "Wow" demo
            self.yolo_model.set_classes([
                "person", "handgun", "rifle", "knife", "mask", 
                "backpack", "cash register", "safe", "jewelry", "bag"
            ])
        return self.yolo_model

    def get_vlm(self):
        if self.moondream_model is None:
            try:
                from transformers import BlipProcessor, BlipForConditionalGeneration
                model_id = "Salesforce/blip-image-captioning-large"
                
                sys.stderr.write(f"\n[VLM] Loading BLIP Engine on: {self.device}\n")
                
                self.vlm_processor = BlipProcessor.from_pretrained(model_id)
                self.moondream_model = BlipForConditionalGeneration.from_pretrained(model_id).to(self.device).eval()
                
                sys.stderr.write("[VLM] ✅ BLIP Ready (Salesforce-Base).\n")
            except Exception as e:
                sys.stderr.write(f"[VLM] ❌ Error loading VLM: {str(e)}\n")
        return self.moondream_model

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
        """Uses 'Corner-Zoom' OCR to capture tiny timestamps and labels."""
        try:
            # We use the middle frame for OCR
            frame = frames[1] if len(frames) > 1 else frames[0]
            h, w = frame.shape[:2]
            
            # --- CORNER ZOOMING: Focus on typical stamp locations ---
            crops = [
                frame[0:int(h*0.18), 0:int(w*0.45)],    # Top Left (Timestamp)
                frame[int(h*0.82):h, int(w*0.55):w],    # Bottom Right (Label)
                frame[int(h*0.82):h, 0:int(w*0.45)]     # Bottom Left (ID)
            ]
            
            all_text = []
            reader = self.get_ocr()
            for i, crop in enumerate(crops):
                # Forensic Preprocessing: Grayscale + Contrast Stretch
                gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                denoised = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
                zoomed = cv2.resize(denoised, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_LANCZOS4)
                
                results = reader.readtext(zoomed, detail=0)
                all_text.extend(results)
                # Verbose logging for demo debugging
                sys.stderr.write(f"[OCR] Zone {i} Results: {results}\n")
            
            # Clean and deduplicate
            seen = set()
            cleaned = []
            for t in all_text:
                t_clean = t.strip()
                if t_clean and len(t_clean) > 2 and t_clean not in seen:
                    cleaned.append(t_clean)
                    seen.add(t_clean)
            
            return cleaned
        except Exception as e:
            sys.stderr.write(f"[OCR] Error: {str(e)}\n")
            return []

    def parse_camera_time(self, text_lines):
        """Extracts HH:MM:SS from OCR lines."""
        import re
        # Special Case: Join fragments for time matching (e.g. ['17', '42', '02'] -> '17:42:02')
        combined_text = " ".join(text_lines)
        
        # More flexible time pattern for fragments
        time_pattern = r'(\d{1,2})[:\- ](\d{2})[:\- ](\d{2})'
        date_pattern = r'(\d{2})[:\- ](\d{2})[:\- ](\d{4})'
        
        found_time = "Live Clock"
        found_date = ""

        # Prioritize 3-part time with colons (HH:MM:SS)
        long_time = r'(\d{1,2}):(\d{2}):(\d{2})'
        t_match = re.search(long_time, combined_text)
        if t_match:
            found_time = f"{t_match.group(1).zfill(2)}:{t_match.group(2)}:{t_match.group(3)}"
        else:
            # Look for 2-part time with colons (HH:MM)
            short_time = r'(\d{1,2}):(\d{2})'
            s_match = re.search(short_time, combined_text)
            if s_match:
                found_time = f"{s_match.group(1).zfill(2)}:{s_match.group(2)}:00"
            else:
                # Fallback for space-separated fragments (common in low-res OCR)
                # We look specifically for fragments that come AFTER a 1- or 2-digit number (17 42 02)
                frag_time = r'\b([012]?\d)[ ](\d{2})[ ](\d{2})\b'
                f_match = re.search(frag_time, combined_text)
                if f_match:
                    found_time = f"{f_match.group(1).zfill(2)}:{f_match.group(2)}:{f_match.group(3)}"

        # Date parsing (avoiding time overlap)
        date_pattern = r'(\d{2})[:\- ](\d{2})[:\- ](\d{4})'
        d_match = re.search(date_pattern, combined_text)
        if d_match:
            found_date = f"{d_match.group(1)}-{d_match.group(2)}-{d_match.group(3)}"

        return found_time, found_date

    def transcribe_audio(self, video_path):
        try:
            model = self.get_whisper()
            result = model.transcribe(video_path, fp16=(self.device == "cuda"))
            return result.get('text', '')
        except Exception:
            return ""

    def calculate_motion_score(self, frames):
        """Calculates a percentage motion score across a set of chronological frames."""
        if len(frames) < 2:
            return "0%"
        
        diffs = []
        for i in range(len(frames) - 1):
            # Convert to grayscale
            gray1 = cv2.cvtColor(frames[i], cv2.COLOR_BGR2GRAY)
            gray2 = cv2.cvtColor(frames[i+1], cv2.COLOR_BGR2GRAY)
            
            # Compute absolute difference
            diff = cv2.absdiff(gray1, gray2)
            _, thresh = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
            
            # Tally active pixels
            non_zero = cv2.countNonZero(thresh)
            total_pixels = thresh.shape[0] * thresh.shape[1]
            diffs.append((non_zero / total_pixels) * 100)
        
        avg_motion = sum(diffs) / len(diffs)
        # Normalize and boost low percentages gently for UX
        score = min(round(avg_motion * 3.5, 1), 100.0) 
        
        if score < 1.0:
            return f"{score}% (Static Scene)"
        elif score < 15.0:
            return f"{score}% (Low Activity)"
        else:
            return f"{score}% (High Motion)"

    def scan_environment(self, frame):
        """Uses YOLO-World to find specific threat objects including weapons and masks."""
        model = self.get_yolo()
        results = model(frame, verbose=False)
        
        detected_objects = {}
        has_person = False
        has_weapon = False
        has_mask = False

        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                if conf > 0.15:  # High sensitivity for weapons and masks
                    name = model.names[cls_id]
                    
                    if name == "person":
                        has_person = True
                    if name in ["handgun", "rifle", "knife"]:
                        has_weapon = True
                    if name == "mask":
                        has_mask = True
                        
                    detected_objects[name] = detected_objects.get(name, 0) + 1
                    
        # Format the object dictionary into a readable string
        obj_list = [f"{count} {name.title()}{'s' if count > 1 else ''}" for name, count in detected_objects.items()]
        summary = ", ".join(obj_list) if obj_list else "No distinct objects classified"
        return summary, has_person, has_weapon, has_mask

    def describe_scene(self, frame):
        """Uses VLM with a Security-Focused prompt to describe threats."""
        try:
            model = self.get_vlm()
            if model is None:
                return "Visual description unavailable (VLM load failed)."
            
            # --- FOVEAL CROPPING: Strip outer 15% to remove UI overlays (speaker icons, etc) ---
            h, w = frame.shape[:2]
            y1, x1 = int(h * 0.1), int(w * 0.1)
            y2, x2 = int(h * 0.9), int(w * 0.9)
            cropped_frame = frame[y1:y2, x1:x2]

            # Convert OpenCV frame to PIL Image
            pil_image = Image.fromarray(cv2.cvtColor(cropped_frame, cv2.COLOR_BGR2RGB))
            
            # BLIP Inference with TARGETED security prompt
            security_prompt = "A person in this image is "
            inputs = self.vlm_processor(pil_image, security_prompt, return_tensors="pt").to(self.device).to(torch.float16)
            
            # Use specific generation config for better results
            out = model.generate(
                **inputs, 
                max_new_tokens=50,
                num_beams=3,
                min_length=5
            )
            description = self.vlm_processor.decode(out[0], skip_special_tokens=True)
            
            # Ensure we return a clean completion
            return description if len(description) > 5 else "A person is present in the scene."
        except Exception as e:
            sys.stderr.write(f"[VLM] Inference Error: {str(e)}\n")
            return f"Analysis unavailable: {str(e)}"

    def analyze_slide(self, video_path, user_id=None, receiver_email=None):
        try:
            frames = self.extract_key_frames(video_path, num_frames=3)
            if not frames:
                return {'success': False, 'error': 'Could not extract frames'}

            text_lines = self.extract_slide_text(frames)
            transcription = self.transcribe_audio(video_path)
            
            # Multi-Frame Combined Intelligence
            combined_summary = []
            final_has_human = False
            final_has_weapon = False
            final_has_mask = False
            final_visual_description = ""
            
            # Scan multiple frames to catch fast-moving weapons/masks
            for i, frame in enumerate(frames):
                env_summary, has_h, has_w, has_m = self.scan_environment(frame)
                final_has_human = final_has_human or has_h
                final_has_weapon = final_has_weapon or has_w
                final_has_mask = final_has_mask or has_m
                
                # Use the middle frame for VLM description (usually the clearest)
                if i == 1:
                    final_visual_description = self.describe_scene(frame)
                    env_objects = env_summary

            # New Extracted Analytics
            motion_score = self.calculate_motion_score(frames)
            
            # Build a cleaner, bulleted summary for the UI
            summary_parts = []
            if final_has_human:
                summary_parts.append("🚨 HUMAN DETECTED")
            
            if final_has_weapon:
                summary_parts.append("🔫 WEAPON DETECTED")

            if final_has_mask:
                summary_parts.append("🎭 MASK DETECTED")

            if final_visual_description and "Analysis unavailable" not in final_visual_description:
                summary_parts.append(f"👁️ Activity: {final_visual_description}")
            
            if transcription:
                summary_parts.append(f"🎙️ Audio captured ({len(transcription)} chars)")
                
            if text_lines:
                summary_parts.append(f"📝 Text: {text_lines[0][:30]}...")

            summary_parts.append(f"🗺️ View: {env_objects}")
            summary = " | ".join(summary_parts)

            result = {
                'success': True,
                'slide_analysis': {
                    'title': text_lines[0] if text_lines else "No Text Found",
                    'text_content': text_lines,
                    'transcription': transcription,
                    'visual_action': final_visual_description,
                    'summary': summary,
                    'key_points': text_lines[:5]
                }
            }

            # --- Synchronous Groq AI Threat Check ---
            groq_verdict = self.run_groq_check(text_lines, transcription, env_objects, final_visual_description, final_has_weapon, final_has_mask)
            result['groq_verdict'] = groq_verdict

            # If suspicious, fire email alert
            if groq_verdict.get('is_suspicious'):
                self.send_alert_email(
                    groq_verdict.get('reason', 'Threat detected'),
                    f"Visual: {final_visual_description}. Weapons: {final_has_weapon}. Masks: {final_has_mask}. Audio: {transcription}",
                    receiver_email
                )

            # Camera Clock Intelligence
            camera_time, camera_date = self.parse_camera_time(text_lines)
            
            result['slowData'] = {
                'title': f"EVENT AT {camera_time}" if camera_time != "Live Clock" else (text_lines[0] if text_lines else "UNIDENTIFIED SEGMENT"),
                'summary': summary,
                'transcription': transcription,
                'visual_action': final_visual_description,
                'hasWeapon': final_has_weapon,
                'hasMask': final_has_mask,
                'cameraTime': camera_time,
                'cameraDate': camera_date,
                'objects': env_objects,
                'severity': groq_verdict.get('severity', 'SECURE')
            }

            # Save to MongoDB if user_id is provided
            if user_id:
                db = self.get_db()
                if db is not None:
                    db['video_analyses'].insert_one({**result, "userId": user_id})

            return result
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def run_groq_check(self, text_lines, transcription, env_objects, visual_description, has_weapon, has_mask):
        """Calls Groq with specific Weapon/Mask flags."""
        combined_text = (
            f"VISUAL THREATS: Weapons Detected: {has_weapon}, Masks Detected: {has_mask}. "
            f"Action: {visual_description}. "
            f"Objects seen: {env_objects}. "
            f"Audio: {transcription}."
        )
        api_key = os.environ.get("GROQ_API_KEY", "").strip()

        if not api_key or (not text_lines and not transcription and env_objects == 'No distinct objects classified' and "failed" in visual_description):
            return {'is_suspicious': False, 'reason': 'No content to analyse in this segment.'}

        try:
            req = urllib.request.Request(
                "https://api.groq.com/openai/v1/chat/completions",
                data=json.dumps({
                    "model": "gpt-oss-20b",
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "You are a strict security AI monitoring a surveillance camera. "
                                "Your ONLY job is to decide if the following camera segment context is suspicious. "
                                "You have access to Visual Action (VLM description), Objects seen (YOLO), Text visible (OCR), and Audio (Whisper). "
                                "You MUST categorize the threat level into 'CRITICAL', 'ELEVATED', or 'SECURE'. "
                                "You MUST always respond with valid JSON in EXACTLY this format: "
                                '{"is_suspicious": true, "severity": "CRITICAL", "reason": "Danger: [explanation]"} '
                                "or "
                                '{"is_suspicious": false, "severity": "SECURE", "reason": "Safe: [explanation]"}. '
                                "MANDATORY TRUTH: If Weapons (handgun, rifle, knife) OR Masks are detected, set severity to 'CRITICAL' and is_suspicious to true. "
                                "MANDATORY TRUTH: If Visual Action describes stealing, pointing weapons, or people on the floor, set severity to 'CRITICAL'. "
                                "MANDATORY TRUTH: If only 'person' is seen with no weapons but suspicious 'Activity' like hide/run, set severity to 'ELEVATED'. "
                                "MANDATORY TRUTH: If the audio transcript contains shouting, distress calls like 'Help', 'Stop', or screaming, set 'is_suspicious' to true immediately. "
                                "Suspicious means: threat, violence, weapons, trespassing, shouting/audible distress, or any illegal activity."
                            )
                        },
                        {"role": "user", "content": combined_text}
                    ]
                }).encode('utf-8'),
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                },
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=8) as response:
                data = json.loads(response.read().decode('utf-8'))
                if "choices" in data and len(data["choices"]) > 0:
                    ai_raw = data['choices'][0]['message']['content']
                    analysis = json.loads(ai_raw)
                    is_sus = bool(analysis.get('is_suspicious', False))
                    severity = str(analysis.get('severity', 'SECURE'))
                    reason = str(analysis.get('reason', 'No reason provided.'))
                    return {'is_suspicious': is_sus, 'severity': severity, 'reason': reason}
        except urllib.error.HTTPError as e:
            err_msg = e.read().decode('utf-8')
            sys.stderr.write(f"Groq HTTP Error {e.code}: {err_msg}\n")
            return {'is_suspicious': False, 'reason': f'API Error {e.code}: {err_msg[:60]}'}
        except Exception as e:
            sys.stderr.write(f"Groq check failed: {e}\n")
            return {'is_suspicious': False, 'reason': f'AI check failed: {str(e)}'}

    def send_alert_email(self, reason, contextful_text, receiver_email=None):
        try:
            msg = EmailMessage()
            msg.set_content(
                f"--- AI SECURITY ALERT ---\n"
                f"Verdict: SUSPICIOUS\n"
                f"Reason : {reason}\n"
                f"--------------------------\n\n"
                f"Segment Context Details:\n"
                f"{contextful_text}\n\n"
                f"Review this immediately in your dashboard."
            )
            msg['Subject'] = f'\U0001f6a8 ALERT: {reason}'

            sender_email = os.environ.get("ALERT_SENDER_EMAIL", "").strip()
            app_password = os.environ.get("EMAIL_APP_PASSWORD", "").strip()

            if not sender_email or not app_password:
                sys.stderr.write(
                    "Alert email skipped: ALERT_SENDER_EMAIL or EMAIL_APP_PASSWORD is not set.\n"
                )
                return

            # Receiver = logged-in user's email, with fallback chain
            final_receiver = (
                receiver_email
                or os.environ.get("ALERT_RECEIVER_EMAIL")
                or sender_email  # Last resort: send to self
            )
            
            # Remove any accidental whitespace or hidden characters
            final_receiver = final_receiver.strip()
            
            sys.stderr.write(f"\n[ALERT SYSTEM] Preparing email for: '{final_receiver}'\n")
            sys.stderr.write(f"[ALERT SYSTEM] Source: {receiver_email if receiver_email else 'FALLBACK'}\n")

            msg['From'] = sender_email
            msg['To'] = final_receiver

            server = smtplib.SMTP_SSL('smtp.gmail.com', 465)
            server.login(sender_email, app_password)
            server.send_message(msg)
            server.quit()
            sys.stderr.write(f"Alert email sent to {final_receiver} for reason: {reason}\n")
        except Exception as e:
            sys.stderr.write(f"Failed to send alert email: {e}\n")

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No video path'}))
        sys.exit(1)
    
    video_path = sys.argv[1]
    user_id = sys.argv[2] if len(sys.argv) > 2 else None
    receiver_email = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
    
    analyzer = SlideAnalyzer()
    result = analyzer.analyze_slide(video_path, user_id, receiver_email)
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main()