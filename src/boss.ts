import * as THREE from 'three';
import { createBossShip } from './models';
import { fireEnemyBullet } from './bullets';
import { spawnExplosion } from './effects';

// ─── ステージ別ボス設定 ────────────────────────────────────────────────────────
interface BossConfig {
  hp: number;
  coreColor: number;
  scale: number;
  moveSpeed: number;
  fireInterval: number;  // base seconds between shots
  fireWays: number;      // bullet spread count
  spreadAngle: number;
  special: 'beam' | 'charge' | 'shield' | 'storm';
}

const CONFIGS: BossConfig[] = [
  // S1 コーネリア守護者
  { hp:  30, coreColor: 0xff8800, scale: 1.0,  moveSpeed:  7, fireInterval: 1.4, fireWays: 3, spreadAngle: 0.18, special: 'beam'   },
  // S2 メテオ破壊者(チャージ突進)
  { hp:  45, coreColor: 0xff4400, scale: 1.1,  moveSpeed: 10, fireInterval: 1.1, fireWays: 4, spreadAngle: 0.22, special: 'charge' },
  // S3 氷河要塞(シールド+全方位バースト)
  { hp:  60, coreColor: 0x44aaff, scale: 1.2,  moveSpeed:  5, fireInterval: 1.3, fireWays: 6, spreadAngle: 0.25, special: 'shield' },
  // S4 火山ドラゴン(回転弾幕)
  { hp:  80, coreColor: 0xff2200, scale: 1.15, moveSpeed: 14, fireInterval: 0.9, fireWays: 5, spreadAngle: 0.20, special: 'storm'  },
  // S5 ラストコア(ビーム+超弾幕)
  { hp: 120, coreColor: 0xaa44ff, scale: 1.3,  moveSpeed: 12, fireInterval: 0.8, fireWays: 7, spreadAngle: 0.28, special: 'beam'   },
];

const BOSS_Z      = -90;
const BODY_RADIUS = 10;
const CORE_RADIUS = 2.5;

type Pattern = 'enter' | 'patternA' | 'special_warn' | 'special_fire' | 'dying';

export interface Boss {
  group:        THREE.Group;
  core:         THREE.Mesh;
  hp:           number;
  alive:        boolean;
  isFiringBeam: boolean;
  beamX:        number;
  isShielded:   boolean;
  radius:       number;
  coreRadius:   number;
  update(dt: number, playerPos: THREE.Vector3): void;
  damage(dmg: number): void;
  reset(): void;
}

