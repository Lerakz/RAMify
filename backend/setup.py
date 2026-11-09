"""
Downloads the MediaPipe FaceLandmarker model.
Run once before starting the tracker.
"""
import urllib.request
import os
import sys

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
MODEL_PATH = os.path.join(os.path.dirname(__file__), "face_landmarker.task")

def download():
    if os.path.exists(MODEL_PATH):
        print(f"[OK] Model already exists at {MODEL_PATH}")
        return

    print(f"Downloading FaceLandmarker model (~29 MB)...")
    print(f"  From: {MODEL_URL}")

    def progress(count, block_size, total_size):
        pct = count * block_size / total_size * 100
        bar = "█" * int(pct / 2) + "░" * (50 - int(pct / 2))
        sys.stdout.write(f"\r  [{bar}] {min(pct, 100):.1f}%")
        sys.stdout.flush()

    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH, reporthook=progress)
    print(f"\n[OK] Saved to {MODEL_PATH}")

if __name__ == "__main__":
    download()
