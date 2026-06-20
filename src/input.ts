import { resumeAudio } from './audio';

const keys = new Set<string>();

addEventListener('keydown', e => { resumeAudio(); keys.add(e.code); e.preventDefault(); });
addEventListener('keyup',   e => keys.delete(e.code));

export const isDown = (code: string) => keys.has(code);
