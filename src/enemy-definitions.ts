import * as THREE from 'three';

export type EnemyType =
  | 'straight'
  | 'sine'
  | 'turret'
  | 'sniper'
  | 'shieldDrone'
  | 'kamikaze'
  | 'missileCarrier'
  | 'mineLayer'
  | 'armoredFighter'
  | 'mine'
  | 'heavyGunship';

export type MovementPatternId =
  | 'straight'
  | 'sine'
  | 'turret'
  | 'sniper'
  | 'shield'
  | 'kamikaze'
  | 'carrier'
  | 'mineLayer'
  | 'armored'
  | 'mine'
  | 'heavy';

export type AttackPatternId =
  | 'aimedShot'
  | 'spreadShot'
  | 'telegraphLaser'
  | 'homingMissile'
  | 'mineDrop'
  | 'chargeAttack'
  | 'weakPointWindow'
  | 'pulseWave'
  | 'radialBurst'
  | 'predictiveShot'
  | 'laserWall';

export interface AttackSpec {
  id?: string;
  pattern: AttackPatternId;
  interval: number;
  warmup?: number;
  damage?: number;
  speed?: number;
  shots?: number;
  spread?: number;
  telegraphDuration?: number;
  activeDuration?: number;
  homingStrength?: number;
}

export interface SupportSpec {
  type: 'shieldAura';
  radius: number;
  damageMultiplier: number;
}

export type EnemyPartId = 'hull' | 'leftCannon' | 'rightCannon' | 'engine' | 'core';

/**
 * Authoring-layer part config. Heavy Gunship adapts this into the generic
 * runtime `EnemyPartDefinition` in `enemy-parts.ts`; keeping authoring data
 * here avoids putting Three.js nodes into static enemy definitions.
 */
export interface EnemyPartConfig {
  id: EnemyPartId;
  nodeName: string;
  hp: number;
  maxHp: number;
  score: number;
  damageMultiplier?: number;
  damageReduction?: number;
  initiallyHidden?: boolean;
  initiallyVisible?: boolean;
  armored?: boolean;
  gatedBy?: EnemyPartId;
}

export interface EnemyDefinition {
  type: EnemyType;
  hp: number;
  radius: number;
  score: number;
  color: number;
  scale: number;
  movement: MovementPatternId;
  moveSpeed: number;
  attacks: AttackSpec[];
  support?: SupportSpec;
  weakPointRadius?: number;
  parts?: readonly EnemyPartConfig[];
}

export interface MovementContext {
  group: THREE.Group;
  baseX: number;
  baseY: number;
  age: number;
  dt: number;
  playerPos: THREE.Vector3;
  speedMult: number;
  paceMultiplier: number;
  moveSpeed: number;
  flags: Record<string, boolean>;
  chargeTarget?: THREE.Vector3;
}

function advanceToStop(ctx: MovementContext, stopZ: number, speed = ctx.moveSpeed): void {
  if (ctx.group.position.z < stopZ) {
    ctx.group.position.z += speed * ctx.speedMult * ctx.paceMultiplier * ctx.dt;
    if (ctx.group.position.z > stopZ) ctx.group.position.z = stopZ;
  }
}

function facePlayer(ctx: MovementContext): void {
  ctx.group.lookAt(ctx.playerPos);
}

