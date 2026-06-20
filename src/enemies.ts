import * as THREE from 'three';
import { createEnemyA } from './models';
import { fireEnemyBullet } from './bullets';
import { spawnExplosion } from './effects';

// ─── 敵の定義 ────────────────────────────────────────────────────────────────

interface Enemy {
  group: THREE.Group;
  hp: number;
  radius: number;
  alive: boolean;
  age: number;
  type: 'straight' | 'sine' | 'turret';
  baseX: number;
  shootCd: number;
}

const enemies: Enemy[] = [];
let scene: THREE.Scene;
let onKill: (pos: THREE.Vector3, score: number) => void;
let speedMult = 1.0;

// ─── ウェーブ定義 ─────────────────────────────────────────────────────────────
interface WaveEntry {
  time: number;
  type: 'straight' | 'sine' | 'turret';
  x: number;
  y: number;
  count: number;
  gap: number;
}

// Stage 1: 森林 ─────────────────────────────────────────────────────────────
const STAGE1_WAVES: WaveEntry[] = [
  { time:  3, type: 'straight', x:  -6, y: 6,  count: 2, gap: 0.4  },
  { time:  5, type: 'straight', x:   6, y: 6,  count: 2, gap: 0.4  },
  { time:  9, type: 'sine',     x:   0, y: 8,  count: 3, gap: 0.6  },
  { time: 14, type: 'turret',   x:  -8, y: 0,  count: 1, gap: 0    },
  { time: 14, type: 'turret',   x:   8, y: 0,  count: 1, gap: 0    },
  { time: 20, type: 'straight', x: -10, y: 7,  count: 3, gap: 0.3  },
  { time: 20, type: 'straight', x:  10, y: 7,  count: 3, gap: 0.3  },
  { time: 28, type: 'sine',     x:  -4, y: 9,  count: 4, gap: 0.5  },
  { time: 35, type: 'turret',   x: -12, y: 0,  count: 1, gap: 0    },
  { time: 35, type: 'turret',   x:  12, y: 0,  count: 1, gap: 0    },
  { time: 35, type: 'turret',   x:   0, y: 0,  count: 1, gap: 0    },
  { time: 43, type: 'sine',     x:   0, y: 10, count: 5, gap: 0.4  },
  { time: 52, type: 'straight', x:  -8, y: 7,  count: 4, gap: 0.25 },
  { time: 52, type: 'straight', x:   8, y: 7,  count: 4, gap: 0.25 },
  { time: 60, type: 'turret',   x:  -6, y: 0,  count: 1, gap: 0    },
  { time: 60, type: 'turret',   x:   6, y: 0,  count: 1, gap: 0    },
  { time: 68, type: 'sine',     x:   4, y: 8,  count: 6, gap: 0.3  },
];

// Stage 2: 峡谷 ─────────────────────────────────────────────────────────────
const STAGE2_WAVES: WaveEntry[] = [
  { time:  2, type: 'straight', x:  -5, y: 6,  count: 3, gap: 0.3  },
  { time:  3, type: 'straight', x:   5, y: 6,  count: 3, gap: 0.3  },
  { time:  7, type: 'sine',     x:   0, y: 8,  count: 4, gap: 0.5  },
  { time: 10, type: 'turret',   x:  -8, y: 0,  count: 1, gap: 0    },
  { time: 10, type: 'turret',   x:   8, y: 0,  count: 1, gap: 0    },
  { time: 15, type: 'straight', x: -10, y: 7,  count: 4, gap: 0.28 },
  { time: 15, type: 'straight', x:  10, y: 7,  count: 4, gap: 0.28 },
  { time: 20, type: 'sine',     x:  -4, y: 9,  count: 5, gap: 0.42 },
  { time: 24, type: 'turret',   x: -10, y: 0,  count: 2, gap: 4    },
  { time: 24, type: 'turret',   x:  10, y: 0,  count: 2, gap: 4    },
  { time: 30, type: 'straight', x:  -8, y: 6,  count: 5, gap: 0.22 },
  { time: 30, type: 'straight', x:   8, y: 6,  count: 5, gap: 0.22 },
  { time: 36, type: 'sine',     x:   0, y: 10, count: 6, gap: 0.38 },
  { time: 40, type: 'turret',   x: -12, y: 0,  count: 1, gap: 0    },
  { time: 40, type: 'turret',   x:   0, y: 0,  count: 1, gap: 0    },
  { time: 40, type: 'turret',   x:  12, y: 0,  count: 1, gap: 0    },
  { time: 46, type: 'sine',     x:   4, y: 8,  count: 6, gap: 0.32 },
  { time: 52, type: 'straight', x:  -6, y: 7,  count: 5, gap: 0.2  },
  { time: 52, type: 'straight', x:   6, y: 7,  count: 5, gap: 0.2  },
  { time: 58, type: 'turret',   x:  -8, y: 0,  count: 2, gap: 4    },
  { time: 58, type: 'turret',   x:   8, y: 0,  count: 2, gap: 4    },
  { time: 64, type: 'sine',     x:   0, y: 9,  count: 7, gap: 0.28 },
];

