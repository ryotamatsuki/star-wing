import * as THREE from 'three';
import type { ChargeStateDetail } from './player-weapons';
import type { FlightPaceState } from './flight-pace';

const scoreEl  = document.getElementById('score')!;
const stageEl  = document.getElementById('stage')!;
const shieldEl = document.getElementById('shield-bar')!;
const msgEl    = document.getElementById('message')!;
const bossHudEl = document.getElementById('boss-hud')!;
const bossHpEl  = document.getElementById('boss-hp-bar')!;
const combatAlertEl = document.getElementById('combat-alert')!;
const chargeHudEl = document.getElementById('charge-hud')!;
const chargeBarEl = document.getElementById('charge-bar')!;
const chargeLabelEl = document.getElementById('charge-label')!;
const paceHudEl = document.getElementById('pace-hud')!;
const paceLabelEl = document.getElementById('pace-label')!;
const paceFeedbackEl = document.getElementById('pace-feedback')!;

export function setScore(n: number): void {
  scoreEl.textContent = String(n);
}

export function setStage(n: number): void {
  stageEl.textContent = String(n);
}

export function setShield(current: number, max: number): void {
  const pct = Math.max(0, current / max * 100);
  shieldEl.style.width = `${pct}%`;
  shieldEl.classList.toggle('danger', pct < 30);
}

export function showMessage(text: string): void {
  msgEl.textContent = text;
}

export function hideMessage(): void {
  msgEl.textContent = '';
}

export function showBossHud(current: number, max: number): void {
  bossHudEl.hidden = false;
  updateBossHud(current, max);
}

export function updateBossHud(current: number, max: number): void {
  const pct = Math.max(0, Math.min(100, current / max * 100));
  bossHpEl.style.width = `${pct}%`;
}

export function hideBossHud(): void {
  bossHudEl.hidden = true;
  bossHpEl.style.width = '0%';
}

export interface CombatAlert {
  sourceId: string;
  message: string;
  priority: number;
  color: string;
  active: boolean;
  sequence: number;
}

export function updateChargeHud(detail: ChargeStateDetail): void {
  const active = detail.state !== 'idle';
  chargeHudEl.hidden = !active;
  if (!active) {
    chargeHudEl.classList.remove('ready', 'full');
    return;
  }
  chargeBarEl.style.width = `${detail.progress * 100}%`;
  chargeHudEl.classList.toggle('ready', detail.state === 'ready');
  chargeHudEl.classList.toggle('full', detail.full);
  chargeLabelEl.textContent = detail.full
    ? `FULL • LOCK ${detail.lockCount}/${detail.maxLocks}`
    : detail.state === 'ready'
      ? `READY • LOCK ${detail.lockCount}/${detail.maxLocks}`
      : 'CHARGE';
}

export function updateFlightPaceHud(state: FlightPaceState, multiplier: number): void {
  const active = state !== 'cruise';
  paceHudEl.hidden = !active;
  paceHudEl.classList.toggle('boost', state === 'boost');
  paceHudEl.classList.toggle('brake', state === 'brake');
  paceFeedbackEl.classList.toggle('boost', state === 'boost');
  paceFeedbackEl.classList.toggle('brake', state === 'brake');
  if (active) paceLabelEl.textContent = `${state.toUpperCase()} ${Math.round(multiplier * 100)}%`;
}

const combatAlerts = new Map<string, CombatAlert>();
let combatAlertSequence = 0;

function renderCombatAlert(): void {
  const activeAlerts = [...combatAlerts.values()]
    .filter(alert => alert.active)
    .sort((a, b) => b.priority - a.priority || b.sequence - a.sequence);
  const current = activeAlerts[0];
  if (!current) {
    combatAlertEl.textContent = '';
    combatAlertEl.classList.remove('active');
    return;
  }

  combatAlertEl.textContent = current.message;
  combatAlertEl.style.color = current.color;
  combatAlertEl.classList.add('active');
}

/** Register or refresh one alert source. Higher priority sources win the display. */
export function showCombatAlert(
  sourceId: string,
  message: string,
  color = '#ff6677',
  priority = 1,
): void {
  combatAlerts.set(sourceId, {
    sourceId,
    message,
    priority,
    color,
    active: true,
    sequence: ++combatAlertSequence,
  });
  renderCombatAlert();
}

/** Remove one source, allowing the next active priority to be shown immediately. */
export function hideCombatAlert(sourceId: string): void {
  combatAlerts.delete(sourceId);
  renderCombatAlert();
}

export function clearCombatAlerts(): void {
  combatAlerts.clear();
  renderCombatAlert();
}

// 被弾時の画面シェイク
const PHASE_2D_LANE_ALERT_ID = 'phase2d-lane';

function laneLabel(lane: string | number): string {
  const value = String(lane).trim().toUpperCase();
  return value.startsWith('LANE ') ? value : `LANE ${value}`;
}

/** Show a short-lived lane threat using the existing priority-arbitrated alert. */
export function showLaneTelegraphFeedback(lane: string | number, priority = 3): void {
  showCombatAlert(PHASE_2D_LANE_ALERT_ID, `${laneLabel(lane)} THREAT`, '#ffb347', priority);
}

/** Show that a lane choice is currently unavailable using the same alert source. */
export function showLaneDenialFeedback(lane: string | number, priority = 5): void {
  showCombatAlert(PHASE_2D_LANE_ALERT_ID, `${laneLabel(lane)} DENIED`, '#ff5964', priority);
}

/** Clear only the Phase 2D lane feedback, preserving unrelated combat alerts. */
export function hideLaneFeedback(): void {
  hideCombatAlert(PHASE_2D_LANE_ALERT_ID);
}

let shakeTimer  = 0;
let shakeAmount = 0;

export function triggerShake(intensity = 0.4): void {
  shakeTimer  = 0.25;
  shakeAmount = intensity;
}

export function updateHUD(dt: number, camPos: THREE.Vector3): void {
  if (shakeTimer > 0) {
    shakeTimer -= dt;
    const s = shakeAmount * (shakeTimer / 0.25);
    camPos.x += (Math.random() - 0.5) * s;
    camPos.y += (Math.random() - 0.5) * s * 0.5;
  }
}
