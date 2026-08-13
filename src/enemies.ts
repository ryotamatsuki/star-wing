import * as THREE from 'three';
import { createEnemyA } from './models';
import { spawnExplosion } from './effects';
import { createAttackController, AttackController } from './attacks';
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
    e.attackController.dispose();
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
  const visual = makeEnemyVisual(definition);
  const group = visual.group;
  group.scale.setScalar(definition.scale);
  group.position.set(x, y, type === 'turret' ? -80 : -200);
  if (type === 'turret') group.position.y = 0;

  scene.add(group);
  const id = `enemy-${nextEnemyId++}`;
  registerSpawn(encounterId);
  let enemy: Enemy | undefined;
  const lockCandidate: LockCandidate = {
    id,
    object: group,
    lockable: type !== 'mine',
    isValid: () => Boolean(enemy?.alive),
  };
  enemy = {
    id,
    encounterId,
    lockCandidate,
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
    attackController: createAttackController(scene, definition.attacks, id),
    weakPoint: visual.weakPoint,
    weakPointRadius: definition.weakPointRadius ?? 0,
    vulnerable: false,
    shielded: false,
    damageMultiplier: 1,
    shieldVisual: visual.shieldVisual,
    flags: {},
  };
  enemies.push(enemy);
  lockCandidates.push(lockCandidate);
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

export function updateEnemies(dt: number, stageTime: number, playerPos: THREE.Vector3): void {
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
      removeLiveEnemy(e.encounterId);
      e.attackController.dispose();
      scene.remove(e.group);
      const candidateIndex = lockCandidates.indexOf(e.lockCandidate);
      if (candidateIndex >= 0) lockCandidates.splice(candidateIndex, 1);
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
      moveSpeed: e.definition.moveSpeed,
      flags: e.flags,
      chargeTarget: e.chargeTarget,
    });

    if (e.group.position.z > 28) e.alive = false;
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

export function damageEnemy(e: Enemy, dmg: number): void {
  if (!e.alive) return;
  const armorMultiplier = e.type === 'armoredFighter' && !e.vulnerable ? 0.08 : 1;
  e.hp -= dmg * e.damageMultiplier * armorMultiplier;
  if (e.hp <= 0) {
    e.alive = false;
    spawnExplosion(e.group.position.clone(), 14, e.type === 'mine' ? 0xffaa44 : 0xff6600);
    onKill?.(e.group.position.clone(), e.score);
  }
}

export function getEnemyScore(e: Enemy): number { return e.score; }

export type { EnemyType };
