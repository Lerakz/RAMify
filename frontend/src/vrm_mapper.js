/**
 * VRMMapper
 *
 * Poses use normalized humanoid bone rotations — model-agnostic by the VRM spec.
 * T-pose = all zeros. Conventions:
 *
 *   LEFT arm  (leftUpperArm): Z+ = drops BELOW horizontal, Z- = rises ABOVE
 *   RIGHT arm (rightUpperArm): Z- = drops BELOW horizontal, Z+ = rises ABOVE
 *   Arms at natural sides: leftUpperArm q(0,0,78), rightUpperArm q(0,0,-78)
 *
 * Additional bones added vs. previous version:
 *   leftShoulder / rightShoulder — clavicle: lifts when arm raises
 *   spine / chest / hips         — postural lean (few degrees, feels natural)
 */

import * as THREE from 'three';

const DEG = Math.PI / 180;

function q(xDeg, yDeg, zDeg) {
  const e  = new THREE.Euler(xDeg * DEG, yDeg * DEG, zDeg * DEG, 'XYZ');
  const qt = new THREE.Quaternion().setFromEuler(e);
  return [qt.x, qt.y, qt.z, qt.w];
}

const ID = q(0, 0, 0);

// Bones driven by direct quaternion slerp (order matters for slerp — do spine before arms)
const POSE_BONES = [
  'spine', 'chest', 'hips',
  'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'rightUpperArm',
  'leftLowerArm', 'rightLowerArm',
  'leftHand',     'rightHand',
  'leftThumbProximal',  'rightThumbProximal',
  'leftIndexProximal',  'leftIndexIntermediate',  'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal',   'leftRingIntermediate',   'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  'rightIndexProximal',  'rightIndexIntermediate',  'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal',   'rightRingIntermediate',   'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
];

const POSES = {

  idle: {
    label: 'Idle', icon: '🧍',
    rot: {
      leftUpperArm:  q( 0, 0,  70),
      rightUpperArm: q( 0, 0, -70),
      leftLowerArm:  q( 8, 0,   0),
      rightLowerArm: q( 8, 0,   0),
      leftHand:      ID,
      rightHand:     ID,
      leftShoulder:  q( 0, 0,   5),
      rightShoulder: q( 0, 0,  -5),
      spine: q( 3, 0, 0), chest: q( 2, 0, 0), hips: q(-1, 0, 0),
    },
  },

  thinking: {
    label: 'Thinking', icon: '🤔',
    rot: {
      leftUpperArm:  q( 10, -55,  58),
      leftLowerArm:  q( 65,   0, 105),
      leftHand:      q(-30,  40,   0),
      leftShoulder:  q(  0,   0,  10),
      rightUpperArm: q(  0,  68, -35),
      rightLowerArm: q(  0, 125,  25),
      rightHand:     q(-15,   0,   0),
      rightShoulder: q(  0,  -5, -15),
      spine: q( 4, 2, 0), chest: q( 3, 0, 0), hips: q(-1, 0, 0),
      leftThumbProximal:  q(0, 90, 0),
      leftIndexProximal:  q(0,0,80), leftIndexIntermediate:  q(0,0,90), leftIndexDistal:  q(0,0,70),
      leftMiddleProximal: q(0,0,80), leftMiddleIntermediate: q(0,0,90), leftMiddleDistal: q(0,0,70),
      leftRingProximal:   q(0,0,80), leftRingIntermediate:   q(0,0,90), leftRingDistal:   q(0,0,70),
      leftLittleProximal: q(0,0,75), leftLittleIntermediate: q(0,0,85), leftLittleDistal: q(0,0,65),
      rightThumbProximal:   q(0, -60, 0),
      rightIndexProximal:   q(0,0,-25), rightIndexIntermediate:  q(0,0,-20), rightIndexDistal:  q(0,0,-15),
      rightMiddleProximal:  q(0,0,-55), rightMiddleIntermediate: q(0,0,-65), rightMiddleDistal: q(0,0,-50),
      rightRingProximal:    q(0,0,-55), rightRingIntermediate:   q(0,0,-65), rightRingDistal:   q(0,0,-50),
      rightLittleProximal:  q(0,0,-50), rightLittleIntermediate: q(0,0,-60), rightLittleDistal: q(0,0,-45),
    },
  },

  crossed: {
    label: 'Arms crossed', icon: '🤨',
    rot: {
      leftUpperArm:  q(  0, -55,  58),
      rightUpperArm: q(  0,  55, -58),
      leftLowerArm:  q( 65,   0, 105),
      rightLowerArm: q( 65,   0, -92),
      leftHand:      q(-30,  40,   0),
      rightHand:     q( 15, -40,   0),
      leftShoulder:  q(  0,   0,  10),
      rightShoulder: q(  0,   0, -10),
      spine: q( 5, 0, 0), chest: q( 4, 0, 0), hips: q(-1, 0, 0),
      leftThumbProximal:  q(0, 90,  0), rightThumbProximal:  q(0,-90,  0),
      leftIndexProximal:  q(0,0, 80), leftIndexIntermediate:  q(0,0, 90), leftIndexDistal:  q(0,0, 70),
      leftMiddleProximal: q(0,0, 80), leftMiddleIntermediate: q(0,0, 90), leftMiddleDistal: q(0,0, 70),
      leftRingProximal:   q(0,0, 80), leftRingIntermediate:   q(0,0, 90), leftRingDistal:   q(0,0, 70),
      leftLittleProximal: q(0,0, 75), leftLittleIntermediate: q(0,0, 85), leftLittleDistal: q(0,0, 65),
      rightIndexProximal:  q(0,0,-80), rightIndexIntermediate:  q(0,0,-90), rightIndexDistal:  q(0,0,-70),
      rightMiddleProximal: q(0,0,-80), rightMiddleIntermediate: q(0,0,-90), rightMiddleDistal: q(0,0,-70),
      rightRingProximal:   q(0,0,-80), rightRingIntermediate:   q(0,0,-90), rightRingDistal:   q(0,0,-70),
      rightLittleProximal: q(0,0,-75), rightLittleIntermediate: q(0,0,-85), rightLittleDistal: q(0,0,-65),
    },
  },

  tpose: {
    label: 'T-Pose', icon: '🙆',
    rot: {
      leftUpperArm: ID, rightUpperArm: ID,
      leftLowerArm: ID, rightLowerArm: ID,
      leftHand: ID, rightHand: ID,
      leftShoulder: ID, rightShoulder: ID,
      spine: ID, chest: ID, hips: ID,
    },
  },

};

