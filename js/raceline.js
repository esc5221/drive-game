// Dynamic racing line (Forza/GT style): a thin feathered ribbon along the
// driving line whose color tells the driver what to do RIGHT NOW given current
// speed — green = flat out, yellow = lift, red = brake.
//
// Line geometry: a min-curvature pass establishes the corridor line, then a
// phase-bias refinement pushes it toward a real LATE-APEX line (wide entry →
// late inside apex → wide exit). The speed profile uses both a backward braking
// pass AND a forward acceleration pass, so the value of opening the exit (the
// whole point of a late apex) actually shows up in the colors.
import * as THREE from 'three';

// ---- racing line offsets (cached once) ------------------------------------
let _cache = null;
export function racingLineOffsets(track) {
  if (_cache) return _cache;
  const n = track.n;
  const px = track.px, pz = track.pz, rx = track.rx, rz = track.rz;
  const lim = 3.1;                              // lateral corridor (keep off edges)

  // (1) min-curvature base line: pull each point toward its neighbours' midpoint
  const d = new Float32Array(n);
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

  // (2) centerline signed curvature, smoothed — drives corner strength & phase
  const kc = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    let ax = px[i] - px[a], az = pz[i] - pz[a];
    let bx = px[b] - px[i], bz = pz[b] - pz[i];
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    const cross = ax * bz - az * bx;
    kc[i] = Math.asin(THREE.MathUtils.clamp(cross, -1, 1)) / ((la + lb) / 2);
  }
  const smooth = (arr, passes) => {
    for (let p = 0; p < passes; p++) {
      const t = arr.slice();
      for (let i = 0; i < n; i++) arr[i] = (t[(i - 1 + n) % n] + t[i] * 2 + t[(i + 1) % n]) / 4;
    }
  };
  smooth(kc, 4);

  // inside direction = sign of the min-curvature offset (it leans into bends);
  // this is robust regardless of the curvature sign convention.
  const ds = d.slice(); smooth(ds, 3);
  const insideDir = new Float32Array(n);
  const turn = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    insideDir[i] = Math.sign(ds[i]) || 1;
    turn[i] = THREE.MathUtils.smoothstep(Math.abs(kc[i]), 0.006, 0.035);
  }

  // (3) late-apex phase bias: apex (curvature peak, |dk| small) -> inside,
  // entry/exit (curvature changing, |dk| large) -> outside. L = look-ahead.
  const L = 8;
  for (let iter = 0; iter < 70; iter++) {
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      const mx = (px[a] + rx[a] * d[a] + px[b] + rx[b] * d[b]) * 0.5;
      const mz = (pz[a] + rz[a] * d[a] + pz[b] + rz[b] * d[b]) * 0.5;
      let nd = (mx - px[i]) * rx[i] + (mz - pz[i]) * rz[i];

      const kAhd = Math.abs(kc[(i + L) % n]), kBeh = Math.abs(kc[(i - L + n) % n]);
      const dk = Math.abs(kAhd - kBeh);
      const dkN = THREE.MathUtils.clamp(dk / (0.5 * (kAhd + kBeh) + 1e-4), 0, 1);
      const apexW = turn[i] * (1 - dkN);     // near the apex
      const eeW = turn[i] * dkN;             // entry / exit
      nd += insideDir[i] * lim * 0.30 * (apexW * 0.85 - eeW * 0.65);

      if (nd > lim) nd = lim; else if (nd < -lim) nd = -lim;
      d[i] += (nd - d[i]) * 0.52;            // gentler relax: bias settles cleanly
    }
  }

  _cache = d;
  return d;
}

// ---- colours ---------------------------------------------------------------
const COL_BASE = [0.16, 0.17, 0.20];
const COL_GREEN = [0.05, 0.92, 0.30];
const COL_YELLOW = [1.00, 0.78, 0.05];
const COL_RED = [1.00, 0.06, 0.03];
const COL_ORANGE = [1.00, 0.42, 0.0];     // ideal-guide: trail-braking

