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
function buildSegments(pts, kap, rng) {
  const n = pts.length, step = STEP, CORNER = 0.010;
  // longest straight → spawn + a Start marker
  let bestLen = 0, bestStart = 0, run = 0, runStart = 0;
  for (let j = 0; j < n * 2; j++) {
    const a = Math.abs(kap[j % n]);
    if (a < CORNER) { if (run === 0) runStart = j; run++; if (run > bestLen && j < n + runStart) { bestLen = run; bestStart = runStart % n; } }
    else run = 0;
  }
  const spawnS = ((bestStart + Math.floor(bestLen * 0.72)) % n) * step;
  // collect corner regions
  const cs = []; let i = 0;
  while (i < n) {
    if (Math.abs(kap[i]) > CORNER) {
      const start = i; let turn = 0, len = 0, sm = 0; const sgn = Math.sign(kap[i]);
      while (i < n && Math.abs(kap[i]) > CORNER * 0.6) { turn += kap[i]; len++; sm = Math.max(sm, Math.abs(kap[i])); i++; }
      cs.push({ s: Math.round(start * step), start, deg: Math.abs(turn) * 180 / Math.PI, len, sm, sgn });
    } else i++;
  }
  // one tight corner may become a banked Karussell (concrete bowl) — a signature feature
  let tightIdx = -1, tightSm = 0;
  cs.forEach((c, idx) => { if (c.sm > tightSm) { tightSm = c.sm; tightIdx = idx; } });
  const carousel = tightSm > 0.10 && rng() < 0.7 ? tightIdx : -1;

  const seg = [{ name: 'Start', s: Math.round(spawnS) }];
  for (let c = 0; c < cs.length; c++) {
    const cc = cs[c], nx = cs[c + 1];
    let name;
    if (c === carousel) name = 'Karussell';
    else if (nx && nx.sgn !== cc.sgn && (nx.start - cc.start) * step < 170 && cc.deg < 110 && nx.deg < 110)
      name = (nx.start - cc.start) * step < 95 ? 'Chicane' : 'Esses';
    else if (cc.sm > 0.11 || cc.deg > 115) name = 'Hairpin';
    else if (cc.len * step > 130 && cc.sm < 0.05) name = 'Sweeper';
    else if (cc.deg < 40) name = 'Kink';
    else name = 'Corner';
    if (Math.abs(cc.s - spawnS) > 40) seg.push({ name: name + ' ' + (c + 1), s: cc.s });
  }
  seg.sort((a, b) => a.s - b.s);
  return { segments: seg, spawnS: Math.round(spawnS), longestStraight: bestLen * step };
}

// Rolling elevation — the biggest "feature": low harmonics (periodic, so the loop
// closes) for big hills + a couple of sharper crests (blind brows), per-track hilliness,
// then scaled so the grade stays drivable. Non-DEM terrain follows the road, so this
// gives real 3D — climbs, dips, crests over corners.
function elevation(n, rng) {
  const hill = 0.15 + rng() * rng();                 // 0.15 .. ~1.15 (flat .. very hilly)
  const amp = 6 + hill * 26;
  const H = [];
  for (let k = 1; k <= 3; k++) H.push({ k, a: amp / (k * k) * (0.5 + rng()), p: rng() * Math.PI * 2 });
  const bumps = [];
  const nb = Math.floor(rng() * 3);                  // 0..2 sharper crests
  for (let b = 0; b < nb; b++) bumps.push({ c: 0.12 + rng() * 0.76, w: 0.025 + rng() * 0.04, a: (rng() * 2 - 1) * (5 + rng() * 9) });
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const f = i / n; let e = 0;
    for (const h of H) e += h.a * Math.sin(2 * Math.PI * h.k * f + h.p);
    for (const bp of bumps) { const d = Math.abs(((f - bp.c + 0.5) % 1) - 0.5) / bp.w; if (d < 1) e += bp.a * 0.5 * (1 + Math.cos(Math.PI * d)); }
    y[i] = e;
  }
  for (let p = 0; p < 2; p++) { const t = y.slice(); for (let i = 0; i < n; i++) { const a = (i - 1 + n) % n, b = (i + 1) % n; y[i] = (t[a] + 2 * t[i] + t[b]) / 4; } }
  let mg = 0; for (let i = 0; i < n; i++) { const d = Math.abs(y[i] - y[(i - 1 + n) % n]); if (d > mg) mg = d; }
  const lim = 0.085 * STEP;                           // ≤8.5% grade — drivable
  if (mg > lim) { const s = lim / mg; for (let i = 0; i < n; i++) y[i] *= s; }
  return i => Y + y[i];
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
    let maxK = 0, corners = 0, inC = false, straight = 0, sRun = 0, longStraight = 0;
    for (const k of kap) {
      const a = Math.abs(k);
      if (a > maxK) maxK = a;
      if (a > 0.02) { if (!inC) { corners++; inC = true; } } else inC = false;
      if (a < 0.009) { straight++; sRun++; if (sRun > longStraight) longStraight = sRun; } else sRun = 0;
    }
    // real circuit character with actual FEATURES: drivable, several corners, at least
    // one proper corner, genuine straights, and one clear long straight (a speed section)
    if (maxK > MAX_CURV) continue;
    if (corners < 4) continue;
    if (maxK < 0.06) continue;                         // no real corner (radius > ~16 m everywhere)
    if (straight / kap.length < 0.08) continue;        // no straights (constant-curving oval)
    if (longStraight * STEP < 180) continue;           // no long straight (nothing to accelerate down)

    // valid — assemble the TRACK
    const elev = elevation(pts.length, rng);
    const points = pts.map((p, i) => [+p.x.toFixed(2), +elev(i).toFixed(2), +p.z.toFixed(2)]);
    const { segments, spawnS } = buildSegments(pts, kap, rng);
    return {
      name: 'Random #' + (seed >>> 0), step: STEP, total,
      points, segments, origin: { lat: 0, lon: 0 },
      spawn: spawnS, seed: seed >>> 0, roadHalf: 4.5,
    };
  }
  return null;   // caller retries with a fresh seed (extremely rare)
}
