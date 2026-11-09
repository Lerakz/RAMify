import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMMapper, POSES } from './vrm_mapper.js';
import { FaceTracker } from './face_tracker.js';
import { HandTracker } from './hand_tracker.js';
import { PoseTracker } from './pose_tracker.js';

// ── Spout renderer mode (window loaded as ?spout=1 by main process) ──────────
const SPOUT_MODE = new URLSearchParams(location.search).has('spout');

// ── Scene setup ──────────────────────────────────────────────────────────────
const canvas   = document.getElementById('canvas');
const viewport = document.getElementById('viewport');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: !SPOUT_MODE });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
if (!SPOUT_MODE) scene.background = new THREE.Color('#050508');

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
camera.position.set(0, 1.4, 2.8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.5;
controls.maxDistance = 8;
controls.update();

// ── Lighting ─────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
dirLight.position.set(1, 3, 2);
dirLight.castShadow = true;
scene.add(dirLight);
const fillLight = new THREE.DirectionalLight(0xddeeff, 0.4);
fillLight.position.set(-2, 1, -1);
scene.add(fillLight);

// ── State ─────────────────────────────────────────────────────────────────────
let vrm    = null;
let mapper = null;
let frameCount  = 0;
let lastFpsTime = performance.now();

// ── Spout2 output state (GPU texture path via offscreen window) ───────────────
let spoutEnabled  = false;
let _spoutVrmUrl  = null;  // file:// or /@fs/ URL safe to send to spout window

// Bones to sync every frame — all animated humanoid bones
const _SPOUT_BONES = [
  'hips','spine','chest','upperChest','neck','head',
  'leftShoulder','leftUpperArm','leftLowerArm','leftHand',
  'rightShoulder','rightUpperArm','rightLowerArm','rightHand',
  'leftThumbProximal','leftThumbDistal',
  'leftIndexProximal','leftIndexIntermediate','leftIndexDistal',
  'leftMiddleProximal','leftMiddleIntermediate','leftMiddleDistal',
  'leftRingProximal','leftRingIntermediate','leftRingDistal',
  'leftLittleProximal','leftLittleIntermediate','leftLittleDistal',
  'rightThumbProximal','rightThumbDistal',
  'rightIndexProximal','rightIndexIntermediate','rightIndexDistal',
  'rightMiddleProximal','rightMiddleIntermediate','rightMiddleDistal',
  'rightRingProximal','rightRingIntermediate','rightRingDistal',
  'rightLittleProximal','rightLittleIntermediate','rightLittleDistal',
];
const _SPOUT_EXPRESSIONS = [
  'happy','angry','sad','relaxed','surprised',
  'blink','blinkLeft','blinkRight',
  'lookUp','lookDown','lookLeft','lookRight',
  'aa','ih','ou','ee','oh','neutral',
];

function sendSpoutState() {
  if (!vrm || !window.spout) return;
  const h = vrm.humanoid;
  const bones = {};
  for (const name of _SPOUT_BONES) {
    const node = h.getNormalizedBoneNode(name);
    if (node) { const q = node.quaternion; bones[name] = [q.x, q.y, q.z, q.w]; }
  }
  const expressions = {};
  const em = vrm.expressionManager;
  if (em) {
    for (const name of _SPOUT_EXPRESSIONS) {
      const v = em.getValue(name);
      if (v != null && v > 0.001) expressions[name] = v;
    }
  }
  window.spout.sendState({ bones, expressions });
}

// Spout renderer: receive and apply state from the main window
function applySpoutState(state) {
  if (!vrm) return;
  const h = vrm.humanoid;
  for (const [name, q] of Object.entries(state.bones || {})) {
    const node = h.getNormalizedBoneNode(name);
    if (node) node.quaternion.set(q[0], q[1], q[2], q[3]);
  }
  const em = vrm.expressionManager;
  if (em) {
    for (const [name, val] of Object.entries(state.expressions || {})) {
      try { em.setValue(name, val); } catch (_) {}
    }
  }
}

const settings = {
  smirk:        true,
  brow:         true,
  head:         true,
  blink:        true,
  smoothExpr:   0.20,
  smoothHead:   0.12,
  sensitivity:  1.0,
  headXNeutral: 0,   // calibrated pitch offset — set via the "Set neutral" button
};

// ── Resize ────────────────────────────────────────────────────────────────────
function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
resize();
new ResizeObserver(resize).observe(viewport);

// ── VRM loading ───────────────────────────────────────────────────────────────
const loader = new GLTFLoader();
loader.register(parser => new VRMLoaderPlugin(parser));

function loadVRM(url, name, fsPath) {
  // Compute a URL the offscreen spout window can reach (no blob: URLs cross processes).
  // In dev mode the spout window is on http://localhost so we must use /@fs/ (Vite file serving).
  // In production the spout window is on file:// so file:/// URLs work directly.
  const devMode = window.location.protocol === 'http:';
  if (fsPath) {
    _spoutVrmUrl = devMode
      ? '/@fs/' + fsPath.replace(/\\/g, '/')
      : 'file:///' + fsPath.replace(/\\/g, '/');
  } else if (url.startsWith('/@fs/')) {
    // Already a Vite fs URL — keep as-is in dev, convert to file:// for production
    _spoutVrmUrl = devMode ? url : 'file://' + url.slice(4);
  } else if (!url.startsWith('blob:')) {
    _spoutVrmUrl = url;
  } else {
    _spoutVrmUrl = null; // blob: URLs can't cross processes
  }

  if (vrm) {
    scene.remove(vrm.scene);
    VRMUtils.deepDispose(vrm.scene);
    vrm    = null;
    mapper = null;
  }

  if (!SPOUT_MODE) {
    document.getElementById('overlay-text').textContent = 'Loading model…';
    document.getElementById('overlay').style.display = 'flex';
  }

  loader.load(
    url,
    gltf => {
      const model = gltf.userData.vrm;
      if (!model) {
        if (!SPOUT_MODE) document.getElementById('overlay-text').textContent = 'Error: not a valid VRM file.';
        return;
      }

      VRMUtils.removeUnnecessaryJoints(model.scene);
      VRMUtils.removeUnnecessaryVertices(model.scene);

      vrm = model;
      scene.add(vrm.scene);

      if (!SPOUT_MODE) {
        const box    = new THREE.Box3().setFromObject(vrm.scene);
        const size   = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        controls.target.set(center.x, center.y * 0.85, center.z);
        camera.position.set(center.x, center.y * 0.85, center.z + size.y * 1.6);
        controls.update();
      }

      mapper = new VRMMapper(vrm, settings);
      window.__vrm         = vrm;
      window.__mapper      = mapper;
      window.__THREE       = THREE;
      window.__POSES       = { POSES };
      window.__handTracker = handTracker;
      window.__poseTracker = poseTracker;

      if (!SPOUT_MODE) {
        // Apply whichever pose button is currently active
        const activeBtn = document.querySelector('.pose-btn.active');
        if (activeBtn) {
          mapper.setPose(activeBtn.dataset.pose);
        } else {
          const idleBtn = document.querySelector('[data-pose="idle"]');
          if (idleBtn) idleBtn.classList.add('active');
          mapper.setPose('idle');
        }
        document.getElementById('overlay').style.display = 'none';
        document.getElementById('model-name').textContent = name || 'Model loaded';
      } else {
        // Auto-frame a bust shot from the front (-Z side) for the Spout output.
        // VRM characters face -Z, so the camera must be at negative Z to see the face.
        // Camera FOV is 30°, so half-angle = 15°, tan(15°) ≈ 0.268.
        // At distance D the visible half-height = D * 0.268.
        // We aim for ~0.82m visible (head + upper body) → D ≈ 0.82 / (2 * 0.268) * 2 = height * 0.9.
        const box = new THREE.Box3().setFromObject(vrm.scene);
        const height = box.max.y - box.min.y;
        const cx = (box.max.x + box.min.x) / 2;
        const cz = (box.max.z + box.min.z) / 2;
        const targetY = box.max.y - height * 0.22; // upper-chest level — keeps head+arms both in frame
        const camY    = box.max.y - height * 0.19; // just above target, nearly level
        const camDist = height * 0.90;             // bust shot with arm clearance for thinking/crossed poses
        camera.position.set(cx, camY, cz - camDist);
        controls.target.set(cx, targetY, cz);
        controls.update();
      }

      console.log('[VRM] Loaded:', name, '| version:', vrm.meta?.metaVersion ?? 'unknown');
      if (!SPOUT_MODE && spoutEnabled && _spoutVrmUrl && window.spout) {
        window.spout.notifyLoadVRM(_spoutVrmUrl);
      }
    },
    progress => {
      if (!SPOUT_MODE) {
        const pct = Math.round((progress.loaded / progress.total) * 100);
        document.getElementById('overlay-text').textContent = `Loading… ${pct}%`;
      }
    },
    err => {
      console.error('[VRM] Load error:', err);
      if (!SPOUT_MODE) document.getElementById('overlay-text').textContent = 'Failed to load model.\nMake sure it\'s a valid .vrm file.';
    }
  );
}

// ── Face tracker (MediaPipe WASM — no Python, no WebSocket) ──────────────────
const tracker      = new FaceTracker();
const handTracker  = new HandTracker();
const poseTracker  = new PoseTracker();
let   handTracking = false;  // true when hand tracking is active
let   armTracking  = false;  // true when arm tracking is active

const trackerVideo = document.createElement('video');
trackerVideo.setAttribute('playsinline', '');
trackerVideo.muted = true;
trackerVideo.style.display = 'none';
document.body.appendChild(trackerVideo);

tracker.onData = (data) => {
  if (!mapper) return;
  mapper.applyData(data);
  document.getElementById('face-status').textContent = 'Face detected';
  updateMeters(data);
};

tracker.onFaceFound = () => {
  document.getElementById('face-status').textContent = 'Face detected';
};

tracker.onFaceLost = () => {
  document.getElementById('face-status').textContent = 'No face';
};

if (!SPOUT_MODE) (async () => {
  try {
    document.getElementById('status-label').textContent = 'Loading face tracking…';
    const faceModelUrl = new URL('./face_landmarker.task', window.location.href).href;
    await tracker.init(faceModelUrl);
    await tracker.startCamera(trackerVideo);
    document.getElementById('status-dot').classList.add('connected');
    document.getElementById('status-label').textContent = 'Tracking active';
    // Pre-load hand + pose models in the background so toggles are instant when user enables them
    const handModelUrl = new URL('./hand_landmarker.task', window.location.href).href;
    handTracker.init(handModelUrl).catch(err => console.warn('[HandTracker] init failed:', err));
    const poseModelUrl = new URL('./pose_landmarker.task', window.location.href).href;
    poseTracker.init(poseModelUrl).catch(err => console.warn('[PoseTracker] init failed:', err));
  } catch (err) {
    console.error('[Tracker] Failed to start:', err);
    document.getElementById('status-label').textContent = 'Camera error — check permissions';
  }
})();

// ── Spout renderer mode setup ─────────────────────────────────────────────────
if (SPOUT_MODE) {
  // Hide the entire UI — this window is invisible to the user anyway
  ['topbar','panel','bottombar','overlay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  // Transparent background for Spout — OBS composites the character over whatever is behind the source
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  document.body.style.background = 'transparent';
  const vp = document.getElementById('viewport');
  if (vp) vp.style.background = 'transparent';
  // Initial camera — VRM characters face -Z, so camera must be at negative Z to see the front.
  // This gets overridden per-model after VRM loads in the loadVRM callback below.
  camera.position.set(0, 1.42, -2.2);
  controls.target.set(0, 1.2, 0);
  controls.enableDamping = false;
  controls.enabled = false;
  controls.update();
  // Receive VRM and per-frame state from the main window via IPC relay
  if (window.spoutReceiver) {
    window.spoutReceiver.onLoadVRM(url => {
      console.log('[Spout window] Loading VRM:', url);
      loadVRM(url, 'Spout');
    });
    window.spoutReceiver.onState(applySpoutState);
  }
}

// ── Render loop ───────────────────────────────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  controls.update();
  if (vrm) {
    if (mapper && !SPOUT_MODE) {
      mapper.tickExpressions(delta);
      mapper.tickPose(delta);    // must be BEFORE vrm.update so bones are processed this frame
      mapper.tickHands(delta);   // overrides finger bones when hand data is present; no-op otherwise
      mapper.tickArms(delta);    // overrides arm bones when pose arm data is present; no-op otherwise
    }
    vrm.update(delta);
    if (spoutEnabled && !SPOUT_MODE) sendSpoutState();
  }
  renderer.render(scene, camera);

  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime > 1000) {
    document.getElementById('fps-counter').textContent = `${frameCount} fps`;
    frameCount  = 0;
    lastFpsTime = now;
  }
}
animate();

