import * as THREE from 'three';

export interface LockCandidate {
  id: string;
  object: THREE.Object3D;
  lockable: boolean;
  isValid(): boolean;
}

export interface LockedTarget extends LockCandidate {
  acquiredAt: number;
  slot: number;
}

export const TARGETING_CONFIG = {
  corridorX: 2.8,
  corridorY: 2.4,
  minDepth: 4,
  maxDepth: 230,
  reticleDepth: 52,
  acquireInterval: 0.14,
} as const;

export interface TargetingController {
  update(dt: number, playerPos: THREE.Vector3, candidates: readonly LockCandidate[], maxLocks: number): void;
  clear(): void;
  getLockedTargets(): readonly LockedTarget[];
  readonly lockCount: number;
}

interface LockMarker {
  group: THREE.Group;
  target?: LockedTarget;
}

function makeLockMarker(order: number): LockMarker {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.9, 0.08, 6, 20),
    new THREE.MeshBasicMaterial({ color: 0x66f6ff, transparent: true, opacity: 0.9 }),
  );
  group.add(ring);

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#e9ffff';
    context.font = 'bold 38px monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(order), canvas.width / 2, canvas.height / 2 + 1);
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    color: 0xffffff,
    transparent: true,
    depthTest: false,
  }));
  sprite.position.set(0.95, 0.95, 0.1);
  sprite.scale.setScalar(0.72);
  group.add(sprite);
  group.visible = false;
  return { group };
}

function isAlreadyLocked(locked: readonly LockedTarget[], id: string): boolean {
  return locked.some(target => target.id === id);
}

export function createTargetingController(
  scene: THREE.Scene,
  onAcquire: (slot: number, candidate: LockCandidate) => void,
): TargetingController {
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(2.35, 2.5, 24),
    new THREE.MeshBasicMaterial({ color: 0x66f6ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  );
  reticle.visible = false;
  scene.add(reticle);

  const markers = [1, 2, 3, 4].map(makeLockMarker);
  markers.forEach(marker => scene.add(marker.group));

  const locked: LockedTarget[] = [];
  const targetPosition = new THREE.Vector3();
  let elapsed = 0;
  let nextAcquireAt = 0;

  function updateMarkers(dt: number): void {
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      const target = locked[i];
      marker.target = target;
      marker.group.visible = Boolean(target);
      if (!target) continue;
      target.object.getWorldPosition(targetPosition);
      marker.group.position.copy(targetPosition);
      marker.group.rotation.z += dt * (1.5 + i * 0.2);
      const ring = marker.group.children[0];
      ring.scale.setScalar(1 + Math.sin(elapsed * 8 + i) * 0.08);
    }
  }

  function pruneInvalidLocks(): void {
    for (let i = locked.length - 1; i >= 0; i--) {
      if (locked[i].isValid()) continue;
      locked.splice(i, 1);
    }
    for (let i = 0; i < locked.length; i++) locked[i].slot = i + 1;
  }

  function chooseNextTarget(playerPos: THREE.Vector3, candidates: readonly LockCandidate[]): LockCandidate | undefined {
    let best: LockCandidate | undefined;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      if (!candidate.lockable || !candidate.isValid() || isAlreadyLocked(locked, candidate.id)) continue;
      candidate.object.getWorldPosition(targetPosition);
      const depth = playerPos.z - targetPosition.z;
      if (depth < TARGETING_CONFIG.minDepth || depth > TARGETING_CONFIG.maxDepth) continue;

      const dx = Math.abs(targetPosition.x - playerPos.x);
      const dy = Math.abs(targetPosition.y - playerPos.y);
      if (dx > TARGETING_CONFIG.corridorX || dy > TARGETING_CONFIG.corridorY) continue;

      const corridorDistance = Math.hypot(dx / TARGETING_CONFIG.corridorX, dy / TARGETING_CONFIG.corridorY);
      const score = corridorDistance + depth / TARGETING_CONFIG.maxDepth * 0.08;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  function update(dt: number, playerPos: THREE.Vector3, candidates: readonly LockCandidate[], maxLocks: number): void {
    elapsed += dt;
    pruneInvalidLocks();

    if (maxLocks <= 0) {
      reticle.visible = false;
      updateMarkers(dt);
      return;
    }

    reticle.visible = true;
    reticle.position.set(playerPos.x, playerPos.y, playerPos.z - TARGETING_CONFIG.reticleDepth);
    reticle.scale.setScalar(1 + Math.sin(elapsed * 7) * 0.05);

    if (locked.length < maxLocks && elapsed >= nextAcquireAt) {
      const candidate = chooseNextTarget(playerPos, candidates);
      if (candidate) {
        const slot = locked.length + 1;
        locked.push({ ...candidate, acquiredAt: elapsed, slot });
        nextAcquireAt = elapsed + TARGETING_CONFIG.acquireInterval;
        onAcquire(slot, candidate);
      }
    }
    updateMarkers(dt);
  }

  function clear(): void {
    locked.length = 0;
    nextAcquireAt = elapsed;
    reticle.visible = false;
    for (const marker of markers) {
      marker.target = undefined;
      marker.group.visible = false;
    }
  }

  return {
    update,
    clear,
    getLockedTargets: () => locked,
    get lockCount() { return locked.length; },
  };
}
