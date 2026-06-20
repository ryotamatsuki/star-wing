import * as THREE from 'three';

export function sphereHit(
  aPos: THREE.Vector3, aR: number,
  bPos: THREE.Vector3, bR: number
): boolean {
  return aPos.distanceTo(bPos) < aR + bR;
}
