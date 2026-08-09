import * as THREE from 'three';
import { isAutoFireEnabled, isDown } from './input';
import { Player } from './player';
import { Boss, createBoss } from './boss';
import {
  updateBullets, firePlayerBullet,
  getPlayerBullets, getEnemyBullets,
  killBullet, clearBullets,
} from './bullets';
import {
  updateEnemies, getEnemies, damageEnemy, resetEnemies,
  allWavesCleared, setStageWaves, setEnemySpeedMult,
} from './enemies';
import { updateEffects, spawnExplosion, clearEffects, spawnScorePopup, spawnTextPopup } from './effects';
import { sphereHit } from './collision';
import {
  setScore, setShield, setStage, showMessage, hideMessage,
  showBossHud, updateBossHud, hideBossHud, updateHUD, triggerShake,
} from './hud';
import { updateObstacles, getObstacles, resetObstacles, setStageTheme, setSceneBackground } from './terrain';
import { updateItems, getItems, resetItems, ITEM_RADIUS, HEAL_AMOUNT } from './items';
import { sfxLaser, sfxExplosion, sfxHit, sfxWarning, sfxClear, sfxShieldLow, sfxPickup } from './audio';
import { isTouchActive } from './touch';

// タイトル画面の操作説明(キーボード / タッチで切替)
const TITLE_MSG = () =>
  isTouchActive()
    ? 'STAR WING\n\nLEFT DRAG: MOVE\nROLL: EVADE\nAUTO FIRE: ON\n\n[ START ]'
    : 'STAR WING\n\n[ SPACE ] START\n[ V ] VIEW';

// 「タイトルへ戻る」操作の表記
const BACK_KEY = () => (isTouchActive() ? '[ TITLE ]' : '[ SPACE ] TITLE');

const MAX_SHIELD    = 100;
const PLAYER_RADIUS_PC = 1.5;
const PLAYER_RADIUS_TOUCH = 1.35;
const PLAYER_BULLET_RADIUS_PC = 0.5;
const PLAYER_BULLET_RADIUS_TOUCH = 0.56;
const ENEMY_BULLET_RADIUS = 0.5;
const BOSS_CHARGE_DAMAGE = 30;
const TOTAL_STAGES  = 5;

// ステージごとの敵速度倍率
const STAGE_SPEED_MULTS = [1.0, 1.2, 1.35, 1.55, 1.8];

function getPlayerRadius(): number {
  return isTouchActive() ? PLAYER_RADIUS_TOUCH : PLAYER_RADIUS_PC;
}

function getPlayerBulletRadius(): number {
  return isTouchActive() ? PLAYER_BULLET_RADIUS_TOUCH : PLAYER_BULLET_RADIUS_PC;
}

export type GameState = 'title' | 'playing' | 'boss_warning' | 'boss' | 'stage_clear' | 'gameover' | 'clear';

export class Game {
  state: GameState = 'title';

  private score          = 0;
  private shield         = MAX_SHIELD;
  private stageTime      = 0;
  private fireTimer      = 0;
  private hitFlash       = 0;
  private warningTimer   = 0;
  private currentStage   = 1;
  private stageClearTimer = 0;
  private boss: Boss | null = null;
  private prevSpace      = false;
  private lastChargeId   = -1;
  private pendingMessageTimers = new Set<number>();

  // フェーズ5: 演出
  private muzzleFlash:    THREE.Mesh;
  private muzzleLife      = 0;
  private shieldLowTimer  = 0;
  private bossHitSoundCd  = 0;