// ── Debug helper (open browser console and call: logBones()) ─────────────────
window.logBones = function() {
  const vrm = window.__vrm;
  if (!vrm) { console.log('No VRM loaded'); return; }
  const h = vrm.humanoid;
  const v = vrm.meta?.metaVersion === '1' ? 1 : 0;
  const getBone = name => v === 0
    ? (h.getRawBoneNode?.(name) ?? h.getNormalizedBoneNode?.(name))
    : h.getNormalizedBoneNode?.(name);
  console.log(`VRM version: ${v}`);
  ['leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm','leftHand','rightHand'].forEach(b => {
    const n = getBone(b);
    if (n) console.log(`${b}: x=${(n.rotation.x*180/Math.PI).toFixed(1)}° y=${(n.rotation.y*180/Math.PI).toFixed(1)}° z=${(n.rotation.z*180/Math.PI).toFixed(1)}°  (name: ${n.name})`);
    else console.log(`${b}: NOT FOUND`);
  });
};

window.testPose = function(bone, xDeg, yDeg, zDeg) {
  const mapper = window.__mapper;
  if (!mapper) { console.log('No VRM/mapper loaded'); return; }

  const T = window.__THREE;
  const rad = deg => deg * Math.PI / 180;
  const qq = new T.Quaternion().setFromEuler(new T.Euler(rad(xDeg), rad(yDeg), rad(zDeg), 'XYZ'));
  const arr = [qq.x, qq.y, qq.z, qq.w];
  const ID  = [0, 0, 0, 1];

  // Build an idle-based target with only the tested bone overridden,
  // so the body posture stays natural during the test.
  const { POSES } = window.__POSES;
  const base = POSES.idle.rot;
  const target = {};
  ['spine','chest','hips','leftShoulder','rightShoulder',
   'leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm','leftHand','rightHand']
    .forEach(b => { target[b] = b === bone ? arr : (base[b] ?? ID); });

  mapper._poseTarget = target;
  mapper._poseSpeed  = 1;

  console.log(`testPose ${bone}  x=${xDeg} y=${yDeg} z=${zDeg}`);
};

