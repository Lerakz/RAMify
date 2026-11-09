import * as THREE from 'three';

const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/**
 * Rotates `bone` so that the direction from `bone` to `childPos` aligns with
 * the direction from `bone` to `targetWorld`.
 * The rotation is applied as a delta in the bone's local space.
 */
function pointBoneAt(bone, targetWorld, childPos) {
  _va.setFromMatrixPosition(bone.matrixWorld);       // bone world pos
  _vb.subVectors(childPos, _va).normalize();         // current direction
  _vc.subVectors(targetWorld, _va).normalize();      // desired direction

  if (_vb.dot(_vc) > 0.99999) return;

  // World-space rotation delta that rotates current dir → desired dir
  _qa.setFromUnitVectors(_vb, _vc);

  // Convert to bone's parent local space:
  // localDelta = inv(parentWorld) * worldDelta * parentWorld
  _qb.identity();
  if (bone.parent) bone.parent.getWorldQuaternion(_qb); // _qb = parentWorldQ
  _qb.invert();                                          // _qb = inv(parentWorldQ)

  const localDelta = new THREE.Quaternion()
    .copy(_qb)
    .multiply(_qa)
    .multiply(_qb.invert()); // _qb.invert() reverts _qb to parentWorldQ in place

  bone.quaternion.premultiply(localDelta);
}

/**
 * 2-bone IK: rotates upperArm and lowerArm so the hand reaches `target`.
 *
 * @param {THREE.Object3D} upperArm  normalized upper arm bone
 * @param {THREE.Object3D} lowerArm  normalized lower arm bone
 * @param {THREE.Vector3}  target    desired hand/wrist world position
 * @param {THREE.Vector3}  elbowHint preferred elbow direction (world space, unit vector)
 */
export function solveTwoBoneIK(upperArm, lowerArm, target, elbowHint) {
  upperArm.updateWorldMatrix(true, true);

  const root = new THREE.Vector3().setFromMatrixPosition(upperArm.matrixWorld);
  const mid  = new THREE.Vector3().setFromMatrixPosition(lowerArm.matrixWorld);

  const tipNode = lowerArm.children[0];
  const tip = tipNode
    ? new THREE.Vector3().setFromMatrixPosition(tipNode.matrixWorld)
    : new THREE.Vector3().copy(mid).addScaledVector(
        new THREE.Vector3().subVectors(mid, root).normalize(),
        mid.distanceTo(root) * 0.9
      );

  const upperLen = root.distanceTo(mid);
  const lowerLen = mid.distanceTo(tip);
  const totalLen = upperLen + lowerLen;

  // Clamp so target is always reachable
  const toTarget    = new THREE.Vector3().subVectors(target, root);
  const dist        = Math.min(toTarget.length(), totalLen * 0.9999);
  const toTargetDir = toTarget.clone().normalize();

  // Law of cosines: angle at root (shoulder)
  const cosAngle = THREE.MathUtils.clamp(
    (upperLen * upperLen + dist * dist - lowerLen * lowerLen) / (2 * upperLen * dist),
    -1, 1
  );
  const angle = Math.acos(cosAngle);

  // Project elbow hint perpendicular to target direction
  const proj = toTargetDir.clone().multiplyScalar(elbowHint.dot(toTargetDir));
  let elbowDir = elbowHint.clone().sub(proj);
  if (elbowDir.lengthSq() < 1e-6) {
    elbowDir = new THREE.Vector3().crossVectors(toTargetDir, new THREE.Vector3(0, 1, 0));
    if (elbowDir.lengthSq() < 1e-6)
      elbowDir.crossVectors(toTargetDir, new THREE.Vector3(1, 0, 0));
  }
  elbowDir.normalize();

  // Ideal elbow = shoulder + upperLen along (cosAngle*toTarget + sinAngle*elbowDir)
  const idealElbow = new THREE.Vector3()
    .copy(root)
    .addScaledVector(toTargetDir, upperLen * Math.cos(angle))
    .addScaledVector(elbowDir,    upperLen * Math.sin(angle));

  // Step 1: rotate upper arm so its child (elbow) points toward idealElbow
  pointBoneAt(upperArm, idealElbow, mid);

  // Update matrices — lower arm and its children now have new world positions
  upperArm.updateWorldMatrix(false, true);
  const newMid = new THREE.Vector3().setFromMatrixPosition(lowerArm.matrixWorld);
  const newTip = tipNode
    ? new THREE.Vector3().setFromMatrixPosition(tipNode.matrixWorld)
    : new THREE.Vector3().copy(newMid).addScaledVector(
        new THREE.Vector3().subVectors(newMid, idealElbow).normalize(),
        lowerLen
      );

  // Step 2: rotate lower arm so its child (hand) points toward target
  pointBoneAt(lowerArm, target, newTip);
}
