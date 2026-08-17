import * as THREE from 'three';

interface Particle {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number;
  life: number;
  maxLife: number;
}

interface Popup {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  life: number;
  maxLife: number;
}

const particles: Particle[] = [];
const popups: Popup[] = [];
let scene: THREE.Scene;

const fragGeo = new THREE.TetrahedronGeometry(0.35, 0);

export function initEffects(s: THREE.Scene): void {
  scene = s;
}

export function spawnExplosion(pos: THREE.Vector3, count = 14, color = 0xff6600): void {
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(fragGeo, mat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(0.6 + Math.random() * 0.8);
    scene.add(mesh);

    const speed = 5 + Math.random() * 12;
    const theta = Math.random() * Math.PI * 2;
    const phi   = (Math.random() - 0.5) * Math.PI;
    particles.push({
      mesh,
      vx: Math.cos(theta) * Math.cos(phi) * speed,
      vy: Math.sin(phi) * speed,
      vz: Math.sin(theta) * Math.cos(phi) * speed * 0.5,
      rx: (Math.random() - 0.5) * 8,
      ry: (Math.random() - 0.5) * 8,
      rz: (Math.random() - 0.5) * 8,
      life: 0.5 + Math.random() * 0.35,
      maxLife: 0,
    });
    particles[particles.length - 1].maxLife = particles[particles.length - 1].life;
  }
}

export function spawnScorePopup(pos: THREE.Vector3, points: number): void {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 28px monospace';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText(`+${points}`, 64, 24);
  ctx.fillStyle = '#ffff55';
  ctx.fillText(`+${points}`, 64, 24);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(6, 2.25, 1);
  sprite.position.copy(pos);
  sprite.position.y += 1.5;
  scene.add(sprite);
  popups.push({ sprite, mat, life: 1.0, maxLife: 1.0 });
}

export function spawnTextPopup(pos: THREE.Vector3, text: string, color = '#ffff55'): void {
  const canvas = document.createElement('canvas');
  canvas.width = 160; canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 26px monospace';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText(text, 80, 24);
  ctx.fillStyle = color;
  ctx.fillText(text, 80, 24);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(7, 2.1, 1);
  sprite.position.copy(pos);
  sprite.position.y += 1.5;
  scene.add(sprite);
  popups.push({ sprite, mat, life: 1.4, maxLife: 1.4 });
}

/** Event-driven Phase 2D feedback for removing a destructible part. */
export function spawnPartDestroyFeedback(pos: THREE.Vector3, color = 0xffaa44): void {
  spawnExplosion(pos, 12, color);
  spawnTextPopup(pos, 'PART DOWN', '#ffcc66');
}

/** Event-driven Phase 2D feedback for opening a heavy enemy's core window. */
export function spawnCoreExposeFeedback(pos: THREE.Vector3): void {
  spawnExplosion(pos, 8, 0xffe477);
  spawnTextPopup(pos, 'CORE EXPOSED', '#ffe477');
}

/** Event-driven Phase 2D feedback for a successful hit on the exposed core. */
export function spawnCoreHitFeedback(pos: THREE.Vector3): void {
  spawnExplosion(pos, 5, 0xffaa00);
}

export function updateEffects(dt: number): void {
  // パーティクル更新
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      particles.splice(i, 1);
      continue;
    }
    const t = p.life / p.maxLife;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    p.mesh.rotation.x += p.rx * dt;
    p.mesh.rotation.y += p.ry * dt;
    p.mesh.rotation.z += p.rz * dt;
    p.mesh.scale.setScalar(t * (0.6 + Math.random() * 0.2));
    const col = (p.mesh.material as THREE.MeshBasicMaterial).color;
    col.setRGB(t * 1.0, t * 0.3, 0);
    p.vy -= 4 * dt;
  }

  // スコアポップアップ更新
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.sprite);
      p.mat.map?.dispose();
      p.mat.dispose();
      popups.splice(i, 1);
      continue;
    }
    p.sprite.position.y += 3 * dt;
    p.mat.opacity = p.life / p.maxLife;
  }
}

export function clearEffects(): void {
  for (const p of particles) scene.remove(p.mesh);
  particles.length = 0;
  for (const p of popups) {
    scene.remove(p.sprite);
    p.mat.map?.dispose();
    p.mat.dispose();
  }
  popups.length = 0;
}
