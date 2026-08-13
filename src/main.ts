import * as THREE from 'three';
import { initTerrain, updateTerrain } from './terrain';
import { createPlayer } from './player';
import { initBullets } from './bullets';
import { initEnemies } from './enemies';
import { initEffects } from './effects';
import { initItems } from './items';
import { initTouchControls, isTouchDevice, isTouchLayoutBlocked } from './touch';
import { Game } from './game';
import { clearCombatAlerts, hideCombatAlert, showCombatAlert, updateChargeHud } from './hud';

// ─── シーン・カメラ・レンダラー ───────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x4488cc);
scene.fog = new THREE.FogExp2(0x4488cc, 0.008);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 600);
camera.position.set(0, 7, 22);
camera.lookAt(0, 2, 0);

const canvas = document.getElementById('game') as HTMLCanvasElement;
const touchPlatform = isTouchDevice();
const maxPixelRatio = touchPlatform ? 1.5 : 2;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, maxPixelRatio));

// ─── ライト ───────────────────────────────────────────────────────────────────
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(30, 60, 20);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x6688aa, 1.2));

// ─── 各モジュール初期化 ───────────────────────────────────────────────────────
initTerrain(scene);
initBullets(scene);
initEffects(scene);
initItems(scene);
const player = createPlayer(scene);
initEnemies(scene, () => {});

// タッチ端末向けの画面操作UI(PCでは表示されない)。タイトル表示前に有効化する
initTouchControls();

const game = new Game(player, camera, scene);

const encounterHintTimers = new Map<string, number>();
addEventListener('combat:encounter', e => {
  const detail = (e as CustomEvent<{ id: string; objective?: string }>).detail;
  if (!detail.objective) return;
  const sourceId = `encounter:${detail.id}`;
  const previousTimer = encounterHintTimers.get(sourceId);
  if (previousTimer !== undefined) window.clearTimeout(previousTimer);
  showCombatAlert(sourceId, detail.objective, '#ffe477', 1);
  const timer = window.setTimeout(() => {
    if (encounterHintTimers.get(sourceId) === timer) encounterHintTimers.delete(sourceId);
    hideCombatAlert(sourceId);
  }, 2600);
  encounterHintTimers.set(sourceId, timer);
});

addEventListener('game:state', e => {
  const state = (e as CustomEvent<string>).detail;
  if (state === 'title' || state === 'gameover' || state === 'stage_clear' || state === 'clear') {
    for (const timer of encounterHintTimers.values()) window.clearTimeout(timer);
    encounterHintTimers.clear();
    clearCombatAlerts();
  }
});

addEventListener('game:charge-state', e => {
  updateChargeHud((e as CustomEvent<Parameters<typeof updateChargeHud>[0]>).detail);
});

// ─── ウィンドウリサイズ ────────────────────────────────────────────────────────
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, maxPixelRatio));
});

// ─── ゲームループ ─────────────────────────────────────────────────────────────
let lastTime = 0;
function loop(time: number): void {
  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  // A portrait touch layout is an instruction screen, so pause simulation behind it.
  if (!isTouchLayoutBlocked()) {
    game.updateFlightPace(dt);
    updateTerrain(dt);
    player.update(dt, camera);
    game.update(dt);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
