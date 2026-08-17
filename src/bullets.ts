import * as THREE from 'three';
import type { EnemyHitTargetCompatible, TargetMetadata } from './targeting';

const PLAYER_BULLET_SPEED = 100;
const ENEMY_BULLET_SPEED  = 60;
const LASER_COLOR_PLAYER  = 0x44ffaa;
const LASER_COLOR_ENEMY   = 0xff4422;

interface Bullet {
  mesh: THREE.Object3D;
  vz: number;
  vx: number;
  vy: number;
  isPlayer: boolean;
  alive: boolean;
  damage: number;
  kind: 'normal' | 'charge' | 'lock';
  homing: boolean;
  homingStrength: number;
  target?: THREE.Vector3;
  targetObject?: THREE.Object3D;
  targetIsValid?: () => boolean;
  targetId?: string;
  targetEnemyId?: string;
  targetPartId?: string;
  targetKind?: string;
  targetDisplayName?: string;
  targetMetadata?: TargetMetadata;
  targetHitTarget?: EnemyHitTargetCompatible;
  evaded: boolean;
}

const bullets: Bullet[] = [];
let scene: THREE.Scene;

const playerGeo = new THREE.BoxGeometry(0.12, 0.12, 2.4);
const playerMat = new THREE.MeshBasicMaterial({ color: LASER_COLOR_PLAYER });
const enemyGeo  = new THREE.SphereGeometry(0.3, 5, 4);
const enemyMat  = new THREE.MeshBasicMaterial({ color: LASER_COLOR_ENEMY });
const playerHomingGeo = new THREE.SphereGeometry(0.24, 6, 4);
const playerHomingMat = new THREE.MeshBasicMaterial({ color: 0x66f6ff });
const playerHomingRingGeo = new THREE.TorusGeometry(0.42, 0.07, 5, 12);
const playerHomingRingMat = new THREE.MeshBasicMaterial({ color: 0xffe477 });

export interface EnemyBulletOptions {
  damage?: number;
  speed?: number;
  color?: number;
}

export interface HomingMissileOptions {
  damage?: number;
  speed?: number;
  homingStrength?: number;
  homingTarget?: THREE.Vector3;
}

export interface PlayerBulletOptions {
  damage?: number;
  kind?: 'normal' | 'charge' | 'lock';
  color?: number;
  scale?: number;
}

export interface PlayerHomingTarget {
  id?: string;
  object: THREE.Object3D;
  isValid(): boolean;
  lockable?: boolean;
  canAcquire?: () => boolean;
  canLock?: () => boolean;
  enemyId?: string;
  partId?: string;
  kind?: string;
  displayName?: string;
  targetId?: string;
  target?: EnemyHitTargetCompatible;
}

export interface PlayerHomingShotOptions {
  damage?: number;
  speed?: number;
  homingStrength?: number;
}

function targetObject(target: PlayerHomingTarget): THREE.Object3D {
  return target.target?.object ?? target.object;
}

function metadataString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function targetMetadata(target: PlayerHomingTarget): TargetMetadata | undefined {
  const nested = target.target;
  const nestedMetadata = nested?.metadata;
  const metadata: TargetMetadata = {
    targetId: target.targetId ?? nested?.targetId ?? nested?.id ?? metadataString(nestedMetadata?.targetId),
    enemyId: target.enemyId ?? nested?.enemyId ?? metadataString(nestedMetadata?.enemyId),
    partId: target.partId ?? nested?.partId ?? metadataString(nestedMetadata?.partId),
    kind: target.kind ?? nested?.kind ?? metadataString(nestedMetadata?.kind),
    displayName: target.displayName ?? nested?.displayName ?? metadataString(nestedMetadata?.displayName),
  };
  return Object.values(metadata).some(value => value !== undefined) ? metadata : undefined;
}

function targetIsAcquirable(target: PlayerHomingTarget): boolean {
  if (!target.isValid() || target.lockable === false) return false;
  if (target.canAcquire && !target.canAcquire()) return false;
  if (target.canLock && !target.canLock()) return false;
  const nested = target.target;
  if (!nested) return true;
  if (nested.lockable === false) return false;
  if (nested.isValid && !nested.isValid()) return false;
  if (nested.canAcquire && !nested.canAcquire()) return false;
  return !nested.canLock || nested.canLock();
}

