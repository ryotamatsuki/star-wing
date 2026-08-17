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

export interface HeavyGunshipNodeMap {
  hull: THREE.Group;
  leftCannon: THREE.Group;
  rightCannon: THREE.Group;
  leftMuzzle: THREE.Object3D;
  rightMuzzle: THREE.Object3D;
  engine: THREE.Group;
  core: THREE.Group;
}

export interface HeavyGunshipModel {
  group: THREE.Group;
  nodes: HeavyGunshipNodeMap;
  /** Toggle the prebuilt front armor around the exposed core. */
  setCoreExposed: (exposed: boolean) => void;
}

/**
 * A dedicated low-poly gunship assembled from named component groups.
 *
 * The component groups are deliberately direct children of the root so a
 * future enemy-parts controller can hide, disable, or replace a part without
 * needing to know anything about the model's internal mesh layout.
 */
export function createHeavyGunship(): HeavyGunshipModel {
  const group = new THREE.Group();
  group.name = 'heavy-gunship';

  const hull = new THREE.Group();
  hull.name = 'hull';
  const hullMaterial = new THREE.MeshLambertMaterial({ color: 0x46586a, flatShading: true });
  const armorMaterial = new THREE.MeshLambertMaterial({ color: 0x2d3d4c, flatShading: true });

  const hullBody = new THREE.Mesh(new THREE.BoxGeometry(8.6, 3.4, 8.8), hullMaterial);
  hullBody.name = 'hull-body';
  hull.add(hullBody);

  const prow = new THREE.Mesh(new THREE.ConeGeometry(3.35, 5.5, 6), hullMaterial);
  prow.name = 'hull-prow';
  prow.rotation.x = Math.PI / 2;
  prow.position.z = 5.1;
  hull.add(prow);

  // Prebuilt front armor pieces make the Core opening explicit. They are
  // transformed/hidden only when the state changes; no per-frame allocations.
  const coreArmor = new THREE.Group();
  coreArmor.name = 'core-armor-panels';
  const coreHatchMaterial = new THREE.MeshLambertMaterial({ color: 0x354859, flatShading: true });
  const coreHatch = new THREE.Mesh(new THREE.BoxGeometry(3.8, 3.4, 0.42), coreHatchMaterial);
  coreHatch.name = 'core-hatch';
  coreHatch.position.set(0, 0.2, 7.48);
  coreArmor.add(coreHatch);

  const coreFrameMaterial = new THREE.MeshLambertMaterial({ color: 0x60788b, flatShading: true });
  const leftPanel = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2.8, 0.5), coreFrameMaterial);
  leftPanel.name = 'core-panel-left';
  leftPanel.position.set(-2.45, 0.2, 7.55);
  coreArmor.add(leftPanel);
  const rightPanel = leftPanel.clone();
  rightPanel.name = 'core-panel-right';
  rightPanel.position.x = 2.45;
  coreArmor.add(rightPanel);

  const topPanel = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.72, 0.5), coreFrameMaterial);
  topPanel.name = 'core-panel-top';
  topPanel.position.set(0, 2.0, 7.55);
  coreArmor.add(topPanel);
  const bottomPanel = topPanel.clone();
  bottomPanel.name = 'core-panel-bottom';
  bottomPanel.position.y = -1.6;
  coreArmor.add(bottomPanel);
  hull.add(coreArmor);

  const upperArmor = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.15, 4.6), armorMaterial);
  upperArmor.name = 'hull-upper-armor';
  upperArmor.position.set(0, 2.0, -0.2);
  hull.add(upperArmor);

  for (const x of [-4.8, 4.8]) {
    const sideArmor = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.85, 6.4), armorMaterial);
    sideArmor.name = x < 0 ? 'hull-left-armor' : 'hull-right-armor';
    sideArmor.position.set(x, -0.25, -0.2);
    sideArmor.rotation.z = x < 0 ? -0.08 : 0.08;
    hull.add(sideArmor);
  }
  group.add(hull);

  const cannonMaterial = new THREE.MeshLambertMaterial({ color: 0x748596, flatShading: true });
  const makeCannon = (name: string, x: number): { cannon: THREE.Group; muzzle: THREE.Object3D } => {
    const cannon = new THREE.Group();
    cannon.name = name;
    // The part anchor is the visible mount center. Mesh children use local
    // coordinates so collision, lock markers, and homing follow the assembled
    // cannon instead of the gunship root.
    cannon.position.set(x, 1.75, 1.3);

    const mount = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 0.9, 6), cannonMaterial);
    mount.name = `${name}-mount`;
    mount.position.set(0, 0, 0);
    cannon.add(mount);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.6, 4.8, 6), cannonMaterial);
    barrel.name = `${name}-barrel`;
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, 2.7);
    cannon.add(barrel);

    // The barrel points toward +Z. Keep the muzzle as a named non-rendering
    // anchor so attack origin follows the visible barrel tip exactly.
    const muzzle = new THREE.Object3D();
    muzzle.name = `${name}-muzzle`;
    muzzle.position.set(0, 0, 5.1);
    cannon.add(muzzle);

    return { cannon, muzzle };
  };

  const leftCannonModel = makeCannon('left-cannon', -4.25);
  const rightCannonModel = makeCannon('right-cannon', 4.25);
  const { cannon: leftCannon, muzzle: leftMuzzle } = leftCannonModel;
  const { cannon: rightCannon, muzzle: rightMuzzle } = rightCannonModel;
  group.add(leftCannon, rightCannon);

  const engine = new THREE.Group();
  engine.name = 'engine';
  // One Engine part controls the paired pods. Its anchor is the center of
  // that rear assembly; pod/exhaust offsets remain local to the part.
  engine.position.set(0, -0.45, -4.55);
  const engineHousingMaterial = new THREE.MeshLambertMaterial({ color: 0x263746, flatShading: true });
  const engineGlowMaterial = new THREE.MeshBasicMaterial({ color: 0x39b9e8 });
  for (const x of [-2.25, 2.25]) {
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.45, 2.6, 8), engineHousingMaterial);
    housing.name = x < 0 ? 'engine-left-housing' : 'engine-right-housing';
    housing.rotation.x = Math.PI / 2;
    housing.position.set(x, 0, 0);
    engine.add(housing);

    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.92, 0.18, 8), engineGlowMaterial);
    exhaust.name = x < 0 ? 'engine-left-exhaust' : 'engine-right-exhaust';
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(x, 0, -1.35);
    engine.add(exhaust);
  }
  group.add(engine);

  const core = new THREE.Group();
  core.name = 'core';
  // Place the exposed core at the prow face so visibility, collision, and lock share one anchor.
  // Hull prow reaches approximately z=7.85. Keep the Core Group outside that
  // surface so visibility, collision, lock markers, and feedback share one
  // visibly exposed anchor.
  core.position.set(0, 0.2, 8.3);
  const coreShell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.65, 0),
    new THREE.MeshLambertMaterial({ color: 0x8a4d31, flatShading: true }),
  );
  coreShell.name = 'core-armor';
  core.add(coreShell);

  const coreCrystal = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.95, 0),
    new THREE.MeshBasicMaterial({ color: 0xffb52e }),
  );
  coreCrystal.name = 'core-crystal';
  core.add(coreCrystal);

  // A prebuilt low-poly ring makes the armor opening readable when the core appears.
  const coreOpening = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.22, 6, 8), new THREE.MeshLambertMaterial({ color: 0x6b7d8c, flatShading: true }));
  coreOpening.name = 'core-opening-ring';
  coreOpening.position.z = -0.12;

  const setCoreExposed = (exposed: boolean): void => {
    // Open the opaque prow and hatch while preserving the Hull Part itself as
    // the low-efficiency armor target.
    prow.visible = !exposed;
    coreHatch.visible = !exposed;
    if (exposed) {
      leftPanel.position.x = -3.45;
      leftPanel.rotation.z = -0.14;
      rightPanel.position.x = 3.45;
      rightPanel.rotation.z = 0.14;
      topPanel.position.y = 2.7;
      topPanel.rotation.z = -0.08;
      bottomPanel.position.y = -2.3;
      bottomPanel.rotation.z = 0.08;
    } else {
      leftPanel.position.x = -2.45;
      leftPanel.rotation.z = 0;
      rightPanel.position.x = 2.45;
      rightPanel.rotation.z = 0;
      topPanel.position.y = 2.0;
      topPanel.rotation.z = 0;
      bottomPanel.position.y = -1.6;
      bottomPanel.rotation.z = 0;
    }
  };
  core.add(coreOpening);
  core.visible = false;
  group.add(core);

  return {
    group,
    nodes: { hull, leftCannon, rightCannon, leftMuzzle, rightMuzzle, engine, core },
    setCoreExposed,
  };
}
