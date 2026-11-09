# ✦ VTuber Studio — Setup Guide

A VTuber app with full facial expression tracking including smirk detection,
brow movement, and subtle expression recognition — powered by MediaPipe.

---

## What you need first

Install these once if you don't have them:

- **Python 3.10 or 3.11** → https://www.python.org/downloads/
  - On Windows: check "Add Python to PATH" during install
- **Node.js 18+** → https://nodejs.org/ (click "LTS" version)
- A **VRM model file** (.vrm) — you can get free ones from:
  - https://hub.vroid.com  (make your own in VRoid Studio)
  - https://3d.nicovideo.jp

---

## First-time setup (do this once)

Open a terminal / command prompt in the `vtuber-app` folder.

### Step 1 — Install Python packages

```
cd backend
pip install -r requirements.txt
```

### Step 2 — Download the face tracking model

```
python setup.py
```

This downloads a ~29 MB file called `face_landmarker.task`. Only needed once.

### Step 3 — Install frontend packages

```
cd ../frontend
npm install
```

---

## Running the app (every time)

You need **two terminals open at the same time**.

### Terminal 1 — Start the face tracker (Python)

```
cd backend
python face_tracker.py
```

You should see:
```
==================================================
  VTuber Face Tracker
  WebSocket: ws://localhost:8765
==================================================
[WS] Server started.
[CAM] Webcam opened. Starting capture...
```

### Terminal 2 — Start the app (browser)

```
cd frontend
npm run dev
```

Then open your browser and go to: **http://localhost:5173**

---

## Using the app

1. Click **Load VRM File** in the right panel and select your .vrm model
   (or drag-and-drop it onto the viewer)
2. Make sure the green dot appears in the top bar — this means face tracking is live
3. Look at your webcam and move your face — the avatar follows!

---

## Panel controls

| Control | What it does |
|---|---|
| Smirk detection | Tracks asymmetric half-smiles |
| Brow tracking | Tracks eyebrow raises and furrowing |
| Head rotation | Tracks nodding, turning, tilting |
| Eye blink | Tracks blinking |
| Expression smoothing | Higher = slower/floatier, Lower = snappier |
| Head smoothing | Smoothing just for head rotation |
| Sensitivity | Amplifies all expression values |
| Background | Change the background color (green screen!) |
| Webcam preview | Shows your live camera feed in the panel |

### Green screen for OBS
Set the background to **green** (#00b140), then in OBS add a
"Browser Source" pointing to `http://localhost:5173` and apply a
chroma key filter.

---

## Troubleshooting

**"Model not found" error**
→ Run `python setup.py` inside the `backend` folder

**Red dot / "Disconnected" in the app**
→ The Python tracker isn't running. Start Terminal 1 first.

**Avatar loads but doesn't move**
→ Make sure the green dot shows. Check that your webcam works.

**Face tracks but looks wrong / jittery**
→ Try increasing the Expression Smoothing slider. Make sure you have good lighting on your face.

**Smirk not detecting**
→ Smirk detection works best with strong lighting. Try exaggerating slightly at first.
   You can boost the Sensitivity slider too.

**VRM model doesn't load**
→ Try a different VRM file. Models from VRoid Hub work reliably.

---

## Making it better over time

The expression tuning lives in `backend/face_tracker.py` around the `solve()` function.
The VRM expression mapping lives in `frontend/src/vrm_mapper.js`.
These are heavily commented so you can tweak values.
