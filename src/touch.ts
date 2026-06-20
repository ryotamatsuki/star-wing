import { setVirtual } from './input';

// タッチ操作UIが有効かどうか(タイトルの操作説明切替などに使用)
let touchActive = false;
export const isTouchActive = (): boolean => touchActive;

// タッチ端末かどうか(?touch を付ければPCでも強制表示してテスト可能)
function isTouchDevice(): boolean {
  if (location.search.includes('touch')) return true;
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

// ボタン要素を生成(押下中に down/up コールバックを呼ぶ)
function makeButton(
  cls: string, label: string,
  onDown: () => void, onUp: () => void = () => {},
): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `touch-btn ${cls}`;
  el.textContent = label;
  let active = false;

  const press = (e: PointerEvent) => {
    e.preventDefault();
    if (active) return;
    active = true;
    el.classList.add('pressed');
    onDown();
  };
  const release = (e: PointerEvent) => {
    e.preventDefault();
    if (!active) return;
    active = false;
    el.classList.remove('pressed');
    onUp();
  };

  el.addEventListener('pointerdown', press);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', release);
  return el;
}

export function initTouchControls(): void {
  if (!isTouchDevice()) return;

  touchActive = true;
  document.body.classList.add('touch-mode');

  const root = document.createElement('div');
  root.id = 'touch-controls';

  // ── 左: 仮想アナログスティック(移動) ──────────────────────────────────────
  const stick = document.createElement('div');
  stick.className = 'touch-stick';
  const knob = document.createElement('div');
  knob.className = 'touch-knob';
  stick.appendChild(knob);

  const DEAD = 0.32;          // デッドゾーン(半径比)
  let stickPid = -1;
  let cx = 0, cy = 0, radius = 60;

  const clearMove = () => {
    setVirtual('ArrowLeft', false);
    setVirtual('ArrowRight', false);
    setVirtual('ArrowUp', false);
    setVirtual('ArrowDown', false);
  };

  const applyMove = (dx: number, dy: number) => {
    const nx = dx / radius;       // -1〜1
    const ny = dy / radius;
    setVirtual('ArrowLeft',  nx < -DEAD);
    setVirtual('ArrowRight', nx >  DEAD);
    setVirtual('ArrowUp',    ny < -DEAD);   // 画面上方向 = 上昇
    setVirtual('ArrowDown',  ny >  DEAD);
  };

  stick.addEventListener('pointerdown', e => {
    e.preventDefault();
    stickPid = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    radius = r.width / 2;
  });

  stick.addEventListener('pointermove', e => {
    if (e.pointerId !== stickPid) return;
    e.preventDefault();
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    const max = radius;
    if (dist > max) { dx = dx / dist * max; dy = dy / dist * max; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    applyMove(dx, dy);
  });

  const stickRelease = (e: PointerEvent) => {
    if (e.pointerId !== stickPid) return;
    e.preventDefault();
    stickPid = -1;
    knob.style.transform = 'translate(0, 0)';
    clearMove();
  };
  stick.addEventListener('pointerup', stickRelease);
  stick.addEventListener('pointercancel', stickRelease);

  // ── 右: 射撃ボタン(押しっぱなしで連射 / タイトルでは開始) ─────────────────
  const fire = makeButton(
    'touch-fire', 'FIRE',
    () => setVirtual('Space', true),
    () => setVirtual('Space', false),
  );

  // ── ロール(左右) ───────────────────────────────────────────────────────────
  const rollL = makeButton('touch-roll-l', '⟲',
    () => dispatchEvent(new CustomEvent('game:roll', { detail: -1 })));
  const rollR = makeButton('touch-roll-r', '⟳',
    () => dispatchEvent(new CustomEvent('game:roll', { detail: 1 })));

  // ── 視点切替 ───────────────────────────────────────────────────────────────
  const view = makeButton('touch-view', 'VIEW',
    () => dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' })));

  root.append(stick, fire, rollL, rollR, view);
  document.body.appendChild(root);
}
