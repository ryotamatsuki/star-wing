import * as THREE from 'three';

const scoreEl  = document.getElementById('score')!;
const stageEl  = document.getElementById('stage')!;
const shieldEl = document.getElementById('shield-bar')!;
const msgEl    = document.getElementById('message')!;

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

// 被弾時の画面シェイク
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
