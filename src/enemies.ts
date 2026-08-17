import * as THREE from 'three';
import { createEnemyA } from './models';
import { spawnExplosion } from './effects';
import { createAttackController, AttackController } from './attacks';
import {
  createHeavyGunshipRuntime,
  emitCombatEvent,
  HeavyGunshipRuntime,
  invalidateHeavyGunshipTargets,
  resolveHeavyGunshipPartDamage,
} from './heavy-gunship';
import {
  ENEMY_DEFINITIONS,
  EnemyDefinition,
  EnemyType,
  MOVEMENT_PATTERNS,
} from './enemy-definitions';
import {
  EncounterDefinition,
  EncounterState,
  EncounterStatus,
  STAGE_ENCOUNTERS,
} from './encounters';
import type { LockCandidate } from './targeting';
import { canHitEnemyPart } from './enemy-parts';
import type { EnemyHitTarget, EnemyPartState } from './enemy-parts';

export interface Enemy {
  id: string;
  encounterId: string;
  lockCandidate: LockCandidate;
  group: THREE.Group;
  hp: number;
  maxHp: number;
  radius: number;
  alive: boolean;
  age: number;
  type: EnemyType;
  baseX: number;
  baseY: number;
  score: number;
  definition: EnemyDefinition;
  attackController: AttackController;
  weakPoint?: THREE.Object3D;
  weakPointRadius: number;
  vulnerable: boolean;
  shielded: boolean;
  damageMultiplier: number;
  shieldVisual?: THREE.Object3D;
  flags: Record<string, boolean>;
  chargeTarget?: THREE.Vector3;
  /** Runtime part states; legacy enemies expose an empty list. */
  parts: EnemyPartState[];
  partById: ReadonlyMap<string, EnemyPartState>;
  partLockCandidates: LockCandidate[];
  heavyRuntime?: HeavyGunshipRuntime;
  rootDeathHandled: boolean;
  encounterLiveCounted: boolean;
}

const enemies: Enemy[] = [];
let scene: THREE.Scene;
let onKill: (pos: THREE.Vector3, score: number) => void;
let speedMult = 1.0;
let currentEncounters: EncounterDefinition[] = STAGE_ENCOUNTERS[0];
let encounterIdx = 0;
let nextEnemyId = 0;

interface SpawnJob {
  at: number;
  encounterId: string;
  type: EnemyType;
  x: number;
  y: number;
}

const spawnQueue: SpawnJob[] = [];
const encounterStates = new Map<string, EncounterState>();
const lockCandidates: LockCandidate[] = [];

function resetEncounterStates(): void {
  encounterStates.clear();
  for (const definition of currentEncounters) {
    encounterStates.set(definition.id, {
      id: definition.id,
      status: 'scheduled',
      spawned: 0,
      pending: 0,
      live: 0,
    });
  }
}

function getEncounterStateMutable(id: string): EncounterState | undefined {
  return encounterStates.get(id);
}

function registerSpawn(id: string, pending = false): void {
  const state = getEncounterStateMutable(id);
  if (!state) return;
  if (pending) state.pending += 1;
  else {
    state.pending = Math.max(0, state.pending - 1);
    state.spawned += 1;
    state.live += 1;
  }
}

function removeLiveEnemy(id: string): void {
  const state = getEncounterStateMutable(id);
  if (state) state.live = Math.max(0, state.live - 1);
}

function releaseEncounterLive(e: Enemy): void {
  if (!e.encounterLiveCounted) return;
  e.encounterLiveCounted = false;
  removeLiveEnemy(e.encounterId);
}

function emitEnemyEvent<T>(type: string, detail: T): void {
  emitCombatEvent(type, detail);
}

function checkEncounterCompletion(): void {
  for (const definition of currentEncounters) {
    const state = encounterStates.get(definition.id);
    if (!state || state.status !== 'active' || definition.completionCondition !== 'clearAll') continue;
    if (state.pending !== 0 || state.live !== 0) continue;
    state.status = 'completed';
    dispatchEvent(new CustomEvent('combat:encounter-complete', {
      detail: { id: state.id, status: state.status },
    }));
  }
}

