import time
start = time.time()
import torch
print(f"Import torch: {time.time() - start:.4f}s")
start = time.time()
from ultralytics import YOLO
print(f"Import ultralytics: {time.time() - start:.4f}s")
start = time.time()
import whisper
print(f"Import whisper: {time.time() - start:.4f}s")
start = time.time()
import easyocr
print(f"Import easyocr: {time.time() - start:.4f}s")
start = time.time()
from transformers import BlipProcessor, BlipForConditionalGeneration
print(f"Import transformers: {time.time() - start:.4f}s")
