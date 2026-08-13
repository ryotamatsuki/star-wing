import * as THREE from 'three';
import { fireEnemyBullet, fireHomingMissile } from './bullets';
import { AttackSpec } from './enemy-definitions';
import { hideCombatAlert, showCombatAlert } from './hud';
import { sfxCharge, sfxLock, sfxMine, sfxTelegraph } from './audio';

export interface AttackContext {
  scene: THREE.Scene;
  alertSourceId: string;
  group: THREE.Group;
  age: number;
  dt: number;
  playerPos: THREE.Vector3;
  flags: Record<string, boolean>;
  chargeTarget?: THREE.Vector3;
  spawnMineField: (origin: THREE.Vector3, pattern: number) => void;
}

interface AttackState {
  cooldown: number;
  phase: 'idle' | 'telegraph' | 'active';
  timer: number;
  target?: THREE.Vector3;
  visual?: THREE.Object3D;
  groupVisual?: boolean;
  patternIndex: number;
  locked: boolean;
}

export interface AttackController {
  update(ctx: AttackContext): void;
  dispose(): void;
}

function makeLine(color: number, opacity: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.18, 1),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity }),
  );
}

function aimLine(line: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
  const length = from.distanceTo(to);
  line.position.copy(from).add(to).multiplyScalar(0.5);
  line.scale.set(1, 1, Math.max(1, length));
  line.lookAt(to);
}

