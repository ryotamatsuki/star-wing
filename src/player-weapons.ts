import * as THREE from 'three';
import { fireChargeBullet, firePlayerBullet, firePlayerHomingVolley } from './bullets';
import { createTargetingController, LockCandidate, TargetingController } from './targeting';
import {
  sfxChargeFire,
  sfxChargeFull,
  sfxChargeReady,
  sfxChargeStart,
  sfxLockAcquire,
  sfxLockVolley,
  sfxLaser,
} from './audio';

export type ChargeState = 'idle' | 'charging' | 'ready' | 'full';

export interface WeaponInput {
  normalFire: boolean;
  autoFire: boolean;
  charge: boolean;
  active: boolean;
}

export interface ChargeStateDetail {
  state: ChargeState;
  progress: number;
  full: boolean;
  lockCount: number;
  maxLocks: number;
}

export interface PlayerWeaponController {
  update(dt: number, input: WeaponInput): void;
  cancelCharge(blockUntilRelease?: boolean): void;
  reset(): void;
  readonly chargeState: ChargeState;
  readonly chargeProgress: number;
  readonly lockCount: number;
}

export interface PlayerWeaponOptions {
  getLockCandidates(): readonly LockCandidate[];
}

export const WEAPON_CONFIG = {
  normalFireInterval: 0.13,
  chargeReadyTime: 0.5,
  chargeFullTime: 1.2,
  normalDamage: 1,
  readyChargeDamage: 4,
  fullChargeDamage: 10,
  readyMaxLocks: 2,
  fullMaxLocks: 4,
  readyLockDamage: 2,
  fullLockDamage: 3,
  lockShotSpeed: 74,
} as const;

const PLAYER_BULLET_COLOR = 0x44ffaa;
const CHARGE_READY_COLOR = 0xffb347;
const CHARGE_FULL_COLOR = 0xffe477;

function getBulletOrigin(playerGroup: THREE.Group): THREE.Vector3 {
  return playerGroup.position.clone().add(new THREE.Vector3(0, 0, -2));
}