// Stage 3: 氷河 ─────────────────────────────────────────────────────────────
const STAGE3_WAVES: WaveEntry[] = [
  { time:  2, type: 'sine',     x:  -4, y: 8,  count: 3, gap: 0.5  },
  { time:  2, type: 'sine',     x:   4, y: 8,  count: 3, gap: 0.5  },
  { time:  7, type: 'straight', x:   0, y: 6,  count: 4, gap: 0.28 },
  { time: 11, type: 'turret',   x:  -6, y: 0,  count: 1, gap: 0    },
  { time: 11, type: 'turret',   x:   6, y: 0,  count: 1, gap: 0    },
  { time: 15, type: 'sine',     x:   0, y: 10, count: 5, gap: 0.4  },
  { time: 19, type: 'turret',   x: -10, y: 0,  count: 2, gap: 4    },
  { time: 19, type: 'straight', x:   0, y: 7,  count: 4, gap: 0.25 },
  { time: 25, type: 'sine',     x:  -6, y: 9,  count: 5, gap: 0.35 },
  { time: 25, type: 'sine',     x:   6, y: 9,  count: 5, gap: 0.35 },
  { time: 31, type: 'turret',   x: -12, y: 0,  count: 1, gap: 0    },
  { time: 31, type: 'turret',   x:   0, y: 0,  count: 1, gap: 0    },
  { time: 31, type: 'turret',   x:  12, y: 0,  count: 1, gap: 0    },
  { time: 37, type: 'sine',     x:   0, y: 8,  count: 7, gap: 0.28 },
  { time: 43, type: 'straight', x: -10, y: 6,  count: 5, gap: 0.2  },
  { time: 43, type: 'straight', x:  10, y: 6,  count: 5, gap: 0.2  },
  { time: 49, type: 'turret',   x:  -8, y: 0,  count: 2, gap: 4    },
  { time: 49, type: 'turret',   x:   8, y: 0,  count: 2, gap: 4    },
  { time: 55, type: 'sine',     x:   2, y: 10, count: 8, gap: 0.25 },
  { time: 61, type: 'turret',   x: -14, y: 0,  count: 1, gap: 0    },
  { time: 61, type: 'turret',   x:  -4, y: 0,  count: 1, gap: 0    },
  { time: 61, type: 'turret',   x:   4, y: 0,  count: 1, gap: 0    },
  { time: 61, type: 'turret',   x:  14, y: 0,  count: 1, gap: 0    },
];

