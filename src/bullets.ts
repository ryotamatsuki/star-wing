import * as THREE from 'three';

const PLAYER_BULLET_SPEED = 100;
const ENEMY_BULLET_SPEED  = 60;
const LASER_COLOR_PLAYER  = 0x44ffaa;
const LASER_COLOR_ENEMY   = 0xff4422;

interface Bullet {
  mesh: THREE.Mesh;
  vz: number;
  vx: number;
  vy: number;
  isPlayer: boolean;
  alive: boolean;
}

const bullets: Bullet[] = [];
let scene: THREE.Scene;

const playerGeo = new THREE.BoxGeometry(0.12, 0.12, 2.4);
const playerMat = new THREE.MeshBasicMaterial({ color: LASER_COLOR_PLAYER });
const enemyGeo  = new THREE.SphereGeometry(0.3, 5, 4);
const enemyMat  = new THREE.MeshBasicMaterial({ color: LASER_COLOR_ENEMY });

export function initBullets(s: THREE.Scene): void {
  scene = s;
}

export function firePlayerBullet(origin: THREE.Vector3): void {
  const mesh = new THREE.Mesh(playerGeo, playerMat);
  mesh.position.copy(origin);
  scene.add(mesh);
  bullets.push({ mesh, vz: -PLAYER_BULLET_SPEED, vx: 0, vy: 0, isPlayer: true, alive: true });
}

export function fireEnemyBullet(origin: THREE.Vector3, target: THREE.Vector3): void {
  const dir = target.clone().sub(origin).normalize();
  const mesh = new THREE.Mesh(enemyGeo, enemyMat);
  mesh.position.copy(origin);
  scene.add(mesh);
  bullets.push({
    mesh,
    vz: dir.z * ENEMY_BULLET_SPEED,
    vx: dir.x * ENEMY_BULLET_SPEED,
    vy: dir.y * ENEMY_BULLET_SPEED,
    isPlayer: false,
    alive: true,
  });
}

export function updateBullets(dt: number): void {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (!b.alive) { scene.remove(b.mesh); bullets.splice(i, 1); continue; }

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