window.stopTest = function() {
  if (window.__testPoseRAF) { cancelAnimationFrame(window.__testPoseRAF); window.__testPoseRAF = null; }
  if (window.__mapper) window.__mapper.setPose('idle');
  console.log('Stopped — back to idle');
};

// Inspect what's actually on the humanoid object
window.__autoLoadVRM = function(fileUrl, name) {
  loadVRM(fileUrl, name);
};

window.inspectHumanoid = function() {
  const vrm = window.__vrm;
  if (!vrm) { console.log('No VRM loaded'); return; }
  const h = vrm.humanoid;
  console.log('humanoid keys:', Object.keys(h));
  console.log('humanoid proto methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(h)));
  const nn = h.getNormalizedBoneNode?.('leftUpperArm');
  console.log('normalizedNode:', nn?.name, 'parent:', nn?.parent?.name);
  const rn = h.getRawBoneNode?.('leftUpperArm');
  console.log('rawNode:', rn?.name, 'parent:', rn?.parent?.name);
};

// ── UI wiring — all done with addEventListener, NOT inline onclick ────────────

// File input / drag-drop
document.getElementById('file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  loadVRM(URL.createObjectURL(file), file.name.replace('.vrm', ''), file.path || null);
});

document.getElementById('load-btn').addEventListener('click', async () => {
  if (window.electronAPI?.openVRM) {
    const fsPath = await window.electronAPI.openVRM();
    if (!fsPath) return;
    const url = 'file:///' + fsPath.replace(/\\/g, '/');
    loadVRM(url, fsPath.split(/[/\\]/).pop().replace(/\.vrm$/i, ''), fsPath);
  } else {
    document.getElementById('file-input').click(); // dev fallback
  }
});