function targetRemainsValid(target: PlayerHomingTarget): boolean {
  if (!target.isValid() || target.lockable === false) return false;
  if (target.canLock && !target.canLock()) return false;
  const nested = target.target;
  if (!nested) return true;
  if (nested.lockable === false) return false;
  if (nested.isValid && !nested.isValid()) return false;
  return !nested.canLock || nested.canLock();
}

export function initBullets(s: THREE.Scene): void {
  scene = s;
}

export function firePlayerBullet(origin: THREE.Vector3, options: PlayerBulletOptions = {}): void {
  const material = options.color === undefined || options.color === LASER_COLOR_PLAYER
    ? playerMat
    : playerMat.clone();
  if (options.color !== undefined) (material as THREE.MeshBasicMaterial).color.setHex(options.color);
  const mesh = new THREE.Mesh(playerGeo, material);
  mesh.scale.setScalar(options.scale ?? 1);
  mesh.position.copy(origin);
  scene.add(mesh);
  bullets.push({
    mesh, vz: -PLAYER_BULLET_SPEED, vx: 0, vy: 0, isPlayer: true, alive: true,
    damage: options.damage ?? 1,
    kind: options.kind ?? 'normal',
    homing: false, homingStrength: 0, evaded: false,
  });
}

export function fireChargeBullet(origin: THREE.Vector3, fullCharge: boolean, damage?: number): void {
  firePlayerBullet(origin, {
    damage: damage ?? (fullCharge ? 10 : 4),
    kind: 'charge',
    color: fullCharge ? 0xffe477 : 0xffb347,
    scale: fullCharge ? 2.1 : 1.5,
  });
}

export function firePlayerHomingShot(
  origin: THREE.Vector3,
  target: PlayerHomingTarget,
  options: PlayerHomingShotOptions = {},
): void {
  const homingObject = targetObject(target);
  const targetPosition = homingObject.getWorldPosition(new THREE.Vector3());
  const direction = targetPosition.clone().sub(origin);
  if (direction.lengthSq() === 0) direction.set(0, 0, -1);
  direction.normalize();

  const group = new THREE.Group();
  const body = new THREE.Mesh(playerHomingGeo, playerHomingMat);
  const ring = new THREE.Mesh(playerHomingRingGeo, playerHomingRingMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.z = 0.18;
  group.add(body, ring);
  group.position.copy(origin);
  group.lookAt(origin.clone().add(direction));
  scene.add(group);

  const speed = options.speed ?? 72;
  const metadata = targetMetadata(target);
  bullets.push({
    mesh: group,
    vz: direction.z * speed,
    vx: direction.x * speed,
    vy: direction.y * speed,
    isPlayer: true,
    alive: true,
    damage: options.damage ?? 3,
    kind: 'lock',
    homing: true,
    homingStrength: options.homingStrength ?? 1.4,
    target: targetPosition,
    targetObject: homingObject,
    targetIsValid: () => targetRemainsValid(target),
    targetId: metadata?.targetId,
    targetEnemyId: metadata?.enemyId,
    targetPartId: metadata?.partId,
    targetKind: metadata?.kind,
    targetDisplayName: metadata?.displayName,
    targetMetadata: metadata,
    targetHitTarget: target.target,
    evaded: false,
  });
}

export function firePlayerHomingVolley(
  origin: THREE.Vector3,
  targets: readonly PlayerHomingTarget[],
  options: PlayerHomingShotOptions = {},
): number {
  let fired = 0;
  for (const target of targets) {
    if (!targetIsAcquirable(target)) continue;
    firePlayerHomingShot(origin, target, options);
    fired++;
  }
  return fired;
}

export function fireEnemyBullet(origin: THREE.Vector3, target: THREE.Vector3, options: EnemyBulletOptions = {}): void {
  const dir = target.clone().sub(origin).normalize();
  const mat = options.color === undefined ? enemyMat : enemyMat.clone();
  if (options.color !== undefined) mat.color.setHex(options.color);
  const mesh = new THREE.Mesh(enemyGeo, mat);
  mesh.position.copy(origin);
  scene.add(mesh);
  const speed = options.speed ?? ENEMY_BULLET_SPEED;
  bullets.push({
    mesh, vz: dir.z * speed, vx: dir.x * speed, vy: dir.y * speed,
    isPlayer: false, alive: true, damage: options.damage ?? 15,
    kind: 'normal',
    homing: false, homingStrength: 0, evaded: false,
  });
}

export function fireHomingMissile(origin: THREE.Vector3, target: THREE.Vector3, options: HomingMissileOptions = {}): void {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1.8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff5533 }),
  );
  body.rotation.x = Math.PI / 2;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.12, 5, 12),
    new THREE.MeshBasicMaterial({ color: 0xffcc44 }),
  );
  ring.position.z = 0.35;
  group.add(body, ring);
  group.position.copy(origin);
  scene.add(group);

  const dir = target.clone().sub(origin).normalize();
  const speed = options.speed ?? 38;
  bullets.push({
    mesh: group,
    vz: dir.z * speed,
    vx: dir.x * speed,
    vy: dir.y * speed,
    isPlayer: false,
    alive: true,
    damage: options.damage ?? 22,
    homing: true,
    homingStrength: options.homingStrength ?? 0.9,
    target: options.homingTarget ?? target,
    kind: 'normal',
    evaded: false,
  });
}