function addRing(group: THREE.Group, radius: number, color: number, opacity = 0.75): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.12, 6, 20),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity }),
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  return ring;
}

function makeMineVisual(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(1.15, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xff4a3d, flatShading: true }),
  );
  const ring = addRing(group, 1.65, 0xffaa44, 0.9);
  const spikes = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.65, 0),
    new THREE.MeshBasicMaterial({ color: 0xff3322, wireframe: true }),
  );
  group.add(body, ring, spikes);
  return group;
}

function makeEnemyVisual(definition: EnemyDefinition): { group: THREE.Group; weakPoint?: THREE.Object3D; shieldVisual?: THREE.Object3D } {
  if (definition.type === 'mine') return { group: makeMineVisual() };

  const group = createEnemyA();
  const body = group.children[0] as THREE.Mesh;
  const bodyMat = body.material as THREE.MeshLambertMaterial;
  bodyMat.color.setHex(definition.color);

  if (definition.type === 'sniper') {
    addRing(group, 2.8, 0xff3344, 0.6);
  } else if (definition.type === 'shieldDrone') {
    addRing(group, 2.9, 0x66ccff, 0.95);
    addRing(group, 3.3, 0x2266ff, 0.4);
  } else if (definition.type === 'kamikaze') {
    addRing(group, 2.4, 0xff5522, 0.9);
  } else if (definition.type === 'missileCarrier') {
    addRing(group, 3.2, 0xffcc44, 0.65);
    const launcherMat = new THREE.MeshLambertMaterial({ color: 0xffaa33, flatShading: true });
    const launcherGeo = new THREE.CylinderGeometry(0.32, 0.5, 2.5, 6);
    for (const x of [-1.2, 1.2]) {
      const launcher = new THREE.Mesh(launcherGeo, launcherMat);
      launcher.rotation.x = Math.PI / 2;
      launcher.position.set(x, 0.5, 0.8);
      group.add(launcher);
    }
  } else if (definition.type === 'mineLayer') {
    addRing(group, 3.0, 0x66ee88, 0.65);
    bodyMat.color.setHex(0x248c58);
  }

  let weakPoint: THREE.Object3D | undefined;
  if (definition.type === 'armoredFighter') {
    const armorRing = addRing(group, 3.2, 0xb8c9dd, 0.65);
    armorRing.rotation.z = Math.PI / 2;
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffde55 }),
    );
    core.position.set(0, 0, 1.25);
    core.visible = false;
    group.add(core);
    weakPoint = core;
  }

  const shieldVisual = addRing(group, definition.radius * 1.55, 0x55bfff, 0.8);
  shieldVisual.visible = false;
  return { group, weakPoint, shieldVisual };
}

export function initEnemies(s: THREE.Scene, killCb: (pos: THREE.Vector3, score: number) => void): void {
  scene = s;
  onKill = killCb;
}

export function setStageWaves(stage: number): void {
  currentEncounters = STAGE_ENCOUNTERS[Math.min(stage - 1, STAGE_ENCOUNTERS.length - 1)];
  resetEncounterStates();
}

export function setEnemySpeedMult(mult: number): void {
  speedMult = mult;
}

export function resetEnemies(): void {
  for (const e of enemies) {
    if (e.heavyRuntime) e.heavyRuntime.dispose();
    else e.attackController.dispose();
    scene.remove(e.group);
  }
  enemies.length = 0;
  lockCandidates.length = 0;
  spawnQueue.length = 0;
  encounterIdx = 0;
  nextEnemyId = 0;
  resetEncounterStates();
}