export { POSES };

// --------------------------------------------------------------------------

// Arm bones driven by pose tracking (excluded from pose when arm data is present)
const ARM_BONES = new Set([
  'leftShoulder',  'rightShoulder',
  'leftUpperArm',  'rightUpperArm',
  'leftLowerArm',  'rightLowerArm',
]);

// Finger bones driven by hand tracking (excluded from pose when hands are detected)
const HAND_BONES = new Set([
  'leftThumbProximal',  'rightThumbProximal',
  'leftIndexProximal',  'leftIndexIntermediate',  'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal',   'leftRingIntermediate',   'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  'rightIndexProximal',  'rightIndexIntermediate',  'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal',   'rightRingIntermediate',   'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
]);

// Maps hand tracker finger names → VRM bone name fragment
const FINGER_TO_VRM = { index: 'Index', middle: 'Middle', ring: 'Ring', pinky: 'Little' };
// Max bend per joint (degrees) for a natural-looking full curl
const CURL_ANGLES = [['Proximal', 80], ['Intermediate', 90], ['Distal', 70]];

export class VRMMapper {
  constructor(vrm, settings) {
    this.vrm      = vrm;
    this.settings = settings;
    this.version  = vrm.meta?.metaVersion === '1' ? 1 : 0;
    console.log(`[VRMMapper] "${vrm.meta?.name}" VRM${this.version}`);

    if (vrm.expressionManager) {
      const names = Object.keys(vrm.expressionManager._expressionMap ?? {});
      console.log('[VRMMapper] Expressions:', names);
    }

    this.cur      = {};
    this.raw      = {};
    this.rawHands = null;
    this.rawArms  = null;
    this._tmpQ    = new THREE.Quaternion();

    this._poseTarget  = null;
    this._poseCurrent = {};
    this._poseSpeed   = 0.06;

    this.setPose('idle');
  }

  applyData(data) {
    this.raw = data;
  }

  applyHandData(data) {
    this.rawHands = data;
  }

  applyPoseArmData(data) {
    this.rawArms = data;
  }

