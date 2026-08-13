import * as THREE from 'three';

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
  homing: boolean;
  homingStrength: number;
  target?: THREE.Vector3;
  evaded: boolean;
}

const bullets: Bullet[] = [];
let scene: THREE.Scene;

const playerGeo = new THREE.BoxGeometry(0.12, 0.12, 2.4);
const playerMat = new THREE.MeshBasicMaterial({ color: LASER_COLOR_PLAYER });
const enemyGeo  = new THREE.SphereGeometry(0.3, 5, 4);
const enemyMat  = new THREE.MeshBasicMaterial({ color: LASER_COLOR_ENEMY });

export interface EnemyBulletOptions {
  damage?: number;
  speed?: number;
  color?: number;
}

export interface HomingMissileOptions {
  damage?: number;
  speed?: number;
  homingStrength?: number;
}

export function initBullets(s: THREE.Scene): void {
  scene = s;
}

export function firePlayerBullet(origin: THREE.Vector3): void {
  const mesh = new THREE.Mesh(playerGeo, playerMat);
  mesh.position.copy(origin);
  scene.add(mesh);
  bullets.push({
    mesh, vz: -PLAYER_BULLET_SPEED, vx: 0, vy: 0, isPlayer: true, alive: true,
    damage: 1, homing: false, homingStrength: 0, evaded: false,
  });
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
    target,
    evaded: false,
  });
}

export function updateBullets(dt: number, playerPos?: THREE.Vector3, playerRolling = false): void {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (!b.alive) { scene.remove(b.mesh); bullets.splice(i, 1); continue; }

    if (b.homing && playerRolling && !b.evaded) {
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
