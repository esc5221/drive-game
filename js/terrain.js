// Terrain: a real DEM when one is supplied (Nürburgring), otherwise a
// procedural rolling ground derived from the track's own elevation (Spa,
// practice). Either way exposes the same demHeight / worldGround / buildDem.
import * as THREE from 'three';
import { ROAD_HALF, RAIL_D } from './track.js';

let _track = null;          // set by buildDem; enables corridor carving
let _dem = null;            // real DEM module, or null for procedural ground
let _meanY = 0;

// supply (or clear) the real DEM before buildWorld; null => procedural
export function setDem(dem) { _dem = dem || null; _distGrid = null; }

function rawDem(x, z) {
  if (!_dem) {              // procedural: follow the nearest track elevation
    const ni = _track ? _track.nearestIndex(x, z, 10) : -1;
    let baseY = _meanY, dist = 300;
    if (ni >= 0) { baseY = _track.py[ni]; dist = Math.hypot(_track.px[ni] - x, _track.pz[ni] - z); }
    const n = Math.sin(x * 0.0061 + z * 0.0103) * Math.sin(x * 0.0152 - z * 0.0047)
            + 0.4 * Math.sin(x * 0.031 + z * 0.027);
    return baseY - 1.2 + n * Math.min(1, dist / 90) * 11;
  }
  const fx = (x - _dem.x0) / _dem.step;
  const fz = (z - _dem.z0) / _dem.step;
  const i = THREE.MathUtils.clamp(Math.floor(fx), 0, _dem.nx - 2);
  const j = THREE.MathUtils.clamp(Math.floor(fz), 0, _dem.nz - 2);
  const tx = THREE.MathUtils.clamp(fx - i, 0, 1);
  const tz = THREE.MathUtils.clamp(fz - j, 0, 1);
  const h = _dem.h;
  const a = h[j * _dem.nx + i], b = h[j * _dem.nx + i + 1];
  const c = h[(j + 1) * _dem.nx + i], d = h[(j + 1) * _dem.nx + i + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

// DEM height with the road corridor carved out: terrain may never rise above
// a clearance cone around the track (the coarse 65m DEM otherwise averages
// valley walls right over the road, e.g. Senkenlinks +66m).
// ceiling(dist) = roadY - 1.6        for dist <= 24 m
//               + (dist-24) * 0.55   beyond (≈29° cut slope)
let _distGrid = null;       // coarse per-DEM-cell distance to track (speed cache)

function coarseDist(x, z) {
  if (!_distGrid) {
    _distGrid = new Float32Array(_dem.nx * _dem.nz).fill(1e9);
    for (let j = 0; j < _dem.nz; j++) {
      for (let i = 0; i < _dem.nx; i++) {
        const cx = _dem.x0 + i * _dem.step, cz = _dem.z0 + j * _dem.step;
        const ni = _track.nearestIndex(cx, cz, 6);
        if (ni >= 0) {
          _distGrid[j * _dem.nx + i] =
            Math.hypot(_track.px[ni] - cx, _track.pz[ni] - cz);
        }
      }
    }
  }
  const i = THREE.MathUtils.clamp(Math.round((x - _dem.x0) / _dem.step), 0, _dem.nx - 1);
  const j = THREE.MathUtils.clamp(Math.round((z - _dem.z0) / _dem.step), 0, _dem.nz - 1);
  return _distGrid[j * _dem.nx + i];
}

export function demHeight(x, z) {
  let y = rawDem(x, z);
  if (!_track || !_dem) return y;   // procedural ground already follows the track
  // cell-center distance minus half diagonal bounds the true distance
  if (coarseDist(x, z) > 200) return y;
  const ni = _track.nearestIndex(x, z, 6);      // search up to ~150 m out
  if (ni < 0) return y;
  const dx = _track.px[ni] - x, dz = _track.pz[ni] - z;
  const dist = Math.hypot(dx, dz);
  const ceiling = _track.py[ni] - 1.6 + Math.max(0, dist - 24) * 0.55;
  return Math.min(y, ceiling);
}

// visual ground height anywhere: road / apron ribbon / blend zone / raw DEM
export function worldGround(track, x, z) {
  const q = track.query(x, z, {});
  if (!q) return demHeight(x, z);
  const ad = Math.abs(q.d);
  if (ad <= ROAD_HALF) return q.y;
  const v = new THREE.Vector3();
  track.edge(q.i, Math.sign(q.d) * ROAD_HALF, 0, v);
  const apron = v.y - 0.10 - (ad - ROAD_HALF) * 0.05;
  const inner = RAIL_D + 6;
  if (ad <= inner) return apron;
  const dem = demHeight(x, z);
  if (ad >= 60) return dem;
  const t = (ad - inner) / (60 - inner);
  const s = t * t * (3 - 2 * t);                     // smoothstep
  return apron * (1 - s) + dem * s;
}

export function buildDem(scene, track) {
  _track = track;             // demHeight() carves around the road from here on
  let sy = 0; for (let i = 0; i < track.n; i++) sy += track.py[i];
  _meanY = sy / track.n;

  // grid bounds + resolution: real DEM uses its own grid; procedural spans the
  // track bounding box + margin at a fixed cell size.
  let gx0, gz0, st, nx, nz;
  if (_dem) {
    const UP = 3;             // upsample so triangles can't bridge the corridor
    nx = (_dem.nx - 1) * UP + 1; nz = (_dem.nz - 1) * UP + 1;
    st = _dem.step / UP; gx0 = _dem.x0; gz0 = _dem.z0;
  } else {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < track.n; i++) {
      minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]);
      minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]);
    }
    const M = 400; st = 22;
    gx0 = minX - M; gz0 = minZ - M;
    nx = Math.ceil((maxX - minX + 2 * M) / st) + 1;
    nz = Math.ceil((maxZ - minZ + 2 * M) / st) + 1;
  }
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const cLow = new THREE.Color(0x4f7038);    // valley grass
  const cMid = new THREE.Color(0x39542e);    // forest green
  const cHigh = new THREE.Color(0x2f4527);   // high forest
  const tmp = new THREE.Color();

  let hMin = Infinity, hMax = -Infinity;
  if (_dem) { for (const h of _dem.h) { hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); } }
  else { hMin = _meanY - 12; hMax = _meanY + 18; }

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = gx0 + i * st, z = gz0 + j * st;
      const yRaw = rawDem(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = demHeight(x, z) - 0.4; pos[k * 3 + 2] = z;
      const t = (yRaw - hMin) / (hMax - hMin);
      tmp.copy(cLow).lerp(cMid, Math.min(1, t * 1.8));
      if (t > 0.6) tmp.lerp(cHigh, (t - 0.6) * 2.0);
      const n = Math.sin(x * 0.013 + z * 0.021) * 0.5 + Math.sin(x * 0.041 - z * 0.007) * 0.5;
      tmp.offsetHSL(0, 0.02 * n, 0.018 * n);
      col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
    }
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1.0, metalness: 0,
  }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