function spawnEnemy(type: EnemyType, x: number, y: number, encounterId: string): void {
  const definition = ENEMY_DEFINITIONS[type];
  const id = `enemy-${nextEnemyId++}`;
  registerSpawn(encounterId);
  let enemy: Enemy | undefined;
  const flags: Record<string, boolean> = {};
  const heavyRuntime = type === 'heavyGunship'
    ? createHeavyGunshipRuntime(scene, id, definition, flags, () => Boolean(enemy?.alive))
    : undefined;
  const visual = heavyRuntime
    ? { group: heavyRuntime.group }
    : makeEnemyVisual(definition);
  const group = visual.group;
  group.scale.setScalar(definition.scale);
  group.position.set(x, y, type === 'turret' ? -80 : -200);
  if (type === 'turret') group.position.y = 0;

  scene.add(group);
  const lockCandidate: LockCandidate = {
    id,
    object: group,
    lockable: type !== 'mine' && type !== 'heavyGunship',
    isValid: () => Boolean(enemy?.alive),
  };
  const partLockCandidates = heavyRuntime ? [...heavyRuntime.lockCandidates] : [lockCandidate];
  const heavyRootCandidate = heavyRuntime
    ? partLockCandidates.find(candidate => candidate.id === `${id}:hull`) ?? partLockCandidates[0]
    : lockCandidate;
  const parts = heavyRuntime ? [...heavyRuntime.parts] : [];
  const partById = heavyRuntime ? new Map(parts.map(part => [part.id, part])) : new Map<string, EnemyPartState>();
  enemy = {
    id,
    encounterId,
    lockCandidate: heavyRootCandidate,
    group,
    hp: definition.hp,
    maxHp: definition.hp,
    radius: definition.radius,
    alive: true,
    age: 0,
    type,
    baseX: x,
    baseY: y,
    score: definition.score,
    definition,
    attackController: heavyRuntime?.attackController ?? createAttackController(scene, definition.attacks, id),
    weakPoint: 'weakPoint' in visual ? visual.weakPoint : undefined,
    weakPointRadius: definition.weakPointRadius ?? 0,
    vulnerable: false,
    shielded: false,
    damageMultiplier: 1,
    shieldVisual: 'shieldVisual' in visual ? visual.shieldVisual : undefined,
    flags,
    parts,
    partById,
    partLockCandidates,
    heavyRuntime,
    rootDeathHandled: false,
    encounterLiveCounted: true,
  };
  enemies.push(enemy);
  lockCandidates.push(...partLockCandidates);
}

function spawnMineField(origin: THREE.Vector3, pattern: number, encounterId: string): void {
  const laneX = [-8, 0, 8];
  const occupied = pattern === 0 ? [0, 1] : pattern === 1 ? [1, 2] : [0, 2];
  const laneY = pattern === 2 ? [4.5, 8.5] : [5.5, 6.5];
  for (let i = 0; i < occupied.length; i++) {
    const lane = occupied[i];
    const visual = makeMineVisual();
    visual.position.set(laneX[lane], laneY[i], origin.z);
    scene.add(visual);
    const definition = ENEMY_DEFINITIONS.mine;
    const id = `enemy-${nextEnemyId++}`;
    const state = getEncounterStateMutable(encounterId);
    if (state) state.live += 1;
    let enemy: Enemy | undefined;
    const lockCandidate: LockCandidate = {
      id,
      object: visual,
      lockable: false,
      isValid: () => Boolean(enemy?.alive),
    };
    enemy = {
      id,
      encounterId,
      lockCandidate,
      group: visual,
      hp: definition.hp,
      maxHp: definition.hp,
      radius: definition.radius,
      alive: true,
      age: 0,
      type: 'mine',
      baseX: laneX[lane],
      baseY: laneY[i],
      score: definition.score,
      definition,
      attackController: createAttackController(scene, [], id),
      weakPointRadius: 0,
      vulnerable: false,
      shielded: false,
      damageMultiplier: 1,
      flags: {},
      parts: [],
      partById: new Map<string, EnemyPartState>(),
      partLockCandidates: [lockCandidate],
      rootDeathHandled: false,
      encounterLiveCounted: true,
    };
    enemies.push(enemy);
    lockCandidates.push(lockCandidate);
  }
}

