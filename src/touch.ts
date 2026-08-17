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
const STICK_DEADZONE = 0.14;
const STICK_ACTIVE_THRESHOLD = 0.1;
const STICK_EDGE_PADDING = 10;

interface Point {
  x: number;
  y: number;
}

interface RollStateDetail {
  state: 'ready' | 'rolling' | 'cooldown';
  remaining: number;
  duration: number;
}

let touchActive = false;
export const isTouchActive = (): boolean => touchActive;

const CHARGE_SCAN_HINT = 'Move while charging to scan for additional locks.';

export function isTouchDevice(): boolean {
  if (location.search.includes('touch')) return true;
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

export function isTouchLayoutBlocked(): boolean {
  return touchActive && matchMedia('(orientation: portrait)').matches;
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

  const safeAreaProbe = document.createElement('div');
  safeAreaProbe.className = 'touch-safe-area-probe';

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
  let rawPointerX = 0;
  let rawPointerY = 0;
  let pointerOffsetX = 0;
  let pointerOffsetY = 0;
  let lastRollDirection = 1;

  const safeInset = (side: 'left' | 'right' | 'top' | 'bottom'): number => {
    const styles = getComputedStyle(safeAreaProbe);
    const value = side === 'left' ? styles.paddingLeft
      : side === 'right' ? styles.paddingRight
        : side === 'top' ? styles.paddingTop
          : styles.paddingBottom;
    const inset = parseFloat(value);
    return Number.isFinite(inset) ? Math.max(0, inset) : 0;
  };

  const clampPoint = (x: number, y: number): Point => {
    const width = document.documentElement.clientWidth || innerWidth;
    const height = document.documentElement.clientHeight || innerHeight;
    const zoneRight = moveZone.getBoundingClientRect().right;
    const minX = safeInset('left') + STICK_RADIUS + STICK_EDGE_PADDING;
    const maxX = Math.min(
      width - safeInset('right') - STICK_RADIUS - STICK_EDGE_PADDING,
      zoneRight - STICK_RADIUS - STICK_EDGE_PADDING,
    );
    const minY = safeInset('top') + STICK_RADIUS + STICK_EDGE_PADDING;
    const maxY = height - safeInset('bottom') - STICK_RADIUS - STICK_EDGE_PADDING;
    return {
      x: Math.max(minX, Math.min(Math.max(minX, maxX), x)),
      y: Math.max(minY, Math.min(Math.max(minY, maxY), y)),
    };
  };

  const placeStick = (point: Point): void => {
    centerX = point.x;
    centerY = point.y;
    stick.style.left = `${centerX - STICK_RADIUS}px`;
    stick.style.top = `${centerY - STICK_RADIUS}px`;
  };

  const applyMove = (dx: number, dy: number): void => {
    const distance = Math.hypot(dx, dy);
    if (distance > STICK_RADIUS) {
      dx = dx / distance * STICK_RADIUS;
      dy = dy / distance * STICK_RADIUS;
    }

    const nx = dx / STICK_RADIUS;
    const ny = dy / STICK_RADIUS;
    const length = Math.min(1, Math.hypot(nx, ny));
    if (length <= STICK_DEADZONE) {
      setAnalogMove(0, 0);
      knob.style.transform = 'translate(0, 0)';
      return;
    }

    // Convert screen coordinates to game coordinates: screen-down is game-down.
    const remappedLength = (length - STICK_DEADZONE) / (1 - STICK_DEADZONE);
    const scale = remappedLength / length;
    const inputX = nx * scale;
    const inputY = -ny * scale;
    setAnalogMove(inputX, inputY);
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
    const center = clampPoint(e.clientX, e.clientY);
    rawPointerX = e.clientX;
    rawPointerY = e.clientY;
    pointerOffsetX = center.x - rawPointerX;
    pointerOffsetY = center.y - rawPointerY;
    placeStick(center);
    setAnalogMove(0, 0);
    knob.style.transform = 'translate(0, 0)';
    stick.classList.add('is-active');
    try { moveZone.setPointerCapture(e.pointerId); } catch { /* See clearStick. */ }
  });

  moveZone.addEventListener('pointermove', e => {
    if (e.pointerId !== stickPointerId) return;
    e.preventDefault();
    rawPointerX = e.clientX;
    rawPointerY = e.clientY;
    applyMove(
      rawPointerX + pointerOffsetX - centerX,
      rawPointerY + pointerOffsetY - centerY,
    );
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

  let currentGameState = 'title';

  const fire = makeButton(
    'touch-fire',
    'START',
    () => setVirtual('Space', true),
    () => setVirtual('Space', false),
    registerButtonReset,
  );

  const isCombatState = (): boolean =>
    currentGameState === 'playing' || currentGameState === 'boss';

  const isPaceState = (): boolean => currentGameState === 'playing';

  const charge = makeButton(
    'touch-charge',
    'CHARGE',
    () => { if (isCombatState()) setVirtual('KeyC', true); },
    () => setVirtual('KeyC', false),
    registerButtonReset,
  );

  charge.setAttribute('aria-describedby', 'touch-charge-hint');
  charge.setAttribute('aria-label', 'Charge. ' + CHARGE_SCAN_HINT);
  const chargeHint = document.createElement('span');
  chargeHint.id = 'touch-charge-hint';
  chargeHint.className = 'touch-sr-only';
  chargeHint.textContent = CHARGE_SCAN_HINT;

  const boost = makeButton(
    'touch-pace touch-boost',
    'BOOST',
    () => { if (isPaceState()) setVirtual('KeyE', true); },
    () => setVirtual('KeyE', false),
    registerButtonReset,
  );

  const brake = makeButton(
    'touch-pace touch-brake',
    'BRAKE',
    () => { if (isPaceState()) setVirtual('KeyQ', true); },
    () => setVirtual('KeyQ', false),
    registerButtonReset,
  );

  const updateTouchState = (state: string): void => {
    currentGameState = state;
    const isReturnState = state === 'gameover' || state === 'clear';
    const isCombatState = state === 'playing' || state === 'boss';
    const fireLabel = state === 'title' ? 'START'
      : state === 'gameover' ? 'RETRY'
        : state === 'clear' ? 'TITLE'
          : 'FIRE';
    fire.textContent = fireLabel;
    fire.setAttribute('aria-label', fireLabel);
    root.classList.toggle('fire-start', state === 'title');
    root.classList.toggle('fire-return', isReturnState);
    root.classList.toggle('fire-passive', isCombatState && isAutoFireEnabled());
    root.classList.toggle('charge-available', isCombatState);
    root.classList.toggle('pace-unavailable', !isPaceState());
    boost.setAttribute('aria-disabled', String(!isPaceState()));
    brake.setAttribute('aria-disabled', String(!isPaceState()));
    if (!isPaceState()) {
      setVirtual('KeyE', false);
      setVirtual('KeyQ', false);
    }
  };

  let autoFireButton: HTMLDivElement;
  const updateAutoFireLabel = (): void => {
    const label = isAutoFireEnabled() ? 'AUTO ON' : 'AUTO OFF';
    autoFireButton.textContent = label;
    autoFireButton.setAttribute('aria-label', label);
    root.classList.toggle('auto-fire-enabled', isAutoFireEnabled());
    updateTouchState(currentGameState);
  };
  autoFireButton = makeButton('touch-auto', 'AUTO ON', () => {
    setAutoFireEnabled(!isAutoFireEnabled());
    updateAutoFireLabel();
  }, undefined, registerButtonReset);

  let rollState: RollStateDetail['state'] = 'ready';
  const roll = makeButton('touch-roll', 'ROLL', () => {
    if (rollState !== 'ready') return;
    const move = getAnalogMove();
    if (Math.abs(move.x) > STICK_ACTIVE_THRESHOLD) {
      lastRollDirection = move.x < 0 ? -1 : 1;
    }
    dispatchEvent(new CustomEvent<number>('game:roll', { detail: lastRollDirection }));
  }, undefined, registerButtonReset);

  const updateRollState = (detail: RollStateDetail): void => {
    rollState = detail.state;
    const isCooldown = detail.state === 'cooldown';
    const progress = detail.duration > 0
      ? Math.max(0, Math.min(1, 1 - detail.remaining / detail.duration))
      : 1;
    roll.style.setProperty('--roll-progress', `${progress * 100}%`);
    roll.classList.toggle('roll-rolling', detail.state === 'rolling');
    roll.classList.toggle('roll-cooldown', isCooldown);
    roll.textContent = isCooldown ? 'WAIT' : 'ROLL';
    roll.setAttribute('aria-label', isCooldown ? 'ROLL cooldown' : 'ROLL');
  };

  // View is intentionally a small secondary control; it is not part of the combat cluster.
  const view = makeButton('touch-view', 'V',
    () => { dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' })); },
    undefined,
    registerButtonReset,
  );

  root.append(safeAreaProbe, moveZone, stick, fire, charge, boost, brake, autoFireButton, roll, view, chargeHint);
  document.body.appendChild(root);

  const resetControls = (): void => {
    clearStick();
    buttonResets.forEach(reset => reset());
    clearInputState();
  };

  addEventListener('game:state', e => {
    updateTouchState((e as CustomEvent<string>).detail);
  });
  addEventListener('game:roll-state', e => {
    updateRollState((e as CustomEvent<RollStateDetail>).detail);
  });
  addEventListener('game:charge-state', e => {
    const detail = (e as CustomEvent<{ state: string; full: boolean }>).detail;
    const active = detail.state !== 'idle';
    charge.classList.toggle('charge-active', active);
    charge.classList.toggle('charge-full', detail.full);
    charge.textContent = detail.full ? 'FULL' : active ? 'CHARGING' : 'CHARGE';
    charge.setAttribute('aria-label', detail.full ? 'Full charge. ' + CHARGE_SCAN_HINT : active ? 'Charging. ' + CHARGE_SCAN_HINT : 'Charge. ' + CHARGE_SCAN_HINT);
  });
  addEventListener('blur', resetControls);
  addEventListener('pagehide', resetControls);
  addEventListener('orientationchange', resetControls);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetControls();
  });
  addEventListener('resize', () => {
    if (stickPointerId === null) return;
    const center = clampPoint(centerX, centerY);
    placeStick(center);
    pointerOffsetX = centerX - rawPointerX;
    pointerOffsetY = centerY - rawPointerY;
    applyMove(0, 0);
  });

  updateAutoFireLabel();
  updateTouchState('title');
  updateRollState({ state: 'ready', remaining: 0, duration: 0 });
}