viewport.addEventListener('dragover',  e => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) viewport.classList.add('drag-over'); });
viewport.addEventListener('dragleave', () => viewport.classList.remove('drag-over'));
viewport.addEventListener('drop', e => {
  e.preventDefault();
  viewport.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file || !file.name.endsWith('.vrm')) return;
  const fsPath = file.path || null;
  if (fsPath) {
    const url = 'file:///' + fsPath.replace(/\\/g, '/');
    loadVRM(url, file.name.replace(/\.vrm$/i, ''), fsPath);
  } else {
    loadVRM(URL.createObjectURL(file), file.name.replace(/\.vrm$/i, ''), null);
  }
});

// Toggles
function bindToggle(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', () => {
    settings[key] = el.classList.contains('on');
    if (mapper) mapper.settings = settings;
  });
}
bindToggle('toggle-smirk', 'smirk');
bindToggle('toggle-brow',  'brow');
bindToggle('toggle-head',  'head');
bindToggle('toggle-blink', 'blink');

// Smoothing sliders
document.getElementById('sl-smooth').addEventListener('input', function() {
  settings.smoothExpr = parseFloat(this.value) / 100;
  document.getElementById('sl-smooth-val').textContent = this.value + '%';
  if (mapper) mapper.settings = settings;
});
document.getElementById('sl-head').addEventListener('input', function() {
  settings.smoothHead = parseFloat(this.value) / 100;
  document.getElementById('sl-head-val').textContent = this.value + '%';
  if (mapper) mapper.settings = settings;
});
document.getElementById('sl-sens').addEventListener('input', function() {
  settings.sensitivity = parseFloat(this.value) / 100;
  document.getElementById('sl-sens-val').textContent = settings.sensitivity.toFixed(1) + '×';
  if (mapper) mapper.settings = settings;
});