  setPose(poseKey) {
    const pose = POSES[poseKey];
    if (!pose) { console.warn('[Pose] Unknown:', poseKey); return; }

    this._poseTarget  = pose.rot;
    this._poseCurrent = {};

    for (const boneName of POSE_BONES) {
      const node = this.vrm.humanoid.getNormalizedBoneNode(boneName);
      if (node) {
        this._poseCurrent[boneName] = node.quaternion.clone();
      } else {
        this._poseCurrent[boneName] = new THREE.Quaternion();
      }
    }
    console.log(`[Pose] → ${pose.label}`);
  }

  _setExpr(name, value) {
    if (!this.vrm.expressionManager) return;
    try { this.vrm.expressionManager.setValue(name, value); } catch(_) {}
  }

  tickExpressions(delta) {
    const r = this.raw;
    const s = this.settings;
    const sens = s.sensitivity ?? 1.0;
    const ef   = s.smoothExpr  ?? 0.20;
    const hf   = s.smoothHead  ?? 0.12;
    const DEAD = 0.015;

    const lerp  = (a, b, t) => a + (b - a) * Math.min(t, 1.0);
    const clamp = (v, lo=0, hi=1) => Math.max(lo, Math.min(hi, v));

    const smooth = (key, val, factor=ef) => {
      const scaled = clamp(val * sens);
      const diff = Math.abs((this.cur[key] ?? 0) - scaled);
      if (diff < DEAD && scaled < DEAD) return this.cur[key] ?? 0;
      this.cur[key] = lerp(this.cur[key] ?? scaled, scaled, factor);
      return this.cur[key];
    };

    if (!r || Object.keys(r).length === 0) return;

    const em = this.vrm.expressionManager;
    // Mouth expressions need faster smoothing to feel responsive in speech
    const mf = Math.min(ef * 1.8, 0.40);

    if (em) {
      if (s.blink) {
        this._setExpr('blinkLeft',  smooth('blinkLeft',  r.blinkLeft  ?? 0));
        this._setExpr('blinkRight', smooth('blinkRight', r.blinkRight ?? 0));
      }
      const wide = clamp(Math.max(r.eyeWideLeft ?? 0, r.eyeWideRight ?? 0));
      this._setExpr('surprised', smooth('surprised', wide * 0.6));

      // Boost aa so the avatar's jaw opens fully during natural speech
      this._setExpr('aa', smooth('mouthOpen',  (r.mouthOpen ?? 0) * 1.35,  mf));
      // ih = "ee" vowel — driven by mouth corner stretch
      const stretch = ((r.mouthStretchLeft ?? 0) + (r.mouthStretchRight ?? 0)) / 2;
      this._setExpr('ih', smooth('ih',          stretch * 1.2,              mf));
      this._setExpr('oh', smooth('oh',          (r.mouthFunnel  ?? 0) * 0.9, mf));
      this._setExpr('ou', smooth('ou',          (r.mouthPucker  ?? 0) * 0.9, mf));

      const smileAvg  = ((r.smileLeft ?? 0) + (r.smileRight ?? 0)) / 2;
      const baseSmile = smooth('happy', smileAvg);
      if (s.smirk) {
        const smirkL = smooth('smirkL', r.smirkLeft  ?? 0, ef * 1.2);
        const smirkR = smooth('smirkR', r.smirkRight ?? 0, ef * 1.2);
        this._setExpr('happy', clamp(baseSmile + Math.max(smirkL, smirkR) * 0.7));
      } else {
        this._setExpr('happy', baseSmile);
      }

      const frownAvg = ((r.frownLeft ?? 0) + (r.frownRight ?? 0)) / 2;
      this._setExpr('sad', smooth('sad', frownAvg * 0.8));

      if (s.brow) {
        const browDown = Math.max(r.browDownLeft ?? 0, r.browDownRight ?? 0);
        this._setExpr('angry', smooth('angry', browDown * 0.7));
      }
      const squint = Math.max(r.eyeSquintLeft ?? 0, r.eyeSquintRight ?? 0);
      this._setExpr('relaxed', smooth('relaxed', squint * 0.4));
    }

    if (s.head) {
      const headNode = this.vrm.humanoid.getNormalizedBoneNode('head');
      const neckNode = this.vrm.humanoid.getNormalizedBoneNode('neck');
      const lerp = (a, b, t) => a + (b - a) * Math.min(t, 1.0);
      // Subtract calibration offset so the user's natural rest position = avatar neutral.
      // Sign is positive: MediaPipe headX increases when chin dips forward (looking down),
      // which maps naturally to positive rotation.x (head pitches forward = looks down).
      const pitch = (r.headX ?? 0) - (s.headXNeutral ?? 0);
      if (headNode) {
        headNode.rotation.x = lerp(headNode.rotation.x,  pitch          * 0.55, hf);
        headNode.rotation.y = lerp(headNode.rotation.y, (r.headY ?? 0) * 0.65, hf);
        headNode.rotation.z = lerp(headNode.rotation.z, (r.headZ ?? 0) * 0.40, hf);
      }
      if (neckNode) {
        neckNode.rotation.x = lerp(neckNode.rotation.x,  pitch          * 0.25, hf * 0.6);
        neckNode.rotation.y = lerp(neckNode.rotation.y, (r.headY ?? 0) * 0.25, hf * 0.6);
        neckNode.rotation.z = lerp(neckNode.rotation.z, (r.headZ ?? 0) * 0.18, hf * 0.6);
      }
    }
  }