function updateSupport(): void {
  for (const e of enemies) {
    e.shielded = false;
    e.damageMultiplier = 1;
    if (e.shieldVisual) e.shieldVisual.visible = false;
  }

  for (const source of enemies) {
    if (!source.alive || !source.definition.support) continue;
    const support = source.definition.support;
    for (const target of enemies) {
      if (!target.alive || target === source || target.type === 'mine') continue;
      if (source.group.position.distanceTo(target.group.position) <= support.radius) {
        target.shielded = true;
        target.damageMultiplier = Math.min(target.damageMultiplier, support.damageMultiplier);
        if (target.shieldVisual) target.shieldVisual.visible = true;
      }
    }
  }
}

export function updateEnemies(
  dt: number,
  stageTime: number,
  playerPos: THREE.Vector3,
  paceMultiplier: number,
): void {
  while (encounterIdx < currentEncounters.length && stageTime >= currentEncounters[encounterIdx].startTime) {
    const encounter = currentEncounters[encounterIdx];
    const state = encounterStates.get(encounter.id);
    if (state) {
      state.status = 'active';
      state.pending = 0;
    }
    for (const spawn of encounter.enemies) {
      const count = spawn.count ?? 1;
      const gap = spawn.gap ?? 0;
      for (let i = 0; i < count; i++) {
        spawnQueue.push({
          at: encounter.startTime + i * gap,
          encounterId: encounter.id,
          type: spawn.type,
          x: spawn.x,
          y: spawn.y,
        });
        registerSpawn(encounter.id, true);
      }
    }
    dispatchEvent(new CustomEvent('combat:encounter', {
      detail: { id: encounter.id, objective: encounter.objective ?? '', status: 'active' as EncounterStatus },
    }));
    encounterIdx++;
  }

  for (let i = spawnQueue.length - 1; i >= 0; i--) {
    if (stageTime < spawnQueue[i].at) continue;
    const { encounterId, type, x, y } = spawnQueue[i];
    spawnQueue.splice(i, 1);
    spawnEnemy(type, x, y, encounterId);
  }

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (!e.alive) {
      releaseEncounterLive(e);
      if (e.heavyRuntime) e.heavyRuntime.dispose();
      else e.attackController.dispose();
      scene.remove(e.group);
      for (const candidate of e.partLockCandidates) {
        const candidateIndex = lockCandidates.indexOf(candidate);
        if (candidateIndex >= 0) lockCandidates.splice(candidateIndex, 1);
      }
      enemies.splice(i, 1);
      continue;
    }

    e.age += dt;
    e.flags.chargeActive = false;
    e.flags.vulnerable = false;
    const attackContext = {
      scene,
      alertSourceId: e.id,
      group: e.group,
      age: e.age,
      dt,
      playerPos,
      flags: e.flags,
      chargeTarget: e.chargeTarget,
      spawnMineField: (origin: THREE.Vector3, pattern: number) => spawnMineField(origin, pattern, e.encounterId),
    };
    e.attackController.update(attackContext);
    e.chargeTarget = attackContext.chargeTarget;
    e.vulnerable = Boolean(e.flags.vulnerable);
    if (e.weakPoint) {
      e.weakPoint.visible = e.vulnerable;
      e.weakPoint.scale.setScalar(1 + Math.sin(e.age * 12) * 0.12);
    }

    MOVEMENT_PATTERNS[e.definition.movement]({
      group: e.group,
      baseX: e.baseX,
      baseY: e.baseY,
      age: e.age,
      dt,
      playerPos,
      speedMult,
      paceMultiplier,
      moveSpeed: e.definition.moveSpeed,
      flags: e.flags,
      chargeTarget: e.chargeTarget,
    });

    if (e.type !== 'heavyGunship' && e.group.position.z > 28) {
      e.alive = false;
      releaseEncounterLive(e);
      invalidateEnemyTargets(e);
    }
  }

  updateSupport();
  checkEncounterCompletion();
}

