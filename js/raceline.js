// Dynamic racing line (Forza/GT style): a ribbon along the driving line whose
// color tells the driver what to do RIGHT NOW given current speed —
// green = flat out, yellow = lift, red = brake.
//
// Physics: per-point cornering speed limit v = sqrt(mu*g/|curv|), propagated
// backward through braking distance so the red zone appears exactly where a
// real braking point is.
import * as THREE from 'three';

// the line hugs corner insides, heavily smoothed into a flowing arc
// (also used by world.js for the rubber darkening)
export function racingLineOffsets(track) {
  const n = track.n;
  const off = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    off[i] = THREE.MathUtils.clamp(-track.curv[i] * 240, -2.3, 2.3);
  }
  for (let p = 0; p < 3; p++) {
    const out = new Float32Array(n);
    const half = 30;
    let acc = 0;
    for (let k = -half; k <= half; k++) acc += off[(k + n) % n];
    for (let i = 0; i < n; i++) {
      out[i] = acc / (2 * half + 1);
      acc += off[(i + half + 1) % n] - off[(i - half + n) % n];
    }
    off.set(out);
  }
  return off;
}

const COL_BASE = [0.30, 0.30, 0.34];
const COL_GREEN = [0.10, 0.85, 0.30];
const COL_YELLOW = [1.00, 0.80, 0.08];
const COL_RED = [1.00, 0.10, 0.06];

export class RaceLine {
  constructor(scene, track) {
    this.track = track;
    const n = track.n;
    this.offsets = racingLineOffsets(track);

    // ---- allowed-speed profile
    const MU = 1.12, G = 9.81, VMAX = 80, ABRAKE = 8.8;
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = Math.abs(track.curv[i]);
      v[i] = k > 1e-4 ? Math.min(VMAX, Math.sqrt(MU * G / k)) : VMAX;
    }
    for (let i = 2 * n - 1; i >= 0; i--) {   // backward braking pass (wraps)
      const a = i % n, b = (i + 1) % n;
      const lim = Math.sqrt(v[b] * v[b] + 2 * ABRAKE * track.step);
      if (v[a] > lim) v[a] = lim;
    }
    this.vAllowed = v;

    // ---- ribbon geometry (1.0 m wide, on the racing line)
    const pos = new Float32Array(n * 2 * 3);
    this.colors = new Float32Array(n * 2 * 3);
    const idx = [];
    const e = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      for (let side = 0; side < 2; side++) {
        const d = this.offsets[i] + (side ? 0.5 : -0.5);
        track.edge(i, d, 0.03, e);
        const o = (i * 2 + side) * 3;
        pos[o] = e.x; pos[o + 1] = e.y; pos[o + 2] = e.z;
      }
      const a = i * 2, b = ((i + 1) % n) * 2;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.colorAttr = new THREE.BufferAttribute(this.colors, 3);
    geo.setAttribute('color', this.colorAttr);
    geo.setIndex(idx);

    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.72,
      depthWrite: false, polygonOffset: true,
      polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  // recolor relative to the car every frame (full rewrite — 25k floats, cheap)
  update(carS, carSpeed) {
    if (!this.mesh.visible) return;
    const n = this.track.n, step = this.track.step;
    const i0 = Math.floor(carS / step) % n;
    const c = this.colors;
    const AHEAD = 1400, BEHIND = 60;
    for (let i = 0; i < n; i++) {
      let dist = ((i - i0 + n) % n) * step;
      let col = COL_BASE, fade = 1;
      if (dist <= AHEAD) {
        const va = this.vAllowed[i];
        if (carSpeed <= va + 0.5) col = COL_GREEN;
        else {
          const req = (carSpeed * carSpeed - va * va) / (2 * Math.max(dist, 2));
          col = req > 5.8 ? COL_RED : req > 2.3 ? COL_YELLOW : COL_GREEN;
        }
        fade = 1 - 0.75 * (dist / AHEAD);
      } else if (((i0 - i + n) % n) * step <= BEHIND) {
        fade = 0.4;                          // short dim trail behind
      }
      const r = col[0] * fade + COL_BASE[0] * (1 - fade) * 0.5;
      const g = col[1] * fade + COL_BASE[1] * (1 - fade) * 0.5;
      const b = col[2] * fade + COL_BASE[2] * (1 - fade) * 0.5;
      const o = i * 2 * 3;
      c[o] = r; c[o + 1] = g; c[o + 2] = b;
      c[o + 3] = r; c[o + 4] = g; c[o + 5] = b;
    }
    this.colorAttr.needsUpdate = true;
  }

  toggle() {
    this.mesh.visible = !this.mesh.visible;
    return this.mesh.visible;
  }
}
