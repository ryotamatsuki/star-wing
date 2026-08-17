import { EnemyType } from './enemy-definitions';

export interface EnemySpawnDefinition {
  type: EnemyType;
  x: number;
  y: number;
  count?: number;
  gap?: number;
}

export interface EncounterDefinition {
  id: string;
  startTime: number;
  enemies: EnemySpawnDefinition[];
  objective?: string;
  completionCondition?: 'clearAll';
}

export type EncounterStatus = 'scheduled' | 'active' | 'completed';

export interface EncounterState {
  id: string;
  status: EncounterStatus;
  spawned: number;
  pending: number;
  live: number;
}

function encounter(
  id: string,
  startTime: number,
  enemies: EnemySpawnDefinition[],
  objective?: string,
): EncounterDefinition {
  return { id, startTime, enemies, objective, completionCondition: 'clearAll' };
}

const fighterPair = (type: EnemyType, x: number, y: number, count = 2, gap = 0.4): EnemySpawnDefinition => ({
  type, x, y, count, gap,
});

export const STAGE_ENCOUNTERS: EncounterDefinition[][] = [
  [
    encounter('s1-opening', 3, [fighterPair('straight', -6, 6)]),
    encounter('s1-crossing', 5, [fighterPair('straight', 6, 6)]),
    encounter('s1-sine-lesson', 9, [{ type: 'sine', x: 0, y: 8, count: 3, gap: 0.6 }]),
    encounter('s1-turret-pair', 14, [fighterPair('turret', -8, 0, 1, 0), fighterPair('turret', 8, 0, 1, 0)]),
    encounter('s1-wide-pass', 20, [fighterPair('straight', -10, 7, 3, 0.3), fighterPair('straight', 10, 7, 3, 0.3)]),
    encounter('s1-sine-wave', 28, [{ type: 'sine', x: -4, y: 9, count: 4, gap: 0.5 }]),
    encounter('s1-turret-wall', 35, [
      fighterPair('turret', -12, 0, 1, 0), fighterPair('turret', 0, 0, 1, 0), fighterPair('turret', 12, 0, 1, 0),
    ]),
    encounter('s1-pressure', 40, [
      { type: 'kamikaze', x: -7, y: 5, count: 2, gap: 0.65 },
      { type: 'straight', x: 7, y: 7, count: 2, gap: 0.7 },
    ], 'Destroy the charging targets before they close in.'),
    encounter('s1-sine-finale', 48, [{ type: 'sine', x: 0, y: 10, count: 5, gap: 0.4 }]),
    encounter('s1-timing', 56, [
      { type: 'armoredFighter', x: 0, y: 7, count: 1 },
      { type: 'straight', x: -8, y: 7, count: 2, gap: 0.5 },
      { type: 'straight', x: 8, y: 7, count: 2, gap: 0.5 },
    ], 'Watch for the armored fighter\'s exposed core.'),
  ],
  [
    encounter('s2-opening', 2, [fighterPair('straight', -5, 6, 3, 0.3), fighterPair('straight', 5, 6, 3, 0.3)]),
    encounter('s2-sine', 7, [{ type: 'sine', x: 0, y: 8, count: 4, gap: 0.5 }]),
    encounter('s2-turrets', 10, [fighterPair('turret', -8, 0, 1, 0), fighterPair('turret', 8, 0, 1, 0)]),
    encounter('s2-movement-trap', 22, [
      { type: 'mineLayer', x: 0, y: 6, count: 1 },
      { type: 'sniper', x: -7, y: 8, count: 1, gap: 0.5 },
    ], 'Read the mine lane, then move before the sniper locks on.'),
    encounter('s2-wide-pass', 31, [fighterPair('straight', -8, 6, 5, 0.22), fighterPair('straight', 8, 6, 5, 0.22)]),
    encounter('s2-sine-finale', 42, [{ type: 'sine', x: 4, y: 8, count: 6, gap: 0.32 }]),
    encounter('s2-movement-trap-2', 52, [
      { type: 'mineLayer', x: 0, y: 6, count: 1 },
      { type: 'sniper', x: 7, y: 8, count: 1, gap: 0.4 },
      { type: 'turret', x: -10, y: 0, count: 1 },
    ], 'Choose a safe lane while both threats are active.'),
  ],
  [
    encounter('s3-opening', 2, [fighterPair('sine', -4, 8, 3, 0.5), fighterPair('sine', 4, 8, 3, 0.5)]),
    encounter('s3-target-priority', 12, [
      { type: 'shieldDrone', x: 0, y: 6, count: 1 },
      { type: 'straight', x: -7, y: 7, count: 3, gap: 0.45 },
      { type: 'straight', x: 7, y: 7, count: 3, gap: 0.45 },
      { type: 'armoredFighter', x: 0, y: 9, count: 1, gap: 0.8 },
    ], 'Take down the shield drone first to open the formation.'),
    encounter('s3-sniper-support', 25, [
      { type: 'sniper', x: -6, y: 8, count: 1 },
      { type: 'shieldDrone', x: 5, y: 6, count: 1, gap: 0.6 },
      { type: 'turret', x: 10, y: 0, count: 1, gap: 0.6 },
    ], 'Break support, then answer the sniper telegraph.'),
    encounter('s3-timing', 38, [
      { type: 'armoredFighter', x: 0, y: 8, count: 1 },
      { type: 'straight', x: -8, y: 7, count: 4, gap: 0.3 },
      { type: 'straight', x: 8, y: 7, count: 4, gap: 0.3 },
    ], 'Manage the escorts while waiting for the weak-point window.'),
    encounter('s3-finale', 53, [{ type: 'sine', x: 2, y: 10, count: 7, gap: 0.28 }]),
  ],
  [
    encounter('s4-opening', 2, [fighterPair('straight', -4, 6, 4, 0.22), fighterPair('straight', 4, 6, 4, 0.22)]),
    encounter('s4-pressure', 12, [
      { type: 'missileCarrier', x: 0, y: 7, count: 1 },
      { type: 'kamikaze', x: -6, y: 5, count: 2, gap: 0.55 },
      { type: 'kamikaze', x: 6, y: 5, count: 2, gap: 0.55 },
    ], 'Destroy the rushers while rolling through missile locks.'),
    encounter('s4-turrets', 22, [fighterPair('turret', -10, 0, 2, 4), fighterPair('turret', 10, 0, 2, 4)]),
    encounter('s4-movement-trap', 33, [
      { type: 'mineLayer', x: 0, y: 6, count: 1 },
      { type: 'sniper', x: 0, y: 9, count: 1, gap: 0.7 },
      { type: 'straight', x: -9, y: 7, count: 3, gap: 0.3 },
    ], 'The mine pattern changes the route while the sniper watches.'),
    encounter('s4-pressure-2', 48, [
      { type: 'heavyGunship', x: 0, y: 7, count: 1 },
      { type: 'kamikaze', x: -7, y: 5, count: 2, gap: 0.5 },
      { type: 'kamikaze', x: 7, y: 5, count: 2, gap: 0.5 },
    ], 'Prioritize the closest threat, then break the next lock.'),
  ],
  [
    encounter('s5-opening', 1, [fighterPair('straight', -5, 6, 4, 0.2), fighterPair('straight', 5, 6, 4, 0.2)]),
    encounter('s5-target-priority', 12, [
      { type: 'shieldDrone', x: 0, y: 6, count: 1 },
      { type: 'armoredFighter', x: -6, y: 8, count: 1, gap: 0.5 },
      { type: 'turret', x: 8, y: 0, count: 1, gap: 0.5 },
      { type: 'straight', x: 6, y: 8, count: 3, gap: 0.35 },
    ], 'Choose the support target before the formation overwhelms you.'),
    encounter('s5-movement-trap', 26, [
      { type: 'mineLayer', x: 0, y: 6, count: 1 },
      { type: 'sniper', x: -6, y: 8, count: 1 },
      { type: 'turret', x: 9, y: 0, count: 1, gap: 0.5 },
    ], 'Read the route and move before both aim patterns resolve.'),
    encounter('s5-pressure', 40, [
      { type: 'missileCarrier', x: 0, y: 7, count: 1 },
      { type: 'kamikaze', x: -6, y: 5, count: 3, gap: 0.5 },
      { type: 'kamikaze', x: 6, y: 5, count: 3, gap: 0.5 },
    ], 'Shorten the fight: remove rushers and roll through the lock.'),
    encounter('s5-timing-finale', 55, [
      { type: 'heavyGunship', x: 0, y: 8, count: 1 },
      { type: 'sniper', x: -8, y: 8, count: 1, gap: 0.6 },
      { type: 'mineLayer', x: 8, y: 6, count: 1, gap: 0.6 },
      { type: 'straight', x: 0, y: 10, count: 4, gap: 0.25 },
    ], 'Final exam: aim, route, timing, and threat priority together.'),
  ],
];