export function createBoss(scene: THREE.Scene, onDead: () => void, stage = 1): Boss {
  const cfg = CONFIGS[Math.min(stage - 1, CONFIGS.length - 1)];

  const { group, core } = createBossShip();
  (core.material as THREE.MeshBasicMaterial).color.setHex(cfg.coreColor);
  group.position.set(0, 8, BOSS_Z - 60);
  group.scale.setScalar(cfg.scale);
  scene.add(group);

  // レーザービーム用エレメント(beam 特殊攻撃のみ使用)
  const warnGeo = new THREE.BoxGeometry(1.5, 0.4, 120);
  const warnMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
  const warnLine = new THREE.Mesh(warnGeo, warnMat);
  warnLine.visible = false;
  scene.add(warnLine);

  const beamGeo = new THREE.BoxGeometry(3, 1, 130);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.8 });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.visible = false;
  scene.add(beam);

  let hp         = cfg.hp;
  let alive      = true;
  let isShielded = false;
  let pattern: Pattern = 'enter';
  let timer      = 0;
  let shootTimer = 0;
  let moveDir    = 1;
  let dyingTimer = 0;
  let beamX      = 0;
  // charge 用
  let chargeStartZ  = BOSS_Z;
  let chargeTargetZ = BOSS_Z;
  // storm 用
  let stormFireCd = 0;
  let stormAngle  = 0;

  function phase2(): boolean { return hp <= cfg.hp / 2; }
  function spdMul(): number  { return phase2() ? 1.5 : 1.0; }
  function ways(): number    { return phase2() ? cfg.fireWays + 2 : cfg.fireWays; }
  function interval(): number { return cfg.fireInterval / spdMul(); }

  function shoot(origin: THREE.Vector3, target: THREE.Vector3, n: number, spread: number): void {
    for (let i = 0; i < n; i++) {
      const s = (i - (n - 1) / 2) * spread;
      fireEnemyBullet(origin.clone(), target.clone().add(new THREE.Vector3(s * 40, 0, 0)));
    }
  }

  function update(dt: number, playerPos: THREE.Vector3): void {
    if (!alive) return;
    timer += dt;

    // ビームのワールド位置追従
    if (cfg.special === 'beam') {
      warnLine.position.set(beamX, group.position.y - 0.5, BOSS_Z + 5);
      beam.position.set(beamX, group.position.y - 0.5, BOSS_Z + 5);
    }

    switch (pattern) {

      // ── 登場 ──────────────────────────────────────────────────────────────
      case 'enter':
        group.position.z += (BOSS_Z - group.position.z) * 2 * dt;
        group.position.y += (7 - group.position.y)      * 2 * dt;
        if (Math.abs(group.position.z - BOSS_Z) < 0.5) { pattern = 'patternA'; timer = 0; }
        break;

      // ── 通常: 左右移動 + n-way 弾 ────────────────────────────────────────
      case 'patternA': {
        const spd = cfg.moveSpeed * spdMul();
        group.position.x += moveDir * spd * dt;
        if (group.position.x >  16) { group.position.x =  16; moveDir = -1; }
        if (group.position.x < -16) { group.position.x = -16; moveDir =  1; }

        shootTimer -= dt;
        if (shootTimer <= 0) {
          shootTimer = interval();
          shoot(group.position.clone(), playerPos.clone(), ways(), cfg.spreadAngle);
        }

        if (timer > (phase2() ? 3.0 : 5.0)) {
          pattern = 'special_warn'; timer = 0; shootTimer = 0;
          beamX = group.position.x;
          if (cfg.special === 'beam') { warnLine.visible = true; warnMat.opacity = 0.6; }
        }
        break;
      }

      // ── 特殊攻撃 警告 ─────────────────────────────────────────────────────
      case 'special_warn': {
        const warnDur = phase2() ? 1.0 : 1.8;

        if (cfg.special === 'beam') {
          warnMat.opacity = 0.3 + Math.sin(timer * 12) * 0.25;
        } else if (cfg.special === 'charge') {
          // 機体フラッシュ
          const bm = (group.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial;
          bm.color.setHex(Math.sin(timer * 14) > 0 ? 0xffffff : 0x886644);
        } else if (cfg.special === 'shield') {
          // 青白く点滅
          const bm = (group.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial;
          const t = (Math.sin(timer * 8) + 1) / 2;
          bm.color.setRGB(0.4 + t * 0.3, 0.6 + t * 0.2, 1.0);
        } else { // storm
          group.rotation.y += 6 * dt; // 高速スピン予告
        }

        if (timer >= warnDur) {
          pattern = 'special_fire'; timer = 0;
          if (cfg.special === 'beam') {
            warnLine.visible = false; beam.visible = true; beamMat.opacity = 0.9;
          } else if (cfg.special === 'charge') {
            chargeStartZ  = group.position.z;
            chargeTargetZ = playerPos.z - 5;
            const bm = (group.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial;
            bm.color.setHex(0x886644);
          } else if (cfg.special === 'shield') {
            isShielded = true;
          } else {
            stormFireCd = 0; stormAngle = 0;
          }
        }
        break;
      }

      // ── 特殊攻撃 実行 ─────────────────────────────────────────────────────
      case 'special_fire': {

        if (cfg.special === 'beam') {
          // ── ビーム 0.6s ──
          const dur = 0.6;
          beamMat.opacity = 0.9 * (1 - timer / dur);
          if (timer >= dur) { beam.visible = false; pattern = 'patternA'; timer = 0; shootTimer = 0.3; }

        } else if (cfg.special === 'charge') {
          // ── チャージ突進 ──
          const chargeDur = phase2() ? 0.55 : 0.85;
          const returnDur = 0.7;
          const total     = chargeDur + returnDur;
          if (timer < chargeDur) {
            group.position.z = chargeStartZ + (chargeTargetZ - chargeStartZ) * (timer / chargeDur);
          } else if (timer < total) {
            const t2 = (timer - chargeDur) / returnDur;
            group.position.z = chargeTargetZ + (BOSS_Z - chargeTargetZ) * t2;
          } else {
            group.position.z = BOSS_Z;
            pattern = 'patternA'; timer = 0; shootTimer = 0.3;
          }

        } else if (cfg.special === 'shield') {
          // ── シールド + バースト ──
          const shieldDur = phase2() ? 1.0 : 1.5;
          const bm = (group.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial;
          if (timer < shieldDur) {
            const t = (Math.sin(timer * 10) + 1) / 2;
            bm.color.setRGB(0.5 + t * 0.5, 0.7 + t * 0.3, 1.0);
          } else {
            isShielded = false;
            bm.color.setHex(0x886644);
            const burstWays = phase2() ? 12 : 8;
            for (let i = 0; i < burstWays; i++) {
              const a = (i / burstWays) * Math.PI * 2;
              fireEnemyBullet(
                group.position.clone(),
                group.position.clone().add(new THREE.Vector3(Math.cos(a) * 30, 0, Math.sin(a) * 30)),
              );
            }
            spawnExplosion(group.position.clone(), 10, 0x88ddff);
            pattern = 'patternA'; timer = 0; shootTimer = 1.0;
          }

        } else {
          // ── ストーム: 回転弾幕 ──
          const stormDur      = phase2() ? 1.8 : 2.5;
          const stormInterval = phase2() ? 0.12 : 0.18;
          stormFireCd -= dt;
          stormAngle  += dt * 2.5;
          if (stormFireCd <= 0) {
            stormFireCd = stormInterval;
            const n = phase2() ? 6 : 4;
            for (let i = 0; i < n; i++) {
              const a = stormAngle + (i / n) * Math.PI * 2;
              fireEnemyBullet(
                group.position.clone(),
                group.position.clone().add(new THREE.Vector3(Math.cos(a) * 30, 0, Math.sin(a) * 30)),
              );
            }
          }
          if (timer >= stormDur) {
            group.rotation.y = 0;
            pattern = 'patternA'; timer = 0; shootTimer = 0.5;
          }
        }
        break;
      }

      // ── 死亡演出 ──────────────────────────────────────────────────────────
      case 'dying':
        dyingTimer += dt;
        if (dyingTimer < 2.5) {
          if (Math.floor(dyingTimer * 6) % 2 === 0) {
            const off = new THREE.Vector3(
              (Math.random() - 0.5) * 10,
              (Math.random() - 0.5) * 6,
              (Math.random() - 0.5) * 6,
            );
            spawnExplosion(group.position.clone().add(off), 8, 0xff6600);
          }
          group.rotation.z += dt * 0.8;
          group.rotation.x += dt * 0.4;
        } else {
          spawnExplosion(group.position.clone(), 30, 0xffaa00);
          scene.remove(group);
          scene.remove(warnLine);
          scene.remove(beam);
          alive = false;
          onDead();
        }
        break;
    }
  }

  function damage(dmg: number): void {
    if (!alive || pattern === 'dying' || isShielded) return;
    hp = Math.max(0, hp - dmg);
    (core.material as THREE.MeshBasicMaterial).color.setHex(hp > cfg.hp / 2 ? cfg.coreColor : 0xff2200);
    if (hp <= 0) {
      pattern = 'dying'; timer = 0; dyingTimer = 0; isShielded = false;
      warnLine.visible = false; beam.visible = false;
    }
  }

  function reset(): void {
    scene.remove(group);
    scene.remove(warnLine);
    scene.remove(beam);
  }

  return {
    group, core,
    get hp()           { return hp; },
    get alive()        { return alive; },
    get isFiringBeam() { return pattern === 'special_fire' && cfg.special === 'beam'; },
    get beamX()        { return beamX; },
    get isShielded()   { return isShielded; },
    radius:     BODY_RADIUS,
    coreRadius: CORE_RADIUS,
    update, damage, reset,
  };
}
