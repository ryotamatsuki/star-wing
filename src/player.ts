import * as THREE from 'three';
import { isDown } from './input';
import { createPlayerShip } from './models';
import { sfxBarrel } from './audio';

// ─── 調整パラメータ ───────────────────────────────────────────────────────────
const SPEED_X       = 18;
const SPEED_Y       = 12;
const LERP_MOVE     = 8;
const LERP_ROLL     = 6;
const MAX_ROLL      = 0.72;  // ≈ 41°
const MAX_PITCH     = 0.28;
const LIMIT_X       = 16;
const LIMIT_Y_MIN   = 0.5;
const LIMIT_Y_MAX   = 12;
const BARREL_WINDOW   = 0.35; // ダブルタップ判定時間(秒)
const BARREL_DURATION = 0.5;

export interface Player {
  group: THREE.Group;
  isRolling: boolean;
  update(dt: number, camera: THREE.Camera): void;
  reset(): void;
}

export function createPlayer(scene: THREE.Scene): Player {
  const group = new THREE.Group();
  const ship = createPlayerShip();
  ship.scale.setScalar(1.4);
  group.add(ship);
  group.position.set(0, 3, 10);
  scene.add(group);

  const vel = new THREE.Vector2(0, 0);

  // ── 視点モード(V キーで三人称 ⇔ 一人称コックピットを切替) ──────────────────
  let firstPerson = false;
  let tpQuat: THREE.Quaternion | null = null;          // 三人称カメラの基準姿勢
  const tmpV = new THREE.Vector3();
  addEventListener('keydown', e => {
    if (e.code === 'KeyV' && !e.repeat) {
      firstPerson = !firstPerson;
      ship.visible = !firstPerson;                     // 一人称時は自機を隠す
    }
  });

  // バレルロール
  let rollTimer   = 0;
  let isRolling   = false;
  let totalTime   = 0;

  // ダブルタップ検出用:前フレームのキー状態
  let prevLeft  = false;
  let prevRight = false;
  let lastLeftReleased  = -99;
  let lastRightReleased = -99;

  function update(dt: number, camera: THREE.Camera): void {
    totalTime += dt;

    // 三人称基準姿勢を初回フレームで取得(FP の lookAt で姿勢が変わる前に)
    if (!tpQuat) tpQuat = (camera as THREE.PerspectiveCamera).quaternion.clone();

    const left  = isDown('ArrowLeft')  || isDown('KeyA');
    const right = isDown('ArrowRight') || isDown('KeyD');
    const up    = isDown('ArrowUp')    || isDown('KeyW');
    const down  = isDown('ArrowDown')  || isDown('KeyS');

    // ── バレルロール:キーを一度離して再度押したら発動 ─────────────────────
    if (!isRolling) {
      if (prevLeft  && !left)  lastLeftReleased  = totalTime;
      if (prevRight && !right) lastRightReleased = totalTime;

      if (!prevLeft  && left  && totalTime - lastLeftReleased  < BARREL_WINDOW) {
        isRolling = true; rollTimer = BARREL_DURATION; lastLeftReleased  = -99;
        sfxBarrel();
      }
      if (!prevRight && right && totalTime - lastRightReleased < BARREL_WINDOW) {
        isRolling = true; rollTimer = BARREL_DURATION; lastRightReleased = -99;
        sfxBarrel();
      }
    }

    prevLeft  = left;
    prevRight = right;

    // ── 移動 ───────────────────────────────────────────────────────────────
    const targetVx = (right ? SPEED_X : 0) - (left ? SPEED_X : 0);
    const targetVy = (up    ? SPEED_Y : 0) - (down ? SPEED_Y : 0);
    vel.x += (targetVx - vel.x) * LERP_MOVE * dt;
    vel.y += (targetVy - vel.y) * LERP_MOVE * dt;

    if (!isRolling) {
      group.position.x = THREE.MathUtils.clamp(group.position.x + vel.x * dt, -LIMIT_X, LIMIT_X);
      group.position.y = THREE.MathUtils.clamp(group.position.y + vel.y * dt, LIMIT_Y_MIN, LIMIT_Y_MAX);
    }

    // ── 姿勢 ───────────────────────────────────────────────────────────────
    if (isRolling) {
      rollTimer -= dt;
      const progress = 1 - rollTimer / BARREL_DURATION;
      group.rotation.z = -Math.PI * 2 * progress;
      if (rollTimer <= 0) {
        isRolling = false;
        rollTimer = 0;
        group.rotation.z = 0;
      }
    } else {
      const targetRoll  = -vel.x / SPEED_X * MAX_ROLL;
      const targetPitch =  vel.y / SPEED_Y * MAX_PITCH;
      group.rotation.z += (targetRoll  - group.rotation.z) * LERP_ROLL * dt;
      group.rotation.x += (targetPitch - group.rotation.x) * LERP_ROLL * dt;
    }

    // ── カメラ追従 ─────────────────────────────────────────────────────────
    const cam = camera as THREE.PerspectiveCamera;
    if (firstPerson) {
      // 一人称: コックピット内から前方を見る
      tmpV.set(group.position.x, group.position.y + 0.8, group.position.z + 0.3);
      cam.position.lerp(tmpV, Math.min(1, 12 * dt));
      cam.lookAt(group.position.x, group.position.y + 0.4, group.position.z - 60);
      cam.rotateZ(group.rotation.z);          // バンク・バレルロールを視界へ反映
      cam.rotateX(group.rotation.x * 0.5);    // ピッチを軽く反映
    } else {
      // 三人称: 後方から追従(姿勢は固定)
      cam.position.x += (group.position.x * 0.25) * 4 * dt - cam.position.x * 4 * dt;
      cam.position.y += ((group.position.y * 0.1 + 6) - cam.position.y) * 3 * dt;
      cam.position.z += (22 - cam.position.z) * 4 * dt;   // FP→TP 復帰時に z を戻す
      if (tpQuat) cam.quaternion.copy(tpQuat);
    }
  }

  function reset(): void {
    group.position.set(0, 3, 10);
    group.rotation.set(0, 0, 0);
    vel.set(0, 0);
    isRolling = false;
    rollTimer = 0;
    totalTime = 0;
    prevLeft = false;
    prevRight = false;
  }

  return { group, get isRolling() { return isRolling; }, update, reset };
}
