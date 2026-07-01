// Procedural random circuit generator. Produces the same TRACK shape as the static
// tracks (points + segments); the Track class derives curvature/banking/curbs/surface,
// and the world builds road/kerbs/trees around it — so a random layout needs only a
// clean, closed, non-self-intersecting centreline plus segment markers.
//
// Method: a star polygon — nodes at monotonically-increasing angles around a centre
// (so it can never self-cross) with strongly varied radii AND angular gaps. A per-track
// "bay depth" sets how deep the radius dips get, giving anything from flowing/fast to
// tight/technical layouts. Then: soften near-180° kinks -> closed Catmull-Rom ->
// arc-length resample -> reject boring ovals / undrivable spikes. Seeded, so a given
// seed always yields the same track (records/sharing work).

const STEP = 5.0;
const Y = 80.0;                       // flat, like the practice track
const TARGET_LEN = 2900;              // aim ~2.9 km; accepted band [2200, 3800]
const MIN_RADIUS = 6.0;               // tightest corner (m) — real hairpins ok (practice ~5.8)
const MAX_CURV = 1 / MIN_RADIUS;

// ---- seeded PRNG (mulberry32) ---------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---- geometry helpers ------------------------------------------------------
const cross3 = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

// soften vertices whose turn is sharper than maxTurn (keeps corners drivable)
function soften(pts, maxCos, iters) {
  const n = pts.length;
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
      const v1x = b.x - a.x, v1z = b.z - a.z, v2x = c.x - b.x, v2z = c.z - b.z;
      const l1 = Math.hypot(v1x, v1z) || 1, l2 = Math.hypot(v2x, v2z) || 1;
      const dot = (v1x * v2x + v1z * v2z) / (l1 * l2);
      if (dot < maxCos) { b.x += ((a.x + c.x) / 2 - b.x) * 0.5; b.z += ((a.z + c.z) / 2 - b.z) * 0.5; }
    }
  }
  return pts;
}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) };
}
function catmullClosed(pts, sub) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let k = 0; k < sub; k++) out.push(catmull(p0, p1, p2, p3, k / sub));
  }
  return out;
}

function resample(poly, step) {
  const out = [poly[0]]; let acc = 0;
  for (let i = 1; i <= poly.length; i++) {
    let a = poly[(i - 1) % poly.length]; const b = poly[i % poly.length];
    let seg = Math.hypot(b.x - a.x, b.z - a.z);
    while (acc + seg >= step) {
      const t = (step - acc) / seg;
      a = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      out.push(a); seg = Math.hypot(b.x - a.x, b.z - a.z); acc = 0;
    }
    acc += seg;
  }
  return out;
}

function smoothClosed(vals, win, passes) {
  const n = vals.length, half = win >> 1;
  for (let p = 0; p < passes; p++) {
    const t = vals.slice();
    for (let i = 0; i < n; i++) {
      let sx = 0, sz = 0;
      for (let k = -half; k <= half; k++) { const q = t[(i + k + n) % n]; sx += q.x; sz += q.z; }
      vals[i] = { x: sx / (2 * half + 1), z: sz / (2 * half + 1) };
    }
  }
  return vals;
}