// ── Pose buttons — attached here, not via onclick in HTML ────────────────────
document.querySelectorAll('.pose-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Update active highlight
    document.querySelectorAll('.pose-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Tell the mapper
    if (mapper) {
      mapper.setPose(btn.dataset.pose);
    } else {
      // No model loaded yet — just store so it applies on load
      console.log('[Pose] No model loaded yet, will apply on load:', btn.dataset.pose);
    }
  });
});

// Pose transition speed slider
document.getElementById('sl-pose-speed').addEventListener('input', function() {
  const v = parseFloat(this.value);
  // Range is 1–20; map to lerp factor 0.01–0.15
  const speed = v / 130;
  const label = v <= 4 ? 'Slow' : v <= 12 ? 'Medium' : 'Fast';
  document.getElementById('sl-pose-speed-val').textContent = label;
  if (mapper) mapper._poseSpeed = speed;
});

// Background swatches
document.querySelectorAll('.swatch[data-color]').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    el.classList.add('active');
    scene.background = new THREE.Color(el.dataset.color);
  });
});
document.getElementById('color-pick').addEventListener('input', function() {
  scene.background = new THREE.Color(this.value);
});

// Spout2 output toggle
document.getElementById('toggle-spout').addEventListener('click', function() {
  spoutEnabled = this.classList.contains('on');
  document.getElementById('spout-info').style.display = spoutEnabled ? 'block' : 'none';
  if (spoutEnabled && window.spout) {
    const statusEl = document.getElementById('spout-status');
    statusEl.style.color = 'var(--muted)';
    statusEl.textContent = 'Starting…';
    window.spout.start('RAMify').then(result => {
      if (!result?.ok) {
        statusEl.style.color = 'var(--red)';
        statusEl.textContent = 'Error: ' + (result?.error ?? 'unknown');
        return;
      }
      statusEl.style.color = 'var(--green)';
      statusEl.textContent = 'Sender: RAMify · 1280 × 720';
      window.spout.notifyLoadVRM(_spoutVrmUrl); // always send — main process logs NULL if no VRM loaded yet
    });
  } else if (!spoutEnabled && window.spout) {
    window.spout.stop();
  }
});

