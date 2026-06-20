import { resumeAudio } from './audio';

const keys = new Set<string>();

addEventListener('keydown', e => { resumeAudio(); keys.add(e.code); e.preventDefault(); });
addEventListener('keyup',   e => keys.delete(e.code));

export const isDown = (code: string) => keys.has(code);

// タッチ操作などから仮想的にキー状態を設定する(キーボードと同じ keys を駆動)
export function setVirtual(code: string, down: boolean): void {
  resumeAudio();
  if (down) keys.add(code);
  else      keys.delete(code);
}
