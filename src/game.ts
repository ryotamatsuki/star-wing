import * as THREE from 'three';
import { isAutoFireEnabled, isDown } from './input';
import { Player } from './player';
import { createPlayerWeaponController, PlayerWeaponController } from './player-weapons';
import { Boss, createBoss } from './boss';
import {
  updateBullets,
  getPlayerBullets, getEnemyBullets,
  killBullet, clearBullets,
} from './bullets';
import {
  updateEnemies, getEnemies, resetEnemies,
  allWavesCleared, setStageWaves, setEnemySpeedMult, getLockCandidates,
  resolvePlayerBulletHit, forceDestroyEnemy,
} from './enemies';
import {
  updateEffects, spawnExplosion, clearEffects, spawnScorePopup, spawnTextPopup,
  spawnPartDestroyFeedback, spawnCoreExposeFeedback, spawnCoreHitFeedback,
} from './effects';
import { sphereHit } from './collision';
import {
  setScore, setShield, setStage, showMessage, hideMessage,
  showBossHud, updateBossHud, hideBossHud, updateHUD, triggerShake,
  clearCombatAlerts, updateFlightPaceHud,
} from './hud';
import { updateObstacles, getObstacles, resetObstacles, setStageTheme, setSceneBackground } from './terrain';
import { updateItems, getItems, resetItems, ITEM_RADIUS, HEAL_AMOUNT } from './items';
import {
  updateEnginePace, sfxExplosion, sfxHit, sfxWarning, sfxClear, sfxShieldLow, sfxPickup,
  sfxPartDestroy, sfxCoreExpose, sfxCoreHit,
} from './audio';
import { isTouchActive } from './touch';
import { flightPace } from './flight-pace';

// タイトル画面の操作説明(キーボード / タッチで切替)
const TITLE_MSG = () =>
  isTouchActive()
    ? 'STAR WING\n\nLEFT DRAG: MOVE\nROLL: EVADE\nAUTO FIRE: ON\n\n[ START ]'
    : 'STAR WING\n\n[ SPACE ] START\n[ C / SHIFT ] CHARGE\n[ V ] VIEW';

// 「タイトルへ戻る」操作の表記
const BACK_KEY = () => (isTouchActive() ? '[ TITLE ]' : '[ SPACE ] TITLE');
const RETRY_KEY = () => (isTouchActive() ? '[ RETRY ]' : '[ SPACE ] RETRY');

const MAX_SHIELD    = 100;
const PLAYER_RADIUS_PC = 1.5;
const PLAYER_RADIUS_TOUCH = 1.35;
const PLAYER_BULLET_RADIUS_PC = 0.5;
const PLAYER_BULLET_RADIUS_TOUCH = 0.56;
const ENEMY_BULLET_RADIUS = 0.5;
const BOSS_CHARGE_DAMAGE = 30;
const BOSS_CHARGE_DAMAGE_MULTIPLIER = 0.5;
const CHARGE_BULLET_RADIUS_MULTIPLIER = 1.45;
const TOTAL_STAGES  = 5;

// ステージごとの敵速度倍率
const STAGE_SPEED_MULTS = [1.0, 1.2, 1.35, 1.55, 1.8];

function getPlayerRadius(): number {
  return isTouchActive() ? PLAYER_RADIUS_TOUCH : PLAYER_RADIUS_PC;
}

function getPlayerBulletRadius(kind?: 'normal' | 'charge' | 'lock'): number {
  const base = isTouchActive() ? PLAYER_BULLET_RADIUS_TOUCH : PLAYER_BULLET_RADIUS_PC;
  return kind === 'charge' ? base * CHARGE_BULLET_RADIUS_MULTIPLIER : base;
}

export type GameState = 'title' | 'playing' | 'boss_warning' | 'boss' | 'stage_clear' | 'gameover' | 'clear';

export class Game {
  state: GameState = 'title';