function makeReticle(): THREE.Mesh {
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 1.5, 16),
    new THREE.MeshBasicMaterial({ color: 0xff3344, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  reticle.rotation.x = 0;
  return reticle;
}

function makeChargeWarning(): THREE.Mesh {
  const warning = new THREE.Mesh(
    new THREE.RingGeometry(2.1, 2.5, 16),
    new THREE.MeshBasicMaterial({ color: 0xff4422, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  warning.rotation.x = 0;
  return warning;
}

function makeState(spec: AttackSpec): AttackState {
  return {
    cooldown: spec.warmup ?? spec.interval,
    phase: 'idle',
    timer: 0,
    patternIndex: 0,
    locked: false,
  };
}

function alertId(ctx: AttackContext, spec: AttackSpec): string {
  return `${ctx.alertSourceId}:${spec.id ?? spec.pattern}`;
}

function fireSpread(ctx: AttackContext, spec: AttackSpec): void {
  const shots = Math.max(2, spec.shots ?? 3);
  const spread = spec.spread ?? 0.18;
  for (let i = 0; i < shots; i++) {
    const offset = (i - (shots - 1) / 2) * spread;
    fireEnemyBullet(
      ctx.group.position.clone(),
      ctx.playerPos.clone().add(new THREE.Vector3(offset * 40, offset * 20, 0)),
      { damage: spec.damage ?? 12, speed: spec.speed ?? 60 },
    );
  }
}

function updateTelegraphLaser(ctx: AttackContext, spec: AttackSpec, state: AttackState): void {
  const duration = spec.telegraphDuration ?? 1.2;
  const lockAt = duration * 0.62;
  if (state.phase === 'idle') {
    state.phase = 'telegraph';
    state.timer = 0;
    state.locked = false;
    state.target = ctx.playerPos.clone();
    state.visual = makeLine(0xff1b2d, 0.5);
    ctx.scene.add(state.visual);
    showCombatAlert(alertId(ctx, spec), 'SNIPER LOCK', '#ff5265', 4);
    sfxTelegraph();
  }

  state.timer += ctx.dt;
  if (!state.locked && state.timer >= lockAt) {
    // Capture the player's position at the actual lock boundary. The warning
    // must never jump back to the position from telegraph start.
    state.target = ctx.playerPos.clone();
    state.locked = true;
    sfxLock();
  }
  const lockPoint = state.locked ? state.target! : ctx.playerPos;
  aimLine(state.visual as THREE.Mesh, ctx.group.position, lockPoint);
  const mat = (state.visual as THREE.Mesh).material as THREE.MeshBasicMaterial;
  mat.opacity = 0.25 + Math.abs(Math.sin(ctx.age * 14)) * 0.65;

  if (state.timer >= duration) {
    fireEnemyBullet(ctx.group.position.clone(), state.target!, {
      damage: spec.damage ?? 30,
      speed: spec.speed ?? 120,
      color: 0xff2233,
    });
    ctx.scene.remove(state.visual!);
    state.visual = undefined;
    state.phase = 'idle';
    state.timer = 0;
    state.cooldown = spec.interval;
    state.locked = false;
    hideCombatAlert(alertId(ctx, spec));
  }
}

function updateHomingMissile(ctx: AttackContext, spec: AttackSpec, state: AttackState): void {
  const duration = spec.telegraphDuration ?? 0.9;
  const lockAt = duration * 0.65;
  if (state.phase === 'idle') {
    state.phase = 'telegraph';
    state.timer = 0;
    state.locked = false;
    state.target = ctx.playerPos.clone();
    state.visual = makeReticle();
    ctx.scene.add(state.visual);
    showCombatAlert(alertId(ctx, spec), 'MISSILE LOCK', '#ff5964', 5);
    sfxTelegraph();
  }

  state.timer += ctx.dt;
  if (!state.locked && state.timer >= lockAt) {
    state.target = ctx.playerPos.clone();
    state.locked = true;
    sfxLock();
  }
  const target = state.locked ? state.target! : ctx.playerPos;
  state.visual!.position.copy(target);
  state.visual!.scale.setScalar(1 + Math.sin(ctx.age * 12) * 0.18);

  if (state.timer >= duration) {
    // Launch toward the locked point, then let the projectile home on the live
    // player position. This keeps the reticle and launch direction consistent.
    fireHomingMissile(ctx.group.position.clone(), state.target!, {
      damage: spec.damage ?? 22,
      speed: spec.speed ?? 38,
      homingStrength: spec.homingStrength ?? 0.9,
      homingTarget: ctx.playerPos,
    });
    ctx.scene.remove(state.visual!);
    state.visual = undefined;
    state.phase = 'idle';
    state.timer = 0;
    state.cooldown = spec.interval;
    state.locked = false;
    hideCombatAlert(alertId(ctx, spec));
  }
}

function updateMineDrop(ctx: AttackContext, spec: AttackSpec, state: AttackState): void {
  const duration = spec.telegraphDuration ?? 0.75;
  if (state.phase === 'idle') {
    state.phase = 'telegraph';
    state.timer = 0;
    showCombatAlert(alertId(ctx, spec), 'MINE ROUTE', '#ffb347', 2);
    sfxMine();
  }
  state.timer += ctx.dt;
  if (state.timer >= duration) {
    ctx.spawnMineField(ctx.group.position.clone().add(new THREE.Vector3(0, 0, -12)), state.patternIndex++ % 3);
    state.phase = 'idle';
    state.timer = 0;
    state.cooldown = spec.interval;
    hideCombatAlert(alertId(ctx, spec));
  }
}

function updateChargeAttack(ctx: AttackContext, spec: AttackSpec, state: AttackState): void {
  const duration = spec.telegraphDuration ?? 0.9;
  const activeDuration = spec.activeDuration ?? 1.5;
  if (state.phase === 'idle') {
    state.phase = 'telegraph';
    state.timer = 0;
    state.target = ctx.playerPos.clone();
    state.visual = makeChargeWarning();
    state.groupVisual = true;
    ctx.group.add(state.visual);
    showCombatAlert(alertId(ctx, spec), 'INCOMING CHARGE', '#ff704d', 4);
    sfxTelegraph();
  }

  state.timer += ctx.dt;
  if (state.phase === 'telegraph') {
    ctx.flags.chargeActive = false;
    state.visual!.scale.setScalar(1 + Math.sin(ctx.age * 16) * 0.22);
    if (state.timer >= duration) {
      state.phase = 'active';
      state.timer = 0;
      ctx.chargeTarget = state.target;
      sfxCharge();
    }
  } else {
    ctx.flags.chargeActive = true;
    ctx.chargeTarget = state.target;
    if (state.timer >= activeDuration) {
      ctx.flags.chargeActive = false;
      if (state.visual) ctx.group.remove(state.visual);
      state.visual = undefined;
      state.groupVisual = false;
      state.phase = 'idle';
      state.timer = 0;
      state.cooldown = spec.interval;
      hideCombatAlert(alertId(ctx, spec));
    }
  }
}

function updateWeakPointWindow(ctx: AttackContext, spec: AttackSpec, state: AttackState): void {
  const telegraph = spec.telegraphDuration ?? 0.7;
  const active = spec.activeDuration ?? 1.25;
  if (state.phase === 'idle') {
    state.phase = 'telegraph';
    state.timer = 0;
    showCombatAlert(alertId(ctx, spec), 'CORE PREPARING', '#ffe477', 3);
    sfxTelegraph();
  }
  state.timer += ctx.dt;
  if (state.phase === 'telegraph') {
    ctx.flags.vulnerable = false;
    if (state.timer >= telegraph) {
      state.phase = 'active';
      state.timer = 0;
      showCombatAlert(alertId(ctx, spec), 'CORE EXPOSED', '#ffe477', 4);
    }
  } else {
    ctx.flags.vulnerable = true;
    if (state.timer >= active) {
      ctx.flags.vulnerable = false;
      state.phase = 'idle';
      state.timer = 0;
      state.cooldown = spec.interval;
      hideCombatAlert(alertId(ctx, spec));
    }
  }
}

function updateSimpleAttack(ctx: AttackContext, spec: AttackSpec, state: AttackState): void {
  if (state.cooldown > 0) {
    state.cooldown -= ctx.dt;
    return;
  }

  switch (spec.pattern) {
    case 'aimedShot':
      fireEnemyBullet(ctx.group.position.clone(), ctx.playerPos.clone(), { damage: spec.damage ?? 15, speed: spec.speed ?? 60 });
      state.cooldown = spec.interval;
      break;
    case 'spreadShot':
      fireSpread(ctx, spec);
      state.cooldown = spec.interval;
      break;
    case 'predictiveShot': {
      const predicted = ctx.playerPos.clone().add(new THREE.Vector3(0, 0, -8));
      fireEnemyBullet(ctx.group.position.clone(), predicted, { damage: spec.damage ?? 15, speed: spec.speed ?? 65 });
      state.cooldown = spec.interval;
      break;
    }
    case 'pulseWave':
      fireSpread(ctx, { ...spec, shots: spec.shots ?? 6, spread: spec.spread ?? 0.3 });
      state.cooldown = spec.interval;
      break;
    case 'radialBurst':
      for (let i = 0; i < (spec.shots ?? 8); i++) {
        const angle = i / (spec.shots ?? 8) * Math.PI * 2;
        fireEnemyBullet(ctx.group.position.clone(), ctx.group.position.clone().add(new THREE.Vector3(Math.cos(angle) * 40, Math.sin(angle) * 20, 30)), { damage: spec.damage ?? 12, speed: spec.speed ?? 55 });
      }
      state.cooldown = spec.interval;
      break;
    case 'laserWall':
      fireSpread(ctx, { ...spec, shots: spec.shots ?? 5, spread: spec.spread ?? 0.45 });
      state.cooldown = spec.interval;
      break;
    default:
      break;
  }
}

export function createAttackController(
  scene: THREE.Scene,
  specs: AttackSpec[],
  alertSourceId: string,
): AttackController {
  const states = specs.map(makeState);

  return {
    update(ctx: AttackContext): void {
      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        const state = states[i];

        if (state.cooldown > 0 && state.phase === 'idle') {
          state.cooldown -= ctx.dt;
          continue;
        }

        switch (spec.pattern) {
          case 'telegraphLaser': updateTelegraphLaser(ctx, spec, state); break;
          case 'homingMissile': updateHomingMissile(ctx, spec, state); break;
          case 'mineDrop': updateMineDrop(ctx, spec, state); break;
          case 'chargeAttack': updateChargeAttack(ctx, spec, state); break;
          case 'weakPointWindow': updateWeakPointWindow(ctx, spec, state); break;
          default: updateSimpleAttack(ctx, spec, state); break;
        }
      }
    },

    dispose(): void {
      for (const state of states) {
        if (!state.visual) continue;
        if (state.groupVisual) ctxRemoveFromGroup(state.visual);
        else scene.remove(state.visual);
        state.visual = undefined;
      }
      for (const spec of specs) hideCombatAlert(`${alertSourceId}:${spec.id ?? spec.pattern}`);
    },
  };
}

// The owner group is not retained by the controller, so group-attached warnings
// are marked with their parent and removed without requiring a global registry.
function ctxRemoveFromGroup(object: THREE.Object3D): void {
  object.parent?.remove(object);
}
