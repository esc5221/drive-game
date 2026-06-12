// Dynamic racing line (Forza/GT style): a ribbon along the driving line whose
// color tells the driver what to do RIGHT NOW given current speed —
// green = flat out, yellow = lift, red = brake.
//
// Physics: per-point cornering speed limit v = sqrt(mu*g/|curv|), propagated
// backward through braking distance so the red zone appears exactly where a
// real braking point is.
import * as THREE from 'three';

// Proper racing line: iterative path-straightening inside the track width.
// Each pass pulls every point toward its neighbors' midpoint (constrained to
// the lateral corridor) — converging on a shortest/least-curvature path that
// naturally produces out-in-out lines and late apexes.
// Used by: the guide ribbon, the rubber darkening, vAllowed.
let _cache = null;
export function racingLineOffsets(track) {
  if (_cache) return _cache;
  const n = track.n;
  const d = new Float32Array(n);
  const lim = 3.1;                              // keep ~1.4m off the edges
  const px = track.px, pz = track.pz, rx = track.rx, rz = track.rz;
  for (let iter = 0; iter < 260; iter++) {
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      const mx = (px[a] + rx[a] * d[a] + px[b] + rx[b] * d[b]) * 0.5;
      const mz = (pz[a] + rz[a] * d[a] + pz[b] + rz[b] * d[b]) * 0.5;
      let nd = (mx - px[i]) * rx[i] + (mz - pz[i]) * rz[i];
      if (nd > lim) nd = lim; else if (nd < -lim) nd = -lim;
      d[i] += (nd - d[i]) * 0.6;
    }
  }
  _cache = d;
  return d;
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
    this.mode = +(localStorage.getItem('ns-line') ?? 2);   // 0 off, 1 brake-only, 2 full

    // ---- allowed-speed profile from the LINE's curvature (flatter than the
    // centerline through corners — that's the whole point of a racing line)
    const MU = 1.12, G = 9.81, VMAX = 80, ABRAKE = 8.8;
    const lx = new Float32Array(n), lz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      lx[i] = track.px[i] + track.rx[i] * this.offsets[i];
      lz[i] = track.pz[i] + track.rz[i] * this.offsets[i];
    }
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      let ax = lx[i] - lx[a], az = lz[i] - lz[a];
      let bx = lx[b] - lx[i], bz = lz[b] - lz[i];
      const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
      ax /= la; az /= la; bx /= lb; bz /= lb;
      const cy = az * bx - ax * bz;
      const k = Math.abs(Math.asin(THREE.MathUtils.clamp(cy, -1, 1))) / ((la + lb) / 2);
      v[i] = k > 1e-4 ? Math.min(VMAX, Math.sqrt(MU * G / k)) : VMAX;
    }
    // smooth, then backward braking pass (wraps)
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < n; i++) {
        v[i] = (v[(i - 1 + n) % n] + v[i] * 2 + v[(i + 1) % n]) / 4;
      }
    }
    for (let i = 2 * n - 1; i >= 0; i--) {
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

    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.72,
      depthWrite: false, polygonOffset: true,
      polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this._applyMode();
  }

  _applyMode() {
    this.mesh.visible = this.mode > 0;
    // brake-only: additive blending makes black vertices invisible, so only
    // the red braking zones glow on the road
    this.material.blending = this.mode === 1 ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.material.opacity = this.mode === 1 ? 0.9 : 0.72;
    localStorage.setItem('ns-line', String(this.mode));
  }

  setMode(m) { this.mode = m; this._applyMode(); }
  cycleMode() {
    this.setMode((this.mode + 2) % 3);     // 2(full) -> 1(brake) -> 0(off)
    return ['끔', '브레이크 가이드', '전체 라인'][this.mode];
  }

  _baseColorAt(i) {
    if (this.mode === 1) return [0, 0, 0];      // brake-only: invisible (additive)
    return [COL_BASE[0] * 0.5, COL_BASE[1] * 0.5, COL_BASE[2] * 0.5];
  }

  _paintBaseAll() {
    const n = this.track.n, c = this.colors;
    for (let i = 0; i < n; i++) {
      const [r, g, b] = this._baseColorAt(i);
      const o = i * 6;
      c[o] = r; c[o + 1] = g; c[o + 2] = b;
      c[o + 3] = r; c[o + 4] = g; c[o + 5] = b;
    }
    if (this.colorAttr.clearUpdateRanges) this.colorAttr.clearUpdateRanges();
    this.colorAttr.needsUpdate = true;
    this._prevStart = -1;
  }

  // windowed recolor: only ~300 points around the car are touched and only
  // those bytes are re-uploaded (the 20km full-buffer rewrite hurt mobile)
  update(carS, carSpeed) {
    if (!this.mesh.visible) return;
    if (this._lastMode !== this.mode) { this._lastMode = this.mode; this._paintBaseAll(); return; }
    const brakeOnly = this.mode === 1;
    const n = this.track.n, step = this.track.step;
    const i0 = Math.floor(carS / step) % n;
    const c = this.colors;
    const BEH = 12, AHD = 281, LEN = BEH + AHD + 1;
    const start = ((i0 - BEH) % n + n) % n;
    const ranges = [];

    // restore the previous window to base where it no longer overlaps
    if (this._prevStart >= 0 && this._prevStart !== start) {
      for (let k = 0; k < LEN; k++) {
        const i = (this._prevStart + k) % n;
        const rel = ((i - start) % n + n) % n;
        if (rel < LEN) continue;                  // still inside the new window
        const [r, g, b] = this._baseColorAt(i);
        const o = i * 6;
        c[o] = r; c[o + 1] = g; c[o + 2] = b;
        c[o + 3] = r; c[o + 4] = g; c[o + 5] = b;
      }
      ranges.push([this._prevStart, LEN]);
    }

    for (let k = 0; k < LEN; k++) {
      const i = (start + k) % n;
      const dist = (((i - i0) % n + n) % n) * step;
      let col = COL_BASE, fade = 0.4;             // behind-car trail dim
      if (dist <= AHD * step) {
        const va = this.vAllowed[i];
        if (carSpeed <= va + 0.5) col = COL_GREEN;
        else {
          const req = (carSpeed * carSpeed - va * va) / (2 * Math.max(dist, 2));
          col = req > 5.8 ? COL_RED : req > 2.3 ? COL_YELLOW : COL_GREEN;
        }
        fade = 1 - 0.75 * (dist / (AHD * step));
      }
      let r, g, b;
      if (brakeOnly) {
        const isWarn = col === COL_RED || col === COL_YELLOW;
        r = isWarn ? col[0] * fade : 0;
        g = isWarn ? col[1] * fade : 0;
        b = isWarn ? col[2] * fade : 0;
      } else {
        r = col[0] * fade + COL_BASE[0] * (1 - fade) * 0.5;
        g = col[1] * fade + COL_BASE[1] * (1 - fade) * 0.5;
        b = col[2] * fade + COL_BASE[2] * (1 - fade) * 0.5;
      }
      const o = i * 6;
      c[o] = r; c[o + 1] = g; c[o + 2] = b;
      c[o + 3] = r; c[o + 4] = g; c[o + 5] = b;
    }
    ranges.push([start, LEN]);
    this._prevStart = start;

    if (this.colorAttr.clearUpdateRanges) {
      this.colorAttr.clearUpdateRanges();
      for (const [s0, len] of ranges) {
        if (s0 + len <= n) this.colorAttr.addUpdateRange(s0 * 6, len * 6);
        else {                                    // wraps the loop seam
          this.colorAttr.addUpdateRange(s0 * 6, (n - s0) * 6);
          this.colorAttr.addUpdateRange(0, (s0 + len - n) * 6);
        }
      }
    }
    this.colorAttr.needsUpdate = true;
  }
}
