import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_PATH = './mediapipe-wasm';

// PoseLandmarker landmark indices (body skeleton — indices refer to the subject's own body):
//   11 = left shoulder   12 = right shoulder
//   13 = left elbow      14 = right elbow
//   15 = left wrist      16 = right wrist
//   23 = left hip        24 = right hip
//
// World landmark coordinate system (body-centric, origin at hip midpoint):
//   X+: subject's right   Y+: up   Z+: toward camera (subject's forward)
//
// MIRROR_POSE: if true, swaps left/right indices (needed if MediaPipe labels from the image
// frame instead of the body frame when using a front-facing camera). Empirically determine
// the correct value — start with false and flip if the wrong arm drives.
const MIRROR_POSE = false;

function normalize3(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-6) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function sub3(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function solveArm(lm, normLm, shIdx, elIdx, wrIdx) {
  const shoulder   = lm[shIdx];
  const elbow      = lm[elIdx];
  const wrist      = lm[wrIdx];
  const wristNorm  = normLm[wrIdx];

  // Gate on wrist actually being inside the camera frame (not extrapolated off-screen).
  // normLm coordinates are 0–1 in image space; outside that range = off-camera.
  const wristInFrame = wristNorm.x > 0.04 && wristNorm.x < 0.96 &&
                       wristNorm.y > 0.04 && wristNorm.y < 0.96;

  const vis = wristInFrame &&
              (shoulder.visibility ?? 1) >= 0.3 &&
              (elbow.visibility    ?? 1) >= 0.3 &&
              (wrist.visibility    ?? 1) >= 0.6;
  if (!vis) return null;

  const upperArmVec = normalize3(sub3(elbow, shoulder));
  const forearmVec  = normalize3(sub3(wrist, elbow));

  // Elevation: angle above/below horizontal. Scale by 0.75 to prevent over-rotation —
  // the camera perspective and seated position make arm angles read higher than they appear.
  const elevation = Math.asin(clamp(upperArmVec.y, -1, 1)) * 0.75;

  // Forward angle: how much the arm points toward/away from camera in the horizontal plane.
  // Z+ = toward camera = subject's forward.
  const horiz   = Math.sqrt(upperArmVec.x * upperArmVec.x + upperArmVec.z * upperArmVec.z);
  const forward = horiz > 0.001 ? Math.asin(clamp(upperArmVec.z / horiz, -1, 1)) * 0.6 : 0;

  // Elbow bend: 0 = fully extended, increases when the forearm angles away from upper arm.
  const elbowBend = Math.acos(clamp(dot3(upperArmVec, forearmVec), -1, 1));

  return { elevation, forward, elbowBend };
}

function solvePoseArms(worldLandmarks, landmarks) {
  const lm     = worldLandmarks[0];
  const normLm = landmarks[0];
  if (!lm || lm.length < 25 || !normLm) return null;

  const leftShIdx  = MIRROR_POSE ? 12 : 11;
  const rightShIdx = MIRROR_POSE ? 11 : 12;
  const leftElIdx  = MIRROR_POSE ? 14 : 13;
  const rightElIdx = MIRROR_POSE ? 13 : 14;
  const leftWrIdx  = MIRROR_POSE ? 16 : 15;
  const rightWrIdx = MIRROR_POSE ? 15 : 16;

  return {
    left:  solveArm(lm, normLm, leftShIdx,  leftElIdx,  leftWrIdx),
    right: solveArm(lm, normLm, rightShIdx, rightElIdx, rightWrIdx),
  };
}

export class PoseTracker {
  constructor() {
    this.onData         = null;
    this._landmarker    = null;
    this._video         = null;
    this._animId        = null;
    this._running       = false;
    this._ready         = false;
    this._frameCount    = 0;
    this._noPoseFrames  = 0;
  }

  async init(modelPath) {
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
    this._landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: modelPath },
      runningMode:                'VIDEO',
      numPoses:                   1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence:  0.5,
      minTrackingConfidence:      0.5,
    });
    this._ready = true;
  }

  get ready() { return this._ready; }

  // Reuses the face tracker's existing camera stream — no second camera needed.
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

    // Run at ~15fps (every 4th frame) to keep CPU reasonable alongside face + hand tracking.
    this._frameCount++;
    if (this._frameCount % 4 !== 0) return;

    const result = this._landmarker.detectForVideo(this._video, performance.now());
    if (result.worldLandmarks?.length) {
      this._noPoseFrames = 0;
      const arms = solvePoseArms(result.worldLandmarks, result.landmarks);
      if (arms) this.onData?.(arms);
    } else {
      this._noPoseFrames++;
      if (this._noPoseFrames >= 5) {
        this._noPoseFrames = 0;
        this.onData?.(null);
      }
    }
  }

  stop() {
    this._running      = false;
    this._frameCount   = 0;
    this._noPoseFrames = 0;
    if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    this._video = null;
  }
}
