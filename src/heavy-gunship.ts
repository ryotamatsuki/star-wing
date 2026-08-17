import * as THREE from 'three';
import { createHeavyGunship, HeavyGunshipModel } from './models';
import type { AttackContext, AttackController } from './attacks';
import type { EnemyDefinition, EnemyPartConfig as DefinedPart } from './enemy-definitions';
import type { LockCandidate } from './targeting';
import {
  canLockEnemyPart,
  createEnemyPartStates,
  EnemyHitResult,
  EnemyPartDefinition as RuntimePartDefinition,
  EnemyPartState,
  hideEnemyPart,
  markEnemyPartDestroyed,
  resolveEnemyPartDamage,
  showEnemyPart,
} from './enemy-parts';
import { hideCombatAlert, showCombatAlert } from './hud';
import { sfxLaneDenied, sfxLaneTelegraph, sfxLock, sfxTelegraph } from './audio';
import { fireEnemyBullet } from './bullets';

export type HeavyGunshipPartId = 'hull' | 'leftCannon' | 'rightCannon' | 'engine' | 'core';

export interface HeavyGunshipPartTransition {
  part: EnemyPartState;
  partDestroyed: boolean;
  coreExposed: boolean;
  coreExposedNow: boolean;
  engineDestroyed: boolean;
  cannonDestroyed: boolean;
}

export interface HeavyGunshipRuntime {
  readonly id: string;
  readonly model: HeavyGunshipModel;
  readonly group: THREE.Group;
  readonly parts: readonly EnemyPartState[];
  readonly partById: ReadonlyMap<string, EnemyPartState>;
  readonly lockCandidates: readonly LockCandidate[];
  readonly attackController: AttackController;
  readonly flags: Record<string, boolean>;
  readonly isCoreExposed: () => boolean;
  readonly getPart: (partId: string) => EnemyPartState | undefined;
  readonly getPartForTarget: (target: object) => EnemyPartState | undefined;
  dispose(): void;
}

export interface HeavyGunshipAttackIds {
  leftCannon: string;
  rightCannon: string;
  laneDenial: string;
}

const HEAVY_ATTACKS: Readonly<HeavyGunshipAttackIds> = {
  leftCannon: 'heavy-left-cannon-barrage',
  rightCannon: 'heavy-right-cannon-barrage',
  laneDenial: 'heavy-lane-denial',
};

const FALLBACK_PARTS: readonly DefinedPart[] = [
  { id: 'hull', nodeName: 'hull', hp: 36, maxHp: 36, score: 0, damageMultiplier: 0.2, destroyable: false, armored: true },
  { id: 'leftCannon', nodeName: 'left-cannon', hp: 12, maxHp: 12, score: 150 },
  { id: 'rightCannon', nodeName: 'right-cannon', hp: 12, maxHp: 12, score: 150 },
  { id: 'engine', nodeName: 'engine', hp: 16, maxHp: 16, score: 200 },
  {
    id: 'core', nodeName: 'core', hp: 40, maxHp: 40, score: 0,
    damageMultiplier: 3, armored: true, initiallyHidden: true,
  },
];

function emitEvent<T>(type: string, detail: T): void {
  if (typeof globalThis.dispatchEvent !== 'function' || typeof CustomEvent === 'undefined') return;
  globalThis.dispatchEvent(new CustomEvent<T>(type, { detail }));
}

export const emitCombatEvent = emitEvent;

function partKind(partId: HeavyGunshipPartId): RuntimePartDefinition['kind'] {
  if (partId === 'core') return 'core';
  if (partId === 'engine') return 'engine';
  if (partId === 'hull') return 'armor';
  return 'weapon';
}

function partRadius(partId: HeavyGunshipPartId): number {
  switch (partId) {
    case 'hull': return 5.8;
    case 'leftCannon':
    case 'rightCannon': return 2.8;
    // The anchor is centered between the two engine pods. Include the pod
    // housings in the single subsystem's collision/lock envelope.
    case 'engine': return 3.8;
    case 'core': return 1.9;
  }
}

function partNode(model: HeavyGunshipModel, partId: HeavyGunshipPartId): THREE.Object3D {
  return model.nodes[partId];
}