export function createPlayerWeaponController(
  scene: THREE.Scene,
  playerGroup: THREE.Group,
  options: PlayerWeaponOptions,
): PlayerWeaponController {
  let fireTimer = 0;
  let chargeTime = 0;
  let state: ChargeState = 'idle';
  let effectTime = 0;
  let chargeBlockedUntilRelease = false;

  const muzzleFlash = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 5, 4),
    new THREE.MeshBasicMaterial({ color: PLAYER_BULLET_COLOR }),
  );
  muzzleFlash.visible = false;
  scene.add(muzzleFlash);
  let muzzleLife = 0;

  const chargeAura = new THREE.Mesh(
    new THREE.TorusGeometry(1.65, 0.09, 6, 24),
    new THREE.MeshBasicMaterial({
      color: CHARGE_READY_COLOR,
      transparent: true,
      opacity: 0.75,
    }),
  );
  chargeAura.rotation.x = Math.PI / 2;
  chargeAura.visible = false;
  playerGroup.add(chargeAura);

  const targeting: TargetingController = createTargetingController(scene, slot => sfxLockAcquire(slot));

  function maxLocksForState(): number {
    if (state === 'full') return WEAPON_CONFIG.fullMaxLocks;
    if (state === 'ready') return WEAPON_CONFIG.readyMaxLocks;
    return 0;
  }

  function progress(): number {
    return Math.max(0, Math.min(1, chargeTime / WEAPON_CONFIG.chargeFullTime));
  }

  function emitChargeState(): void {
    dispatchEvent(new CustomEvent<ChargeStateDetail>('game:charge-state', {
      detail: {
        state,
        progress: progress(),
        full: state === 'full',
        lockCount: targeting.lockCount,
        maxLocks: maxLocksForState(),
      },
    }));
  }

  function setChargeVisual(): void {
    const material = chargeAura.material as THREE.MeshBasicMaterial;
    const chargeProgress = progress();
    chargeAura.visible = state !== 'idle';
    if (!chargeAura.visible) return;

    material.color.setHex(state === 'full' ? CHARGE_FULL_COLOR : CHARGE_READY_COLOR);
    material.opacity = state === 'full'
      ? 0.9 + Math.sin(effectTime * 18) * 0.08
      : 0.4 + chargeProgress * 0.35;
    const scale = state === 'full' ? 1.45 + Math.sin(effectTime * 12) * 0.08 : 1 + chargeProgress * 0.35;
    chargeAura.scale.setScalar(scale);
    chargeAura.rotation.z = effectTime * (state === 'full' ? 2.4 : 1.3);
  }

  function beginCharge(): void {
    targeting.clear();
    state = 'charging';
    chargeTime = 0;
    effectTime = 0;
    sfxChargeStart();
    setChargeVisual();
    emitChargeState();
  }

  function releaseCharge(): void {
    if (state === 'idle') return;
    const fullCharge = state === 'full';
    if (chargeTime >= WEAPON_CONFIG.chargeReadyTime) {
      const origin = getBulletOrigin(playerGroup);
      const lockedTargets = targeting.getLockedTargets();
      const volleyCount = lockedTargets.length > 0
        ? firePlayerHomingVolley(origin, lockedTargets, {
          damage: fullCharge ? WEAPON_CONFIG.fullLockDamage : WEAPON_CONFIG.readyLockDamage,
          speed: WEAPON_CONFIG.lockShotSpeed,
        })
        : 0;
      if (volleyCount > 0) {
        sfxLockVolley(volleyCount, fullCharge);
      } else {
        fireChargeBullet(
          origin,
          fullCharge,
          fullCharge ? WEAPON_CONFIG.fullChargeDamage : WEAPON_CONFIG.readyChargeDamage,
        );
        sfxChargeFire(fullCharge);
      }
      muzzleFlash.position.copy(getBulletOrigin(playerGroup));
      muzzleFlash.scale.setScalar(fullCharge ? 2.2 : 1.65);
      (muzzleFlash.material as THREE.MeshBasicMaterial).color.setHex(
        fullCharge ? CHARGE_FULL_COLOR : CHARGE_READY_COLOR,
      );
      muzzleFlash.visible = true;
      muzzleLife = fullCharge ? 0.12 : 0.08;
    }
    state = 'idle';
    chargeTime = 0;
    chargeAura.visible = false;
    targeting.clear();
    emitChargeState();
  }

  function fireNormal(): void {
    firePlayerBullet(getBulletOrigin(playerGroup), {
      damage: WEAPON_CONFIG.normalDamage,
      kind: 'normal',
      color: PLAYER_BULLET_COLOR,
    });
    sfxLaser();
    muzzleFlash.position.set(
      playerGroup.position.x,
      playerGroup.position.y + 0.3,
      playerGroup.position.z - 3.5,
    );
    muzzleFlash.scale.setScalar(1);
    (muzzleFlash.material as THREE.MeshBasicMaterial).color.setHex(PLAYER_BULLET_COLOR);
    muzzleFlash.visible = true;
    muzzleLife = 0.04;
  }

  function update(dt: number, input: WeaponInput): void {
    effectTime += dt;
    fireTimer -= dt;
    muzzleLife -= dt;
    if (muzzleLife <= 0) muzzleFlash.visible = false;

    if (!input.active) {
      cancelCharge(true);
      return;
    }

    if (input.charge) {
      if (chargeBlockedUntilRelease) return;
      if (state === 'idle') beginCharge();
      if (state !== 'full') {
        chargeTime = Math.min(WEAPON_CONFIG.chargeFullTime, chargeTime + dt);
        if (state === 'charging' && chargeTime >= WEAPON_CONFIG.chargeReadyTime) {
          state = 'ready';
          sfxChargeReady();
        }
        if (chargeTime >= WEAPON_CONFIG.chargeFullTime) {
          state = 'full';
          sfxChargeFull();
        }
      }
      targeting.update(dt, playerGroup.position, options.getLockCandidates(), maxLocksForState());
      setChargeVisual();
      emitChargeState();
      return;
    }

    chargeBlockedUntilRelease = false;

    if (state !== 'idle') {
      releaseCharge();
      return;
    }

    if ((input.normalFire || input.autoFire) && fireTimer <= 0) {
      fireNormal();
      fireTimer = WEAPON_CONFIG.normalFireInterval;
    }
  }

  function cancelCharge(blockUntilRelease = false): void {
    chargeBlockedUntilRelease ||= blockUntilRelease;
    const wasActive = state !== 'idle';
    state = 'idle';
    chargeTime = 0;
    chargeAura.visible = false;
    targeting.clear();
    if (wasActive) emitChargeState();
  }

  function reset(): void {
    fireTimer = 0;
    muzzleLife = 0;
    muzzleFlash.visible = false;
    chargeBlockedUntilRelease = false;
    targeting.clear();
    cancelCharge();
    emitChargeState();
  }

  const cancelForRoll = (): void => cancelCharge(true);
  const resetForPageState = (): void => reset();
  addEventListener('game:roll-start', cancelForRoll);
  addEventListener('blur', resetForPageState);
  addEventListener('pagehide', resetForPageState);
  addEventListener('orientationchange', resetForPageState);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetForPageState();
  });

  return {
    update,
    cancelCharge,
    reset,
    get chargeState() { return state; },
    get chargeProgress() { return progress(); },
    get lockCount() { return targeting.lockCount; },
  };
}
