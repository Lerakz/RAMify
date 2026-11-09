import { FaceLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';

// Bundled locally — app works fully offline after install.
const WASM_PATH = './mediapipe-wasm';

// Mirrors the Python backend's solve() function exactly.
function solveFace(blendshapes, landmarks, matrix) {
  const bs = {};
  for (const cat of blendshapes) bs[cat.categoryName] = cat.score;
  const get = (n) => bs[n] ?? 0;

  const browInnerUp     = get('browInnerUp');
  const mouthLeft       = get('mouthLeft');
  const mouthRight      = get('mouthRight');
  const smileLeft       = get('mouthSmileLeft');
  const smileRight      = get('mouthSmileRight');

  // Smirk: asymmetry of mouth corners + landmark delta (landmarks 61=left, 291=right corner)
  const cornerAsymmetry = mouthLeft - mouthRight;
  const smileAsymmetry  = smileLeft - smileRight;
  let cornerDelta = 0;
  if (landmarks?.length > 291) {
    cornerDelta = landmarks[61].y - landmarks[291].y;
  }
  const combined = cornerAsymmetry * 0.5 + smileAsymmetry * 0.5;
  const boost    = 1.0 + Math.abs(cornerDelta) * 5.0;

  // Head pose from 4x4 transformation matrix (flat array, row-major as reshaped by Python)
  let headX = 0, headY = 0, headZ = 0;
  if (matrix?.data) {
    const d = matrix.data;
    headX = Math.atan2(d[9],  d[10]);
    headY = Math.atan2(-d[8], Math.sqrt(d[9] * d[9] + d[10] * d[10]));
    headZ = Math.atan2(d[4],  d[0]);
  }

  return {
    blinkLeft:        get('eyeBlinkLeft'),
    blinkRight:       get('eyeBlinkRight'),
    eyeWideLeft:      get('eyeWideLeft'),
    eyeWideRight:     get('eyeWideRight'),
    eyeSquintLeft:    get('eyeSquintLeft'),
    eyeSquintRight:   get('eyeSquintRight'),
    browDownLeft:     get('browDownLeft'),
    browDownRight:    get('browDownRight'),
    browUpLeft:       browInnerUp * 0.5 + get('browOuterUpLeft')  * 0.5,
    browUpRight:      browInnerUp * 0.5 + get('browOuterUpRight') * 0.5,
    mouthOpen:        get('jawOpen'),
    mouthFunnel:      get('mouthFunnel'),
    mouthPucker:      get('mouthPucker'),
    smileLeft,
    smileRight,
    frownLeft:        get('mouthFrownLeft'),
    frownRight:       get('mouthFrownRight'),
    smirkLeft:        Math.min(Math.max(combined,  0) * boost, 1),
    smirkRight:       Math.min(Math.max(-combined, 0) * boost, 1),
    cheekPuffLeft:    get('cheekPuff') * 0.5,
    cheekPuffRight:   get('cheekPuff') * 0.5,
    cheekSquintLeft:  get('cheekSquintLeft'),
    cheekSquintRight: get('cheekSquintRight'),
    noseSneerLeft:    get('noseSneerLeft'),
    noseSneerRight:   get('noseSneerRight'),
    jawLeft:              get('jawLeft'),
    jawRight:             get('jawRight'),
    jawForward:           get('jawForward'),
    mouthStretchLeft:     get('mouthStretchLeft'),
    mouthStretchRight:    get('mouthStretchRight'),
    mouthDimpleLeft:      get('mouthDimpleLeft'),
    mouthDimpleRight:     get('mouthDimpleRight'),
    headX, headY, headZ,
  };
}

export class FaceTracker {
  constructor() {
    this.onData      = null;
    this.onFaceFound = null;
    this.onFaceLost  = null;
    this._landmarker   = null;
    this._video        = null;
    this._animId       = null;
    this._running      = false;
    this._facePresent  = false;
    this._noFaceFrames = 0;
    this._overlayCtx   = null;
    this._overlayCanvas = null;
    this._drawUtils    = null;
  }

  setOverlayCanvas(canvas) {
    if (!canvas && this._overlayCtx) {
      this._overlayCtx.clearRect(0, 0, this._overlayCanvas.width, this._overlayCanvas.height);
    }
    this._overlayCanvas = canvas;
    if (canvas) {
      canvas.width  = 640;
      canvas.height = 480;
      this._overlayCtx = canvas.getContext('2d');
      this._drawUtils  = new DrawingUtils(this._overlayCtx);
    } else {
      this._overlayCtx = null;
      this._drawUtils  = null;
    }
  }

  async init(modelPath) {
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
    this._landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: modelPath },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  async startCamera(videoEl) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    });
    videoEl.srcObject = stream;
    this._video = videoEl;
    await new Promise(res => { videoEl.onloadedmetadata = res; });
    await videoEl.play();
    this._running = true;
    this._loop();
  }

  // Expose the live stream so the cam preview can reuse it without opening a second camera.
  get stream() { return this._video?.srcObject ?? null; }

  _loop() {
    if (!this._running) return;
    this._animId = requestAnimationFrame(() => this._loop());
    if (!this._landmarker || !this._video || this._video.readyState < 2) return;

    const result  = this._landmarker.detectForVideo(this._video, performance.now());
    const hasFace = result.faceBlendshapes?.length && result.facialTransformationMatrixes?.length;

    if (hasFace) {
      this._noFaceFrames = 0;
      if (!this._facePresent) {
        this._facePresent = true;
        this.onFaceFound?.();
      }
      this.onData?.(solveFace(
        result.faceBlendshapes[0].categories,
        result.faceLandmarks?.[0] ?? [],
        result.facialTransformationMatrixes[0],
      ));
    } else if (++this._noFaceFrames > 10 && this._facePresent) {
      this._facePresent = false;
      this.onFaceLost?.();
    }

    if (this._drawUtils) {
      this._overlayCtx.clearRect(0, 0, 640, 480);
      if (hasFace) {
        for (const lm of result.faceLandmarks) {
          this._drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_TESSELATION,
            { color: 'rgba(156,175,136,0.18)', lineWidth: 1 });
          this._drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
            { color: 'rgba(200,184,122,0.55)', lineWidth: 1.5 });
          this._drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
            { color: '#9caf88', lineWidth: 1.5 });
          this._drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
            { color: '#9caf88', lineWidth: 1.5 });
          this._drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
            { color: '#c8b87a', lineWidth: 1.5 });
          this._drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
            { color: '#c8b87a', lineWidth: 1.5 });
          this._drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_LIPS,
            { color: '#9caf88', lineWidth: 1.5 });
          this._drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
            { color: 'rgba(156,175,136,0.7)', lineWidth: 1 });
          this._drawUtils.drawConnectors(lm, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
            { color: 'rgba(156,175,136,0.7)', lineWidth: 1 });
        }
      }
    }
  }

  stop() {
    this._running = false;
    if (this._animId) cancelAnimationFrame(this._animId);
    if (this._video?.srcObject) {
      this._video.srcObject.getTracks().forEach(t => t.stop());
      this._video.srcObject = null;
    }
  }
}