export const MOVEMENT_PATTERNS: Record<MovementPatternId, (ctx: MovementContext) => void> = {
  straight: ctx => {
    ctx.group.position.z += ctx.moveSpeed * ctx.speedMult * ctx.paceMultiplier * ctx.dt;
    ctx.group.rotation.x = 0.1;
  },

  sine: ctx => {
    ctx.group.position.z += ctx.moveSpeed * ctx.speedMult * ctx.paceMultiplier * ctx.dt;
    ctx.group.position.x = ctx.baseX + Math.sin(ctx.age * 2.2) * 8;
    ctx.group.rotation.z = Math.cos(ctx.age * 2.2) * 0.18;
  },

  turret: ctx => {
    facePlayer(ctx);
  },

  sniper: ctx => {
    advanceToStop(ctx, -68, ctx.moveSpeed);
    ctx.group.position.x = ctx.baseX + Math.sin(ctx.age * 0.8) * 2.5;
    facePlayer(ctx);
  },

  shield: ctx => {
    advanceToStop(ctx, -64, ctx.moveSpeed);
    ctx.group.position.x = ctx.baseX + Math.sin(ctx.age * 1.2) * 3.5;
    ctx.group.position.y = ctx.baseY + Math.sin(ctx.age * 1.8) * 1.2;
  },

  kamikaze: ctx => {
    if (ctx.flags.chargeActive && ctx.chargeTarget) {
      const target = ctx.chargeTarget.clone().sub(ctx.group.position);
      if (target.lengthSq() > 0.01) {
        target.normalize();
        ctx.group.position.addScaledVector(target, ctx.moveSpeed * 2.35 * ctx.speedMult * ctx.dt);
        ctx.group.lookAt(ctx.chargeTarget);
      }
    } else {
      advanceToStop(ctx, -62, ctx.moveSpeed);
      ctx.group.position.x += Math.sin(ctx.age * 2.4) * ctx.dt * 3;
      facePlayer(ctx);
    }
  },

  carrier: ctx => {
    advanceToStop(ctx, -70, ctx.moveSpeed);
    ctx.group.position.x = ctx.baseX + Math.sin(ctx.age * 0.9) * 4;
    ctx.group.position.y = ctx.baseY + Math.sin(ctx.age * 1.1) * 0.8;
    facePlayer(ctx);
  },

  mineLayer: ctx => {
    advanceToStop(ctx, -76, ctx.moveSpeed);
    ctx.group.position.x = ctx.baseX + Math.sin(ctx.age * 0.7) * 5;
    ctx.group.position.y = ctx.baseY + Math.sin(ctx.age * 1.3) * 0.7;
    facePlayer(ctx);
  },

  armored: ctx => {
    advanceToStop(ctx, -78, ctx.moveSpeed);
    ctx.group.position.x = ctx.baseX + Math.sin(ctx.age * 0.65) * 3;
    facePlayer(ctx);
  },

  heavy: ctx => {
    const approachStop = -76;
    const wasApproaching = ctx.group.position.z < approachStop;
    advanceToStop(ctx, approachStop, ctx.moveSpeed);
    if (wasApproaching) {
      ctx.group.rotation.x = 0.04;
      return;
    }

    // After the approach, pace still changes the gunship's combat depth and
    // lateral aiming window. The drift is deliberately small and bounded so
    // Boost/Brake are visible without turning the gunship into a fast-moving
    // ordinary enemy. `age` remains real-time for the sweep itself.
    const paceDelta = ctx.paceMultiplier - 1;
    const combatDepthDrift = ctx.moveSpeed * ctx.speedMult * paceDelta * 0.22 * ctx.dt;
    ctx.group.position.z = THREE.MathUtils.clamp(
      ctx.group.position.z + combatDepthDrift,
      approachStop - 3.2,
      approachStop + 3.8,
    );

    const engineDestroyed = Boolean(ctx.flags.engineDestroyed);
    const coreExposed = Boolean(ctx.flags.coreExposed);
    const sweepRate = engineDestroyed ? 0.38 : 0.62;
    const sweepWidth = (engineDestroyed ? 3.4 : 6.2) * (1 + paceDelta * 0.18);
    const sweepHeight = coreExposed ? 1.35 : 0.85;
    const paceAimBias = paceDelta * 2.2;
    ctx.group.position.x = ctx.baseX + paceAimBias + Math.sin(ctx.age * sweepRate) * sweepWidth;
    ctx.group.position.y = ctx.baseY + Math.sin(ctx.age * 0.45) * sweepHeight;
    ctx.group.rotation.z = Math.cos(ctx.age * sweepRate) * (engineDestroyed ? 0.08 : 0.14);
    facePlayer(ctx);
  },

  mine: ctx => {
    ctx.group.position.z += ctx.moveSpeed * ctx.speedMult * ctx.paceMultiplier * ctx.dt;
    ctx.group.rotation.x += ctx.dt * 1.6;
    ctx.group.rotation.y += ctx.dt * 1.2;
  },
};

