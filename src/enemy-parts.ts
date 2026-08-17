import type { Object3D } from 'three';

/**
 * Well-known part categories. The open string branch lets an enemy introduce
 * a more specific category without this low-level module needing to know it.
 */
export type EnemyPartKind =
  | 'root'
  | 'body'
  | 'weakPoint'
  | 'core'
  | 'armor'
  | 'shield'
  | 'weapon'
  | 'turret'
  | 'wing'
  | 'engine'
  | 'module'
  | (string & {});

export type EnemyPartRule = boolean | ((part: EnemyPartState) => boolean);

export interface EnemyPartDefinition {
  /** Stable identifier within an enemy, for example "left-wing". */
  id: string;
  kind: EnemyPartKind;

  /** Either hp or maxHp may be supplied; hp takes precedence. */
  hp?: number;
  maxHp?: number;

  /** The rendered node used for collision and/or lock targeting. */
  node?: Object3D;
  /** Legacy-friendly aliases for the rendered target node. */
  object?: Object3D;
  targetObject?: Object3D;

  /** Collision radius and damage multiplier exposed on the target metadata. */
  radius?: number;
  hitRadius?: number;
  damageMultiplier?: number;

  /** Rules are evaluated against the live state, so attack windows can be dynamic. */
  canHit?: EnemyPartRule;
  canLock?: EnemyPartRule;

  /** Whether damage may transition this part to destroyed. */
  destroyable?: boolean;

  /** Destruction visuals. Hiding is enabled by default; detaching is opt-in. */
  hideOnDestroy?: boolean;
  detachOnDestroy?: boolean;

  /** Optional identity used when building a stable target id. */
  enemyId?: string;
  targetId?: string;

  /** Application-specific metadata copied once onto the stable target object. */
  metadata?: Readonly<Record<string, unknown>>;
}

export interface EnemyPartState {
  readonly definition: EnemyPartDefinition;
  readonly id: string;
  readonly partId: string;
  readonly kind: EnemyPartKind;
  readonly enemyId?: string;
  readonly node?: Object3D;
  /** Alias of node retained for callers using the legacy object vocabulary. */
  readonly object?: Object3D;
  readonly radius: number;
  readonly damageMultiplier: number;

  hp: number;
  readonly maxHp: number;
  damageTaken: number;
  destroyed: boolean;
  hidden: boolean;
  detached: boolean;
  enabled: boolean;
  hitEnabled: boolean;
  lockEnabled: boolean;

  /** Cached target metadata; its object identity remains stable for this part. */
  target?: EnemyHitTarget;
  /** Alias of target for callers that distinguish hit targets explicitly. */
  hitTarget?: EnemyHitTarget;
}

/**
 * A target is structurally compatible with the legacy targeting pipeline:
 * id, object, lockable, and isValid are intentionally present with the same
 * meaning as a legacy LockCandidate.
 */
export interface EnemyHitTarget {
  readonly id: string;
  readonly enemyId?: string;
  readonly partId: string;
  readonly kind: EnemyPartKind;
  readonly object: Object3D;
  readonly node: Object3D;
  readonly radius: number;
  readonly damageMultiplier: number;
  readonly lockable: boolean;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly isValid: () => boolean;
  readonly canHit: () => boolean;
  readonly canLock: () => boolean;
}

export type EnemyHitRejectReason =
  | 'invalid-damage'
  | 'part-destroyed'
  | 'part-disabled'
  | 'part-not-hittable';

export interface EnemyHitResult {
  readonly part: EnemyPartState;
  readonly target?: EnemyHitTarget;
  /** True when some damage was accepted and applied. */
  readonly accepted: boolean;
  /** Alias for accepted, useful at call sites that treat this as a hit event. */
  readonly hit: boolean;
  /** Effective damage after the part's damageMultiplier. */
  readonly damage: number;
  readonly appliedDamage: number;
  readonly requestedDamage: number;
  readonly remainingHp: number;
  readonly destroyed: boolean;
  /** True only for the call that crosses hp to zero. */
  readonly wasDestroyed: boolean;
  readonly reason?: EnemyHitRejectReason;
}

