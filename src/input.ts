import { resumeAudio } from './audio';

export interface MoveInput {
  x: number;
  y: number;
}

const keys = new Set<string>();
const analogMove: MoveInput = { x: 0, y: 0 };
let autoFireEnabled = false;

addEventListener('keydown', e => {
  resumeAudio();
  keys.add(e.code);
  e.preventDefault();
});

addEventListener('keyup', e => keys.delete(e.code));

/** Input must not survive leaving the page, otherwise a touch/key can remain stuck. */
export function clearInputState(): void {
  keys.clear();
  analogMove.x = 0;
  analogMove.y = 0;
}

addEventListener('blur', clearInputState);
addEventListener('pagehide', clearInputState);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearInputState();
});

export const isDown = (code: string): boolean => keys.has(code);

// Virtual buttons share the keyboard state so title/start and PC gameplay keep one path.
export function setVirtual(code: string, down: boolean): void {
  resumeAudio();
  if (down) keys.add(code);
  else keys.delete(code);
}

export function setAnalogMove(x: number, y: number): void {
  analogMove.x = Math.max(-1, Math.min(1, x));
  analogMove.y = Math.max(-1, Math.min(1, y));
}

export function getAnalogMove(): MoveInput {
  return { x: analogMove.x, y: analogMove.y };
}

/**
 * Merge the two input sources per axis, then normalize diagonals so neither
 * keyboard nor touch can make the ship move faster on a diagonal.
 */
export function getMoveInput(): MoveInput {
  const keyboardX = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0)
    - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
  const keyboardY = (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0)
    - (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0);

  const x = analogMove.x !== 0 ? analogMove.x : keyboardX;
  const y = analogMove.y !== 0 ? analogMove.y : keyboardY;
  const length = Math.hypot(x, y);
  if (length <= 1) return { x, y };
  return { x: x / length, y: y / length };
}

export function setAutoFireEnabled(enabled: boolean): void {
  autoFireEnabled = enabled;
}

export function isAutoFireEnabled(): boolean {
  return autoFireEnabled;
}