  private score          = 0;
  private stageStartScore = 0;
  private shield         = MAX_SHIELD;
  private stageTime      = 0;
  private hitFlash       = 0;
  private warningTimer   = 0;
  private currentStage   = 1;
  private stageClearTimer = 0;
  private boss: Boss | null = null;
  private prevSpace      = false;
  private lastChargeId   = -1;
  private pendingMessageTimers = new Set<number>();
  private weapon: PlayerWeaponController;

  // フェーズ5: 演出
  private shieldLowTimer  = 0;
  private bossHitSoundCd  = 0;

  constructor(
    private player: Player,
    private camera: THREE.PerspectiveCamera,
    private scene:  THREE.Scene,
  ) {
    // マズルフラッシュ
    this.weapon = createPlayerWeaponController(scene, player.group, { getLockCandidates });

    addEventListener('combat:enemy-part-destroyed', event => {
      const detail = (event as CustomEvent<{
        score?: number;
        position?: THREE.Vector3;
        partId?: string;
      }>).detail;
      const position = detail.position instanceof THREE.Vector3
        ? detail.position
        : new THREE.Vector3();
      if ((detail.score ?? 0) > 0) {
        this.addScore(detail.score!);
        spawnScorePopup(position, detail.score!);
      }
      spawnPartDestroyFeedback(position);
      sfxPartDestroy();
    });
    addEventListener('combat:enemy-core-exposed', event => {
      const detail = (event as CustomEvent<{ position?: THREE.Vector3 }>).detail;
      const position = detail.position instanceof THREE.Vector3
        ? detail.position
        : new THREE.Vector3();
      spawnCoreExposeFeedback(position);
      sfxCoreExpose();
    });
    addEventListener('combat:enemy-root-destroyed', event => {
      const detail = (event as CustomEvent<{
        reason?: string;
        score?: number;
        position?: THREE.Vector3;
      }>).detail;
      if (detail.reason === 'force') return;
      const position = detail.position instanceof THREE.Vector3
        ? detail.position
        : new THREE.Vector3();
      if ((detail.score ?? 0) > 0) {
        this.addScore(detail.score!);
        spawnScorePopup(position, detail.score!);
      }
      sfxExplosion(false);
    });
    addEventListener('combat:enemy-hit', event => {
      const detail = (event as CustomEvent<{
        partId?: string;
        position?: THREE.Vector3;
      }>).detail;
      if (detail.partId !== 'core') return;
      const position = detail.position instanceof THREE.Vector3
        ? detail.position
        : new THREE.Vector3();
      spawnCoreHitFeedback(position);
      sfxCoreHit();
    });

    const resetPaceForPageState = (): void => this.resetFlightPace();
    addEventListener('blur', resetPaceForPageState);
    addEventListener('pagehide', resetPaceForPageState);
    addEventListener('orientationchange', resetPaceForPageState);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) resetPaceForPageState();
    });

    showMessage(TITLE_MSG());
    setShield(MAX_SHIELD, MAX_SHIELD);
    setScore(0);
    setStage(1);
    hideBossHud();
    dispatchEvent(new CustomEvent<GameState>('game:state', { detail: this.state }));
  }

  private setState(next: GameState): void {
    if (this.state === next) return;
    if (next !== 'playing' && next !== 'boss') this.weapon.cancelCharge(true);
    if (next !== 'playing') this.resetFlightPace();
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

  private resetFlightPace(): void {
    flightPace.reset();
    this.applyFlightPaceFeedback();
  }

  private applyFlightPaceFeedback(): void {
    const targetFov = this.state === 'playing' ? flightPace.fov : 70;
    const fovDelta = targetFov - this.camera.fov;
    if (Math.abs(fovDelta) > 0.01) {
      this.camera.fov += fovDelta * 0.18;
      this.camera.updateProjectionMatrix();
    }
    updateFlightPaceHud(flightPace.state, flightPace.multiplier);
    updateEnginePace(flightPace.multiplier, this.state === 'playing');
  }

  updateFlightPace(dt: number): void {
    const enabled = this.state === 'playing';
    flightPace.update(dt, {
      boost: enabled && isDown('KeyE'),
      brake: enabled && isDown('KeyQ'),
      enabled,
    });
    this.applyFlightPaceFeedback();
  }

  update(dt: number): void {
    updateHUD(dt, this.camera.position);

    // マズルフラッシュ
    const spaceNow   = isDown('Space');
    const spaceFresh = spaceNow && !this.prevSpace;
    this.prevSpace   = spaceNow;

    if (this.state === 'title') {
      if (spaceFresh) this.startGame();
      return;
    }

    if (this.state === 'gameover') {
      if (spaceFresh) this.restartCurrentStage();
      return;
    }

    if (this.state === 'clear') {
      if (spaceFresh) this.resetToTitle();
      return;
    }

    this.hitFlash       = Math.max(0, this.hitFlash - dt);
    this.bossHitSoundCd = Math.max(0, this.bossHitSoundCd - dt);

    // ── 射撃 ──────────────────────────────────────────────────────────────
    const autoFire = isAutoFireEnabled() && (this.state === 'playing' || this.state === 'boss');
    this.weapon.update(dt, {
      normalFire: isDown('Space'),
      autoFire,
      charge: isDown('KeyC') || isDown('ShiftLeft') || isDown('ShiftRight'),
      active: this.state === 'playing' || this.state === 'boss',
    });

    // ── シールド低下ビープ ────────────────────────────────────────────────
    if (this.shield < MAX_SHIELD * 0.3 && this.shield > 0) {
      this.shieldLowTimer -= dt;
      if (this.shieldLowTimer <= 0) { sfxShieldLow(); this.shieldLowTimer = 1.5; }
    } else {
      this.shieldLowTimer = 0;
    }

    updateBullets(dt, this.player.group.position, this.player.isRolling);
    updateEffects(dt);

    if (this.state === 'playing') {
      this.stageTime += dt * flightPace.multiplier;
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
    updateEnemies(dt, this.stageTime, this.player.group.position, flightPace.multiplier);
    updateObstacles(dt);
    updateItems(dt);

    this.checkPlayerBulletsVsEnemies();
    this.checkEnemyHitsVsPlayer();
    this.checkObstaclesVsPlayer();
    this.checkItemsVsPlayer();

    if (allWavesCleared()) {
      resetObstacles();
      // Do not carry lock-on projectiles from the final encounter into the
      // separate boss collision system. Their targets may have just been
      // destroyed in the same frame.
      clearBullets();
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
      if (sphereHit(b.mesh.position, getPlayerBulletRadius(b.kind), coreWorld, this.boss.coreRadius)) {
        killBullet(b);
        if (this.boss.isShielded) {
          spawnExplosion(b.mesh.position.clone(), 3, 0x88ddff); // シールド弾き
        } else {
          this.boss.damage(b.damage * 3 * (b.kind === 'charge' ? BOSS_CHARGE_DAMAGE_MULTIPLIER : 1));
          this.addScore(150);
          spawnExplosion(coreWorld, 5, 0xffaa00);
          sfxExplosion(false);
        }
        continue;
      }

      if (sphereHit(b.mesh.position, getPlayerBulletRadius(b.kind), this.boss.group.position, this.boss.radius)) {
        killBullet(b);
        if (this.boss.isShielded) {
          spawnExplosion(b.mesh.position.clone(), 3, 0x88ddff);
        } else {
          this.boss.damage(b.damage * (b.kind === 'charge' ? BOSS_CHARGE_DAMAGE_MULTIPLIER : 1));
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
    this.weapon.reset();
    hideBossHud();
    clearCombatAlerts();
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
    this.resetFlightPace();
    this.stageStartScore = this.score;
    setStage(this.currentStage);
    setStageWaves(this.currentStage);
    setEnemySpeedMult(STAGE_SPEED_MULTS[this.currentStage - 1]);
    setStageTheme(this.currentStage);
    setSceneBackground(this.scene, this.currentStage);

    this.setState('playing');
    this.shield         = MAX_SHIELD;
    this.stageTime    = 0;
    this.hitFlash     = 0;
    this.warningTimer = 0;
    this.weapon.reset();
    this.bossHitSoundCd = 0;
    this.lastChargeId = -1;
    this.shieldLowTimer = 0;
    setShield(MAX_SHIELD, MAX_SHIELD);

    this.boss?.reset();
    this.boss = null;
    hideBossHud();
    clearCombatAlerts();
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
    for (const b of pBullets) {
      const target = b.targetHitTarget as Parameters<typeof resolvePlayerBulletHit>[3] | undefined;
      const result = resolvePlayerBulletHit(
        b.mesh.position,
        getPlayerBulletRadius(b.kind),
        b.damage,
        target,
      );
      if (result?.hit) killBullet(b);
    }
  }

  // ── 共通: 敵弾・敵 × 自機 ────────────────────────────────────────────────
  private checkEnemyHitsVsPlayer(): void {
    if (this.hitFlash > 0 || this.player.isRolling) return;

    for (const b of getEnemyBullets()) {
      if (b.evaded) continue;
      if (sphereHit(b.mesh.position, ENEMY_BULLET_RADIUS, this.player.group.position, getPlayerRadius())) {
        killBullet(b);
        this.takeDamage(b.damage);
        return;
      }
    }

    for (const e of getEnemies()) {
      if (!e.alive) continue;
      if (sphereHit(e.group.position, e.radius, this.player.group.position, getPlayerRadius())) {
        forceDestroyEnemy(e);
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
    this.weapon.cancelCharge(true);
    this.shield = Math.max(0, this.shield - dmg);
    setShield(this.shield, MAX_SHIELD);
    triggerShake((dmg / 30) * (isTouchActive() ? 0.5 : 1));
    spawnExplosion(this.player.group.position.clone(), 6, 0xff2200);
    sfxHit();
    this.hitFlash = 0.8;

    if (this.shield <= 0) {
      this.clearPendingMessageTimers();
      hideBossHud();
      clearCombatAlerts();
      spawnExplosion(this.player.group.position.clone(), 20, 0xff6600);
      sfxExplosion(true);
      this.setState('gameover');
      showMessage(`GAME OVER\n\nSTAGE ${this.currentStage}\nSCORE: ${this.score}\n\n${RETRY_KEY()}`);
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
    clearCombatAlerts();
    this.resetFlightPace();
    this.currentStage   = 1;
    this.setState('playing');
    this.score          = 0;
    this.stageStartScore = 0;
    this.shield         = MAX_SHIELD;
    this.stageTime      = 0;
    this.hitFlash       = 0;
    this.warningTimer   = 0;
    this.weapon.reset();
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

  private restartCurrentStage(): void {
    this.clearPendingMessageTimers();
    hideBossHud();
    clearCombatAlerts();
    this.resetFlightPace();
    this.setState('playing');
    this.shield         = MAX_SHIELD;
    this.stageTime      = 0;
    this.hitFlash       = 0;
    this.warningTimer   = 0;
    this.weapon.reset();
    this.bossHitSoundCd = 0;
    this.lastChargeId   = -1;
    this.shieldLowTimer = 0;

    // Restore the stage-opening checkpoint, then rebuild that stage from its opening state.
    this.score = this.stageStartScore;
    setScore(this.score);
    setShield(MAX_SHIELD, MAX_SHIELD);
    setStage(this.currentStage);
    setStageWaves(this.currentStage);
    setEnemySpeedMult(STAGE_SPEED_MULTS[this.currentStage - 1]);
    setStageTheme(this.currentStage);
    setSceneBackground(this.scene, this.currentStage);
    hideMessage();

    this.player.reset();
    this.boss?.reset();
    this.boss = null;
    resetEnemies();
    resetObstacles();
    resetItems();
    clearBullets();
    clearEffects();

    showMessage(`STAGE ${this.currentStage}`);
    this.scheduleMessage(() => hideMessage(), 2500);
  }

  // ── タイトルへ ────────────────────────────────────────────────────────────
  private resetToTitle(): void {
    this.clearPendingMessageTimers();
    hideBossHud();
    clearCombatAlerts();
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
    this.weapon.reset();
    showMessage(TITLE_MSG());
  }
}