  constructor(
    private player: Player,
    private camera: THREE.PerspectiveCamera,
    private scene:  THREE.Scene,
  ) {
    // マズルフラッシュ
    this.muzzleFlash = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0x88ffcc }),
    );
    this.muzzleFlash.visible = false;
    scene.add(this.muzzleFlash);

    showMessage(TITLE_MSG());
    setShield(MAX_SHIELD, MAX_SHIELD);
    setScore(0);
    setStage(1);
    hideBossHud();
    dispatchEvent(new CustomEvent<GameState>('game:state', { detail: this.state }));
  }

  private setState(next: GameState): void {
    if (this.state === next) return;
    this.state = next;
    dispatchEvent(new CustomEvent<GameState>('game:state', { detail: next }));
  }

  private scheduleMessage(callback: () => void, delay: number): void {
    const timer = window.setTimeout(() => {
      this.pendingMessageTimers.delete(timer);
      callback();
    }, delay);
    this.pendingMessageTimers.add(timer);
  }

  private clearPendingMessageTimers(): void {
    for (const timer of this.pendingMessageTimers) window.clearTimeout(timer);
    this.pendingMessageTimers.clear();
  }

  update(dt: number): void {
    updateHUD(dt, this.camera.position);

    // マズルフラッシュ
    if (this.muzzleLife > 0) {
      this.muzzleLife -= dt;
      if (this.muzzleLife <= 0) this.muzzleFlash.visible = false;
    }

    const spaceNow   = isDown('Space');
    const spaceFresh = spaceNow && !this.prevSpace;
    this.prevSpace   = spaceNow;

    if (this.state === 'title') {
      if (spaceFresh) this.startGame();
      return;
    }

    if (this.state === 'gameover' || this.state === 'clear') {
      if (spaceFresh) this.resetToTitle();
      return;
    }

    this.hitFlash       = Math.max(0, this.hitFlash - dt);
    this.bossHitSoundCd = Math.max(0, this.bossHitSoundCd - dt);

    // ── 射撃 ──────────────────────────────────────────────────────────────
    this.fireTimer -= dt;
    const autoFire = isAutoFireEnabled() && (this.state === 'playing' || this.state === 'boss');
    if ((isDown('Space') || autoFire) && this.fireTimer <= 0) {
      const origin = this.player.group.position.clone();
      origin.z -= 2;
      firePlayerBullet(origin);
      sfxLaser();
      this.muzzleFlash.position.set(
        this.player.group.position.x,
        this.player.group.position.y + 0.3,
        this.player.group.position.z - 3.5,
      );
      this.muzzleFlash.visible = true;
      this.muzzleLife  = 0.04;
      this.fireTimer   = 0.13;
    }

    // ── シールド低下ビープ ────────────────────────────────────────────────
    if (this.shield < MAX_SHIELD * 0.3 && this.shield > 0) {
      this.shieldLowTimer -= dt;
      if (this.shieldLowTimer <= 0) { sfxShieldLow(); this.shieldLowTimer = 1.5; }
    } else {
      this.shieldLowTimer = 0;
    }

    updateBullets(dt);
    updateEffects(dt);

    if (this.state === 'playing') {
      this.stageTime += dt;
      this.updatePlaying(dt);
    } else if (this.state === 'boss_warning') {
      this.updateBossWarning(dt);
    } else if (this.state === 'boss') {
      this.updateBoss(dt);
    } else if (this.state === 'stage_clear') {
      this.updateStageClear(dt);
    }
  }

  // ── 通常ステージ ──────────────────────────────────────────────────────────
  private updatePlaying(dt: number): void {
    updateEnemies(dt, this.stageTime, this.player.group.position);
    updateObstacles(dt);
    updateItems(dt);

    this.checkPlayerBulletsVsEnemies();
    this.checkEnemyHitsVsPlayer();
    this.checkObstaclesVsPlayer();
    this.checkItemsVsPlayer();

    if (allWavesCleared()) {
      resetObstacles();
      this.setState('boss_warning');
      this.warningTimer = 0;
      showMessage('!! WARNING !!');
      sfxWarning();
    }
  }

  // ── ボス登場警告 ──────────────────────────────────────────────────────────
  private updateBossWarning(dt: number): void {
    this.warningTimer += dt;
    if (this.warningTimer >= 3) {
      hideMessage();
      this.setState('boss');
      this.boss  = createBoss(this.scene, () => this.onBossDead(), this.currentStage);
      this.lastChargeId = -1;
      showBossHud(this.boss.hp, this.boss.maxHp);
    }
  }

  // ── ボス戦 ────────────────────────────────────────────────────────────────
  private updateBoss(dt: number): void {
    if (!this.boss) return;
    this.boss.update(dt, this.player.group.position);
    if (!this.boss.alive) return;

    if (this.boss.hp <= 0) hideBossHud();
    else updateBossHud(this.boss.hp, this.boss.maxHp);

    const pBullets = getPlayerBullets();
    const coreWorld = this.boss.core.getWorldPosition(new THREE.Vector3());

    // Core is checked first so one bullet cannot score both a weak-point and body hit.
    for (const b of pBullets) {
      if (this.boss.hp <= 0) break;
      if (sphereHit(b.mesh.position, getPlayerBulletRadius(), coreWorld, this.boss.coreRadius)) {
        killBullet(b);
        if (this.boss.isShielded) {
          spawnExplosion(b.mesh.position.clone(), 3, 0x88ddff); // シールド弾き
        } else {
          this.boss.damage(3);
          this.addScore(150);
          spawnExplosion(coreWorld, 5, 0xffaa00);
          sfxExplosion(false);
        }
        continue;
      }

      if (sphereHit(b.mesh.position, getPlayerBulletRadius(), this.boss.group.position, this.boss.radius)) {
        killBullet(b);
        if (this.boss.isShielded) {
          spawnExplosion(b.mesh.position.clone(), 3, 0x88ddff);
        } else {
          this.boss.damage(1);
          this.addScore(50);
          if (this.bossHitSoundCd <= 0) { sfxHit(); this.bossHitSoundCd = 0.12; }
        }
      }
    }

    this.checkEnemyHitsVsPlayer();

    if (
      this.hitFlash <= 0
      && !this.player.isRolling
      && this.boss.isCharging
      && this.boss.chargeId !== this.lastChargeId
      && sphereHit(this.boss.group.position, this.boss.radius, this.player.group.position, getPlayerRadius())
    ) {
      this.lastChargeId = this.boss.chargeId;
      this.takeDamage(BOSS_CHARGE_DAMAGE);
    }

    // レーザービーム判定
    if (this.hitFlash <= 0 && !this.player.isRolling && this.boss.isFiringBeam) {
      const hitX = Math.abs(this.player.group.position.x - this.boss.beamX)
        < this.boss.beamHalfWidth + getPlayerRadius();
      const hitY = Math.abs(this.player.group.position.y - this.boss.beamY)
        < this.boss.beamHalfHeight + getPlayerRadius();
      if (hitX && hitY) {
        this.takeDamage(25);
      }
    }
  }

  // ── ステージクリア待機(次ステージへ) ─────────────────────────────────────
  private updateStageClear(dt: number): void {
    this.stageClearTimer -= dt;
    if (this.stageClearTimer <= 0) this.startNextStage();
  }

  // ── ボス撃破 ──────────────────────────────────────────────────────────────
  private onBossDead(): void {
    sfxExplosion(true);
    hideBossHud();
    this.clearPendingMessageTimers();
    if (this.currentStage < TOTAL_STAGES) {
      this.setState('stage_clear');
      this.stageClearTimer = 4.5;
      this.scheduleMessage(() => {
        showMessage(
          `STAGE ${this.currentStage} CLEAR!\n\nPREPARE FOR\nSTAGE ${this.currentStage + 1}`,
        );
      }, 400);
    } else {
      this.setState('clear');
      this.scheduleMessage(() => {
        sfxClear();
        showMessage(`MISSION COMPLETE!\n\nFINAL SCORE: ${this.score}\n\n${BACK_KEY()}`);
      }, 500);
    }
  }

  // ── 次ステージ開始 ────────────────────────────────────────────────────────
  private startNextStage(): void {
    this.clearPendingMessageTimers();
    this.currentStage++;
    setStage(this.currentStage);
    setStageWaves(this.currentStage);
    setEnemySpeedMult(STAGE_SPEED_MULTS[this.currentStage - 1]);
    setStageTheme(this.currentStage);
    setSceneBackground(this.scene, this.currentStage);

    this.setState('playing');
    this.stageTime    = 0;
    this.fireTimer    = 0;
    this.hitFlash     = 0;
    this.warningTimer = 0;
    this.muzzleFlash.visible = false;
    this.muzzleLife   = 0;
    this.bossHitSoundCd = 0;
    this.lastChargeId = -1;

    this.boss?.reset();
    this.boss = null;
    hideBossHud();
    resetEnemies();
    resetObstacles();
    resetItems();
    clearBullets();
    clearEffects();
    hideMessage();

    showMessage(`STAGE ${this.currentStage}`);
    this.scheduleMessage(() => hideMessage(), 2500);
  }

  // ── 共通: 自弾 × 通常敵 ──────────────────────────────────────────────────
  private checkPlayerBulletsVsEnemies(): void {
    const pBullets = getPlayerBullets();
    const enemies  = getEnemies();
    for (const b of pBullets) {
      for (const e of enemies) {
        if (!e.alive) continue;
        if (sphereHit(b.mesh.position, getPlayerBulletRadius(), e.group.position, e.radius)) {
          killBullet(b);
          damageEnemy(e, 1);
          if (!e.alive) {
            const pts = e.type === 'turret' ? 500 : e.type === 'sine' ? 200 : 100;
            this.addScore(pts);
            spawnScorePopup(e.group.position.clone(), pts);
            sfxExplosion(false);
          }
          break;
        }
      }
    }
  }

  // ── 共通: 敵弾・敵 × 自機 ────────────────────────────────────────────────
  private checkEnemyHitsVsPlayer(): void {
    if (this.hitFlash > 0 || this.player.isRolling) return;

    for (const b of getEnemyBullets()) {
      if (sphereHit(b.mesh.position, ENEMY_BULLET_RADIUS, this.player.group.position, getPlayerRadius())) {
        killBullet(b);
        this.takeDamage(15);
        return;
      }
    }

    for (const e of getEnemies()) {
      if (!e.alive) continue;
      if (sphereHit(e.group.position, e.radius, this.player.group.position, getPlayerRadius())) {
        damageEnemy(e, 999);
        this.takeDamage(30);
        return;
      }
    }
  }

  // ── 回復アイテム × 自機 ───────────────────────────────────────────────────
  private checkItemsVsPlayer(): void {
    const pp = this.player.group.position;
    for (const item of getItems()) {
      if (item.collected) continue;
      const d = pp.distanceTo(item.group.position);
      if (d < ITEM_RADIUS + 1.5) {
        item.collected = true;
        this.shield = Math.min(MAX_SHIELD, this.shield + HEAL_AMOUNT);
        setShield(this.shield, MAX_SHIELD);
        sfxPickup();
        spawnTextPopup(item.group.position.clone(), `+${HEAL_AMOUNT} HP`, '#44ff99');
      }
    }
  }

  // ── 障害物 × 自機 ─────────────────────────────────────────────────────────
  private checkObstaclesVsPlayer(): void {
    if (this.hitFlash > 0 || this.player.isRolling) return;
    const px = this.player.group.position.x;
    const py = this.player.group.position.y;
    const pz = this.player.group.position.z;
    for (const obs of getObstacles()) {
      for (const col of obs.colliders) {
        const d = Math.sqrt(
          (px - col.wx) ** 2 + (py - col.wy) ** 2 + (pz - obs.group.position.z) ** 2,
        );
        if (d < col.r + getPlayerRadius()) {
          this.takeDamage(20);
          return;
        }
      }
    }
  }

  // ── ダメージ ───────────────────────────────────────────────────────────────
  private takeDamage(dmg: number): void {
    this.shield = Math.max(0, this.shield - dmg);
    setShield(this.shield, MAX_SHIELD);
    triggerShake((dmg / 30) * (isTouchActive() ? 0.5 : 1));
    spawnExplosion(this.player.group.position.clone(), 6, 0xff2200);
    sfxHit();
    this.hitFlash = 0.8;

    if (this.shield <= 0) {
      this.clearPendingMessageTimers();
      hideBossHud();
      spawnExplosion(this.player.group.position.clone(), 20, 0xff6600);
      sfxExplosion(true);
      this.setState('gameover');
      showMessage(`GAME OVER\n\nSCORE: ${this.score}\n\n${BACK_KEY()}`);
    }
  }

  private addScore(n: number): void {
    this.score += n;
    setScore(this.score);
  }

  // ── ゲーム開始 ────────────────────────────────────────────────────────────
  private startGame(): void {
    this.clearPendingMessageTimers();
    hideBossHud();
    this.currentStage   = 1;
    this.setState('playing');
    this.score          = 0;
    this.shield         = MAX_SHIELD;
    this.stageTime      = 0;
    this.fireTimer      = 0;
    this.hitFlash       = 0;
    this.warningTimer   = 0;
    this.muzzleFlash.visible = false;
    this.muzzleLife     = 0;
    this.bossHitSoundCd = 0;
    this.lastChargeId   = -1;
    this.shieldLowTimer = 0;

    setScore(0);
    setShield(MAX_SHIELD, MAX_SHIELD);
    setStage(1);
    setStageWaves(1);
    setEnemySpeedMult(STAGE_SPEED_MULTS[0]);
    setStageTheme(1);
    setSceneBackground(this.scene, 1);
    hideMessage();
    this.player.reset();
    this.boss?.reset();
    this.boss = null;
    resetEnemies();
    resetObstacles();
    resetItems();
    clearBullets();
    clearEffects();
  }

  // ── タイトルへ ────────────────────────────────────────────────────────────
  private resetToTitle(): void {
    this.clearPendingMessageTimers();
    hideBossHud();
    this.setState('title');
    setScore(0);
    setShield(MAX_SHIELD, MAX_SHIELD);
    setStage(1);
    setStageTheme(1);
    setSceneBackground(this.scene, 1);
    this.boss?.reset();
    this.boss = null;
    resetEnemies();
    resetObstacles();
    resetItems();
    clearBullets();
    clearEffects();
    this.player.reset();
    showMessage(TITLE_MSG());
  }
}
