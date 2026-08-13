import * as THREE from 'three';

function flatMesh(verts: number[], color: number, doubleSided = false): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({
    color,
    flatShading: true,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  return new THREE.Mesh(geo, mat);
}

// ─── アーウィン風戦闘機 ───────────────────────────────────────────────────────
export function createPlayerShip(): THREE.Group {
  const ship = new THREE.Group();

  // 胴体(前方に向いた角錐形)
  // 上面三角形 + 底面三角形 + 左右側面
  const body = flatMesh([
    // 上面
     0,  0.3,  3,   -0.8,  0,  -1,   0.8,  0, -1,
    // 底面
     0, -0.4,  3,    0.8,  0,  -1,  -0.8,  0, -1,
    // 左側面
     0,  0.3,  3,   -0.8,  0,  -1,   0, -0.4,  3,
    // 右側面
     0,  0.3,  3,    0.8,  0,  -1,   0, -0.4,  3,
    // 後面
    -0.8, 0, -1,   0.8, 0, -1,   0, -0.4, -1,
    -0.8, 0, -1,   0, 0.3, -1,   0.8, 0, -1,
  ], 0x8899aa);
  ship.add(body);

  // 主翼(左)
  const wingL = flatMesh([
     0,    0,   0.5,   -3.5, -0.3, -0.5,    0,  0,  -1,
     0,    0,   0.5,    0,    0,   -1,      -1, -0.1, -1,
    -1,   -0.1, -1,    -3.5, -0.3, -0.5,    0,  0, -1,
  ], 0x5577aa, true);
  ship.add(wingL);

  // 主翼(右)
  const wingR = flatMesh([
     0,    0,   0.5,   3.5, -0.3, -0.5,    0,  0,  -1,
     0,    0,   0.5,   0,    0,   -1,      1, -0.1, -1,
     1,   -0.1, -1,    3.5, -0.3, -0.5,    0,  0, -1,
  ], 0x5577aa, true);
  ship.add(wingR);

  // エンジンポッド(左右)
  const engineGeo = new THREE.CylinderGeometry(0.25, 0.2, 1.2, 6);
  const engineMat = new THREE.MeshLambertMaterial({ color: 0x445566, flatShading: true });
  const engineL = new THREE.Mesh(engineGeo, engineMat);
  engineL.rotation.x = Math.PI / 2;
  engineL.position.set(-1.2, -0.2, -0.2);
  ship.add(engineL);

  const engineR = engineL.clone();
  engineR.position.set(1.2, -0.2, -0.2);
  ship.add(engineR);

  // キャノピー
  const cockpit = flatMesh([
     0,  0.9,  1.2,   -0.35, 0.3,  0.8,    0.35, 0.3,  0.8,
     0,  0.9,  1.2,   -0.35, 0.3,  0.8,   -0.3,  0.3, -0.2,
     0,  0.9,  1.2,    0.35, 0.3,  0.8,    0.3,  0.3, -0.2,
     0,  0.9,  1.2,   -0.3,  0.3, -0.2,    0.3,  0.3, -0.2,
  ], 0x222244);
  ship.add(cockpit);

  // エンジン噴射口(光るリング)
  const thrusterGeo = new THREE.RingGeometry(0.15, 0.26, 8);
  const thrusterMat = new THREE.MeshBasicMaterial({ color: 0x44aaff, side: THREE.DoubleSide });
  const thruster = new THREE.Mesh(thrusterGeo, thrusterMat);
  thruster.name = 'player-thruster';
  thruster.position.set(0, 0, -1.1);
  ship.add(thruster);

  return ship;
}

// ─── ボス機体 ────────────────────────────────────────────────────────────────
export function createBossShip(): { group: THREE.Group; core: THREE.Mesh } {
  const group = new THREE.Group();

  // メイン胴体(幅広い鈍重な形)
  const body = flatMesh([
    // 上面
     0,  2,  3,  -5,  1, -2,   5,  1, -2,
    // 下面
     0, -2,  3,   5, -1, -2,  -5, -1, -2,
    // 左側面
     0,  2,  3,  -5,  1, -2,   0, -2,  3,
    // 右側面
     0,  2,  3,   5,  1, -2,   0, -2,  3,
    // 後面(2 triangles)
    -5,  1, -2,   5,  1, -2,   5, -1, -2,
    -5,  1, -2,   5, -1, -2,  -5, -1, -2,
  ], 0x334455);
  group.add(body);

  // 左大翼
  const wingL = flatMesh([
    -5,  0, -1,  -12, -0.5,  0,   -5,  0, -3,
    -12, -0.5, 0,  -10, -0.5, -3,   -5,  0, -3,
  ], 0x223344, true);
  group.add(wingL);

  // 右大翼
  const wingR = flatMesh([
     5,  0, -1,   12, -0.5,  0,    5,  0, -3,
    12, -0.5, 0,   10, -0.5, -3,    5,  0, -3,
  ], 0x223344, true);
  group.add(wingR);

  // 肩部キャノン(左右)
  const cannonGeo = new THREE.CylinderGeometry(0.6, 0.4, 3.5, 6);
  const cannonMat = new THREE.MeshLambertMaterial({ color: 0x445566, flatShading: true });
  const cannonL = new THREE.Mesh(cannonGeo, cannonMat);
  cannonL.rotation.x = Math.PI / 2;
  cannonL.position.set(-4, 0.5, 1);
  group.add(cannonL);
  const cannonR = cannonL.clone();
  cannonR.position.set(4, 0.5, 1);
  group.add(cannonR);

  // ブリッジ(上部コクピット)
  const bridge = flatMesh([
    -1.5, 2, 1,   1.5, 2, 1,   1.5, 3.2, -0.5,
    -1.5, 2, 1,   1.5, 3.2, -0.5,  -1.5, 3.2, -0.5,
  ], 0x445577, true);
  group.add(bridge);

  // 弱点コア(光るオレンジ球)
  const coreGeo = new THREE.SphereGeometry(1.4, 8, 6);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.set(0, -0.5, 0);
  group.add(core);

  return { group, core };
}

// ─── 基本的な小型敵機(直進型) ──────────────────────────────────────────────
export function createEnemyA(): THREE.Group {
  const enemy = new THREE.Group();

  const body = flatMesh([
    0,  0.3, -2,   -0.7,  0,  1,   0.7,  0,  1,
    0, -0.3, -2,    0.7,  0,  1,  -0.7,  0,  1,
    0,  0.3, -2,   -0.7,  0,  1,   0,   -0.3, -2,
    0,  0.3, -2,    0.7,  0,  1,   0,   -0.3, -2,
  ], 0xaa2222);
  enemy.add(body);

  const wL = flatMesh([
    0, 0, 0,   -2.5, -0.2, 0.5,   -0.5, 0, 1,
  ], 0x882222, true);
  enemy.add(wL);
  const wR = flatMesh([
    0, 0, 0,    2.5, -0.2, 0.5,    0.5, 0, 1,
  ], 0x882222, true);
  enemy.add(wR);

  return enemy;
}
