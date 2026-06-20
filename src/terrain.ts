import * as THREE from 'three';

const GRID_SIZE   = 20;
const SCROLL_SPEED = 60;
const GRID_COUNT  = 20;

// ─── ステージ別テーマ ─────────────────────────────────────────────────────────
const STAGE_THEMES = [
  { terrain: 0x226622, wire: 0x44aa44, mountain: 0x1a4422, fog: 0x4488cc,
    skyTop: '#0c1a3d', skyMid: '#2255aa', skyBot: '#6699cc' },  // S1 森
  { terrain: 0x775533, wire: 0xaa6633, mountain: 0x442211, fog: 0x553322,
    skyTop: '#1a0c06', skyMid: '#553322', skyBot: '#997755' },  // S2 峡谷
  { terrain: 0x7799aa, wire: 0x99ccdd, mountain: 0x445566, fog: 0x99bbcc,
    skyTop: '#aaccdd', skyMid: '#ccddee', skyBot: '#ddeeff' },  // S3 氷河
  { terrain: 0x331100, wire: 0x882200, mountain: 0x1a0500, fog: 0x220800,
    skyTop: '#0d0000', skyMid: '#220800', skyBot: '#441100' },  // S4 火山
  { terrain: 0x111133, wire: 0x2233aa, mountain: 0x060614, fog: 0x000011,
    skyTop: '#000000', skyMid: '#000011', skyBot: '#000022' },  // S5 宇宙
];

// ─── モジュールスコープ変数 ────────────────────────────────────────────────────
let scene: THREE.Scene;
let groundMat: THREE.MeshLambertMaterial;
let wireMat: THREE.MeshBasicMaterial;
let ground: THREE.Mesh;
let scrollOffset = 0;

// ─── 障害物 ───────────────────────────────────────────────────────────────────
export interface ObstacleCollider { wx: number; wy: number; r: number; }
export interface Obstacle { group: THREE.Group; colliders: ObstacleCollider[]; }

const obstacles: Obstacle[] = [];
let obstacleTimer = 4.0;

// ─── 初期化 ───────────────────────────────────────────────────────────────────
export function initTerrain(s: THREE.Scene): void {
  scene = s;

  const geo = new THREE.PlaneGeometry(GRID_SIZE * 16, GRID_SIZE * GRID_COUNT, 16, GRID_COUNT);
  groundMat = new THREE.MeshLambertMaterial({ color: STAGE_THEMES[0].terrain, flatShading: true });
  ground = new THREE.Mesh(geo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -2, -GRID_SIZE * GRID_COUNT / 2 + 10);
  scene.add(ground);

  wireMat = new THREE.MeshBasicMaterial({
    color: STAGE_THEMES[0].wire, wireframe: true, opacity: 0.4, transparent: true,
  });
  const wireGround = new THREE.Mesh(geo, wireMat);
  ground.add(wireGround);

  addMountains();
  setSceneBackground(s, 1);
}

function addMountains(): void {
  const geo = new THREE.BufferGeometry();
  const verts: number[] = [];
  const count = 20;
  for (let i = 0; i < count; i++) {
    const x = (i - count / 2) * 30;
    const h = 20 + Math.random() * 40;
    const w = 20 + Math.random() * 15;
    const z = -300;
    verts.push(x - w, -2, z, x, -2 + h, z, x + w, -2, z);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({
    color: STAGE_THEMES[0].mountain, flatShading: true, side: THREE.DoubleSide,
  });
  scene.add(new THREE.Mesh(geo, mat));
}

// ─── スクロール ───────────────────────────────────────────────────────────────
export function updateTerrain(dt: number): void {
  scrollOffset += SCROLL_SPEED * dt;
  if (scrollOffset >= GRID_SIZE) scrollOffset -= GRID_SIZE;
  ground.position.z = -GRID_SIZE * GRID_COUNT / 2 + 10 + scrollOffset;
}

// ─── 障害物スポーン ───────────────────────────────────────────────────────────
function spawnArch(baseX: number): void {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x664422, flatShading: true });
  const pillarGeo = new THREE.BoxGeometry(3, 14, 3);

  const left = new THREE.Mesh(pillarGeo, mat);
  left.position.set(-10, 5, 0);
  const right = new THREE.Mesh(pillarGeo, mat);
  right.position.set(10, 5, 0);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(23, 3, 3), mat);
  beam.position.set(0, 12.5, 0);

  group.add(left, right, beam);
  group.position.set(baseX, -2, -260);
  scene.add(group);

  obstacles.push({
    group,
    colliders: [
      { wx: baseX - 10, wy: 4,  r: 3.5 },
      { wx: baseX + 10, wy: 4,  r: 3.5 },
      { wx: baseX,      wy: 12, r: 3.5 },
    ],
  });
}

function spawnColumn(baseX: number): void {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x775544, flatShading: true });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.5, 14, 7), mat);
  mesh.position.set(0, 5, 0);
  group.add(mesh);
  group.position.set(baseX, -2, -260);
  scene.add(group);

  obstacles.push({
    group,
    colliders: [{ wx: baseX, wy: 4, r: 4.5 }],
  });
}

export function updateObstacles(dt: number): void {
  obstacleTimer -= dt;
  if (obstacleTimer <= 0) {
    if (Math.random() < 0.5) {
      spawnArch((Math.random() - 0.5) * 8);
    } else {
      const side = Math.random() < 0.5 ? -1 : 1;
      spawnColumn(side * (7 + Math.random() * 5));
    }
    obstacleTimer = 4.0 + Math.random() * 3.0;
  }

  for (let i = obstacles.length - 1; i >= 0; i--) {
    const obs = obstacles[i];
    obs.group.position.z += SCROLL_SPEED * dt;
    if (obs.group.position.z > 30) {
      scene.remove(obs.group);
      obstacles.splice(i, 1);
    }
  }
}

export function getObstacles(): Obstacle[] { return obstacles; }

export function resetObstacles(): void {
  for (const obs of obstacles) scene.remove(obs.group);
  obstacles.length = 0;
  obstacleTimer = 4.0;
}

// ─── ステージテーマ切替 ───────────────────────────────────────────────────────
export function setStageTheme(stage: number): void {
  const t = STAGE_THEMES[Math.min(stage - 1, STAGE_THEMES.length - 1)];
  groundMat.color.setHex(t.terrain);
  wireMat.color.setHex(t.wire);
}

export function setSceneBackground(s: THREE.Scene, stage: number): void {
  const t = STAGE_THEMES[Math.min(stage - 1, STAGE_THEMES.length - 1)];

  const canvas = document.createElement('canvas');
  canvas.width = 2; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0,   t.skyTop);
  grad.addColorStop(0.6, t.skyMid);
  grad.addColorStop(1,   t.skyBot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);

  const oldBg = s.background;
  if (oldBg instanceof THREE.Texture) oldBg.dispose();
  s.background = new THREE.CanvasTexture(canvas);
  (s.fog as THREE.FogExp2).color.setHex(t.fog);
}
