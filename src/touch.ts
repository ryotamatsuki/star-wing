import {
  clearInputState,
  getAnalogMove,
  isAutoFireEnabled,
  setAnalogMove,
  setAutoFireEnabled,
  setVirtual,
} from './input';

const STICK_DIAMETER = 128;
const STICK_RADIUS = STICK_DIAMETER / 2;
const STICK_DEADZONE = 0.04;
const STICK_ACTIVE_THRESHOLD = 0.1;

let touchActive = false;
export const isTouchActive = (): boolean => touchActive;

export function isTouchDevice(): boolean {
  if (location.search.includes('touch')) return true;
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

function makeButton(
  cls: string,
  label: string,
  onDown: () => void,
  onUp: () => void = () => {},
  registerReset?: (reset: () => void) => void,
): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `touch-btn ${cls}`;
  el.textContent = label;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', label);

  let activePointerId: number | null = null;
  const releaseActive = (): void => {
    if (activePointerId === null) return;
    activePointerId = null;
    el.classList.remove('pressed');
    onUp();
  };

  const press = (e: PointerEvent): void => {
    e.preventDefault();
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch { /* Safari can reject a late capture. */ }
    el.classList.add('pressed');
    onDown();
  };

  const release = (e: PointerEvent): void => {
    if (e.pointerId !== activePointerId) return;
    e.preventDefault();
    releaseActive();
  };

  el.addEventListener('pointerdown', press);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('lostpointercapture', releaseActive);
  registerReset?.(releaseActive);
  return el;
}

export function initTouchControls(): void {
  if (!isTouchDevice() || touchActive) return;

  touchActive = true;
  setAutoFireEnabled(true);
  document.body.classList.add('touch-mode');

  const root = document.createElement('div');
  root.id = 'touch-controls';

  const moveZone = document.createElement('div');
  moveZone.className = 'touch-move-zone';
  moveZone.setAttribute('aria-label', 'Move');

  const stick = document.createElement('div');
  stick.className = 'touch-stick';
  stick.style.width = `${STICK_DIAMETER}px`;
  stick.style.height = `${STICK_DIAMETER}px`;
  const knob = document.createElement('div');
  knob.className = 'touch-knob';
  stick.appendChild(knob);

  let stickPointerId: number | null = null;
  let centerX = 0;
  let centerY = 0;
  let pointerX = 0;
  let pointerY = 0;
  let lastRollDirection = 1;

  const placeStick = (x: number, y: number): void => {
    const width = document.documentElement.clientWidth || innerWidth;
    const height = document.documentElement.clientHeight || innerHeight;
    const left = Math.max(0, Math.min(width - STICK_DIAMETER, x - STICK_RADIUS));
    const top = Math.max(0, Math.min(height - STICK_DIAMETER, y - STICK_RADIUS));
    stick.style.left = `${left}px`;
    stick.style.top = `${top}px`;
  };

  const applyMove = (dx: number, dy: number): void => {
    const distance = Math.hypot(dx, dy);
    if (distance > STICK_RADIUS) {
      dx = dx / distance * STICK_RADIUS;
      dy = dy / distance * STICK_RADIUS;
    }

    const nx = dx / STICK_RADIUS;
    const ny = dy / STICK_RADIUS;
    if (Math.hypot(nx, ny) < STICK_DEADZONE) {
      setAnalogMove(0, 0);
      knob.style.transform = 'translate(0, 0)';
      return;
    }

    setAnalogMove(nx, ny);
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (Math.abs(nx) > STICK_ACTIVE_THRESHOLD) {
      lastRollDirection = nx < 0 ? -1 : 1;
    }
  };

  const clearStick = (): void => {
    if (stickPointerId !== null) {
      try {
        if (moveZone.hasPointerCapture(stickPointerId)) moveZone.releasePointerCapture(stickPointerId);
      } catch { /* The pointer may already have been cancelled by iOS. */ }
    }
    stickPointerId = null;
    setAnalogMove(0, 0);
    knob.style.transform = 'translate(0, 0)';
    stick.classList.remove('is-active');
  };

  moveZone.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (stickPointerId !== null) return;
    stickPointerId = e.pointerId;
    pointerX = e.clientX;
    pointerY = e.clientY;
    centerX = pointerX;
    centerY = pointerY;
    placeStick(centerX, centerY);
    setAnalogMove(0, 0);
    knob.style.transform = 'translate(0, 0)';
    stick.classList.add('is-active');
    try { moveZone.setPointerCapture(e.pointerId); } catch { /* See clearStick. */ }
  });

  moveZone.addEventListener('pointermove', e => {
    if (e.pointerId !== stickPointerId) return;
    e.preventDefault();
    pointerX = e.clientX;
    pointerY = e.clientY;
    applyMove(pointerX - centerX, pointerY - centerY);
  });

  const releaseStick = (e: PointerEvent): void => {
    if (e.pointerId !== stickPointerId) return;
    e.preventDefault();
    clearStick();
  };
  moveZone.addEventListener('pointerup', releaseStick);
  moveZone.addEventListener('pointercancel', releaseStick);
  moveZone.addEventListener('lostpointercapture', clearStick);

  const buttonResets: Array<() => void> = [];
  const registerButtonReset = (reset: () => void): void => { buttonResets.push(reset); };

  const fire = makeButton(
    'touch-fire',
    'FIRE',
    () => setVirtual('Space', true),
    () => setVirtual('Space', false),
    registerButtonReset,
  );

  let autoFireButton: HTMLDivElement;
  const updateAutoFireLabel = (): void => {
    const label = isAutoFireEnabled() ? 'AUTO ON' : 'AUTO OFF';
    autoFireButton.textContent = label;
    autoFireButton.setAttribute('aria-label', label);
    root.classList.toggle('auto-fire-enabled', isAutoFireEnabled());
  };
  autoFireButton = makeButton('touch-auto', 'AUTO ON', () => {
    setAutoFireEnabled(!isAutoFireEnabled());
    updateAutoFireLabel();
  }, undefined, registerButtonReset);

  const roll = makeButton('touch-roll', 'ROLL', () => {
    const move = getAnalogMove();
    if (Math.abs(move.x) > STICK_ACTIVE_THRESHOLD) {
      lastRollDirection = move.x < 0 ? -1 : 1;
    }
    dispatchEvent(new CustomEvent<number>('game:roll', { detail: lastRollDirection }));
  }, undefined, registerButtonReset);

  // View is intentionally a small secondary control; it is not part of the combat cluster.
  const view = makeButton('touch-view', 'V',
    () => dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' })),
    undefined,
    registerButtonReset,
  );

  root.append(moveZone, stick, fire, autoFireButton, roll, view);
  document.body.appendChild(root);

  const resetControls = (): void => {
    clearStick();
    buttonResets.forEach(reset => reset());
    clearInputState();
  };

  addEventListener('blur', resetControls);
  addEventListener('pagehide', resetControls);
  addEventListener('orientationchange', resetControls);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetControls();
  });
  addEventListener('resize', () => {
    if (stickPointerId === null) return;
    placeStick(centerX, centerY);
    applyMove(pointerX - centerX, pointerY - centerY);
  });

  updateAutoFireLabel();
}
