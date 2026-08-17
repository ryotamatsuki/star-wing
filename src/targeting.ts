import * as THREE from 'three';

export interface TargetMetadata {
  enemyId?: string;
  partId?: string;
  kind?: string;
  displayName?: string;
  targetId?: string;
}

/**
 * The optional target adapter is deliberately structural. This keeps the
 * targeting module independent from a particular enemy implementation while
 * allowing EnemyHitTarget instances to be passed through unchanged.
 */
export interface EnemyHitTargetCompatible extends TargetMetadata {
  id?: string;
  object: THREE.Object3D;
  node?: THREE.Object3D;
  lockable?: boolean;
  isValid?: () => boolean;
  canAcquire?: () => boolean;
  canLock?: () => boolean;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface LockCandidate {
  id: string;
  object: THREE.Object3D;
  lockable: boolean;
  isValid(): boolean;
  enemyId?: string;
  partId?: string;
  kind?: string;
  displayName?: string;
  targetId?: string;
  /** Optional live target/part adapter, such as an EnemyHitTarget. */
  target?: EnemyHitTargetCompatible;
  /** Checked when this candidate is being acquired. */
  canAcquire?: () => boolean;
  /** Checked when acquiring and while a marker remains locked. */
  canLock?: () => boolean;
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
  rearmMoveDistance: 1.5,
} as const;

export interface TargetingController {
  update(dt: number, playerPos: THREE.Vector3, candidates: readonly LockCandidate[], maxLocks: number): void;
  /**
   * Clear the current lock set. Passing the charge-start position begins a
   * disarmed scan session immediately. A legacy clear() call remains valid
   * and captures the scan baseline on the next update.
   */
  clear(chargeStartPlayerPos?: THREE.Vector3): void;
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

function targetIdentity(candidate: Pick<LockCandidate, 'id' | 'target' | 'targetId'>): string {
  return candidate.target?.id ?? candidate.targetId ?? candidate.id;
}

function isAlreadyLocked(locked: readonly LockedTarget[], candidate: LockCandidate): boolean {
  const identity = targetIdentity(candidate);
  return locked.some(target => targetIdentity(target) === identity);
}

function predicateAllows(predicate: (() => boolean) | undefined, owner?: object): boolean {
  return !predicate || predicate.call(owner);
}

function targetAllows(
  target: EnemyHitTargetCompatible,
  includeAcquirePredicate: boolean,
): boolean {
  if (target.lockable === false) return false;
  if (target.isValid && !target.isValid()) return false;
  if (includeAcquirePredicate && !predicateAllows(target.canAcquire, target)) return false;
  return predicateAllows(target.canLock, target);
}

function candidateCanAcquire(candidate: LockCandidate): boolean {
  if (!candidate.lockable || !candidate.isValid()) return false;
  if (!predicateAllows(candidate.canAcquire, candidate) || !predicateAllows(candidate.canLock, candidate)) return false;
  return !candidate.target || targetAllows(candidate.target, true);
}

function candidateRemainsLocked(candidate: LockCandidate): boolean {
  if (!candidate.lockable || !candidate.isValid()) return false;
  if (!predicateAllows(candidate.canLock, candidate)) return false;
  return !candidate.target || targetAllows(candidate.target, false);
}

function targetObject(candidate: LockCandidate): THREE.Object3D {
  return candidate.target?.object ?? candidate.object;
}

function metadataString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function withTargetMetadata(candidate: LockCandidate): LockCandidate {
  const target = candidate.target;
  const metadata = target?.metadata;
  return {
    ...candidate,
    enemyId: candidate.enemyId ?? target?.enemyId ?? metadataString(metadata?.enemyId),
    partId: candidate.partId ?? target?.partId ?? metadataString(metadata?.partId),
    kind: candidate.kind ?? target?.kind ?? metadataString(metadata?.kind),
    displayName: candidate.displayName ?? target?.displayName ?? metadataString(metadata?.displayName),
    targetId: candidate.targetId ?? target?.targetId ?? target?.id ?? metadataString(metadata?.targetId),
  };
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
  const lastAcquirePlayerPosition = new THREE.Vector3();
  const chargeStartPlayerPosition = new THREE.Vector3();
  let elapsed = 0;
  let nextAcquireAt = 0;
  let acquisitionArmed = true;
  let hasChargeStartPosition = false;
  let chargeStartPositionPending = false;

  function updateMarkers(dt: number): void {
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      const target = locked[i];
      marker.target = target;
      marker.group.visible = Boolean(target);
      if (!target) continue;
      targetObject(target).getWorldPosition(targetPosition);
      marker.group.position.copy(targetPosition);
      marker.group.rotation.z += dt * (1.5 + i * 0.2);
      const ring = marker.group.children[0];
      ring.scale.setScalar(1 + Math.sin(elapsed * 8 + i) * 0.08);
    }
  }