function definedPart(definition: DefinedPart | undefined, model: HeavyGunshipModel): RuntimePartDefinition {
  const source = definition ?? FALLBACK_PARTS.find(part => part.id === 'hull')!;
  const id = source.id as HeavyGunshipPartId;
  const damageMultiplier = source.damageMultiplier
    ?? (source.damageReduction === undefined ? 1 : Math.max(0, 1 - source.damageReduction));
  return {
    id,
    kind: partKind(id),
    node: partNode(model, id),
    radius: partRadius(id),
    hp: source.hp,
    maxHp: source.maxHp,
    damageMultiplier,
    canHit: part => id !== 'core' || (part.enabled && part.hidden === false),
    canLock: part => id !== 'core' || (part.enabled && part.hidden === false),
    destroyable: id !== 'hull',
    hideOnDestroy: id !== 'hull',
    metadata: {
      sourceId: source.id,
      score: source.score,
      armored: Boolean(source.armored),
      gatedBy: source.gatedBy,
    },
  };
}

function findDefinedPart(definition: EnemyDefinition, id: HeavyGunshipPartId): DefinedPart | undefined {
  return definition.parts?.find(part => part.id === id) ?? FALLBACK_PARTS.find(part => part.id === id);
}

function createHeavyPartCandidates(
  id: string,
  parts: readonly EnemyPartState[],
  isAlive: () => boolean,
): LockCandidate[] {
  return parts.map(part => {
    const target = part.target;
    const candidate: LockCandidate = {
      id: target?.id ?? `${id}:${part.id}`,
      object: target?.object ?? part.node as THREE.Object3D,
      target,
      enemyId: target?.enemyId ?? id,
      partId: target?.partId ?? part.id,
      kind: target?.kind,
      targetId: target?.id,
      get lockable(): boolean {
        return isAlive() && canLockEnemyPart(part);
      },
      isValid: (): boolean => isAlive() && canLockEnemyPart(part),
      canAcquire: (): boolean => isAlive() && canLockEnemyPart(part),
      canLock: (): boolean => isAlive() && canLockEnemyPart(part),
    };
    return candidate;
  });
}

function exposeCore(
  flags: Record<string, boolean>,
  parts: ReadonlyMap<string, EnemyPartState>,
  model: HeavyGunshipModel,
): boolean {
  if (flags.coreExposed) return false;
  const engineDestroyed = Boolean(parts.get('engine')?.destroyed);
  const cannonDestroyedCount = ['leftCannon', 'rightCannon']
    .filter(id => parts.get(id)?.destroyed).length;
  const destroyedRequiredParts = Number(engineDestroyed) + cannonDestroyedCount;

  // Any two of the three primary systems expose the core.
  // Cannon-first and engine-plus-cannon routes remain meaningfully different.
  // The remaining system stays active, preserving the risk trade-off.
  //
  if (destroyedRequiredParts < 2) return false;

  const core = parts.get('core');
  if (!core || core.destroyed) return false;
  flags.coreExposed = true;
  showEnemyPart(core);
  // Keep the generic Part lifecycle as the source of visibility/target state,
  // then open the prebuilt model armor around that same Core Group.
  model.setCoreExposed(true);
  emitEvent('combat:enemy-core-exposed', {
    enemyId: core.enemyId,
    partId: core.partId,
    requiredDestroyedParts: destroyedRequiredParts,
    position: core.node?.getWorldPosition(new THREE.Vector3()),
  });
  return true;
}

export function updateHeavyGunshipPartState(runtime: HeavyGunshipRuntime, part: EnemyPartState): HeavyGunshipPartTransition {
  const partDestroyed = part.destroyed;
  const cannonDestroyed = partDestroyed && (part.id === 'leftCannon' || part.id === 'rightCannon');
  const engineDestroyed = partDestroyed && part.id === 'engine';

  if (cannonDestroyed) runtime.flags[`${part.id}Destroyed`] = true;
  if (engineDestroyed) runtime.flags.engineDestroyed = true;

  const exposedNow = exposeCore(runtime.flags, runtime.partById, runtime.model);

  return {
    part,
    partDestroyed,
    coreExposed: runtime.isCoreExposed(),
    coreExposedNow: exposedNow,
    engineDestroyed,
    cannonDestroyed,
  };
}

export function resolveHeavyGunshipPartDamage(
  runtime: HeavyGunshipRuntime,
  part: EnemyPartState,
  damage: number,
): EnemyHitResult & { transition: HeavyGunshipPartTransition } {
  const result = resolveEnemyPartDamage(part, damage);
  const transition = updateHeavyGunshipPartState(runtime, part);
  if (result.wasDestroyed) {
    emitEvent('combat:enemy-target-invalidated', {
      enemyId: part.enemyId,
      partId: part.partId,
      targetId: result.target?.id,
      reason: 'part-destroyed',
    });
  }
  return { ...result, transition };
}

