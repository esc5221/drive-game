// Track geometry: frames (tangent/right/roll), curvature, banking,
// and fast analytic surface queries for the physics raycasts.
import * as THREE from 'three';

export const ROAD_HALF = 4.5;     // asphalt half width (m)
export const CURB_W = 0.7;        // curb width beyond asphalt
export const RAIL_D = 7.2;        // guardrail lateral distance from centerline
export const WALL_D = 6.9;        // physics wall distance

export const SURF = { ROAD: 0, CURB: 1, GRASS: 2 };

export class Track {
  constructor(data) {
    this.name = data.name;
    this.step = data.step;
    this.n = data.points.length;
    this.total = this.n * this.step;
    this.segments = data.segments;

    const n = this.n;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.px[i] = data.points[i][0];
      this.py[i] = data.points[i][1];
      this.pz[i] = data.points[i][2];
    }

    // tangents (3D, normalized) and horizontal right vectors
    this.tx = new Float32Array(n); this.ty = new Float32Array(n); this.tz = new Float32Array(n);
    this.rx = new Float32Array(n); this.rz = new Float32Array(n);
    this.curv = new Float32Array(n);   // signed, >0 = left turn
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      let dx = this.px[b] - this.px[a], dy = this.py[b] - this.py[a], dz = this.pz[b] - this.pz[a];
      const L = Math.hypot(dx, dy, dz) || 1;
      this.tx[i] = dx / L; this.ty[i] = dy / L; this.tz[i] = dz / L;
      const hl = Math.hypot(dx, dz) || 1;
      // right = cross(t_horiz, up) = (-tz, 0, tx) normalized
      this.rx[i] = -(dz / hl); this.rz[i] = dx / hl;
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      // cross(t[a], t[b]).y > 0 -> left turn
      const cy = this.tz[a] * this.tx[b] - this.tx[a] * this.tz[b];
      this.curv[i] = Math.asin(THREE.MathUtils.clamp(cy, -1, 1)) / (2 * this.step);
    }
    this._smooth(this.curv, 7, 2);

    // banking: bank into the corner. Karussell sections get the concrete-bowl treatment.
    const karussell = new Float32Array(n);
    for (const [si, seg] of data.segments.entries()) {
      if (/Karussell/i.test(seg.name)) {
        const s0 = seg.s;
        const s1 = si + 1 < data.segments.length ? data.segments[si + 1].s : this.total;
        for (let s = s0; s < s1; s += this.step) karussell[Math.floor(s / this.step) % n] = 1;
      }
    }
    this.roll = new Float32Array(n);  // >0 = right side up (left edge low) = banking for LEFT turn
    for (let i = 0; i < n; i++) {
      const k = Math.abs(this.curv[i]);
      const base = Math.atan(k * 900 / 9.81) * 0.45;          // design speed 30 m/s, 45% banked
      const cap = karussell[i] ? 0.28 : 0.10;                  // 16deg in Karussell, 5.7deg elsewhere
      const mag = Math.min(base * (karussell[i] ? 3.0 : 1.0), cap);
      this.roll[i] = this.curv[i] > 0 ? mag : -mag;
    }
    this._smooth(this.roll, 13, 2);

    // curb zones: dilated high-curvature regions
    this.curb = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (Math.abs(this.curv[i]) > 0.011) this.curb[i] = 1;
    const dil = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      for (let k = -6; k <= 6; k++) if (this.curb[(i + k + n) % n]) { dil[i] = 1; break; }
    }
    this.curb = dil;

    // spatial hash grid (25m cells)
    this.cell = 25;
    this.grid = new Map();
    for (let i = 0; i < n; i++) {
      const key = Math.floor(this.px[i] / this.cell) + '|' + Math.floor(this.pz[i] / this.cell);
      let arr = this.grid.get(key);
      if (!arr) this.grid.set(key, arr = []);
      arr.push(i);
    }
  }

  _smooth(arr, win, passes) {
    const n = arr.length, half = win >> 1;
    for (let p = 0; p < passes; p++) {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = -half; k <= half; k++) s += arr[(i + k + n) % n];
        out[i] = s / (2 * half + 1);
      }
      arr.set(out);
    }
  }

  // nearest centerline index to (x,z), searching expanding rings of grid cells
  nearestIndex(x, z, maxRing = 4) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bestD = Infinity;
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let gx = cx - ring; gx <= cx + ring; gx++) {
        for (let gz = cz - ring; gz <= cz + ring; gz++) {
          if (ring > 0 && Math.abs(gx - cx) !== ring && Math.abs(gz - cz) !== ring) continue;
          const arr = this.grid.get(gx + '|' + gz);
          if (!arr) continue;
          for (const i of arr) {
            const dx = this.px[i] - x, dz = this.pz[i] - z;
            const d = dx * dx + dz * dz;
            if (d < bestD) { bestD = d; best = i; }
          }
        }
      }
      if (best >= 0 && ring >= 1) break;   // one extra ring after first hit
    }
    return best;
  }

  // Full surface query at world (x,z).
  // Returns {s, d, y, nx,ny,nz, tx,ty,tz, surf, i, roll} or null if far off-track.
  query(x, z, out) {
    const i0 = this.nearestIndex(x, z);
    if (i0 < 0) return null;
    const n = this.n;
    // project on the two adjacent segments (horizontal), keep the closer
    let bi = i0, bt = 0, bd2 = Infinity;
    for (const i of [(i0 - 1 + n) % n, i0]) {
      const j = (i + 1) % n;
      const ax = this.px[i], az = this.pz[i];
      const bx = this.px[j], bz = this.pz[j];
      const ex = bx - ax, ez = bz - az;
      const L2 = ex * ex + ez * ez || 1;
      const t = THREE.MathUtils.clamp(((x - ax) * ex + (z - az) * ez) / L2, 0, 1);
      const qx = ax + ex * t, qz = az + ez * t;
      const d2 = (x - qx) * (x - qx) + (z - qz) * (z - qz);
      if (d2 < bd2) { bd2 = d2; bi = i; bt = t; }
    }
    const j = (bi + 1) % n;
    const lerp = (A, B) => A + (B - A) * bt;
    const cx = lerp(this.px[bi], this.px[j]), cy = lerp(this.py[bi], this.py[j]), cz2 = lerp(this.pz[bi], this.pz[j]);
    let rx = lerp(this.rx[bi], this.rx[j]), rz = lerp(this.rz[bi], this.rz[j]);
    const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    const roll = lerp(this.roll[bi], this.roll[j]);
    const d = (x - cx) * rx + (z - cz2) * rz;        // signed lateral, + = right of center

    const ad = Math.abs(d);
    let surf, y;
    const tanR = Math.tan(roll);
    // NOTE: every transition below is a continuous ramp — a height step,
    // crossed at speed, spikes the suspension damper and launches the car.
    if (ad <= ROAD_HALF) {
      surf = SURF.ROAD;
      y = cy + d * tanR;
    } else if (ad <= ROAD_HALF + CURB_W && this.curb[bi]) {
      surf = SURF.CURB;
      const lip = Math.min(1, (ad - ROAD_HALF) / 0.25) * 0.025;
      y = cy + d * tanR + lip;
    } else {
      surf = SURF.GRASS;
      const edge = cy + Math.sign(d) * ROAD_HALF * tanR;
      const off = ad - ROAD_HALF;
      const drop = Math.min(1, off / 0.9) * 0.10;    // ramp down over 0.9 m
      y = edge - drop - off * 0.05;
    }

    let tx = lerp(this.tx[bi], this.tx[j]), ty = lerp(this.ty[bi], this.ty[j]), tz = lerp(this.tz[bi], this.tz[j]);
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;

    // surface normal = cross(across, tangent), across = right tilted by roll
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const ax2 = rx * cr, ay2 = sr, az2 = rz * cr;
    let nx = ay2 * tz - az2 * ty, ny = az2 * tx - ax2 * tz, nz = ax2 * ty - ay2 * tx;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const nl = Math.hypot(nx, ny, nz) || 1;

    out = out || {};
    out.s = ((bi + bt) * this.step) % this.total;
    out.d = d; out.y = y;
    out.nx = nx / nl; out.ny = ny / nl; out.nz = nz / nl;
    out.tx = tx; out.ty = ty; out.tz = tz;
    out.rx = rx; out.rz = rz;
    out.surf = surf; out.i = bi; out.roll = roll;
    return out;
  }

  // centerline pose at arc length s
  poseAt(s) {
    s = ((s % this.total) + this.total) % this.total;
    const f = s / this.step;
    const i = Math.floor(f) % this.n, j = (i + 1) % this.n, t = f - Math.floor(f);
    const L = (A, B) => A + (B - A) * t;
    return {
      x: L(this.px[i], this.px[j]), y: L(this.py[i], this.py[j]), z: L(this.pz[i], this.pz[j]),
      tx: L(this.tx[i], this.tx[j]), ty: L(this.ty[i], this.ty[j]), tz: L(this.tz[i], this.tz[j]),
    };
  }

  // lateral edge position used by mesh builders (d in meters from centerline)
  edge(i, d, yOff = 0, v) {
    v = v || new THREE.Vector3();
    const tanR = Math.tan(this.roll[i]);
    v.set(this.px[i] + this.rx[i] * d, this.py[i] + d * tanR + yOff, this.pz[i] + this.rz[i] * d);
    return v;
  }

  sectionAt(s) {
    const segs = this.segments;
    let lo = 0, hi = segs.length - 1, ans = segs.length - 1;
    if (s < segs[0].s) return segs[segs.length - 1];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid].s <= s) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return segs[ans];
  }
}