export function getEnemies(): Enemy[] { return enemies; }

export function getLockCandidates(): readonly LockCandidate[] { return lockCandidates; }

export function allWavesCleared(): boolean {
  return encounterIdx >= currentEncounters.length && spawnQueue.length === 0 && enemies.length === 0;
}

export function getEncounterStates(): EncounterState[] {
  return currentEncounters.map(definition => ({ ...encounterStates.get(definition.id)! }));
}

export function getEncounterState(id: string): EncounterState | undefined {
  const state = encounterStates.get(id);
  return state ? { ...state } : undefined;
}

function invalidateEnemyTargets(e: Enemy): void {
  if (e.heavyRuntime) invalidateHeavyGunshipTargets(e.heavyRuntime);
  emitEnemyEvent('combat:enemy-target-invalidated', {
    enemyId: e.id,
    reason: 'root-destroyed',
  });
}

function rootDeath(e: Enemy, reason: 'destroyed' | 'force' = 'destroyed'): boolean {
  if (!e.alive || e.rootDeathHandled) return false;
  e.rootDeathHandled = true;
  e.alive = false;
  e.hp = 0;
  releaseEncounterLive(e);
  invalidateEnemyTargets(e);

  const position = e.group.position.clone();
  emitEnemyEvent('combat:enemy-root-destroyed', {
    enemyId: e.id,
    enemy: e,
    reason,
    score: e.score,
    position,
  });
  // Keep the legacy event name available to UI/gameplay listeners that only
  // need the root transition and do not care which enemy type caused it.
  emitEnemyEvent('combat:enemy-destroyed', {
    enemyId: e.id,
    enemy: e,
    reason,
    score: e.score,
    position,
  });
  spawnExplosion(position, 14, e.type === 'mine' ? 0xffaa44 : 0xff6600);
  onKill?.(position, e.score);
  return true;
}

function partScore(part: EnemyPartState): number {
  const score = part.definition.metadata?.score;
  return typeof score === 'number' && Number.isFinite(score) ? score : 0;
}

function partWorldPosition(part: EnemyPartState, fallback: THREE.Vector3): THREE.Vector3 {
  return part.node?.getWorldPosition(new THREE.Vector3()) ?? fallback.clone();
}

function resolvePartHit(e: Enemy, part: EnemyPartState, damage: number): PlayerBulletHitResult {
  const effectiveDamage = damage * e.damageMultiplier;
  const result = e.heavyRuntime
    ? resolveHeavyGunshipPartDamage(e.heavyRuntime, part, effectiveDamage)
    : undefined;
  if (!result) {
    return {
      enemy: e,
      part,
      accepted: false,
      hit: false,
      damage: 0,
      appliedDamage: 0,
      requestedDamage: damage,
      remainingHp: part.hp,
      destroyed: part.destroyed,
      wasDestroyed: false,
    };
  }

  const position = partWorldPosition(part, e.group.position);
  if (result.accepted) {
    emitEnemyEvent('combat:enemy-hit', {
      enemyId: e.id,
      enemy: e,
      partId: part.id,
      part,
      damage: result.appliedDamage,
      remainingHp: result.remainingHp,
      position,
    });
  }
  if (result.accepted && e.heavyRuntime && part.id === 'hull') {
    // Hull is a non-destroyable armor target; route effective damage to
    // the root so baseline fire can eventually finish the encounter.
    e.hp = Math.max(0, e.hp - result.appliedDamage);
    if (e.hp <= 0) rootDeath(e);
  }
  if (result.wasDestroyed) {
    const score = partScore(part);
    emitEnemyEvent('combat:enemy-part-destroyed', {
      enemyId: e.id,
      enemy: e,
      partId: part.id,
      part,
      score,
      position,
    });
    if (part.id === 'core') rootDeath(e);
  }

  return {
    enemy: e,
    part,
    target: result.target,
    accepted: result.accepted,
    hit: result.hit,
    damage: result.damage,
    appliedDamage: result.appliedDamage,
    requestedDamage: damage,
    remainingHp: result.remainingHp,
    destroyed: result.destroyed,
    wasDestroyed: result.wasDestroyed,
    rootDestroyed: e.rootDeathHandled,
    partScore: result.wasDestroyed ? partScore(part) : 0,
    reason: result.reason,
  };
}