export function invalidateHeavyGunshipTargets(runtime: HeavyGunshipRuntime): void {
  for (const part of runtime.parts) {
    part.enabled = false;
    part.hitEnabled = false;
    part.lockEnabled = false;
  }
}

export function createHeavyGunshipRuntime(
  scene: THREE.Scene,
  id: string,
  definition: EnemyDefinition,
  flags: Record<string, boolean>,
  isAlive: () => boolean,
): HeavyGunshipRuntime {
  const model = createHeavyGunship();
  const partDefinitions = (definition.parts ?? FALLBACK_PARTS).map(part => definedPart(part, model));
  const parts = createEnemyPartStates(partDefinitions, { enemyId: id });
  const partById = new Map(parts.map(part => [part.id, part]));

  flags.coreExposed = false;
  flags.engineDestroyed = false;
  flags.leftCannonDestroyed = false;
  flags.rightCannonDestroyed = false;

  for (const part of parts) {
    const source = findDefinedPart(definition, part.id as HeavyGunshipPartId);
    if (source?.initiallyHidden || (part.id === 'core' && !source?.initiallyVisible)) hideEnemyPart(part);
  }

  const candidates = createHeavyPartCandidates(id, parts, isAlive);
  const runtime: HeavyGunshipRuntime = {
    id,
    model,
    group: model.group,
    parts,
    partById,
    lockCandidates: candidates,
    flags,
    isCoreExposed: () => Boolean(flags.coreExposed),
    getPart: partId => partById.get(partId),
    getPartForTarget: target => parts.find(part => part.target?.object === target || part.target === target),
    attackController: createHeavyGunshipAttackController(scene, id, model),
    dispose: () => undefined,
  };

  runtime.dispose = (): void => {
    runtime.attackController.dispose();
    invalidateHeavyGunshipTargets(runtime);
    disposeObjectResources(runtime.model.group);
  };

  // A core becomes exposed only through the three-part gate, never by a model
  // visibility change alone.
  flags.coreExposed = false;
  return runtime;
}

function makeLine(color: number, opacity: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.22, 1),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity }),
  );
}

function aimLine(line: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
  const length = Math.max(1, from.distanceTo(to));
  line.position.copy(from).add(to).multiplyScalar(0.5);
  line.scale.set(1, 1, length);
  line.lookAt(to);
}

function disposeObjectResources(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) materials.add(material);
    } else {
      materials.add(mesh.material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

function removeVisual(scene: THREE.Scene, visual: THREE.Object3D | undefined): void {
  if (!visual) return;
  scene.remove(visual);

  // makeLine/createLaneVisual allocate these resources per telegraph, so the
  // attack controller owns and disposes them when the visual leaves the scene.
  // Do not dispose Heavy Gunship model resources here; they are not children
  // of an attack telegraph visual and may be reused by the runtime.
  visual.traverse(child => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) material.dispose();
    } else {
      mesh.material.dispose();
    }
  });
}

/**
 * Combat clocks are always real-time; World Pace only controls route approach.
 * Cooldowns below are always decremented by ctx.dt, preserving real time.
 */
function telegraphDuration(base: number, coreExposed: boolean): number {
  return base * (coreExposed ? 0.9 : 1);
}

function lockFraction(base: number, coreExposed: boolean): number {
  return THREE.MathUtils.clamp(base + (coreExposed ? -0.04 : 0), 0.45, 0.78);
}

function combatInterval(base: number, coreExposed: boolean): number {
  // Core exposure makes surviving attacks slightly more urgent, but the
  // resulting cooldown is still consumed with real dt in the update methods.
  return base * (coreExposed ? 0.86 : 1);
}

interface CannonAttackState {
  cooldown: number;
  timer: number;
  phase: 'idle' | 'telegraph';
  locked: boolean;
  target?: THREE.Vector3;
  visual?: THREE.Mesh;
}

interface LaneDenialState {
  cooldown: number;
  timer: number;
  phase: 'idle' | 'telegraph';
  locked: boolean;
  laneX: number;
  visual?: THREE.Mesh;
}

function resetCannonState(state: CannonAttackState, interval: number): void {
  state.phase = 'idle';
  state.timer = 0;
  state.locked = false;
  state.target = undefined;
  state.cooldown = interval;
}