document.getElementById('toggle-hand').addEventListener('click', function() {
  this.classList.toggle('on');
  handTracking = this.classList.contains('on');
  const statusEl = document.getElementById('hand-status');
  console.log('[Hand] toggle', handTracking ? 'ON' : 'OFF', '| ready:', handTracker.ready);
  if (handTracking) {
    if (!handTracker.ready) {
      statusEl.textContent = 'Loading hand model…';
      const poll = setInterval(() => {
        if (handTracker.ready) {
          clearInterval(poll);
          handTracker.onData = (data) => {
            if (mapper) mapper.applyHandData(data);
            if (data) {
              const l = data.left ? 'L' : '', r = data.right ? 'R' : '';
              statusEl.textContent = (l || r) ? `Tracking: ${l}${r}` : 'No hands';
            } else {
              statusEl.textContent = 'No hands';
            }
          };
          handTracker.attach(trackerVideo);
          console.log('[Hand] attached (after poll), running:', handTracker._running);
        }
      }, 200);
    } else {
      handTracker.onData = (data) => {
        if (mapper) mapper.applyHandData(data);
        if (data) {
          const l = data.left ? 'L' : '', r = data.right ? 'R' : '';
          statusEl.textContent = (l || r) ? `Tracking: ${l}${r}` : 'No hands';
        } else {
          statusEl.textContent = 'No hands';
        }
      };
      handTracker.attach(trackerVideo);
      console.log('[Hand] attached, running:', handTracker._running);
    }
  } else {
    handTracker.stop();
    handTracker.onData = null;
    if (mapper) mapper.applyHandData(null);
    statusEl.textContent = '';
  }
});

document.getElementById('toggle-arm').addEventListener('click', function() {
  this.classList.toggle('on');
  armTracking = this.classList.contains('on');
  const statusEl = document.getElementById('arm-status');
  console.log('[Arm] toggle', armTracking ? 'ON' : 'OFF', '| ready:', poseTracker.ready);
  if (armTracking) {
    // Front-facing camera is mirrored: pose data.left = user's right arm, data.right = user's left.
    const poseStatusText = (data) => {
      if (!data) return 'No pose';
      const r = data.left  ? 'R' : '';  // data.left = user's right arm
      const l = data.right ? 'L' : '';  // data.right = user's left arm
      return (l || r) ? `Tracking: ${l}${r}` : 'No pose';
    };

    if (!poseTracker.ready) {
      statusEl.textContent = 'Loading pose model…';
      const poll = setInterval(() => {
        if (poseTracker.ready) {
          clearInterval(poll);
          poseTracker.onData = (data) => {
            if (mapper) mapper.applyPoseArmData(data);
            statusEl.textContent = poseStatusText(data);
          };
          poseTracker.attach(trackerVideo);
        }
      }, 200);
    } else {
      poseTracker.onData = (data) => {
        if (mapper) mapper.applyPoseArmData(data);
        statusEl.textContent = poseStatusText(data);
      };
      poseTracker.attach(trackerVideo);
    }
  } else {
    poseTracker.stop();
    poseTracker.onData = null;
    if (mapper) mapper.applyPoseArmData(null);
    statusEl.textContent = '';
  }
});

