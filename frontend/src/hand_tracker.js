import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_PATH = './mediapipe-wasm';

// Front-facing (selfie) cameras produce a mirrored image.
// MediaPipe labels from the image's frame of reference, so "Left" = user's right hand.
const MIRROR_CAM = true;

function jointAngle(a, b, c) {
  // Interior angle at b, using vectors b→a and b→c
  const ax = a.x - b.x, ay = a.y - b.y, az = a.z - b.z;
  const cx = c.x - b.x, cy = c.y - b.y, cz = c.z - b.z;
  const mA = Math.sqrt(ax*ax + ay*ay + az*az);
  const mC = Math.sqrt(cx*cx + cy*cy + cz*cz);
  if (mA < 1e-6 || mC < 1e-6) return Math.PI;
  const dot = (ax*cx + ay*cy + az*cz) / (mA * mC);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

function bendToCurl(angle) {
  // π = straight → 0,  π/2 = 90° bend → 1
  return Math.max(0, Math.min(1, (Math.PI - angle) / (Math.PI / 2)));
}

// Compute curl (0=extended, 1=curled) from 3 joints using world-space landmarks
function fingerCurl(lm, prev, mcp, pip, dip, tip) {
  const a1 = jointAngle(lm[prev], lm[mcp], lm[pip]);
  const a2 = jointAngle(lm[mcp],  lm[pip], lm[dip]);
  const a3 = jointAngle(lm[pip],  lm[dip], lm[tip]);
  return (bendToCurl(a1) + bendToCurl(a2) + bendToCurl(a3)) / 3;
}

function thumbCurl(lm) {
  // Thumb has only 2 primary bending joints (MCP=2, IP=3)
  const a1 = jointAngle(lm[0], lm[2], lm[3]);  // wrist–MCP–IP
  const a2 = jointAngle(lm[2], lm[3], lm[4]);  // MCP–IP–TIP
  return (bendToCurl(a1) + bendToCurl(a2)) / 2;
}

function solveHands(worldLandmarks, handedness) {
  const result = { left: null, right: null };
  for (let i = 0; i < worldLandmarks.length; i++) {
    const lm    = worldLandmarks[i];
    const label = handedness[i]?.[0]?.categoryName ?? 'Left';
    const side  = MIRROR_CAM
      ? (label === 'Left' ? 'right' : 'left')
      : (label === 'Left' ? 'left'  : 'right');
    result[side] = {
      thumb:  thumbCurl(lm),
      index:  fingerCurl(lm, 0,  5,  6,  7,  8),
      middle: fingerCurl(lm, 0,  9, 10, 11, 12),
      ring:   fingerCurl(lm, 0, 13, 14, 15, 16),
      pinky:  fingerCurl(lm, 0, 17, 18, 19, 20),
    };
  }
  return result;
}

export class HandTracker {
  constructor() {
    this.onData       = null;
    this._landmarker  = null;
    this._video       = null;
    this._animId      = null;
    this._running     = false;
    this._ready       = false;
    this._frameCount  = 0;
    this._noHandFrames = 0;
  }

  async init(modelPath) {
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
    this._landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: modelPath },
      runningMode:                'VIDEO',
      numHands:                   2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence:  0.5,
      minTrackingConfidence:      0.5,
    });
    this._ready = true;
  }

  get ready() { return this._ready; }

  // Attach to an existing <video> element — reuses the face tracker's camera, no second camera needed.
  attach(videoEl) {
    if (this._running || !this._ready) return;
    this._video   = videoEl;
    this._running = true;
    this._loop();
  }

  _loop() {
    if (!this._running) return;
    this._animId = requestAnimationFrame(() => this._loop());
    if (!this._landmarker || !this._video || this._video.readyState < 2) return;

    // Run detection at ~15fps instead of 60fps to keep CPU reasonable
    this._frameCount++;
    if (this._frameCount % 4 !== 0) return;

    const result = this._landmarker.detectForVideo(this._video, performance.now());
    if (result.worldLandmarks?.length) {
      this._noHandFrames = 0;
      this.onData?.(solveHands(result.worldLandmarks, result.handedness));
    } else {
      // After ~5 missed detections (~330ms), signal hands lost so pose resumes
      this._noHandFrames++;
      if (this._noHandFrames >= 5) {
        this._noHandFrames = 0;
        this.onData?.(null);
      }
    }
  }

  stop() {
    this._running     = false;
    this._frameCount  = 0;
    this._noHandFrames = 0;
    if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    this._video = null;
  }
}