export interface EnemyPartStateOptions {
  /** Used to keep target ids unique across enemy instances. */
  enemyId?: string;
  /** Overrides the definition's initial hp. */
  initialHp?: number;
}

export interface EnemyPartDestructionOptions {
  hide?: boolean;
  detach?: boolean;
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function finitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function partNode(definition: EnemyPartDefinition): Object3D | undefined {
  return definition.node ?? definition.object ?? definition.targetObject;
}

function evaluateRule(rule: EnemyPartRule | undefined, part: EnemyPartState, defaultValue: boolean): boolean {
  if (rule === undefined) return defaultValue;
  return typeof rule === 'function' ? rule(part) : rule;
}

function isVisibleInScene(node: Object3D): boolean {
  let current: Object3D | null = node;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function isTargetValid(part: EnemyPartState): boolean {
  return part.enabled
    && !part.destroyed
    && !part.hidden
    && !part.detached
    && Boolean(part.node)
    && isVisibleInScene(part.node as Object3D);
}

/** Create mutable runtime state from a reusable part definition. */
export function createEnemyPartState(
  definition: EnemyPartDefinition,
  options: EnemyPartStateOptions | string = {},
): EnemyPartState {
  const resolvedOptions: EnemyPartStateOptions = typeof options === 'string'
    ? { enemyId: options }
    : options;
  const node = partNode(definition);
  const definitionHp = definition.hp ?? definition.maxHp;
  const maxHp = finitePositive(definition.maxHp ?? definition.hp, 1);
  const initialHp = finiteNonNegative(resolvedOptions.initialHp ?? definitionHp, maxHp);
  const enemyId = resolvedOptions.enemyId ?? definition.enemyId;
  const partId = definition.id;
  const targetId = definition.targetId ?? (enemyId ? `${enemyId}:${partId}` : partId);
  const radius = finiteNonNegative(definition.radius ?? definition.hitRadius, 0);
  const damageMultiplier = finiteNonNegative(definition.damageMultiplier, 1);
  const metadata: Readonly<Record<string, unknown>> = Object.freeze({
    ...(definition.metadata ?? {}),
    enemyId,
    partId,
    kind: definition.kind,
    targetId,
  });

  const state: EnemyPartState = {
    definition,
    id: partId,
    partId,
    kind: definition.kind,
    enemyId,
    node,
    object: node,
    radius,
    damageMultiplier,
    hp: Math.min(initialHp, maxHp),
    maxHp,
    damageTaken: 0,
    destroyed: false,
    hidden: false,
    detached: false,
    enabled: true,
    hitEnabled: definition.canHit !== false,
    lockEnabled: definition.canLock !== false,
  };

  if (node) {
    const target: EnemyHitTarget = {
      id: targetId,
      enemyId,
      partId,
      kind: definition.kind,
      object: node,
      node,
      radius,
      damageMultiplier,
      get lockable() {
        return canLockEnemyPart(state);
      },
      metadata,
      isValid: () => isTargetValid(state),
      canHit: () => canHitEnemyPart(state),
      canLock: () => canLockEnemyPart(state),
    };
    state.target = target;
    state.hitTarget = target;
  }

  return state;
}

/** Create multiple independent runtime states while preserving definition order. */
export function createEnemyPartStates(
  definitions: readonly EnemyPartDefinition[],
  options: EnemyPartStateOptions | string = {},
): EnemyPartState[] {
  return definitions.map(definition => createEnemyPartState(definition, options));
}

/** Whether a live part can receive damage at this moment. */
export function canHitEnemyPart(part: EnemyPartState): boolean {
  if (!part.enabled || !part.hitEnabled || part.destroyed || part.hidden || part.detached) return false;
  if (part.node && !isVisibleInScene(part.node)) return false;
  return evaluateRule(part.definition.canHit, part, true);
}

/** Whether a live part can be exposed to a lock-on/targeting system. */
export function canLockEnemyPart(part: EnemyPartState): boolean {
  if (!part.node || !part.enabled || !part.lockEnabled || part.destroyed || part.hidden || part.detached) return false;
  if (!isVisibleInScene(part.node)) return false;
  return evaluateRule(part.definition.canLock, part, true);
}

/** Short names for enemy code and for adapters around the legacy pipeline. */
export const canHit = canHitEnemyPart;
export const canLock = canLockEnemyPart;
export const createPartState = createEnemyPartState;

/** Return the cached target object rather than allocating a new metadata record. */
export function getEnemyHitTarget(part: EnemyPartState): EnemyHitTarget | undefined {
  return part.target;
}

export const getPartTarget = getEnemyHitTarget;
export const getEnemyPartTarget = getEnemyHitTarget;

/** Hide a part's node without changing its parent relationship. */
export function hideEnemyPart(part: EnemyPartState): boolean {
  part.hidden = true;
  if (!part.node) return false;
  part.node.visible = false;
  return true;
}

/** Show a part's node again. A destroyed or detached part remains non-targetable. */
export function showEnemyPart(part: EnemyPartState): boolean {
  part.hidden = false;
  if (!part.node) return false;
  part.node.visible = true;
  return true;
}

/** Remove a part node from its parent, idempotently. */
export function detachEnemyPart(part: EnemyPartState): boolean {
  part.detached = true;
  if (!part.node?.parent) return false;
  part.node.parent.remove(part.node);
  return true;
}

export const hidePartNode = hideEnemyPart;
export const detachPartNode = detachEnemyPart;
export const hidePart = hideEnemyPart;
export const detachPart = detachEnemyPart;

/**
 * Mark a part destroyed exactly once. The returned boolean is true only on
 * the transition from live to destroyed.
 */
export function markEnemyPartDestroyed(
  part: EnemyPartState,
  options: EnemyPartDestructionOptions = {},
): boolean {
  if (part.destroyed) return false;

  part.destroyed = true;
  part.hp = 0;
  part.hitEnabled = false;
  part.lockEnabled = false;

  const hide = options.hide ?? part.definition.hideOnDestroy ?? true;
  const detach = options.detach ?? part.definition.detachOnDestroy ?? false;
  if (hide) hideEnemyPart(part);
  if (detach) detachEnemyPart(part);
  return true;
}

export const markPartDestroyed = markEnemyPartDestroyed;

function rejectedHit(
  part: EnemyPartState,
  requestedDamage: number,
  reason: EnemyHitRejectReason,
): EnemyHitResult {
  return {
    part,
    target: part.target,
    accepted: false,
    hit: false,
    damage: 0,
    appliedDamage: 0,
    requestedDamage,
    remainingHp: part.hp,
    destroyed: part.destroyed,
    wasDestroyed: false,
    reason,
  };
}

/** Apply damage to a part and perform configured destruction handling. */
export function resolveEnemyPartDamage(
  part: EnemyPartState,
  damage: number,
): EnemyHitResult {
  if (!Number.isFinite(damage) || damage <= 0) return rejectedHit(part, damage, 'invalid-damage');
  if (part.destroyed) return rejectedHit(part, damage, 'part-destroyed');
  if (!part.enabled) return rejectedHit(part, damage, 'part-disabled');
  if (!canHitEnemyPart(part)) return rejectedHit(part, damage, 'part-not-hittable');

  const multiplier = part.damageMultiplier;
  const appliedDamage = damage * multiplier;
  const wasDestroyed = part.definition.destroyable !== false
    && part.hp > 0
    && appliedDamage >= part.hp;
  part.hp = Math.max(0, part.hp - appliedDamage);
  part.damageTaken += appliedDamage;
  if (wasDestroyed) markEnemyPartDestroyed(part);

  return {
    part,
    target: part.target,
    accepted: true,
    hit: true,
    damage: appliedDamage,
    appliedDamage,
    requestedDamage: damage,
    remainingHp: part.hp,
    destroyed: part.destroyed,
    wasDestroyed,
  };
}

export const resolvePartDamage = resolveEnemyPartDamage;
