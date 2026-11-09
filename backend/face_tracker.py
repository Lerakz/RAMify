"""
VTuber Face Tracker - Backend
Captures webcam, runs MediaPipe FaceLandmarker, computes custom blendshapes
(including smirk detection), and streams data over WebSocket.
"""

import cv2
import mediapipe as mp
import asyncio
import json
import websockets
import numpy as np
import math
import sys
import os

# ── MediaPipe setup ─────────────────────────────────────────────────────────
BaseOptions = mp.tasks.BaseOptions
FaceLandmarker = mp.tasks.vision.FaceLandmarker
FaceLandmarkerOptions = mp.tasks.vision.FaceLandmarkerOptions
FaceLandmarkerResult = mp.tasks.vision.FaceLandmarkerResult
VisionRunningMode = mp.tasks.vision.RunningMode

MODEL_PATH = os.path.join(os.path.dirname(__file__), "face_landmarker.task")

# Shared state between the callback and the websocket loop
latest_payload = {}
connected_clients = set()

# ── Blendshape solver ────────────────────────────────────────────────────────
def solve(blendshapes: dict, landmarks: list, matrix) -> dict:
    def bs(name, default=0.0):
        return float(blendshapes.get(name, default))

    def lm(i):
        if landmarks and len(landmarks) > i:
            return landmarks[i]
        return None

    # ── Eyes
    blink_l = bs("eyeBlinkLeft")
    blink_r = bs("eyeBlinkRight")
    wide_l  = bs("eyeWideLeft")
    wide_r  = bs("eyeWideRight")
    squint_l = bs("eyeSquintLeft")
    squint_r = bs("eyeSquintRight")

    # ── Brows
    brow_down_l   = bs("browDownLeft")
    brow_down_r   = bs("browDownRight")
    brow_inner_up = bs("browInnerUp")
    brow_outer_l  = bs("browOuterUpLeft")
    brow_outer_r  = bs("browOuterUpRight")
    brow_up_l = brow_inner_up * 0.5 + brow_outer_l * 0.5
    brow_up_r = brow_inner_up * 0.5 + brow_outer_r * 0.5

    # ── Mouth fundamentals
    jaw_open   = bs("jawOpen")
    mouth_funnel = bs("mouthFunnel")
    mouth_pucker = bs("mouthPucker")
    smile_l    = bs("mouthSmileLeft")
    smile_r    = bs("mouthSmileRight")
    frown_l    = bs("mouthFrownLeft")
    frown_r    = bs("mouthFrownRight")
    mouth_left  = bs("mouthLeft")
    mouth_right = bs("mouthRight")
    dimple_l   = bs("mouthDimpleLeft")
    dimple_r   = bs("mouthDimpleRight")
    press_l    = bs("mouthPressLeft")
    press_r    = bs("mouthPressRight")
    upper_up_l = bs("mouthUpperUpLeft")
    upper_up_r = bs("mouthUpperUpRight")
    lower_dn_l = bs("mouthLowerDownLeft")
    lower_dn_r = bs("mouthLowerDownRight")

    # ── Smirk detection ──────────────────────────────────────────────────
    # Primary signal: left vs right mouth corner asymmetry
    corner_asymmetry = mouth_left - mouth_right   # + = left smirk, - = right
    smile_asymmetry  = smile_l - smile_r

    # Validate with raw landmark corner Y delta (lm 61=left corner, 291=right corner)
    corner_delta = 0.0
    lm_left  = lm(61)
    lm_right = lm(291)
    if lm_left and lm_right:
        corner_delta = lm_left.y - lm_right.y  # + = left corner lower = right smirk

    combined = corner_asymmetry * 0.5 + smile_asymmetry * 0.5
    boost = 1.0 + abs(corner_delta) * 5.0
    smirk_l = max(0.0, combined) * boost
    smirk_r = max(0.0, -combined) * boost
    smirk_l = min(smirk_l, 1.0)
    smirk_r = min(smirk_r, 1.0)

    # ── Cheek
    cheek_puff_l = bs("cheekPuff") * 0.5
    cheek_puff_r = bs("cheekPuff") * 0.5
    cheek_squint_l = bs("cheekSquintLeft")
    cheek_squint_r = bs("cheekSquintRight")

    # ── Nose
    nose_sneer_l = bs("noseSneerLeft")
    nose_sneer_r = bs("noseSneerRight")

    # ── Jaw
    jaw_left  = bs("jawLeft")
    jaw_right = bs("jawRight")
    jaw_fwd   = bs("jawForward")

    # ── Head pose from transformation matrix ─────────────────────────────
    head_x, head_y, head_z = 0.0, 0.0, 0.0
    if matrix is not None:
        try:
            m = np.array(matrix.data).reshape(4, 4)
            r = m[:3, :3]
            # Euler angles from rotation matrix
            head_x = math.atan2(r[2][1], r[2][2])          # pitch (nod)
            head_y = math.atan2(-r[2][0], math.sqrt(r[2][1]**2 + r[2][2]**2))  # yaw (turn)
            head_z = math.atan2(r[1][0], r[0][0])           # roll (tilt)
        except Exception:
            pass

    return {
        # Eyes
        "blinkLeft": round(blink_l, 4),
        "blinkRight": round(blink_r, 4),
        "eyeWideLeft": round(wide_l, 4),
        "eyeWideRight": round(wide_r, 4),
        "eyeSquintLeft": round(squint_l, 4),
        "eyeSquintRight": round(squint_r, 4),
        # Brows
        "browDownLeft": round(brow_down_l, 4),
        "browDownRight": round(brow_down_r, 4),
        "browUpLeft": round(brow_up_l, 4),
        "browUpRight": round(brow_up_r, 4),
        # Mouth
        "mouthOpen": round(jaw_open, 4),
        "mouthFunnel": round(mouth_funnel, 4),
        "mouthPucker": round(mouth_pucker, 4),
        "smileLeft": round(smile_l, 4),
        "smileRight": round(smile_r, 4),
        "frownLeft": round(frown_l, 4),
        "frownRight": round(frown_r, 4),
        # Smirk (custom computed)
        "smirkLeft": round(smirk_l, 4),
        "smirkRight": round(smirk_r, 4),
        # Cheek
        "cheekPuffLeft": round(cheek_puff_l, 4),
        "cheekPuffRight": round(cheek_puff_r, 4),
        "cheekSquintLeft": round(cheek_squint_l, 4),
        "cheekSquintRight": round(cheek_squint_r, 4),
        # Nose
        "noseSneerLeft": round(nose_sneer_l, 4),
        "noseSneerRight": round(nose_sneer_r, 4),
        # Jaw
        "jawLeft": round(jaw_left, 4),
        "jawRight": round(jaw_right, 4),
        "jawForward": round(jaw_fwd, 4),
        # Head pose (radians)
        "headX": round(head_x, 4),
        "headY": round(head_y, 4),
        "headZ": round(head_z, 4),
    }


