// Loft-based car body — real automotive surfacing, procedurally.
// The body is a single smooth hull lofted through cross-sections ("stations")
// along the car's length, the way car surfaces actually work:
//   - side profile     : belt line / rocker / deck+roof height curves over z
//   - plan view        : body width curve (nose taper, door tuck, rear haunches)
//   - section shape    : rocker -> side -> shoulder -> inset greenhouse -> roof crown
//   - wheel arches     : the section's lower edge lifts over each axle (no CSG)
//   - glass            : faces of the upper hull inside the cabin span, minus
//                        pillar bands, get the glass material via geometry groups
// Everything is driven by a per-car parameter object (spec.visual.body), so each
// car keeps its identity while sharing the engine. Coordinates: +x right, +y up,
// -z forward (same frame as the rest of CarVisual).
import * as THREE from 'three';

// smooth interpolation through [[z, v], ...] stops (monotone, C1)
function curve(stops) {
  return z => {
    if (z <= stops[0][0]) return stops[0][1];
    if (z >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
    let i = 0;
    while (stops[i + 1][0] < z) i++;
    const [z0, v0] = stops[i], [z1, v1] = stops[i + 1];
    const t = (z - z0) / (z1 - z0);
    const s = t * t * (3 - 2 * t);                 // smoothstep — no overshoot
    return v0 + (v1 - v0) * s;
  };
}

const clamp01 = t => Math.min(1, Math.max(0, t));

export function buildRoadBody(B, mats) {
  const { paint, glass, dark } = mats;
  const group = new THREE.Group();

  // ---- profile curves ------------------------------------------------------
  const beltC = curve(B.belt);        // shoulder/belt line height
  const deckC = curve(B.deck);        // hood / roof / decklid centreline height
  const widthC = curve(B.width);      // body half width (plan view)
  const rockC = curve(B.rocker || [[B.z0, B.yLow], [B.z1, B.yLow]]);

  const arches = B.arches;            // [{z, r, lift}] wheel arch spans
  const archLift = z => {
    let lift = 0;
    for (const a of arches) {
      const d = Math.abs(z - a.z);
      if (d < a.r) lift = Math.max(lift, Math.sqrt(a.r * a.r - d * d) * a.lift);
    }
    return lift;
  };
  const archFlare = z => {
    let f = 0;
    for (const a of arches) {
      const d = Math.abs(z - a.z) / (a.r * 1.35);
      if (d < 1) f = Math.max(f, (a.flare || 0) * (1 - d * d) ** 1.5);
    }
    return f;
  };

  // cabin span + glass test
  const [cab0, cab1] = B.cabin;       // greenhouse z range
  const inCabin = z => z > cab0 && z < cab1;
  const isPillar = z => B.pillars.some(([p0, p1]) => z >= p0 && z <= p1);

  // ---- build the loft ------------------------------------------------------
  const NZ = 64, NP = 9;              // stations x half-section points
  const zs = [];
  for (let i = 0; i < NZ; i++) zs.push(B.z0 + (B.z1 - B.z0) * i / (NZ - 1));

  // half-section sample points (x, y) at station z, bottom -> roof centre
  function section(z) {
    const w = widthC(z) + archFlare(z);
    const belt = beltC(z);
    const deck = deckC(z);
    const low = rockC(z) + archLift(z);
    const cabin = inCabin(z);
    const gw = w - B.glassInset;                       // greenhouse base width
    const roofW = B.roofW * w;
    const pts = [];
    pts.push([0, low]);                                 // 0 floor centre
    pts.push([w * 0.86, low]);                          // 1 floor edge
    pts.push([w * 0.985, low + (belt - low) * 0.22]);   // 2 rocker/side low
    pts.push([w, low + (belt - low) * 0.62]);           // 3 side (widest)
    pts.push([w * 0.995, belt]);                        // 4 shoulder
    if (cabin) {
      const roof = deck;                                // deck curve carries roof height in cabin
      pts.push([gw, belt + 0.02]);                      // 5 glass base
      pts.push([gw * 0.94 - (gw - roofW) * 0.35, belt + (roof - belt) * 0.55]);  // 6 glass mid
      pts.push([roofW, roof - B.crown * 0.55]);         // 7 roof edge
      pts.push([0, roof]);                              // 8 roof centre
    } else {
      // bonnet / decklid: shoulder rolls inward to the deck with fender hump + crown
      const hump = (B.humps ? B.humps(z) : 0);
      pts.push([w * 0.86, belt + hump * 0.9]);          // 5 fender top
      pts.push([w * 0.55, deck + hump * 0.35]);         // 6
      pts.push([w * 0.26, deck + 0.008]);               // 7
      pts.push([0, deck]);                              // 8 deck centre
    }
    return pts;
  }

  // vertices: for each station, mirror the half section (x>0 side then x<0)
  const cols = NP * 2 - 2;                              // shared centre points
  const pos = [];
  for (const z of zs) {
    const pts = section(z);
    for (let pI = 0; pI < NP; pI++) pos.push(pts[pI][0], pts[pI][1], z);
    for (let pI = NP - 2; pI >= 1; pI--) pos.push(-pts[pI][0], pts[pI][1], z);
  }
  const idx = [], groups = [];                          // quad strip between stations
  let gStart = 0, gMat = 0;
  const flush = end => { if (end > gStart) groups.push([gStart, end - gStart, gMat]); gStart = end; };
  for (let i = 0; i < NZ - 1; i++) {
    const zMid = (zs[i] + zs[i + 1]) / 2;
    for (let p = 0; p < cols; p++) {
      const pn = (p + 1) % cols;
      const a = i * cols + p, b = i * cols + pn, c = (i + 1) * cols + p, d = (i + 1) * cols + pn;
      // faces on the upper hull inside the cabin (excluding pillar bands) are glass
      const upper = (p >= 4 && p <= NP - 2) || (p >= cols - (NP - 2) && p <= cols - 4);
      const g = (upper && inCabin(zMid) && !isPillar(zMid)) ? 1 : 0;
      if (g !== gMat) { flush(idx.length); gMat = g; }
      idx.push(a, c, b, b, c, d);
    }
  }
  flush(idx.length);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  for (const [s, c, m] of groups) geo.addGroup(s, c, m);
  geo.computeVertexNormals();
  const hull = new THREE.Mesh(geo, [paint, glass]);
  hull.castShadow = true;
  group.add(hull);

  // ---- nose / tail caps (flat-ish lofted ends read as bumpers) --------------
  for (const [z, sign] of [[B.z0, -1], [B.z1, 1]]) {
    const pts = section(z + sign * -0.001);
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < NP; i++) shape.lineTo(pts[i][0], pts[i][1]);
    for (let i = NP - 2; i >= 0; i--) shape.lineTo(-pts[i][0], pts[i][1]);
    shape.closePath();
    const cap = new THREE.Mesh(new THREE.ShapeGeometry(shape), paint);
    cap.position.z = z;
    if (sign < 0) cap.rotation.y = Math.PI;
    cap.castShadow = true;
    group.add(cap);
  }

  // ---- dark wheel wells: thin inner shells INSIDE the arch (never pierce the
  // outer surface) so you don't see through the body behind the wheel ----------
  for (const a of arches) {
    for (const sgn of [-1, 1]) {
      const w = widthC(a.z);
      const well = new THREE.Mesh(
        new THREE.CylinderGeometry(a.r * 0.82, a.r * 0.82, 0.30, 18, 1, false), dark);
      well.rotation.z = Math.PI / 2;
      well.position.set(sgn * (w - 0.26), rockC(a.z) + a.r * 0.30, a.z);
      group.add(well);
    }
  }

  return group;
}
