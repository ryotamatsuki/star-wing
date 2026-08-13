// ブラウザの自動再生制限: 最初のユーザー操作後でないと AudioContext が動かない
// → 最初のキー入力時に resume() を呼ぶ

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ─── 共通ユーティリティ ──────────────────────────────────────────────────────

function makeGain(vol: number): GainNode {
  const g = getCtx().createGain();
  g.gain.value = vol;
  g.connect(getCtx().destination);
  return g;
}

function playTone(
  type: OscillatorType,
  freqStart: number,
  freqEnd: number,
  duration: number,
  vol = 0.18,
): void {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = makeGain(0);
  osc.connect(gain);
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, c.currentTime);
  osc.frequency.linearRampToValueAtTime(freqEnd, c.currentTime + duration);
  gain.gain.setValueAtTime(vol, c.currentTime);
  gain.gain.linearRampToValueAtTime(0, c.currentTime + duration);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + duration + 0.01);
}

function playNoise(duration: number, vol = 0.15): void {
  const c = getCtx();
  const bufSize = c.sampleRate * duration;
  const buf = c.createBuffer(1, bufSize, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const gain = makeGain(vol);
  // ハイパスフィルターで爆発らしさを出す
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 180;
  filter.Q.value = 0.5;
  src.connect(filter);
  filter.connect(gain);
  gain.gain.setValueAtTime(vol, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
  src.start();
  src.stop(c.currentTime + duration);
}

// ─── 公開 API ─────────────────────────────────────────────────────────────────

// レーザー発射:「ピュン」(矩形波 880→180Hz)
export function sfxLaser(): void {
  playTone('square', 880, 180, 0.10, 0.12);
  // サブトーン(低音で厚みを出す)
  playTone('sawtooth', 440, 90, 0.08, 0.06);
}

// 爆発:「ドシュッ」(ノイズ)
export function sfxExplosion(big = false): void {
  playNoise(big ? 0.7 : 0.4, big ? 0.28 : 0.18);
  if (big) playTone('sawtooth', 80, 20, 0.5, 0.12);
}

// 被弾:「ブッ」(のこぎり波の低音)
export function sfxHit(): void {
  playTone('sawtooth', 220, 60, 0.18, 0.22);
  playNoise(0.15, 0.10);
}

// バレルロール:「ヒュルッ」(三角波上昇)
export function sfxBarrel(): void {
  playTone('triangle', 200, 900, 0.4, 0.14);
}

// ボス警告ビープ
export function sfxWarning(): void {
  const c = getCtx();
  [0, 0.22, 0.44].forEach(offset => {
    const osc = c.createOscillator();
    const gain = makeGain(0);
    osc.connect(gain);
    osc.type = 'square';
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0.14, c.currentTime + offset);
    gain.gain.setValueAtTime(0,    c.currentTime + offset + 0.18);
    osc.start(c.currentTime);
    osc.stop(c.currentTime + 0.7);
  });
}

export function sfxTelegraph(): void {
  playTone('square', 620, 280, 0.18, 0.08);
}

export function sfxLock(): void {
  playTone('square', 440, 880, 0.16, 0.1);
}

export function sfxCharge(): void {
  playTone('sawtooth', 150, 70, 0.3, 0.14);
}

export function sfxChargeStart(): void {
  playTone('triangle', 180, 320, 0.16, 0.09);
}

export function sfxChargeReady(): void {
  playTone('square', 420, 620, 0.13, 0.11);
}

export function sfxChargeFull(): void {
  playTone('sawtooth', 520, 980, 0.22, 0.13);
}

export function sfxChargeFire(full = false): void {
  playTone('square', full ? 980 : 680, full ? 180 : 260, full ? 0.22 : 0.14, full ? 0.2 : 0.13);
  if (full) playNoise(0.12, 0.12);
}

export function sfxLockAcquire(slot: number): void {
  const start = 520 + Math.min(3, Math.max(0, slot - 1)) * 110;
  playTone('triangle', start, start + 180, 0.09, 0.08);
}

export function sfxLockVolley(count: number, full: boolean): void {
  playTone('square', full ? 880 : 650, full ? 260 : 340, 0.18, 0.15);
  if (count >= 3) playNoise(0.08, 0.07);
}

export function sfxMine(): void {
  playTone('triangle', 260, 180, 0.16, 0.08);
}

// シールド低下警告ビープ(ループ呼び出し)
export function sfxShieldLow(): void {
  playTone('square', 330, 330, 0.08, 0.08);
}

// ステージクリアファンファーレ
export function sfxClear(): void {
  const notes = [523, 659, 784, 1047];
  const c = getCtx();
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = makeGain(0);
    osc.connect(gain);
    osc.type = 'square';
    osc.frequency.value = freq;
    const t = c.currentTime + i * 0.13;
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.25);
    osc.start(t);
    osc.stop(t + 0.3);
  });
}

// アイテム取得チャイム(上昇音)
export function sfxPickup(): void {
  const notes = [523, 659, 784];
  const c = getCtx();
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = makeGain(0);
    osc.connect(gain);
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const t = c.currentTime + i * 0.08;
    gain.gain.setValueAtTime(0.13, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.18);
    osc.start(t);
    osc.stop(t + 0.22);
  });
}

// 初回キー入力で AudioContext を起動する
export function resumeAudio(): void {
  getCtx();
}