document.getElementById('btn-head-calibrate').addEventListener('click', () => {
  if (!mapper) return;
  const raw = mapper.raw;
  if (raw?.headX != null) {
    settings.headXNeutral = raw.headX;
    mapper.settings = settings;
    const btn = document.getElementById('btn-head-calibrate');
    btn.textContent = 'Neutral set';
    setTimeout(() => { btn.textContent = 'Set neutral'; }, 1500);
  }
});

// Version display
if (window.electronAPI?.getVersion) {
  window.electronAPI.getVersion().then(v => {
    const el = document.getElementById('app-version');
    if (el) el.textContent = `v${v}`;
  });
}

// Update banner
if (window.electronAPI?.onUpdateAvailable) {
  window.electronAPI.onUpdateAvailable(({ version, url }) => {
    const banner = document.getElementById('update-banner');
    document.getElementById('update-text').textContent = `RAMify v${version} is available`;
    document.getElementById('update-download').onclick = () => window.electronAPI.openExternal(url);
    document.getElementById('update-dismiss').onclick  = () => { banner.style.display = 'none'; };
    banner.style.display = 'flex';
  });
}

if (window.spout?.onFps) {
  window.spout.onFps(fps => {
    document.getElementById('spout-fps').textContent = fps;
  });
}

// Webcam preview toggle — shows/hides the tracker's already-open camera stream
function updateOverlayCanvas() {
  const previewOn = document.getElementById('toggle-cam').classList.contains('on');
  const overlayOn = document.getElementById('toggle-overlay').classList.contains('on');
  tracker.setOverlayCanvas(previewOn && overlayOn ? document.getElementById('cam-overlay') : null);
}

document.getElementById('toggle-cam').addEventListener('click', function() {
  this.classList.toggle('on');
  const wrap    = document.getElementById('cam-preview-wrap');
  const preview = document.getElementById('cam-preview');
  const overlayRow = document.getElementById('tracking-overlay-row');
  if (this.classList.contains('on')) {
    preview.srcObject = tracker.stream;
    wrap.style.display = 'block';
    overlayRow.style.display = 'flex';
  } else {
    preview.srcObject = null;
    wrap.style.display = 'none';
    overlayRow.style.display = 'none';
  }
  updateOverlayCanvas();
});

document.getElementById('toggle-overlay').addEventListener('click', function() {
  this.classList.toggle('on');
  updateOverlayCanvas();
});

// ── Live meters ───────────────────────────────────────────────────────────────
const METERS = [
  ['smirkLeft',       'Smirk L',    true ],
  ['smirkRight',      'Smirk R',    true ],
  ['blinkLeft',       'Blink L',    false],
  ['blinkRight',      'Blink R',    false],
  ['mouthOpen',       'Jaw open',   false],
  ['smileLeft',       'Smile L',    false],
  ['smileRight',      'Smile R',    false],
  ['browUpLeft',      'Brow up L',  false],
  ['browUpRight',     'Brow up R',  false],
  ['browDownLeft',    'Brow dn L',  false],
  ['browDownRight',   'Brow dn R',  false],
  ['cheekSquintLeft', 'Cheek sq L', false],
  ['eyeWideLeft',     'Eye wide L', false],
];

const metersEl = document.getElementById('meters');
METERS.forEach(([key, label, hi]) => {
  const row = document.createElement('div');
  row.className = 'meter-row';
  row.innerHTML = `
    <span class="meter-label">${label}</span>
    <div class="meter-bar-bg"><div class="meter-bar${hi ? ' highlight' : ''}" id="m-${key}"></div></div>
    <span class="meter-val" id="mv-${key}">0</span>
  `;
  metersEl.appendChild(row);
});

function updateMeters(data) {
  METERS.forEach(([key]) => {
    const val = Math.max(0, Math.min(1, data[key] ?? 0));
    const bar = document.getElementById(`m-${key}`);
    const num = document.getElementById(`mv-${key}`);
    if (bar) bar.style.width = (val * 100).toFixed(1) + '%';
    if (num) num.textContent  = (val * 100).toFixed(0);
  });
}