function createCannonState(cooldown: number): CannonAttackState {
  return { cooldown, timer: 0, phase: 'idle', locked: false };
}

function cannonDestroyed(ctx: AttackContext, partId: 'leftCannon' | 'rightCannon'): boolean {
  return Boolean(ctx.flags[`${partId}Destroyed`]);
}

function startCannonTelegraph(
  ctx: AttackContext,
  state: CannonAttackState,
  origin: THREE.Vector3,
  attackId: string,
  partId: 'leftCannon' | 'rightCannon',
): void {
  state.phase = 'telegraph';
  state.timer = 0;
  state.locked = false;
  state.target = ctx.playerPos.clone();
  state.visual = makeLine(partId === 'leftCannon' ? 0xffb347 : 0xff5964, 0.65);
  ctx.scene.add(state.visual);
  showCombatAlert(
    `${ctx.alertSourceId}:${attackId}`,
    ctx.flags.coreExposed ? 'CORE BARRAGE' : 'CANNON BARRAGE',
    partId === 'leftCannon' ? '#ffcc66' : '#ff6b7a',
    4,
  );
  sfxTelegraph();
  emitEvent('combat:enemy-attack-telegraph', {
    enemyId: ctx.alertSourceId,
    attackId,
    partId,
  });
  aimLine(state.visual, origin, ctx.playerPos);
}

function updateCannon(
  ctx: AttackContext,
  state: CannonAttackState,
  partId: 'leftCannon' | 'rightCannon',
  origin: THREE.Vector3,
  attackId: string,
  interval: number,
): void {
  const alert = `${ctx.alertSourceId}:${attackId}`;
  const coreExposed = Boolean(ctx.flags.coreExposed);
  const nextInterval = combatInterval(interval, coreExposed);
  if (cannonDestroyed(ctx, partId)) {
    if (state.visual) removeVisual(ctx.scene, state.visual);
    state.visual = undefined;
    resetCannonState(state, nextInterval);
    hideCombatAlert(alert);
    return;
  }

  if (state.phase === 'idle') {
    state.cooldown -= ctx.dt;
    if (state.cooldown > 0) return;
    startCannonTelegraph(ctx, state, origin, attackId, partId);
  }

  state.timer += ctx.dt;
  const warningDuration = telegraphDuration(0.82, coreExposed);
  if (!state.locked && state.timer >= warningDuration * lockFraction(0.62, coreExposed)) {
    state.target = ctx.playerPos.clone();
    state.locked = true;
    sfxLock();
  }
  const target = state.locked ? state.target! : ctx.playerPos;
  if (state.visual) {
    aimLine(state.visual, origin, target);
    (state.visual.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.abs(Math.sin(ctx.age * 16)) * 0.65;
  }

  if (state.timer < warningDuration) return;
  const side = partId === 'leftCannon' ? -1 : 1;
  for (let i = 0; i < 3; i++) {
    const spread = (i - 1) * 1.4;
    fireEnemyBullet(origin.clone(), target.clone().add(new THREE.Vector3(spread * side, spread * 0.45, 0)), {
      damage: 18,
      speed: 74,
      color: partId === 'leftCannon' ? 0xffb347 : 0xff5964,
    });
  }
  emitEvent('combat:enemy-attack-fired', {
    enemyId: ctx.alertSourceId,
    attackId,
    partId,
    shots: 3,
  });
  removeVisual(ctx.scene, state.visual);
  state.visual = undefined;
  resetCannonState(state, nextInterval);
  hideCombatAlert(alert);
}

function createLaneVisual(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(3.5, 14, 0.35),
    new THREE.MeshBasicMaterial({ color: 0xff3344, transparent: true, opacity: 0.5 }),
  );
}