export function updateBullets(dt: number, playerPos?: THREE.Vector3, playerRolling = false): void {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (!b.alive) { scene.remove(b.mesh); bullets.splice(i, 1); continue; }

    if (b.homing && !b.isPlayer && playerRolling && !b.evaded) {
      // A barrel roll breaks a missile's lock. It continues as a dumb projectile,
      // but is ignored by the player collision pass once the lock is broken.
      b.homing = false;
      b.evaded = true;
      const direction = b.mesh.position.x >= (playerPos?.x ?? 0) ? 1 : -1;
      b.vx += direction * ENEMY_BULLET_SPEED * 0.85;
      const mat = b.mesh instanceof THREE.Mesh
        ? b.mesh.material as THREE.MeshBasicMaterial
        : (b.mesh.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.color.setHex(0x55ffaa);
    }

    if (b.homing && b.targetIsValid && !b.targetIsValid()) {
      // A lock target may disappear after release. Keep the projectile's
      // current velocity and stop homing instead of retargeting another enemy.
      b.homing = false;
      b.targetObject = undefined;
      b.targetIsValid = undefined;
    }

    if (b.homing && b.targetObject) {
      b.target ??= new THREE.Vector3();
      b.targetObject.getWorldPosition(b.target);
    }

    if (b.homing && b.target) {
      const desired = b.target.clone().sub(b.mesh.position).normalize();
      const velocity = new THREE.Vector3(b.vx, b.vy, b.vz).normalize();
      velocity.lerp(desired, Math.min(0.18, Math.max(0.01, b.homingStrength * dt * 2.4))).normalize();
      const speed = Math.max(1, Math.sqrt(b.vx ** 2 + b.vy ** 2 + b.vz ** 2));
      b.vx = velocity.x * speed;
      b.vy = velocity.y * speed;
      b.vz = velocity.z * speed;
      b.mesh.lookAt(b.mesh.position.clone().add(velocity));
    }

    b.mesh.position.x += b.vx * dt;
    b.mesh.position.y += b.vy * dt;
    b.mesh.position.z += b.vz * dt;

    // 遠すぎたら削除
    if (b.mesh.position.z < -400 || b.mesh.position.z > 30 ||
        Math.abs(b.mesh.position.x) > 80 || Math.abs(b.mesh.position.y) > 60) {
      b.alive = false;
    }
  }
}

export function getPlayerBullets(): Bullet[] {
  return bullets.filter(b => b.isPlayer && b.alive);
}

export function getEnemyBullets(): Bullet[] {
  return bullets.filter(b => !b.isPlayer && b.alive);
}

export function killBullet(b: Bullet): void {
  b.alive = false;
}

export function clearBullets(): void {
  for (const b of bullets) { scene.remove(b.mesh); }
  bullets.length = 0;
}

export type { Bullet };
