// Remote player cars. Each remote player renders as their ACTUAL car: the
// shared GLB exterior kit (car.js buildExteriorKit) mounted statically at the
// rest pose, wheels spun from the network velocity and steered from the
// transmitted steer byte. A tinted box stands in while the model loads (and
// stays for cars without a GLB — kart/F1).
import * as THREE from 'three';
import { CARS } from './cars.js';
import { buildExteriorKit } from './car.js';

function tint(i) {                                     // stable distinct hue per player index
  const h = (i * 137.508) % 360;
  return new THREE.Color().setHSL(h / 360, 0.72, 0.55);
}

export { tint };

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
  constructor(scene, idx, nick, carId) {
    this.scene = scene;
    const color = tint(idx);
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.5, 4.3), mat);
    body.position.y = 0.28;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.44, 1.9), mat);
    cabin.position.set(0, 0.74, 0.15);
    this.box = new THREE.Group();
    this.box.add(body, cabin);
    this.tag = nameSprite(nick, color);
    g.add(this.box, this.tag);
    g.visible = false;
    scene.add(g);
    this.mesh = g;
    this.mat = mat;
    this.color = color;
    this._spinAngle = 0;
    this._holders = [];                  // per-wheel steer groups (fronts turn)

    // real exterior (async) — same kit the local CarVisual uses
    const spec = CARS[carId];
    if (spec && spec.visual && spec.visual.model) {
      buildExteriorKit(spec, kit => {
        if (this._dead) return;
        const W = spec.wheels, y = kit.staticWheelY;
        const posXZ = [[-W.htF, W.fz], [W.htF, W.fz], [-W.htR, W.rz], [W.htR, W.rz]];
        const model = new THREE.Group();
        model.add(kit.wrap);
        kit.wheels.forEach((wg, i) => {
          if (!wg) return;
          const holder = new THREE.Group();          // steer here, spin inside
          holder.position.set(kit.wheelXFix[i] ?? posXZ[i][0], y, posXZ[i][1]);
          holder.add(wg);
          model.add(holder);
          this._holders[i] = holder;
        });
        this.mesh.remove(this.box);
        this.box.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        this.box = null;
        this.mesh.add(model);
        this.model = model;
        this.tailMat = kit.tailMat;
        this.tailLo = kit.tailMat ? kit.tailMat.emissiveIntensity : 0;
        this.wheelR = W.radius;
      });
    }
  }

  set(pos, quat) {
    this.mesh.position.copy(pos);
    this.mesh.quaternion.copy(quat);
    this.mesh.visible = true;
  }

  // wheel spin from network speed, front steer, brake-light pulse
  drive(speed, steer, brake, dt) {
    if (!this.model) return;
    this._spinAngle += (speed / (this.wheelR || 0.33)) * dt;
    for (let i = 0; i < 4; i++) {
      const h = this._holders[i];
      if (!h) continue;
      if (i < 2) h.rotation.y = -steer * 0.42;       // ~24° visual lock
      h.children[0].userData.spin.rotation.x = -this._spinAngle;
    }
    if (this.tailMat) this.tailMat.emissiveIntensity = brake > 0.1 ? 2.6 : this.tailLo;
  }

  // keep the name tag readable at distance: constant screen size past ~28 m,
  // fading out beyond ~500 m so the horizon doesn't collect floating labels
  tagUpdate(camPos) {
    const d = camPos.distanceTo(this.mesh.position);
    const k = Math.min(18, Math.max(1, d / 28));
    this.tag.scale.set(2.6 * k, 0.65 * k, 1);
    this.tag.position.y = 1.75 + (k - 1) * 0.35;
    this.tag.material.opacity = d > 500 ? Math.max(0, 1 - (d - 500) / 150) : 1;
  }

  fade(f) {
    // box fallback dims; the model just drops out at the end of dead reckoning
    if (this.mat) this.mat.opacity = 0.88 * f;
    if (this.model) this.model.visible = f > 0.05;
  }

  hide() { this.mesh.visible = false; }

  dispose() {
    this._dead = true;
    this.scene.remove(this.mesh);
    this.mesh.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
  }
}