  tickPose(delta) {
    if (!this._poseTarget) return;
    const rh = this.rawHands;
    const ra = this.rawArms;

    const tgt = new THREE.Quaternion();
    for (const boneName of POSE_BONES) {
      // Let arm tracking take over arm bones when pose arm data is present
      if (ra && ARM_BONES.has(boneName)) {
        const isLeft  = boneName.startsWith('left');
        const isRight = boneName.startsWith('right');
        if ((isLeft && ra.left !== null) || (isRight && ra.right !== null)) continue;
      }
      // Let hand tracking take over finger bones when hands are detected
      if (rh && HAND_BONES.has(boneName)) {
        const isLeft  = boneName.startsWith('left');
        const isRight = boneName.startsWith('right');
        if ((isLeft && rh.left !== null) || (isRight && rh.right !== null)) continue;
      }

      const node = this.vrm.humanoid.getNormalizedBoneNode(boneName);
      if (!node) continue;

      const arr = this._poseTarget[boneName] ?? [0, 0, 0, 1];
      tgt.set(arr[0], arr[1], arr[2], arr[3]);

      if (!this._poseCurrent[boneName]) {
        this._poseCurrent[boneName] = node.quaternion.clone();
      }

      this._poseCurrent[boneName].slerp(tgt, this._poseSpeed);
      node.quaternion.copy(this._poseCurrent[boneName]);
    }
  }

  tickHands(delta) {
    const r = this.rawHands;
    if (!r || !this.vrm) return;

    const hs   = 0.25;
    const lerp = (a, b, t) => a + (b - a) * Math.min(t, 1);
    const DEG  = Math.PI / 180;

    for (const side of ['left', 'right']) {
      const hands = r[side];
      if (!hands) continue;
      const sign = side === 'left' ? 1 : -1;

      for (const [finger, vrmName] of Object.entries(FINGER_TO_VRM)) {
        const curl = hands[finger] ?? 0;
        for (const [suffix, maxDeg] of CURL_ANGLES) {
          const boneName = `${side}${vrmName}${suffix}`;
          const node = this.vrm.humanoid.getNormalizedBoneNode(boneName);
          if (!node) continue;
          const key    = `hf_${boneName}`;
          const target = sign * curl * maxDeg * DEG;
          this.cur[key] = lerp(this.cur[key] ?? target, target, hs);
          node.rotation.z = this.cur[key];
          // Sync _poseCurrent so the pose system resumes smoothly if hand tracking turns off
          this._tmpQ.setFromEuler(node.rotation);
          if (this._poseCurrent[boneName]) this._poseCurrent[boneName].copy(this._tmpQ);
          else this._poseCurrent[boneName] = this._tmpQ.clone();
        }
      }

      // Thumb — only proximal joint exists on most VRM0 models, driven on Y axis
      const thumbBone = `${side}ThumbProximal`;
      const thumbNode = this.vrm.humanoid.getNormalizedBoneNode(thumbBone);
      if (thumbNode) {
        const key    = `hf_${thumbBone}`;
        const target = sign * (hands.thumb ?? 0) * 70 * DEG;
        this.cur[key] = lerp(this.cur[key] ?? target, target, hs);
        thumbNode.rotation.y = this.cur[key];
        this._tmpQ.setFromEuler(thumbNode.rotation);
        if (this._poseCurrent[thumbBone]) this._poseCurrent[thumbBone].copy(this._tmpQ);
        else this._poseCurrent[thumbBone] = this._tmpQ.clone();
      }
    }
  }

