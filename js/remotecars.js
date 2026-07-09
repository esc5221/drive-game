// Remote player cars — lightweight tinted boxes (ghost-style, cheap enough for
// mobile) with a billboard name tag. One entry per remote player, pooled.
import * as THREE from 'three';

function tint(i) {                                     // stable distinct hue per player index
  const h = (i * 137.508) % 360;
  return new THREE.Color().setHSL(h / 360, 0.72, 0.55);
}

function nameSprite(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.font = '700 34px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = 8;
  g.fillStyle = '#' + color.getHexString();
  g.fillText(text.slice(0, 14), 128, 32);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sp.scale.set(2.6, 0.65, 1);
  sp.position.y = 1.75;
  return sp;
}

export class RemoteCar {
  constructor(scene, idx, nick) {
    this.scene = scene;
    const color = tint(idx);
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.5, 4.3), mat);
    body.position.y = 0.28;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.44, 1.9), mat);
    cabin.position.set(0, 0.74, 0.15);
    g.add(body, cabin, nameSprite(nick, color));
    g.visible = false;
    scene.add(g);
    this.mesh = g;
    this.mat = mat;
  }
  set(pos, quat) {
    this.mesh.position.copy(pos);
    this.mesh.quaternion.copy(quat);
    this.mesh.visible = true;
  }
  fade(f) { this.mat.opacity = 0.88 * f; }             // dead-reckoning fade-out
  hide() { this.mesh.visible = false; }
  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.traverse(o => { if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } if (o.geometry) o.geometry.dispose(); });
  }
}
