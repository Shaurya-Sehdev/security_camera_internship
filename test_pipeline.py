import requests
import json
import os

def test_pipeline():
    # 1. Test Fast YOLO
    print("Testing Fast YOLO Bridge...")
    # Use a chunk that likely exists from the logs
    test_chunk = "/home/shaurya/SHAURYA/BACK-END/security_camera_muj (Copy final)/public/videos/temp/fast_69f2e88b12bb75382ba50c3f/fast_chunk_0000.mp4"
    
    if not os.path.exists(test_chunk):
        # Find ANY mp4 in the project to test
        import glob
        chunks = glob.glob("**/*.mp4", recursive=True)
        if chunks:
            test_chunk = os.path.abspath(chunks[0])
        else:
            print("No MP4 found to test.")
            return

    print(f"Using test chunk: {test_chunk}")

    try:
        r_fast = requests.post("http://localhost:5000", json={
            "task": "fast_yolo",
            "videoPath": test_chunk
        }, timeout=30)
        print(f"Fast YOLO Result: {r_fast.status_code}")
        print(json.dumps(r_fast.json(), indent=2))
    except Exception as e:
        print(f"Fast YOLO Bridge Failed: {e}")

    # 2. Test Deep Dive
    print("\nTesting Deep Dive Bridge...")
    try:
        r_deep = requests.post("http://localhost:5000", json={
            "task": "deep_dive",
            "videoPath": test_chunk
        }, timeout=120)
        print(f"Deep Dive Result: {r_deep.status_code}")
        # Only print summary to keep it clean
        res = r_deep.json()
        if res.get('success'):
            print(f"Summary: {res['slide_analysis']['summary']}")
            print("✅ Deep Dive Pipeline is WORKING via Bridge.")
        else:
            print(f"Deep Dive Failed: {res.get('error')}")
    except Exception as e:
        print(f"Deep Dive Bridge Failed: {e}")

if __name__ == "__main__":
    test_pipeline()