  tickArms(delta) {
    const r = this.rawArms;
    if (!r || !this.vrm) return;

    const af   = 0.25;
    const lerp = (a, b, t) => a + (b - a) * Math.min(t, 1);

    for (const side of ['left', 'right']) {
      const arm = r[side];

      // --- Upper arm ---
      const uaName = `${side}UpperArm`;
      const uaNode = this.vrm.humanoid.getNormalizedBoneNode(uaName);
      if (uaNode && arm) {
        const { elevation, forward } = arm;
        // VRM conventions (from empirical testing):
        //   left  upper arm: Z+ = drops down,  Y+ = backward  → rotZ = -elev, rotY = -fwd
        //   right upper arm: Z- = drops down,  Y+ = forward   → rotZ = +elev, rotY = +fwd
        const targetZ = side === 'left' ? -elevation : elevation;
        const targetY = side === 'left' ? -forward   : forward;

        this.cur[`${uaName}_z`] = lerp(this.cur[`${uaName}_z`] ?? uaNode.rotation.z, targetZ, af);
        this.cur[`${uaName}_y`] = lerp(this.cur[`${uaName}_y`] ?? uaNode.rotation.y, targetY, af);
        uaNode.rotation.z = this.cur[`${uaName}_z`];
        uaNode.rotation.y = this.cur[`${uaName}_y`];

        // Sync _poseCurrent so tickPose resumes smoothly if arm tracking turns off or arm is lost
        this._tmpQ.setFromEuler(uaNode.rotation);
        if (this._poseCurrent[uaName]) this._poseCurrent[uaName].copy(this._tmpQ);
        else this._poseCurrent[uaName] = this._tmpQ.clone();
      }

      // --- Lower arm (elbow bend on X) ---
      const laName = `${side}LowerArm`;
      const laNode = this.vrm.humanoid.getNormalizedBoneNode(laName);
      if (laNode && arm) {
        this.cur[`${laName}_x`] = lerp(this.cur[`${laName}_x`] ?? laNode.rotation.x, arm.elbowBend, af);
        this.cur[`${laName}_y`] = lerp(this.cur[`${laName}_y`] ?? laNode.rotation.y, 0, af);
        this.cur[`${laName}_z`] = lerp(this.cur[`${laName}_z`] ?? laNode.rotation.z, 0, af);
        laNode.rotation.x = this.cur[`${laName}_x`];
        laNode.rotation.y = this.cur[`${laName}_y`];
        laNode.rotation.z = this.cur[`${laName}_z`];

        this._tmpQ.setFromEuler(laNode.rotation);
        if (this._poseCurrent[laName]) this._poseCurrent[laName].copy(this._tmpQ);
        else this._poseCurrent[laName] = this._tmpQ.clone();
      }

      // --- Shoulder (clavicle) — subtle lift when arm is raised ---
      const shName = `${side}Shoulder`;
      const shNode = this.vrm.humanoid.getNormalizedBoneNode(shName);
      if (shNode && arm) {
        const idleZ   = side === 'left' ?  5 * DEG : -5 * DEG;
        const maxLift = 15 * DEG;
        const lift    = Math.max(0, arm.elevation) / (Math.PI / 2) * maxLift;
        const targetZ = side === 'left' ? idleZ + lift : idleZ - lift;
        this.cur[`${shName}_z`] = lerp(this.cur[`${shName}_z`] ?? shNode.rotation.z, targetZ, af);
        shNode.rotation.z = this.cur[`${shName}_z`];

        this._tmpQ.setFromEuler(shNode.rotation);
        if (this._poseCurrent[shName]) this._poseCurrent[shName].copy(this._tmpQ);
        else this._poseCurrent[shName] = this._tmpQ.clone();
      }
    }
  }

  tick(delta) {
    this.tickExpressions(delta);
    this.tickPose(delta);
    this.tickHands(delta);
    this.tickArms(delta);
  }
}
