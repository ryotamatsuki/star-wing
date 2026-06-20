import * as THREE from 'three';

const SCROLL_SPEED = 60;
export const ITEM_RADIUS  = 2.2;  // 当たり判定半径
export const HEAL_AMOUNT  = 25;   // 回復量

interface HealthItem {
  group: THREE.Group;
  collected: boolean;
  age: number;
}

const items: HealthItem[] = [];
let scene: THREE.Scene;
let spawnTimer = 20.0; // 最初のアイテムは約20秒後

export function initItems(s: THREE.Scene): void {
  scene = s;
}

function spawnHealthItem(): void {
  const group = new THREE.Group();

  // コア球(緑)
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0x00ff88 }),
  );

  // 外殻リング(回転する)
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(2.0, 0.18, 6, 20),
    new THREE.MeshBasicMaterial({ color: 0x44ffcc, transparent: true, opacity: 0.7 }),
  );

  group.add(core, halo);

  const x = (Math.random() - 0.5) * 18; // x: -9 〜 +9
  const y = 2.5 + Math.random() * 4;    // y: 2.5 〜 6.5
  group.position.set(x, y, -260);
  scene.add(group);

  items.push({ group, collected: false, age: 0 });
}

export function updateItems(dt: number): void {
  // スポーンタイマー
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnHealthItem();
    spawnTimer = 22 + Math.random() * 14; // 次は22〜36秒後
  }

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];

    if (item.collected) {
      scene.remove(item.group);
      items.splice(i, 1);
      continue;
    }

    item.age += dt;
    item.group.position.z += SCROLL_SPEED * dt;

    // ぷるぷるアニメーション
    const pulse = 1 + Math.sin(item.age * 4) * 0.18;
    item.group.children[0].scale.setScalar(pulse);

    // ハローリング回転
    (item.group.children[1] as THREE.Mesh).rotation.y += dt * 1.8;
    (item.group.children[1] as THREE.Mesh).rotation.x += dt * 0.9;

    // 画面を通り過ぎたら削除
    if (item.group.position.z > 30) {
      scene.remove(item.group);
      items.splice(i, 1);
    }
  }
}

export function getItems(): HealthItem[] {
  return items;
}

export function resetItems(): void {
  for (const item of items) scene.remove(item.group);
  items.length = 0;
  spawnTimer = 20.0;
}