# ── MediaPipe callback ───────────────────────────────────────────────────────
def on_result(result: FaceLandmarkerResult, output_image, timestamp_ms: int):
    global latest_payload
    if not result.face_blendshapes:
        return

    bs_dict = {b.category_name: b.score for b in result.face_blendshapes[0]}
    landmarks = result.face_landmarks[0] if result.face_landmarks else []
    matrix = (result.facial_transformation_matrixes[0]
              if result.facial_transformation_matrixes else None)

    latest_payload = solve(bs_dict, landmarks, matrix)


# ── WebSocket handler ────────────────────────────────────────────────────────
async def handler(websocket):
    print(f"[WS] Client connected: {websocket.remote_address}")
    connected_clients.add(websocket)
    try:
        await websocket.wait_closed()
    finally:
        connected_clients.discard(websocket)
        print(f"[WS] Client disconnected")


async def capture_loop():
    if not os.path.exists(MODEL_PATH):
        print(f"\n[ERROR] Model not found at: {MODEL_PATH}")
        print("Please download it by running:")
        print("  python backend/setup.py\n")
        sys.exit(1)

    options = FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=VisionRunningMode.LIVE_STREAM,
        num_faces=1,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
        result_callback=on_result,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, 60)

    print("[CAM] Webcam opened. Starting capture...")

    ts = 0
    with FaceLandmarker.create_from_options(options) as landmarker:
        while True:
            ret, frame = cap.read()
            if not ret:
                await asyncio.sleep(0.016)
                continue

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            landmarker.detect_async(mp_image, ts)
            ts += 16  # ~60fps timestamp increment

            if latest_payload and connected_clients:
                msg = json.dumps(latest_payload)
                # Broadcast to all connected clients
                dead = set()
                for ws in connected_clients:
                    try:
                        await ws.send(msg)
                    except Exception:
                        dead.add(ws)
                connected_clients.difference_update(dead)

            await asyncio.sleep(0.016)

    cap.release()


async def main():
    print("=" * 50)
    print("  VTuber Face Tracker")
    print("  WebSocket: ws://localhost:8765")
    print("=" * 50)

    server = await websockets.serve(handler, "localhost", 8765)
    print("[WS] Server started.")

    await asyncio.gather(
        server.wait_closed(),
        capture_loop(),
    )

if __name__ == "__main__":
    asyncio.run(main())