// Stage 4: 火山 ─────────────────────────────────────────────────────────────
const STAGE4_WAVES: WaveEntry[] = [
  { time:  2, type: 'straight', x:  -4, y: 6,  count: 4, gap: 0.22 },
  { time:  2, type: 'straight', x:   4, y: 6,  count: 4, gap: 0.22 },
  { time:  6, type: 'turret',   x:  -8, y: 0,  count: 1, gap: 0    },
  { time:  6, type: 'turret',   x:   8, y: 0,  count: 1, gap: 0    },
  { time: 10, type: 'straight', x: -10, y: 7,  count: 5, gap: 0.2  },
  { time: 10, type: 'straight', x:  10, y: 7,  count: 5, gap: 0.2  },
  { time: 15, type: 'sine',     x:   0, y: 8,  count: 5, gap: 0.35 },
  { time: 18, type: 'turret',   x: -10, y: 0,  count: 2, gap: 4    },
  { time: 18, type: 'turret',   x:  10, y: 0,  count: 2, gap: 4    },
  { time: 23, type: 'straight', x:  -6, y: 6,  count: 6, gap: 0.18 },
  { time: 23, type: 'straight', x:   6, y: 6,  count: 6, gap: 0.18 },
  { time: 28, type: 'sine',     x:  -4, y: 9,  count: 6, gap: 0.28 },
  { time: 28, type: 'sine',     x:   4, y: 9,  count: 6, gap: 0.28 },
  { time: 34, type: 'turret',   x: -12, y: 0,  count: 3, gap: 4    },
  { time: 34, type: 'turret',   x:  12, y: 0,  count: 3, gap: 4    },
  { time: 40, type: 'straight', x:   0, y: 7,  count: 8, gap: 0.16 },
  { time: 45, type: 'sine',     x:   0, y: 10, count: 8, gap: 0.22 },
  { time: 50, type: 'turret',   x: -12, y: 0,  count: 2, gap: 4    },
  { time: 50, type: 'turret',   x:  -4, y: 0,  count: 2, gap: 4    },
  { time: 50, type: 'turret',   x:   4, y: 0,  count: 2, gap: 4    },
  { time: 50, type: 'turret',   x:  12, y: 0,  count: 2, gap: 4    },
  { time: 56, type: 'straight', x:  -8, y: 6,  count: 6, gap: 0.15 },
  { time: 56, type: 'straight', x:   8, y: 6,  count: 6, gap: 0.15 },
];

// Stage 5: 宇宙 ─────────────────────────────────────────────────────────────
const STAGE5_WAVES: WaveEntry[] = [
  { time:  1, type: 'straight', x:  -5, y: 6,  count: 4,  gap: 0.2  },
  { time:  1, type: 'straight', x:   5, y: 6,  count: 4,  gap: 0.2  },
  { time:  4, type: 'sine',     x:   0, y: 8,  count: 5,  gap: 0.32 },
  { time:  7, type: 'turret',   x:  -8, y: 0,  count: 2,  gap: 4    },
  { time:  7, type: 'turret',   x:   8, y: 0,  count: 2,  gap: 4    },
  { time: 11, type: 'straight', x: -10, y: 7,  count: 6,  gap: 0.16 },
  { time: 11, type: 'straight', x:  10, y: 7,  count: 6,  gap: 0.16 },
  { time: 15, type: 'sine',     x:  -4, y: 9,  count: 7,  gap: 0.25 },
  { time: 15, type: 'sine',     x:   4, y: 9,  count: 7,  gap: 0.25 },
  { time: 20, type: 'turret',   x: -12, y: 0,  count: 2,  gap: 4    },
  { time: 20, type: 'turret',   x:   0, y: 0,  count: 2,  gap: 4    },
  { time: 20, type: 'turret',   x:  12, y: 0,  count: 2,  gap: 4    },
  { time: 25, type: 'straight', x:  -6, y: 6,  count: 7,  gap: 0.14 },
  { time: 25, type: 'straight', x:   6, y: 6,  count: 7,  gap: 0.14 },
  { time: 29, type: 'sine',     x:   0, y: 10, count: 9,  gap: 0.2  },
  { time: 34, type: 'turret',   x: -14, y: 0,  count: 2,  gap: 4    },
  { time: 34, type: 'turret',   x:  -4, y: 0,  count: 2,  gap: 4    },
  { time: 34, type: 'turret',   x:   4, y: 0,  count: 2,  gap: 4    },
  { time: 34, type: 'turret',   x:  14, y: 0,  count: 2,  gap: 4    },
  { time: 39, type: 'straight', x:  -8, y: 7,  count: 8,  gap: 0.13 },
  { time: 39, type: 'straight', x:   8, y: 7,  count: 8,  gap: 0.13 },
  { time: 43, type: 'sine',     x:  -6, y: 9,  count: 8,  gap: 0.18 },
  { time: 43, type: 'sine',     x:   6, y: 9,  count: 8,  gap: 0.18 },
  { time: 48, type: 'turret',   x: -12, y: 0,  count: 3,  gap: 4    },
  { time: 48, type: 'turret',   x:   0, y: 0,  count: 3,  gap: 4    },
  { time: 48, type: 'turret',   x:  12, y: 0,  count: 3,  gap: 4    },
  { time: 53, type: 'straight', x:   0, y: 6,  count: 10, gap: 0.11 },
];

