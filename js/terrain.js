// Real-DEM terrain: bilinear height sampling, wide terrain mesh with
// height/slope-based coloring, and the unified visual ground function.
import * as THREE from 'three';
import { DEM } from './dem_data.js';
import { ROAD_HALF, RAIL_D } from './track.js';

let _track = null;          // set by buildDem; enables corridor carving

function rawDem(x, z) {
  const fx = (x - DEM.x0) / DEM.step;
  const fz = (z - DEM.z0) / DEM.step;
  const i = THREE.MathUtils.clamp(Math.floor(fx), 0, DEM.nx - 2);
  const j = THREE.MathUtils.clamp(Math.floor(fz), 0, DEM.nz - 2);
  const tx = THREE.MathUtils.clamp(fx - i, 0, 1);
  const tz = THREE.MathUtils.clamp(fz - j, 0, 1);
  const h = DEM.h;
  const a = h[j * DEM.nx + i], b = h[j * DEM.nx + i + 1];
  const c = h[(j + 1) * DEM.nx + i], d = h[(j + 1) * DEM.nx + i + 1];
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
    _distGrid = new Float32Array(DEM.nx * DEM.nz).fill(1e9);
    for (let j = 0; j < DEM.nz; j++) {
      for (let i = 0; i < DEM.nx; i++) {
        const cx = DEM.x0 + i * DEM.step, cz = DEM.z0 + j * DEM.step;
        const ni = _track.nearestIndex(cx, cz, 6);
        if (ni >= 0) {
          _distGrid[j * DEM.nx + i] =
            Math.hypot(_track.px[ni] - cx, _track.pz[ni] - cz);
        }
      }
    }
  }
  const i = THREE.MathUtils.clamp(Math.round((x - DEM.x0) / DEM.step), 0, DEM.nx - 1);
  const j = THREE.MathUtils.clamp(Math.round((z - DEM.z0) / DEM.step), 0, DEM.nz - 1);
  return _distGrid[j * DEM.nx + i];
}

export function demHeight(x, z) {
  let y = rawDem(x, z);
  if (!_track) return y;
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

  // 3x upsampled grid: ~21.7 m triangles, small enough that interpolation
  // between vertices can no longer bridge across the carved corridor
  const UP = 3;
  const nx = (DEM.nx - 1) * UP + 1, nz = (DEM.nz - 1) * UP + 1;
  const st = DEM.step / UP;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const cLow = new THREE.Color(0x4f7038);    // valley grass
  const cMid = new THREE.Color(0x39542e);    // forest green
  const cHigh = new THREE.Color(0x2f4527);   // high forest
  const tmp = new THREE.Color();

  let hMin = Infinity, hMax = -Infinity;
  for (const h of DEM.h) { hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); }

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = DEM.x0 + i * st, z = DEM.z0 + j * st;
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