function selfIntersects(pts) {
  const n = pts.length;
  const segHit = (a, b, c, d) => {
    const d1 = cross3(a, b, c), d2 = cross3(a, b, d), d3 = cross3(c, d, a), d4 = cross3(c, d, b);
    return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
  };
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;            // skip the closing-adjacent pair
      if (segHit(a, b, pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

// signed curvature per point (matches the Track class' formula)
function curvature(pts) {
  const n = pts.length, k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    let ax = b.x - a.x, az = b.z - a.z, bx = c.x - b.x, bz = c.z - b.z;
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    k[i] = Math.asin(Math.max(-1, Math.min(1, ax * bz - az * bx))) / ((la + lb) / 2);
  }
  return k;
}

function scaleAbout(pts, f) {
  let cx = 0, cz = 0; for (const p of pts) { cx += p.x; cz += p.z; } cx /= pts.length; cz /= pts.length;
  for (const p of pts) { p.x = cx + (p.x - cx) * f; p.z = cz + (p.z - cz) * f; }
  return pts;
}

// ---- segments + spawn from the finished centreline -------------------------
function buildSegments(pts, kap) {
  const n = pts.length, step = STEP;
  // classify contiguous corner regions (|curv| above a threshold), split by straights
  const CORNER = 0.010;
  const seg = [];
  let i = 0, cornerIdx = 0;
  // find the longest straight first (for spawn + a Start marker)
  let bestLen = 0, bestStart = 0, run = 0, runStart = 0;
  for (let j = 0; j < n * 2; j++) {
    const a = Math.abs(kap[j % n]);
    if (a < CORNER) { if (run === 0) runStart = j; run++; if (run > bestLen && j < n + runStart) { bestLen = run; bestStart = runStart % n; } }
    else run = 0;
  }
  const spawnS = ((bestStart + Math.floor(bestLen * 0.72)) % n) * step;   // late on the longest straight (before the corner)
  seg.push({ name: 'Start', s: Math.round(spawnS) });
  // corner markers
  while (i < n) {
    if (Math.abs(kap[i]) > CORNER) {
      const start = i; let turn = 0, len = 0, signMax = 0;
      while (i < n && Math.abs(kap[i]) > CORNER * 0.6) { turn += kap[i]; len++; signMax = Math.max(signMax, Math.abs(kap[i])); i++; }
      const deg = Math.abs(turn) * 180 / Math.PI;
      let name = 'Corner';
      if (signMax > 0.11) name = 'Hairpin';
      else if (deg > 120) name = 'Hairpin';
      else if (len * step > 130 && signMax < 0.05) name = 'Sweeper';
      else if (deg < 45) name = 'Kink';
      cornerIdx++;
      const s = Math.round(start * step);
      if (Math.abs(s - spawnS) > 40) seg.push({ name: name + ' ' + cornerIdx, s });
    } else i++;
  }
  seg.sort((a, b) => a.s - b.s);
  return { segments: seg, spawnS: Math.round(spawnS) };
}

// gentle rolling elevation (a few raised-cosine crests), practice-flat baseline
function elevation(n, rng) {
  const hills = [];
  const count = 1 + Math.floor(rng() * 3);
  for (let h = 0; h < count; h++) hills.push({ c: rng(), w: 0.06 + rng() * 0.12, a: (rng() * 2 - 1) * (3 + rng() * 4) });
  return i => {
    const f = i / n; let y = Y;
    for (const h of hills) { let d = Math.abs(((f - h.c + 0.5) % 1) - 0.5) / h.w; if (d < 1) y += h.a * 0.5 * (1 + Math.cos(Math.PI * d)); }
    return y;
  };
}

// ---- main entry ------------------------------------------------------------
export function generateRandomTrack(seed) {
  seed = (seed >>> 0) || 1;
  for (let attempt = 0; attempt < 40; attempt++) {
    const rng = mulberry32((seed + attempt * 0x9E3779B1) >>> 0);
    const targetLen = 2000 + rng() * 2000;             // per-seed length 2.0..4.0 km (variety)
    const bayDepth = rng();                            // 0 = flowing/fast .. 1 = technical/tight (per track)
    const radMin = 0.58 - bayDepth * 0.40;             // shallow bays (gentle) .. deep bays (tight corners)
    // ---- star polygon: nodes at monotonically-increasing angles around a centre,
    // with strongly varied radii AND angular gaps -> deep bays/headlands become
    // hairpins, chicanes, esses and long straights. Angular order => never self-crosses.
    const N = 15 + Math.floor(rng() * 10);             // 15..24 nodes
    const R = 430;
    const gaps = []; let gsum = 0;
    for (let i = 0; i < N; i++) { const g = 0.30 + rng() * rng() * 2.6; gaps.push(g); gsum += g; }  // uneven spacing
    let ctrl = []; let ang = rng() * Math.PI * 2;
    for (let i = 0; i < N; i++) {
      ang += gaps[i] / gsum * Math.PI * 2;
      const rad = R * (radMin + (1 - radMin) * rng());  // per-track bay depth sets the corner character
      ctrl.push({ x: Math.cos(ang) * rad, z: Math.sin(ang) * rad });
    }
    ctrl = soften(ctrl, -0.85, 1);                     // tame only near-180° kinks (keep real hairpins)

    // fit length: scale control points so the resampled loop is ~targetLen
    const measure = c => resample(catmullClosed(c, 10), STEP).length * STEP;
    let len = measure(ctrl);
    if (len > 100) scaleAbout(ctrl, Math.max(0.5, Math.min(2.0, targetLen / len)));

    let pts = smoothClosed(resample(catmullClosed(ctrl, 10), STEP), 3, 2);
    const total = pts.length * STEP;
    if (total < 2100 || total > 4200) continue;
    if (selfIntersects(pts)) continue;
    const kap = curvature(pts);
    let maxK = 0, corners = 0, inC = false, straight = 0;
    for (const k of kap) {
      const a = Math.abs(k);
      if (a > maxK) maxK = a;
      if (a > 0.02) { if (!inC) { corners++; inC = true; } } else inC = false;
      if (a < 0.008) straight++;
    }
    // real circuit character: drivable, several corners, at least one proper corner,
    // and genuine straights — rejects both undrivable spikes and boring constant-radius ovals
    if (maxK > MAX_CURV) continue;
    if (corners < 4) continue;
    if (maxK < 0.045) continue;                        // no real corner (giant gentle loop)
    if (straight / kap.length < 0.08) continue;        // no straights (constant-curving oval)

    // valid — assemble the TRACK
    const elev = elevation(pts.length, rng);
    const points = pts.map((p, i) => [+p.x.toFixed(2), +elev(i).toFixed(2), +p.z.toFixed(2)]);
    const { segments, spawnS } = buildSegments(pts, kap);
    return {
      name: 'Random #' + (seed >>> 0), step: STEP, total,
      points, segments, origin: { lat: 0, lon: 0 },
      spawn: spawnS, seed: seed >>> 0, roadHalf: 4.5,
    };
  }
  return null;   // caller retries with a fresh seed (extremely rare)
}