function updateLaneDenial(
  ctx: AttackContext,
  state: LaneDenialState,
  attackId: string,
  interval: number,
): void {
  const alert = `${ctx.alertSourceId}:${attackId}`;
  const coreExposed = Boolean(ctx.flags.coreExposed);
  const nextInterval = combatInterval(interval, coreExposed);
  if (ctx.flags.engineDestroyed) {
    if (state.visual) removeVisual(ctx.scene, state.visual);
    state.visual = undefined;
    state.phase = 'idle';
    state.timer = 0;
    state.locked = false;
    state.cooldown = nextInterval;
    hideCombatAlert(alert);
    return;
  }

  if (state.phase === 'idle') {
    state.cooldown -= ctx.dt;
    if (state.cooldown > 0) return;
    state.phase = 'telegraph';
    state.timer = 0;
    state.locked = false;
    state.laneX = THREE.MathUtils.clamp(ctx.playerPos.x, -9, 9);
    state.visual = createLaneVisual();
    ctx.scene.add(state.visual);
    showCombatAlert(alert, coreExposed ? 'CORE LANE DENIAL' : 'LANE DENIAL', '#ff5964', 5);
    sfxLaneTelegraph();
    emitEvent('combat:enemy-attack-telegraph', {
      enemyId: ctx.alertSourceId,
      attackId,
      laneX: state.laneX,
      engineAlive: true,
    });
  }

  state.timer += ctx.dt;
  const warningDuration = telegraphDuration(1.1, coreExposed);
  if (!state.locked && state.timer >= warningDuration * lockFraction(0.65, coreExposed)) {
    state.laneX = THREE.MathUtils.clamp(ctx.playerPos.x, -9, 9);
    state.locked = true;
    sfxLock();
  }
  if (state.visual) {
    state.visual.position.set(state.laneX, ctx.playerPos.y, ctx.playerPos.z - 32);
    (state.visual.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.abs(Math.sin(ctx.age * 14)) * 0.65;
  }
  if (state.timer < warningDuration) return;

  sfxLaneDenied();
  const origin = new THREE.Vector3(state.laneX, ctx.playerPos.y, ctx.playerPos.z - 34);
  for (let i = -1; i <= 1; i++) {
    const offset = i * 1.15;
    fireEnemyBullet(origin.clone().add(new THREE.Vector3(offset, 0, 0)), ctx.playerPos.clone().add(new THREE.Vector3(offset, 0, 0)), {
      damage: 20,
      speed: 82,
      color: 0xff3344,
    });
  }
  emitEvent('combat:enemy-attack-fired', {
    enemyId: ctx.alertSourceId,
    attackId,
    laneX: state.laneX,
    shots: 3,
  });
  removeVisual(ctx.scene, state.visual);
  state.visual = undefined;
  state.phase = 'idle';
  state.timer = 0;
  state.locked = false;
  state.cooldown = nextInterval;
  hideCombatAlert(alert);
}

export function createHeavyGunshipAttackController(
  scene: THREE.Scene,
  alertSourceId: string,
  model: HeavyGunshipModel,
): AttackController {
  const left = createCannonState(1.8);
  const right = createCannonState(3.1);
  const lane: LaneDenialState = { cooldown: 4.2, timer: 0, phase: 'idle', locked: false, laneX: 0 };

  return {
    update(ctx: AttackContext): void {
      const leftOrigin = model.nodes.leftMuzzle.getWorldPosition(new THREE.Vector3());
      const rightOrigin = model.nodes.rightMuzzle.getWorldPosition(new THREE.Vector3());
      updateCannon(ctx, left, 'leftCannon', leftOrigin, HEAVY_ATTACKS.leftCannon, 3.2);
      updateCannon(ctx, right, 'rightCannon', rightOrigin, HEAVY_ATTACKS.rightCannon, 3.65);
      updateLaneDenial(ctx, lane, HEAVY_ATTACKS.laneDenial, 5.4);
    },

    dispose(): void {
      removeVisual(scene, left.visual);
      removeVisual(scene, right.visual);
      removeVisual(scene, lane.visual);
      left.visual = undefined;
      right.visual = undefined;
      lane.visual = undefined;
      hideCombatAlert(`${alertSourceId}:${HEAVY_ATTACKS.leftCannon}`);
      hideCombatAlert(`${alertSourceId}:${HEAVY_ATTACKS.rightCannon}`);
      hideCombatAlert(`${alertSourceId}:${HEAVY_ATTACKS.laneDenial}`);
    },
  };
}

export function markHeavyGunshipPartDestroyed(runtime: HeavyGunshipRuntime, partId: string): HeavyGunshipPartTransition | undefined {
  const part = runtime.getPart(partId);
  if (!part) return undefined;
  if (part.definition.destroyable === false) return updateHeavyGunshipPartState(runtime, part);
  markEnemyPartDestroyed(part);
  return updateHeavyGunshipPartState(runtime, part);
}

export function getHeavyGunshipPartTarget(runtime: HeavyGunshipRuntime, partId: string): LockCandidate | undefined {
  const index = runtime.parts.findIndex(part => part.id === partId);
  return index >= 0 ? runtime.lockCandidates[index] : undefined;
}
