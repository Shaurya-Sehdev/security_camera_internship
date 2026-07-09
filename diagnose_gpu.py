import torch
import sys
from ultralytics import YOLO

def diagnose():
    print(f"Python Version: {sys.version}")
    print(f"Torch Version: {torch.__version__}")
    print(f"CUDA Available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"CUDA Device Name: {torch.cuda.get_device_name(0)}")
        print(f"CUDA Device Count: {torch.cuda.device_count()}")
    
    import time
    try:
        start_load = time.time()
        model = YOLO('yolov8n.pt')
        print(f"YOLO Loaded in: {time.time() - start_load:.4f}s")
        
        # Test inference
        import numpy as np
        dummy_frame = np.zeros((640, 640, 3), dtype=np.uint8)
        
        start_inf = time.time()
        results = model.predict(dummy_frame, device='cuda' if torch.cuda.is_available() else 'cpu', verbose=False)
        print(f"First Inference in: {time.time() - start_inf:.4f}s")
        
        start_inf = time.time()
        results = model.predict(dummy_frame, device='cuda' if torch.cuda.is_available() else 'cpu', verbose=False)
        print(f"Second Inference in: {time.time() - start_inf:.4f}s")
    except Exception as e:
        print(f"Error during YOLO test: {e}")

if __name__ == "__main__":
    diagnose()