function enemyForTarget(target: EnemyHitTarget | LockCandidate | Enemy): Enemy | undefined {
  if ('encounterId' in target && 'group' in target) return target as Enemy;
  const targetId = target.id;
  const explicitEnemyId = 'enemyId' in target && typeof target.enemyId === 'string' ? target.enemyId : undefined;
  return enemies.find(e => {
    if (!e.alive) return false;
    if (explicitEnemyId && e.id === explicitEnemyId) return true;
    return e.id === targetId || e.partLockCandidates.some(candidate => candidate === target || candidate.id === targetId)
      || e.group === target.object;
  });
}

function partForTarget(e: Enemy, target: EnemyHitTarget | LockCandidate | Enemy): EnemyPartState | undefined {
  if (!e.heavyRuntime || target === e) return undefined;
  const targetId = target.id;
  const separator = targetId.indexOf(':');
  if (separator >= 0) {
    const part = e.partById.get(targetId.slice(separator + 1));
    if (part) return part;
  }
  const object = 'object' in target ? target.object : undefined;
  return object ? e.heavyRuntime.getPartForTarget(object) : undefined;
}

function sphereIntersects(
  position: THREE.Vector3,
  radius: number,
  node: THREE.Object3D,
  nodeRadius: number,
  scale = 1,
): boolean {
  return position.distanceTo(node.getWorldPosition(new THREE.Vector3())) <= radius + nodeRadius * scale;
}

function findHeavyHitPart(e: Enemy, position: THREE.Vector3, radius: number): EnemyPartState | undefined {
  const scale = e.group.scale.x;
  // Specific modules win over the broad hull volume when their volumes
  // overlap. This makes a bullet at a cannon/core resolve to that part.
  const priority = ['core', 'leftCannon', 'rightCannon', 'engine', 'hull'];
  for (const id of priority) {
    const part = e.partById.get(id);
    if (!part || !canHitPart(part)) continue;
    if (part.node && sphereIntersects(position, radius, part.node, part.radius, scale)) return part;
  }
  return undefined;
}

function canHitPart(part: EnemyPartState): boolean {
  return canHitEnemyPart(part);
}

export interface PlayerBulletHitResult {
  enemy: Enemy;
  part?: EnemyPartState;
  target?: EnemyHitTarget;
  accepted: boolean;
  hit: boolean;
  damage: number;
  appliedDamage: number;
  requestedDamage: number;
  remainingHp: number;
  destroyed: boolean;
  wasDestroyed: boolean;
  rootDestroyed?: boolean;
  partScore?: number;
  reason?: string;
}

/** Return the live state for a multipart part without exposing another registry. */
export function getEnemyPart(enemyOrId: Enemy | string, partId: string): EnemyPartState | undefined {
  const enemy = typeof enemyOrId === 'string' ? enemies.find(candidate => candidate.id === enemyOrId) : enemyOrId;
  return enemy?.partById.get(partId);
}

export function getEnemyPartLockCandidates(enemyOrId: Enemy | string): readonly LockCandidate[] {
  const enemy = typeof enemyOrId === 'string' ? enemies.find(candidate => candidate.id === enemyOrId) : enemyOrId;
  return enemy?.partLockCandidates ?? [];
}

/**
 * Resolve one player shot against either a supplied lock target or the first
 * intersecting enemy/part. The caller owns projectile removal and scoring.
 */