  function pruneInvalidLocks(): void {
    for (let i = locked.length - 1; i >= 0; i--) {
      if (candidateRemainsLocked(locked[i])) continue;
      locked.splice(i, 1);
    }
    for (let i = 0; i < locked.length; i++) locked[i].slot = i + 1;
  }

  function chooseNextTarget(playerPos: THREE.Vector3, candidates: readonly LockCandidate[]): LockCandidate | undefined {
    let best: LockCandidate | undefined;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      if (!candidateCanAcquire(candidate) || isAlreadyLocked(locked, candidate)) continue;
      targetObject(candidate).getWorldPosition(targetPosition);
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

    // A lock scan must be deliberately swept during this charge. Only
    // lateral/vertical movement counts; the player's forward Z coordinate is
    // not part of the scan gesture.
    if (chargeStartPositionPending) {
      chargeStartPlayerPosition.copy(playerPos);
      chargeStartPositionPending = false;
      hasChargeStartPosition = true;
    }
    if (hasChargeStartPosition && !acquisitionArmed) {
      const movedSinceChargeStart = Math.hypot(
        playerPos.x - chargeStartPlayerPosition.x,
        playerPos.y - chargeStartPlayerPosition.y,
      ) >= TARGETING_CONFIG.rearmMoveDistance;
      if (movedSinceChargeStart) {
        acquisitionArmed = true;
        // From this point onward the normal between-lock scan gesture is
        // measured from the most recently acquired target.
        hasChargeStartPosition = false;
      }
    }

    if (maxLocks <= 0) {
      reticle.visible = false;
      updateMarkers(dt);
      return;
    }

    reticle.visible = true;
    reticle.position.set(playerPos.x, playerPos.y, playerPos.z - TARGETING_CONFIG.reticleDepth);
    reticle.scale.setScalar(1 + Math.sin(elapsed * 7) * 0.05);

    const lockLimit = Math.min(markers.length, Math.max(0, maxLocks));
    if (locked.length < lockLimit) {
      const candidate = chooseNextTarget(playerPos, candidates);
      if (!acquisitionArmed) {
        const movedSinceAcquire = Math.hypot(
          playerPos.x - lastAcquirePlayerPosition.x,
          playerPos.y - lastAcquirePlayerPosition.y,
        )
          >= TARGETING_CONFIG.rearmMoveDistance;
        if (movedSinceAcquire) acquisitionArmed = true;
      }

      if (acquisitionArmed && elapsed >= nextAcquireAt && candidate) {
        const slot = locked.length + 1;
        const selectedTarget = withTargetMetadata(candidate);
        locked.push({ ...selectedTarget, acquiredAt: elapsed, slot });
        lastAcquirePlayerPosition.copy(playerPos);
        acquisitionArmed = false;
        nextAcquireAt = elapsed + TARGETING_CONFIG.acquireInterval;
        onAcquire(slot, selectedTarget);
      }
    }
    updateMarkers(dt);
  }

  function clear(chargeStartPlayerPos?: THREE.Vector3): void {
    locked.length = 0;
    nextAcquireAt = elapsed;
    acquisitionArmed = false;
    if (chargeStartPlayerPos) {
      chargeStartPlayerPosition.copy(chargeStartPlayerPos);
      hasChargeStartPosition = true;
      chargeStartPositionPending = false;
    } else {
      hasChargeStartPosition = false;
      chargeStartPositionPending = true;
    }
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