export const ENEMY_DEFINITIONS: Record<EnemyType, EnemyDefinition> = {
  straight: {
    type: 'straight', hp: 1, radius: 2, score: 100, color: 0xaa2222, scale: 1,
    movement: 'straight', moveSpeed: 40, attacks: [],
  },
  sine: {
    type: 'sine', hp: 1, radius: 2, score: 200, color: 0xccaa00, scale: 1,
    movement: 'sine', moveSpeed: 35, attacks: [],
  },
  turret: {
    type: 'turret', hp: 3, radius: 2.5, score: 500, color: 0x666666, scale: 1.5,
    movement: 'turret', moveSpeed: 0,
    attacks: [{ id: 'turret-shot', pattern: 'aimedShot', interval: 2.5, damage: 15, speed: 60 }],
  },
  sniper: {
    type: 'sniper', hp: 2, radius: 2, score: 450, color: 0x9b4dca, scale: 1.1,
    movement: 'sniper', moveSpeed: 28,
    attacks: [{ id: 'sniper-lock', pattern: 'telegraphLaser', interval: 5.0, damage: 30, speed: 120, telegraphDuration: 1.35 }],
  },
  shieldDrone: {
    type: 'shieldDrone', hp: 2, radius: 2.1, score: 600, color: 0x3b9cff, scale: 1.05,
    movement: 'shield', moveSpeed: 24,
    attacks: [{ id: 'drone-shot', pattern: 'aimedShot', interval: 4.0, damage: 10, speed: 58 }],
    support: { type: 'shieldAura', radius: 15, damageMultiplier: 0.45 },
  },
  kamikaze: {
    type: 'kamikaze', hp: 1, radius: 1.8, score: 300, color: 0xff5522, scale: 0.95,
    movement: 'kamikaze', moveSpeed: 34,
    attacks: [{ id: 'kamikaze-charge', pattern: 'chargeAttack', interval: 5.5, warmup: 1.1, damage: 30, telegraphDuration: 0.9, activeDuration: 1.5 }],
  },
  missileCarrier: {
    type: 'missileCarrier', hp: 4, radius: 2.6, score: 700, color: 0xe0a53b, scale: 1.25,
    movement: 'carrier', moveSpeed: 20,
    attacks: [{ id: 'carrier-missile', pattern: 'homingMissile', interval: 4.6, damage: 22, speed: 38, telegraphDuration: 1.0, homingStrength: 0.9 }],
  },
  mineLayer: {
    type: 'mineLayer', hp: 3, radius: 2.4, score: 650, color: 0x55b85a, scale: 1.15,
    movement: 'mineLayer', moveSpeed: 18,
    attacks: [{ id: 'mine-drop', pattern: 'mineDrop', interval: 4.8, telegraphDuration: 0.75 }],
  },
  armoredFighter: {
    type: 'armoredFighter', hp: 8, radius: 2.7, score: 900, color: 0x7d8794, scale: 1.35,
    movement: 'armored', moveSpeed: 22, weakPointRadius: 0.9,
    attacks: [
      { id: 'armor-window', pattern: 'weakPointWindow', interval: 4.0, telegraphDuration: 0.7, activeDuration: 1.35 },
      { id: 'armor-shot', pattern: 'aimedShot', interval: 2.5, damage: 14, speed: 62 },
    ],
  },
  mine: {
    type: 'mine', hp: 1, radius: 2.1, score: 150, color: 0xff4a3d, scale: 1,
    movement: 'mine', moveSpeed: 60, attacks: [],
  },
  heavyGunship: {
    type: 'heavyGunship', hp: 36, radius: 7, score: 1200, color: 0x46586a, scale: 1,
    movement: 'heavy', moveSpeed: 14, attacks: [],
    parts: [
      {
        id: 'hull', nodeName: 'hull', hp: 36, maxHp: 36, score: 100,
        damageMultiplier: 0.2, damageReduction: 0.8, armored: true,
      },
      { id: 'leftCannon', nodeName: 'left-cannon', hp: 12, maxHp: 12, score: 150 },
      { id: 'rightCannon', nodeName: 'right-cannon', hp: 12, maxHp: 12, score: 150 },
      { id: 'engine', nodeName: 'engine', hp: 16, maxHp: 16, score: 200 },
      {
        id: 'core', nodeName: 'core', hp: 40, maxHp: 40, score: 0,
        damageMultiplier: 3,
        initiallyHidden: true, initiallyVisible: false, armored: true, gatedBy: 'engine',
      },
    ],
  },
};