export function resolvePlayerBulletHit(
  position: THREE.Vector3,
  radius: number,
  damage: number,
  target?: EnemyHitTarget | LockCandidate | Enemy,
): PlayerBulletHitResult | undefined {
  if (!Number.isFinite(damage) || damage <= 0 || !Number.isFinite(radius) || radius < 0) return undefined;

  const candidates = target ? [enemyForTarget(target)] : enemies;
  for (const candidate of candidates) {
    const e = candidate;
    if (!e || !e.alive) continue;

    if (target) {
      if ('isValid' in target && !target.isValid()) return undefined;
      const part = partForTarget(e, target);
      if (part) {
        if (!part.node || !canHitPart(part) || !sphereIntersects(position, radius, part.node, part.radius, e.group.scale.x)) return undefined;
        return resolvePartHit(e, part, damage);
      }
      if (!sphereIntersects(position, radius, e.group, e.radius, e.group.scale.x)) return undefined;
      damageEnemy(e, damage);
      return {
        enemy: e,
        accepted: true,
        hit: true,
        damage,
        appliedDamage: damage,
        requestedDamage: damage,
        remainingHp: Math.max(0, e.hp),
        destroyed: !e.alive,
        wasDestroyed: !e.alive,
        rootDestroyed: e.rootDeathHandled,
      };
    }

    if (e.heavyRuntime) {
      const part = findHeavyHitPart(e, position, radius);
      if (part) return resolvePartHit(e, part, damage);
      continue;
    }

    const weakPointHit = e.weakPoint && e.vulnerable && sphereIntersects(
      position,
      radius,
      e.weakPoint,
      e.weakPointRadius,
    );
    const bodyHit = sphereIntersects(position, radius, e.group, e.radius);
    if (!weakPointHit && !bodyHit) continue;
    const appliedDamage = damage * (weakPointHit ? 3 : 1) * e.damageMultiplier
      * (e.type === 'armoredFighter' && !e.vulnerable ? 0.08 : 1);
    damageEnemy(e, damage * (weakPointHit ? 3 : 1));
    emitEnemyEvent('combat:enemy-hit', {
      enemyId: e.id,
      enemy: e,
      damage: appliedDamage,
      weakPoint: Boolean(weakPointHit),
      position: weakPointHit
        ? e.weakPoint?.getWorldPosition(new THREE.Vector3())
        : e.group.position.clone(),
    });
    return {
      enemy: e,
      accepted: true,
      hit: true,
      damage: appliedDamage,
      appliedDamage,
      requestedDamage: damage,
      remainingHp: Math.max(0, e.hp),
      destroyed: !e.alive,
      wasDestroyed: !e.alive,
      rootDestroyed: e.rootDeathHandled,
    };
  }
  return undefined;
}

export function damageEnemy(e: Enemy, dmg: number): void {
  if (!e.alive || !Number.isFinite(dmg) || dmg <= 0) return;
  if (e.heavyRuntime) {
    // Preserve the legacy contact-damage escape hatch (the player collision
    // path uses a large sentinel) without making ordinary body damage bypass
    // the multipart rules.
    if (dmg >= e.maxHp) {
      rootDeath(e);
      return;
    }
    const hull = e.partById.get('hull');
    if (hull) resolvePartHit(e, hull, dmg);
    return;
  }
  const armorMultiplier = e.type === 'armoredFighter' && !e.vulnerable ? 0.08 : 1;
  e.hp -= dmg * e.damageMultiplier * armorMultiplier;
  emitEnemyEvent('combat:enemy-hit', {
    enemyId: e.id,
    enemy: e,
    damage: dmg * e.damageMultiplier * armorMultiplier,
    position: e.group.position.clone(),
  });
  if (e.hp <= 0) rootDeath(e);
}

/** Destroy only the root once; destroying a child part never calls this path. */
export function forceDestroyEnemy(enemyOrId: Enemy | string): boolean {
  const enemy = typeof enemyOrId === 'string' ? enemies.find(candidate => candidate.id === enemyOrId) : enemyOrId;
  return enemy ? rootDeath(enemy, 'force') : false;
}

export function getEnemyPartScore(part: EnemyPartState): number { return partScore(part); }

export function getEnemyScore(e: Enemy): number { return e.score; }

export type { EnemyType };