// ribbon cross-section (total 0.80 m): a bright opaque core + feathered edges
const W_CORE = 0.27;     // core half-width  (alpha = 1)
const W_EDGE = 0.40;     // edge half-width  (alpha = 0 -> soft fade)

export class RaceLine {
  constructor(scene, track) {
    this.track = track;
    const n = track.n;
    this.offsets = racingLineOffsets(track);
    this.mode = +(localStorage.getItem('ns-line') ?? 2);   // 0 off, 1 brake-only, 2 full

    // ---- allowed-speed profile from the LINE's curvature -------------------
    const MU = 1.12, G = 9.81, VMAX = 80, ABRAKE = 8.8, ADRIVE = 6.0;
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
    // smooth, then backward braking pass + forward acceleration pass (both wrap).
    // forward pass is what makes the late-apex "open exit" pay off in the colors.
    for (let p = 0; p < 2; p++) {
      for (let i = 0; i < n; i++) v[i] = (v[(i - 1 + n) % n] + v[i] * 2 + v[(i + 1) % n]) / 4;
    }
    for (let i = 2 * n - 1; i >= 0; i--) {
      const a = i % n, b = (i + 1) % n;
      const lim = Math.sqrt(v[b] * v[b] + 2 * ABRAKE * track.step);
      if (v[a] > lim) v[a] = lim;
    }
    for (let i = 0; i < 2 * n; i++) {
      const a = i % n, b = (i + 1) % n;
      const lim = Math.sqrt(v[a] * v[a] + 2 * ADRIVE * track.step);
      if (v[b] > lim) v[b] = lim;
    }
    this.vAllowed = v;

    // ---- ribbon geometry: 4 vertices per point (edgeL, coreL, coreR, edgeR) -
    // colour buffer is RGBA (itemSize 4) so per-vertex alpha feathers the edges.
    const pos = new Float32Array(n * 4 * 3);
    this.posBuf = pos;
    this.colors = new Float32Array(n * 4 * 4);
    const idx = [];
    const e = new THREE.Vector3();
    const lat = [-W_EDGE, -W_CORE, W_CORE, W_EDGE];
    for (let i = 0; i < n; i++) {
      for (let s = 0; s < 4; s++) {
        track.edge(i, this.offsets[i] + lat[s], 0.04, e);
        const o = (i * 4 + s) * 3;
        pos[o] = e.x; pos[o + 1] = e.y; pos[o + 2] = e.z;
      }
      const a = i * 4, b = ((i + 1) % n) * 4;
      // three strips: left feather, core, right feather
      idx.push(a, a + 1, b, a + 1, b + 1, b);          // edgeL..coreL
      idx.push(a + 1, a + 2, b + 1, a + 2, b + 2, b + 1); // coreL..coreR
      idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2); // coreR..edgeR
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3);
    geo.setAttribute('position', this.posAttr);
    this.colorAttr = new THREE.BufferAttribute(this.colors, 4);
    geo.setAttribute('color', this.colorAttr);
    geo.setIndex(idx);

    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85,
      depthWrite: false, polygonOffset: true,
      polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 6;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this._applyMode();
  }

  _applyMode() {
    this.mesh.visible = this.mode > 0;
    // brake-only: additive blending so only the red braking zones glow
    this.material.blending = this.mode === 1 ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.material.opacity = this.mode === 1 ? 0.95 : 0.85;
    localStorage.setItem('ns-line', String(this.mode));
  }

  setMode(m) { this.mode = m; this._applyMode(); }
  cycleMode() {
    const modes = this.hasIdeal ? 4 : 3;   // +Ideal guide when an ideal lap is loaded
    this.setMode((this.mode + 1) % modes); // Off -> Brake -> Full -> (Ideal) -> Off
    return ['Off', 'Brake guide', 'Full line', 'Ideal guide'][this.mode];
  }

  // load an ideal-lap action profile (from ideal-practice.js): per track point,
  // the action(1 throttle/2 brake/3 trail/4 coast) + target speed. Enables mode 3.
  setIdeal(pts) {
    const n = this.track.n, step = this.track.step;
    const act = new Uint8Array(n), spd = new Float32Array(n), offI = new Float32Array(n);
    const seen = new Uint8Array(n);
    const A = { THROTTLE: 1, BRAKE: 2, TRAIL: 3, COAST: 4 };
    for (const p of pts) {
      const i = ((Math.round(p.s / step) % n) + n) % n;
      act[i] = A[p.a] || 4; spd[i] = p.v; offI[i] = p.d ?? this.offsets[i]; seen[i] = 1;
    }
    let last = 1, lv = 0, lo = this.offsets[0];   // forward-fill gaps (pts ~3 m apart)
    for (let i = 0; i < n; i++) {
      if (seen[i]) { last = act[i]; lv = spd[i]; lo = offI[i]; }
      else { act[i] = last; spd[i] = lv; offI[i] = lo; }
    }
    this.idealAct = act; this.idealSpd = spd; this.idealOff = offI; this.hasIdeal = true;
    this.offsets = offI;                    // adopt the optimized line everywhere
    this.idealSK = this._signedKappa(offI); // signed curvature for the autopilot's steer feed-forward
    this._rebuildRibbon();
  }
  // signed curvature of the offset line (same formula the lap optimizer scored against)
  _signedKappa(off) {
    const t = this.track, n = t.n;
    const lx = new Float64Array(n), lz = new Float64Array(n), k = new Float64Array(n);
    for (let i = 0; i < n; i++) { lx[i] = t.px[i] + t.rx[i] * off[i]; lz[i] = t.pz[i] + t.rz[i] * off[i]; }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      let ax = lx[i] - lx[a], az = lz[i] - lz[a], bx = lx[b] - lx[i], bz = lz[b] - lz[i];
      const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1; ax /= la; az /= la; bx /= lb; bz /= lb;
      k[i] = (ax * bz - az * bx) / ((la + lb) / 2);
    }
    for (let p = 0; p < 3; p++) { const s = k.slice(); for (let i = 0; i < n; i++) { const a = (i - 1 + n) % n, b = (i + 1) % n; k[i] = (s[a] + 2 * s[i] + s[b]) / 4; } }
    return k;
  }
  // re-lay the ribbon vertices onto the current this.offsets (e.g. after setIdeal
  // adopts the ghost line). Same cross-section as the constructor build.
  _rebuildRibbon() {
    const n = this.track.n, e = new THREE.Vector3();
    const lat = [-W_EDGE, -W_CORE, W_CORE, W_EDGE], pos = this.posBuf;
    for (let i = 0; i < n; i++) for (let s = 0; s < 4; s++) {
      this.track.edge(i, this.offsets[i] + lat[s], 0.04, e);
      const o = (i * 4 + s) * 3; pos[o] = e.x; pos[o + 1] = e.y; pos[o + 2] = e.z;
    }
    this.posAttr.needsUpdate = true;
  }
  clearIdeal() { this.hasIdeal = false; this.idealAct = null; if (this.mode === 3) this.setMode(2); }

  // base (inactive / behind-car) colour for one point: dim grey in full mode,
  // invisible in brake-only. Returns [r,g,b,a].
  _baseColorAt() {
    if (this.mode === 1) return [0, 0, 0, 0];
    return [COL_BASE[0], COL_BASE[1], COL_BASE[2], 0.5];
  }

  // write one point's 4 vertices: core gets the colour at `coreA`, edges get the
  // same rgb at alpha 0 (feather). `rgb` is the lit colour, `a` the core alpha.
  _writePoint(i, rgb, coreA) {
    const c = this.colors, o = i * 16;
    const r = rgb[0], g = rgb[1], b = rgb[2];
    // edgeL (alpha 0)
    c[o] = r; c[o + 1] = g; c[o + 2] = b; c[o + 3] = 0;
    // coreL
    c[o + 4] = r; c[o + 5] = g; c[o + 6] = b; c[o + 7] = coreA;
    // coreR
    c[o + 8] = r; c[o + 9] = g; c[o + 10] = b; c[o + 11] = coreA;
    // edgeR (alpha 0)
    c[o + 12] = r; c[o + 13] = g; c[o + 14] = b; c[o + 15] = 0;
  }

  _paintBaseAll() {
    const n = this.track.n;
    const [r, g, b, a] = this._baseColorAt();
    for (let i = 0; i < n; i++) this._writePoint(i, [r, g, b], a);
    if (this.colorAttr.clearUpdateRanges) this.colorAttr.clearUpdateRanges();
    this.colorAttr.needsUpdate = true;
    this._prevStart = -1;
  }

  // windowed recolour: only ~300 points around the car are touched and only
  // those bytes are re-uploaded.
  update(carS, carSpeed) {
    if (!this.mesh.visible) return;
    if (this._lastMode !== this.mode) { this._lastMode = this.mode; this._paintBaseAll(); return; }
    const brakeOnly = this.mode === 1;
    const n = this.track.n, step = this.track.step;
    const i0 = Math.floor(carS / step) % n;
    const ranges = [];
    const [br, bg, bb, ba] = this._baseColorAt();

    // restore the previous window to base where it no longer overlaps
    const BEH = 8, AHD = 300, LEN = BEH + AHD + 1;
    const start = ((i0 - BEH) % n + n) % n;
    if (this._prevStart >= 0 && this._prevStart !== start) {
      for (let k = 0; k < LEN; k++) {
        const i = (this._prevStart + k) % n;
        const rel = ((i - start) % n + n) % n;
        if (rel < LEN) continue;
        this._writePoint(i, [br, bg, bb], ba);
      }
      ranges.push([this._prevStart, LEN]);
    }

    for (let k = 0; k < LEN; k++) {
      const i = (start + k) % n;
      const dist = (((i - i0) % n + n) % n) * step;
      let col = COL_BASE, fade = 0.34;            // behind-car trail
      if (dist <= AHD * step) {
        if (this.mode === 3 && this.idealAct) {   // ideal guide: static action colours
          const a = this.idealAct[i];
          col = a === 1 ? COL_GREEN : a === 2 ? COL_RED : a === 3 ? COL_ORANGE : COL_YELLOW;
          fade = Math.max(1 - 0.55 * (dist / (AHD * step)), 0.55);
        } else {                                  // dynamic: current speed vs allowed
          const va = this.vAllowed[i];
          if (carSpeed <= va + 0.5) col = COL_GREEN;
          else {
            const req = (carSpeed * carSpeed - va * va) / (2 * Math.max(dist, 2));
            col = req > 5.8 ? COL_RED : req > 2.3 ? COL_YELLOW : COL_GREEN;
          }
          fade = 1 - 0.55 * (dist / (AHD * step));
          if (col === COL_RED) fade = Math.max(fade, 0.70);
          else if (col === COL_YELLOW) fade = Math.max(fade, 0.58);
        }
      }
      if (brakeOnly) {
        const warn = col === COL_RED || col === COL_YELLOW;
        this._writePoint(i, warn ? col : [0, 0, 0], warn ? fade : 0);
      } else {
        // blend lit colour toward the dim base by fade (rgb), alpha = core fade
        const r = col[0] * fade + COL_BASE[0] * (1 - fade);
        const g = col[1] * fade + COL_BASE[1] * (1 - fade);
        const b = col[2] * fade + COL_BASE[2] * (1 - fade);
        this._writePoint(i, [r, g, b], 0.5 + 0.5 * fade);
      }
    }
    ranges.push([start, LEN]);
    this._prevStart = start;

    if (this.colorAttr.clearUpdateRanges) {
      this.colorAttr.clearUpdateRanges();
      for (const [s0, len] of ranges) {
        if (s0 + len <= n) this.colorAttr.addUpdateRange(s0 * 16, len * 16);
        else {                                    // wraps the loop seam
          this.colorAttr.addUpdateRange(s0 * 16, (n - s0) * 16);
          this.colorAttr.addUpdateRange(0, (s0 + len - n) * 16);
        }
      }
    }
    this.colorAttr.needsUpdate = true;
  }
}