const ALL_WAVES = [STAGE1_WAVES, STAGE2_WAVES, STAGE3_WAVES, STAGE4_WAVES, STAGE5_WAVES];

// ─── スポーンキュー ───────────────────────────────────────────────────────────
interface SpawnJob { at: number; type: WaveEntry['type']; x: number; y: number; }
const spawnQueue: SpawnJob[] = [];
let currentWaves: WaveEntry[] = STAGE1_WAVES;
let waveIdx = 0;

export function initEnemies(s: THREE.Scene, killCb: (pos: THREE.Vector3, score: number) => void): void {
  scene = s;
  onKill = killCb;
}

export function setStageWaves(stage: number): void {
  currentWaves = ALL_WAVES[Math.min(stage - 1, ALL_WAVES.length - 1)];
}

export function setEnemySpeedMult(mult: number): void {
  speedMult = mult;
}

export function resetEnemies(): void {
  for (const e of enemies) scene.remove(e.group);
  enemies.length = 0;
  spawnQueue.length = 0;
  waveIdx = 0;
}

function spawnEnemy(type: WaveEntry['type'], x: number, y: number): void {
  const group = createEnemyA();
  const mat = (group.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial;

  let radius = 2;
  if (type === 'sine')   { mat.color.setHex(0xccaa00); radius = 2; }
  if (type === 'turret') { mat.color.setHex(0x666666); group.scale.setScalar(1.5); radius = 2.5; }

  group.position.set(x, y, -200);
  if (type === 'turret') { group.position.y = 0; group.position.z = -80; }

  scene.add(group);
  enemies.push({
    group, hp: type === 'turret' ? 3 : 1,
    radius, alive: true, age: 0, type,
    baseX: x, shootCd: type === 'turret' ? 2 : 999,
  });
}

export function updateEnemies(dt: number, stageTime: number, playerPos: THREE.Vector3): void {
  // ウェーブ発火
  while (waveIdx < currentWaves.length && stageTime >= currentWaves[waveIdx].time) {
    const w = currentWaves[waveIdx];
    for (let i = 0; i < w.count; i++) {
      spawnQueue.push({ at: stageTime + i * w.gap, type: w.type, x: w.x, y: w.y });
    }
    waveIdx++;
  }

  // スポーンキュー
  for (let i = spawnQueue.length - 1; i >= 0; i--) {
    if (stageTime >= spawnQueue[i].at) {
      const { type, x, y } = spawnQueue[i];
      spawnQueue.splice(i, 1);
      spawnEnemy(type, x, y);
    }
  }

  // 各敵の更新
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (!e.alive) { scene.remove(e.group); enemies.splice(i, 1); continue; }

    e.age += dt;

    switch (e.type) {
      case 'straight':
        e.group.position.z += 40 * speedMult * dt;
        e.group.rotation.x = 0.1;
        break;
      case 'sine':
        e.group.position.z += 35 * speedMult * dt;
        e.group.position.x = e.baseX + Math.sin(e.age * 2.2) * 8;
        break;
      case 'turret':
        e.group.lookAt(playerPos);
        e.shootCd -= dt;
        if (e.shootCd <= 0) {
          fireEnemyBullet(e.group.position.clone(), playerPos.clone());
          e.shootCd = 2.5;
        }
        break;
    }

    if (e.group.position.z > 25 && e.type !== 'turret') e.alive = false;
  }
}

export function getEnemies(): Enemy[] { return enemies; }

export function allWavesCleared(): boolean {
  return waveIdx >= currentWaves.length && spawnQueue.length === 0 && enemies.length === 0;
}

export function damageEnemy(e: Enemy, dmg: number): void {
  e.hp -= dmg;
  if (e.hp <= 0) {
    e.alive = false;
    spawnExplosion(e.group.position.clone(), 14);
    onKill(e.group.position.clone(), e.type === 'turret' ? 500 : e.type === 'sine' ? 200 : 100);
  }
}

export type { Enemy };
