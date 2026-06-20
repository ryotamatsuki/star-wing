import * as THREE from 'three';
import { isDown } from './input';
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
import { setScore, setShield, setStage, showMessage, hideMessage, updateHUD, triggerShake } from './hud';
import { updateObstacles, getObstacles, resetObstacles, setStageTheme, setSceneBackground } from './terrain';
import { updateItems, getItems, resetItems, ITEM_RADIUS, HEAL_AMOUNT } from './items';
import { sfxLaser, sfxExplosion, sfxHit, sfxWarning, sfxClear, sfxShieldLow, sfxPickup } from './audio';

const MAX_SHIELD    = 100;
const PLAYER_RADIUS = 1.5;
const BULLET_RADIUS = 0.5;
const BEAM_HALF_W   = 1.8;
const TOTAL_STAGES  = 5;

// ステージごとの敵速度倍率
const STAGE_SPEED_MULTS = [1.0, 1.2, 1.35, 1.55, 1.8];

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

    showMessage('STAR WING\n\n[ SPACE ] START\n[ V ] VIEW');
    setShield(MAX_SHIELD, MAX_SHIELD);
    setScore(0);
    setStage(1);
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
    if (isDown('Space') && this.fireTimer <= 0) {
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
      this.state        = 'boss_warning';
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
      this.state = 'boss';
      this.boss  = createBoss(this.scene, () => this.onBossDead(), this.currentStage);
    }
  }

  // ── ボス戦 ────────────────────────────────────────────────────────────────
  private updateBoss(dt: number): void {
    if (!this.boss) return;
    this.boss.update(dt, this.player.group.position);

    const pBullets = getPlayerBullets();

    // 自弾 × ボス本体
    for (const b of pBullets) {
      if (sphereHit(b.mesh.position, BULLET_RADIUS, this.boss.group.position, this.boss.radius)) {
        killBullet(b);
        if (this.boss.isShielded) {
          spawnExplosion(b.mesh.position.clone(), 3, 0x88ddff); // シールド弾き
        } else {
          this.boss.damage(1);
          this.addScore(50);
          if (this.bossHitSoundCd <= 0) { sfxHit(); this.bossHitSoundCd = 0.12; }
        }
      }
    }

    // 自弾 × コア(弱点: 3x ダメージ)
    for (const b of pBullets) {
      const coreWorld = this.boss.core.getWorldPosition(new THREE.Vector3());
      if (sphereHit(b.mesh.position, BULLET_RADIUS, coreWorld, this.boss.coreRadius)) {
        killBullet(b);
        if (!this.boss.isShielded) {
          this.boss.damage(3);
          this.addScore(150);
          spawnExplosion(coreWorld, 5, 0xffaa00);
          sfxExplosion(false);
        }
      }
    }

    this.checkEnemyHitsVsPlayer();

    // レーザービーム判定
    if (this.hitFlash <= 0 && !this.player.isRolling && this.boss.isFiringBeam) {
      if (Math.abs(this.player.group.position.x - this.boss.beamX) < BEAM_HALF_W) {
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
    if (this.currentStage < TOTAL_STAGES) {
      this.state           = 'stage_clear';
      this.stageClearTimer = 4.5;
      setTimeout(() => {
        showMessage(
          `STAGE ${this.currentStage} CLEAR!\n\nPREPARE FOR\nSTAGE ${this.currentStage + 1}`,
        );
      }, 400);
    } else {
      this.state = 'clear';
      setTimeout(() => {
        sfxClear();
        showMessage(`MISSION COMPLETE!\n\nFINAL SCORE: ${this.score}\n\n[ SPACE ] TITLE`);
      }, 500);
    }
  }

  // ── 次ステージ開始 ────────────────────────────────────────────────────────
  private startNextStage(): void {
    this.currentStage++;
    setStage(this.currentStage);
    setStageWaves(this.currentStage);
    setEnemySpeedMult(STAGE_SPEED_MULTS[this.currentStage - 1]);
    setStageTheme(this.currentStage);
    setSceneBackground(this.scene, this.currentStage);

    this.state        = 'playing';
    this.stageTime    = 0;
    this.fireTimer    = 0;
    this.hitFlash     = 0;
    this.warningTimer = 0;
    this.muzzleFlash.visible = false;
    this.muzzleLife   = 0;
    this.bossHitSoundCd = 0;

    this.boss?.reset();
    this.boss = null;
    resetEnemies();
    resetObstacles();
    resetItems();
    clearBullets();
    clearEffects();
    hideMessage();

    showMessage(`STAGE ${this.currentStage}`);
    setTimeout(() => hideMessage(), 2500);
  }

  // ── 共通: 自弾 × 通常敵 ──────────────────────────────────────────────────
  private checkPlayerBulletsVsEnemies(): void {
    const pBullets = getPlayerBullets();
    const enemies  = getEnemies();
    for (const b of pBullets) {
      for (const e of enemies) {
        if (!e.alive) continue;
        if (sphereHit(b.mesh.position, BULLET_RADIUS, e.group.position, e.radius)) {
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
      if (sphereHit(b.mesh.position, BULLET_RADIUS, this.player.group.position, PLAYER_RADIUS)) {
        killBullet(b);
        this.takeDamage(15);
        return;
      }
    }

    for (const e of getEnemies()) {
      if (!e.alive) continue;
      if (sphereHit(e.group.position, e.radius, this.player.group.position, PLAYER_RADIUS)) {
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
        if (d < col.r + PLAYER_RADIUS) {
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
    triggerShake(dmg / 30);
    spawnExplosion(this.player.group.position.clone(), 6, 0xff2200);
    sfxHit();
    this.hitFlash = 0.8;

    if (this.shield <= 0) {
      spawnExplosion(this.player.group.position.clone(), 20, 0xff6600);
      sfxExplosion(true);
      this.state = 'gameover';
      showMessage(`GAME OVER\n\nSCORE: ${this.score}\n\n[ SPACE ] TITLE`);
    }
  }

  private addScore(n: number): void {
    this.score += n;
    setScore(this.score);
  }

  // ── ゲーム開始 ────────────────────────────────────────────────────────────
  private startGame(): void {
    this.currentStage   = 1;
    this.state          = 'playing';
    this.score          = 0;
    this.shield         = MAX_SHIELD;
    this.stageTime      = 0;
    this.fireTimer      = 0;
    this.hitFlash       = 0;
    this.warningTimer   = 0;
    this.muzzleFlash.visible = false;
    this.muzzleLife     = 0;
    this.bossHitSoundCd = 0;
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
    this.state = 'title';
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
    showMessage('STAR WING\n\n[ SPACE ] START\n[ V ] VIEW');
  }
}
