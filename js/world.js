// World construction: road (PBR) + rubber line + Karussell concrete,
// curbs, guardrails, DEM terrain, forest, corner signs, braking markers,
// km posts, ad bridge/boards, graffiti, Breidscheid village, spectators.
import * as THREE from 'three';
import { ROAD_HALF, CURB_W, RAIL_D } from './track.js';
import { buildDem, demHeight, worldGround } from './terrain.js';
import { racingLineOffsets } from './raceline.js';

export function groundHeightAt(track, q, x, z) {   // camera collision helper
  return worldGround(track, x, z);
}

// ---------------------------------------------------------------- textures
function rng(seed) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

function asphaltTexture() {
  const S = 1024;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#323236'; g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S), d = img.data;
  const r = rng(12345);
  for (let i = 0; i < d.length; i += 4) {
    const v = (r() - 0.5) * 30 + (r() - 0.5) * 12;
    d[i] += v; d[i + 1] += v; d[i + 2] += v + (r() - 0.5) * 4;
  }
  g.putImageData(img, 0, 0);
  // faded patch rectangles
  for (let k = 0; k < 7; k++) {
    g.fillStyle = `rgba(${20 + r() * 30},${20 + r() * 30},${22 + r() * 30},0.18)`;
    g.fillRect(r() * S, r() * S, 80 + r() * 300, 60 + r() * 200);
  }
  // cracks: dark random walks
  g.strokeStyle = 'rgba(12,12,14,0.55)'; g.lineWidth = 2;
  for (let k = 0; k < 10; k++) {
    let x = r() * S, y = r() * S;
    g.beginPath(); g.moveTo(x, y);
    for (let st = 0; st < 22; st++) { x += (r() - 0.5) * 60; y += r() * 42; g.lineTo(x, y); }
    g.stroke();
  }
  // edge grime: dirt/moss creeping in from the verges (public road feel)
  for (let y = 0; y < S; y += 4) {
    const wL = 18 + r() * 30, wR = 18 + r() * 30;
    g.fillStyle = `rgba(52,58,40,${0.10 + r() * 0.16})`;
    g.fillRect(0, y, wL, 4);
    g.fillRect(S - wR, y, wR, 4);
  }
  // white edge lines
  g.fillStyle = 'rgba(232,232,230,0.9)';
  g.fillRect(16, 0, 12, S); g.fillRect(S - 28, 0, 12, S);
  g.fillStyle = 'rgba(140,140,140,0.25)';        // worn edge of the line
  g.fillRect(28, 0, 4, S); g.fillRect(S - 32, 0, 4, S);
  // center dashed line — the Nordschleife is a public toll road
  g.fillStyle = 'rgba(228,228,224,0.78)';
  g.fillRect(S / 2 - 5, 20, 10, 300);            // 3m dash / 7m gap (tile = 10m)
  g.fillStyle = 'rgba(150,150,148,0.2)';
  g.fillRect(S / 2 - 5, 330, 10, 30);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  return t;
}

function rubberTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 512;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 512);
  const r = rng(999);
  for (let k = 0; k < 90; k++) {
    const x = 12 + r() * 104, w = 2 + r() * 5, y = r() * 512, h = 60 + r() * 240;
    const edge = Math.abs(x - 64) / 64;
    g.fillStyle = `rgba(8,8,10,${0.30 * (1 - edge * 0.8) * (0.4 + r() * 0.6)})`;
    g.fillRect(x, y, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function concreteTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#98958a'; g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256), d = img.data;
  const r = rng(777);
  for (let i = 0; i < d.length; i += 4) {
    const v = (r() - 0.5) * 22;
    d[i] += v; d[i + 1] += v; d[i + 2] += v;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = 'rgba(60,58,52,0.8)';            // slab joints across the road
  for (let y = 0; y < 256; y += 64) g.fillRect(0, y, 256, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function curbTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#dad7d0'; g.fillRect(0, 0, 64, 256);
  g.fillStyle = '#c0392b'; g.fillRect(0, 0, 64, 128);
  const img = g.getImageData(0, 0, 64, 256), d = img.data;
  const r = rng(55);
  for (let i = 0; i < d.length; i += 4) {
    const v = (r() - 0.5) * 16; d[i] += v; d[i + 1] += v; d[i + 2] += v;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function railTexture() {
  const c = document.createElement('canvas'); c.width = 32; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#dde0e3'; g.fillRect(0, 0, 32, 64);
  g.fillStyle = '#6a7077'; g.fillRect(0, 0, 32, 7); g.fillRect(0, 30, 32, 7);
  g.fillStyle = '#b4bac0'; g.fillRect(0, 14, 32, 8); g.fillRect(0, 44, 32, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function textPanel(text, opts = {}) {
  const W = opts.w || 512, H = opts.h || 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = opts.bg || '#f2f2ee'; g.fillRect(0, 0, W, H);
  if (opts.border) { g.strokeStyle = opts.border; g.lineWidth = H * 0.08; g.strokeRect(4, 4, W - 8, H - 8); }
  g.fillStyle = opts.fg || '#111';
  let size = opts.size || H * 0.5;
  g.font = `bold ${size}px ${opts.font || '"Arial Narrow", Arial, sans-serif'}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  while (g.measureText(text).width > W * 0.9 && size > 18) {
    size -= 4; g.font = `bold ${size}px ${opts.font || 'Arial'}`;
  }
  g.fillText(text, W / 2, H / 2 + (opts.dy || 0));
  return new THREE.CanvasTexture(c);
}

// ------------------------------------------------------------ mesh helpers
function buildRibbon(track, d0, d1, yOff, material, opts = {}) {
  if (d0 > d1) { const t = d0; d0 = d1; d1 = t; }
  const n = track.n;
  const stride = opts.stride || 1;
  const m = Math.ceil(n / stride);
  const pos = new Float32Array((m + 1) * 2 * 3);
  const uv = new Float32Array((m + 1) * 2 * 2);
  const idx = [];
  const v = new THREE.Vector3();
  const heightFn = opts.heightFn || null;
  const dFn = opts.dFn || null;                 // optional per-index lateral shift
  for (let k = 0; k <= m; k++) {
    const i = (k * stride) % n;
    const shift = dFn ? dFn(i) : 0;
    for (let side = 0; side < 2; side++) {
      const d = (side ? d1 : d0) + shift;
      track.edge(i, d, yOff, v);
      if (heightFn) v.y = heightFn(i, d, v);
      const o = (k * 2 + side) * 3;
      pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
      const uo = (k * 2 + side) * 2;
      uv[uo] = side; uv[uo + 1] = (k * stride * track.step) / (opts.vScale || 4);
    }
    if (k < m) {
      const a = k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

function buildRailRibbon(track, d, y0, y1, material) {
  const n = track.n, stride = 2, m = Math.ceil(n / stride);
  const pos = new Float32Array((m + 1) * 2 * 3);
  const uv = new Float32Array((m + 1) * 2 * 2);
  const idx = [];
  const v = new THREE.Vector3();
  for (let k = 0; k <= m; k++) {
    const i = (k * stride) % n;
    track.edge(i, d, 0, v);
    const groundY = v.y - 0.10 - (Math.abs(d) - ROAD_HALF) * 0.05;
    for (let side = 0; side < 2; side++) {
      const o = (k * 2 + side) * 3;
      pos[o] = v.x; pos[o + 1] = groundY + (side ? y1 : y0); pos[o + 2] = v.z;
      const uo = (k * 2 + side) * 2;
      uv[uo] = (k * stride * track.step) / 4; uv[uo + 1] = side;
    }
    if (k < m) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

// ---------------------------------------------------------------- main
export function buildWorld(scene, track, opts = {}) {
  const treeFrac = opts.trees != null ? opts.trees : 1;
  buildDem(scene, track);

  // ---- road
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTexture(), roughness: 0.94, metalness: 0,
  });
  roadMat.map.anisotropy = Math.min(16, (opts.aniso || 8) * 2);
  const road = buildRibbon(track, -ROAD_HALF, ROAD_HALF, 0, roadMat, { vScale: 10 });
  road.receiveShadow = true;
  scene.add(road);

  // ---- rubber racing line (darkened driving line hugging corner insides)
  const lineOffset = racingLineOffsets(track);
  const rubTex = rubberTexture();
  const mkRubMat = op => new THREE.MeshStandardMaterial({
    map: rubTex, transparent: true, opacity: op, roughness: 1, metalness: 0,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  // faint wide darkening of the whole driving corridor
  const wide = buildRibbon(track, -1.5, 1.5, 0.010, mkRubMat(0.42),
    { vScale: 9, dFn: i => lineOffset[i] });
  wide.renderOrder = 2;
  scene.add(wide);
  // two distinct tire tracks (real rubber lays down in twin stripes)
  for (const off of [-0.62, 0.62]) {
    const stripe = buildRibbon(track, off - 0.26, off + 0.26, 0.013, mkRubMat(0.95),
      { vScale: 14, dFn: i => lineOffset[i] });
    stripe.renderOrder = 3;
    scene.add(stripe);
  }

  // ---- Karussell concrete slabs
  addKarussellConcrete(scene, track);

  // ---- curb chunks (shared with braking markers)
  const chunks = findCurbChunks(track);
  const curbMat = new THREE.MeshStandardMaterial({ map: curbTexture(), roughness: 0.85 });
  addCurbs(scene, track, curbMat, chunks);

  // ---- grass aprons + blend-to-DEM skirt
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x466132, roughness: 1 });
  const grassFarMat = new THREE.MeshStandardMaterial({ color: 0x3a5128, roughness: 1 });
  for (const sgn of [-1, 1]) {
    const apron = buildRibbon(track, sgn * ROAD_HALF, sgn * (RAIL_D + 6), 0, grassMat, {
      stride: 2, vScale: 8,
      heightFn: (i, d, v) => {
        const ad = Math.abs(d);
        if (ad <= ROAD_HALF + 0.01) return v.y;
        const e = new THREE.Vector3(); track.edge(i, Math.sign(d) * ROAD_HALF, 0, e);
        return e.y - 0.10 - (ad - ROAD_HALF) * 0.05;
      },
    });
    apron.receiveShadow = true;
    scene.add(apron);
    const far = buildRibbon(track, sgn * (RAIL_D + 6), sgn * 60, 0, grassFarMat, {
      stride: 3,
      heightFn: (i, d, v) => {
        const ad = Math.abs(d);
        const e = new THREE.Vector3(); track.edge(i, Math.sign(d) * ROAD_HALF, 0, e);
        const apronY = e.y - 0.10 - (RAIL_D + 6 - ROAD_HALF) * 0.05;
        const t = THREE.MathUtils.clamp((ad - RAIL_D - 6) / (60 - RAIL_D - 6), 0, 1);
        const s = t * t * (3 - 2 * t);
        return apronY * (1 - s) + demHeight(v.x, v.z) * s;
      },
    });
    far.receiveShadow = true;
    scene.add(far);
  }

  // ---- guardrails (galvanized steel, reflects the sky)
  const railMat = new THREE.MeshStandardMaterial({
    map: railTexture(), metalness: 0.78, roughness: 0.36, side: THREE.DoubleSide,
  });
  for (const sgn of [-1, 1]) scene.add(buildRailRibbon(track, sgn * RAIL_D, 0.35, 0.80, railMat));
  addRailPosts(scene, track);

  // ---- world dressing
  addForest(scene, track, treeFrac);
  addSigns(scene, track);
  addGantry(scene, track);
  addBrakingMarkers(scene, track, chunks);
  addKmPosts(scene, track);
  addAdBridge(scene, track);
  addAdBoards(scene, track);
  addGraffiti(scene, track);
  addVillage(scene, track);
  addSpectators(scene, track);
}

function addKarussellConcrete(scene, track) {
  const mat = new THREE.MeshStandardMaterial({
    map: concreteTexture(), roughness: 0.9,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  mat.map.repeat.set(1, 1);
  const segs = track.segments;
  for (let si = 0; si < segs.length; si++) {
    if (!/Karussell/i.test(segs[si].name)) continue;
    const s0 = segs[si].s, s1 = si + 1 < segs.length ? segs[si + 1].s : track.total;
    const i0 = Math.floor(s0 / track.step), i1 = Math.floor(s1 / track.step);
    const pos = [], uvs = [], idx = [];
    const v = new THREE.Vector3();
    let row = 0;
    for (let i = i0; i <= i1; i++) {
      const ii = i % track.n;
      for (const [u, d] of [[0, -ROAD_HALF], [1, ROAD_HALF]]) {
        track.edge(ii, d, 0.02, v);
        pos.push(v.x, v.y, v.z);
        uvs.push(u, (i - i0) * track.step / 4);
      }
      if (i < i1) {
        const a = row * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      row++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function findCurbChunks(track) {
  const n = track.n, chunks = [];
  let i = 0;
  while (i < n) {
    if (!track.curb[i]) { i++; continue; }
    const start = i;
    while (i < n && track.curb[i]) i++;
    let maxC = 0;
    for (let k = start; k < i; k++) maxC = Math.max(maxC, Math.abs(track.curv[k]));
    chunks.push({ a: start, b: i, maxCurv: maxC });
  }
  return chunks;
}

function addCurbs(scene, track, mat, chunks) {
  const n = track.n, v = new THREE.Vector3();
  const positions = [], uvs = [], idxs = [];
  let vertBase = 0;
  for (const { a, b } of chunks) {
    if (b - a < 4) continue;
    let cs = 0; for (let k = a; k < b; k++) cs += track.curv[k];
    const inside = cs > 0 ? -1 : 1;
    for (const side of (b - a > 30 ? [inside, -inside] : [inside])) {
      let d0 = side * ROAD_HALF, d1 = side * (ROAD_HALF + CURB_W);
      if (d0 > d1) { const t = d0; d0 = d1; d1 = t; }
      for (let k = a; k <= b; k++) {
        const ii = k % n;
        for (const [di, dd] of [[0, d0], [1, d1]]) {
          track.edge(ii, dd, di ? 0.045 : 0.02, v);
          positions.push(v.x, v.y, v.z);
          uvs.push(di, (k * track.step) / 4);
        }
        if (k < b) {
          const q = vertBase + (k - a) * 2;
          idxs.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
        }
      }
      vertBase += (b - a + 1) * 2;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idxs);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function addRailPosts(scene, track) {
  const n = track.n, every = 4;
  const count = Math.floor(n / every) * 2;
  const geo = new THREE.BoxGeometry(0.10, 0.85, 0.14);
  const mat = new THREE.MeshStandardMaterial({ color: 0x787e85, metalness: 0.6, roughness: 0.5 });
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
  let k = 0;
  for (let i = 0; i < n; i += every) {
    for (const sgn of [-1, 1]) {
      track.edge(i, sgn * RAIL_D, 0, v);
      const gy = v.y - 0.10 - (RAIL_D - ROAD_HALF) * 0.05;
      m4.makeRotationY(Math.atan2(track.tx[i], track.tz[i]));
      m4.setPosition(v.x, gy + 0.42, v.z);
      inst.setMatrixAt(k++, m4);
    }
  }
  inst.count = k;
  scene.add(inst);
}

// two species, near-track dense pass + wide DEM scatter pass
function addForest(scene, track, frac = 1) {
  const r = rng(424242);
  const MAXC = Math.floor(24000 * frac), MAXB = Math.floor(8500 * frac);

  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 3.0, 5);
  const cone1Geo = new THREE.ConeGeometry(2.5, 6.4, 6);
  const cone2Geo = new THREE.ConeGeometry(1.7, 4.4, 6);
  const blobGeo = new THREE.IcosahedronGeometry(2.6, 0);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4e3d2c });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2c4a28 });
  const leafMat2 = new THREE.MeshLambertMaterial({ color: 0x35592f });
  const blobMat = new THREE.MeshLambertMaterial({ color: 0x3f6231 });

  const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, MAXC + MAXB);
  const cone1 = new THREE.InstancedMesh(cone1Geo, leafMat, MAXC);
  const cone2 = new THREE.InstancedMesh(cone2Geo, leafMat2, MAXC);
  const blob = new THREE.InstancedMesh(blobGeo, blobMat, MAXB);
  cone1.castShadow = true;
  blob.castShadow = true;

  const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
  let kc = 0, kb = 0, kt = 0;

  const place = (x, z) => {
    const ni = track.nearestIndex(x, z);
    if (ni >= 0) {
      const dx = track.px[ni] - x, dz = track.pz[ni] - z;
      if (dx * dx + dz * dz < 13.5 * 13.5) return;
    }
    const gy = worldGround(track, x, z);
    const s = 0.95 + r() * 1.35;
    const broad = r() < 0.28;
    if (broad && kb < MAXB) {
      m4.makeScale(s, s * (0.9 + r() * 0.3), s);
      m4.setPosition(x, gy + 1.5 * s, z);
      trunk.setMatrixAt(kt++, m4);
      m4.makeScale(s, s * (0.85 + r() * 0.3), s);
      m4.setPosition(x, gy + 4.4 * s, z);
      blob.setMatrixAt(kb++, m4);
    } else if (kc < MAXC) {
      m4.makeScale(s, s, s);
      m4.setPosition(x, gy + 1.5 * s, z);
      trunk.setMatrixAt(kt++, m4);
      m4.setPosition(x, gy + 5.0 * s, z);
      cone1.setMatrixAt(kc, m4);
      m4.setPosition(x, gy + 7.9 * s, z);
      cone2.setMatrixAt(kc, m4);
      kc++;
    }
  };

  // pass 1: tight tree wall right behind the rails (the Eifel green tunnel)
  for (let i = 0; i < track.n; i += 1) {
    for (const sgn of [-1, 1]) {
      if (r() < 0.25) continue;
      const d = sgn * (RAIL_D + 3.5 + r() * 9);
      track.edge(i, d, 0, v);
      place(v.x + (r() - 0.5) * 4, v.z + (r() - 0.5) * 4);
    }
  }
  // pass 1b: mid-distance forest mass
  for (let i = 0; i < track.n; i += 1) {
    for (const sgn of [-1, 1]) {
      if (r() < 0.35) continue;
      const d = sgn * (RAIL_D + 13 + r() * 40);
      track.edge(i, d, 0, v);
      place(v.x + (r() - 0.5) * 8, v.z + (r() - 0.5) * 8);
    }
  }
  // pass 2: wide scatter over the DEM (forest masses on the hills)
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < track.n; i++) {
    minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]);
    minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]);
  }
  for (let k = 0; k < 14000 && (kc < MAXC || kb < MAXB); k++) {
    const x = minX - 600 + r() * (maxX - minX + 1200);
    const z = minZ - 600 + r() * (maxZ - minZ + 1200);
    place(x, z);
  }

  trunk.count = kt; cone1.count = kc; cone2.count = kc; blob.count = kb;
  scene.add(trunk, cone1, cone2, blob);

  // undergrowth: low bushes hugging the guardrails
  const MAXU = Math.floor(5200 * frac);
  const bushGeo = new THREE.IcosahedronGeometry(1.0, 0);
  const bushMat = new THREE.MeshLambertMaterial({ color: 0x2f4d28 });
  const bush = new THREE.InstancedMesh(bushGeo, bushMat, MAXU);
  let ku = 0;
  for (let i = 0; i < track.n && ku < MAXU; i += 2) {
    for (const sgn of [-1, 1]) {
      if (r() < 0.45) continue;
      const d = sgn * (RAIL_D + 1.2 + r() * 4.5);
      track.edge(i, d, 0, v);
      const gy = worldGround(track, v.x, v.z);
      const s = 0.6 + r() * 1.1;
      m4.makeScale(s * (1 + r() * 0.6), s * 0.62, s * (1 + r() * 0.6));
      m4.setPosition(v.x + (r() - 0.5) * 2, gy + 0.3 * s, v.z + (r() - 0.5) * 2);
      bush.setMatrixAt(ku++, m4);
      if (ku >= MAXU) break;
    }
  }
  bush.count = ku;
  scene.add(bush);
}

function addSigns(scene, track) {
  const postMat = new THREE.MeshStandardMaterial({ color: 0x858a90, metalness: 0.5, roughness: 0.5 });
  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6);
  const v = new THREE.Vector3();
  for (const seg of track.segments) {
    if (/Nordschleife/.test(seg.name)) continue;
    const i = Math.floor(seg.s / track.step) % track.n;
    let cs = 0;
    for (let k = 0; k < 24; k++) cs += track.curv[(i + k) % track.n];
    const side = cs > 0 ? 1 : -1;
    track.edge(i, side * (RAIL_D - 0.8), 0, v);
    const gy = v.y - 0.10 - (RAIL_D - 0.8 - ROAD_HALF) * 0.05;

    const group = new THREE.Group();
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(0, 1.2, 0);
    group.add(post);
    const tex = textPanel(seg.name, { border: '#1a3a8c' });
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 0.58),
      new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    panel.position.set(0, 2.15, 0);
    group.add(panel);
    group.position.set(v.x, gy, v.z);
    group.rotation.y = Math.atan2(-track.tx[i], -track.tz[i]);
    scene.add(group);
  }
}

function addGantry(scene, track) {
  const v0 = new THREE.Vector3(); track.edge(0, 0, 0, v0);
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xcfd3d7, metalness: 0.4, roughness: 0.5 });
  const pillarGeo = new THREE.BoxGeometry(0.5, 6.4, 0.5);
  for (const sgn of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, mat);
    p.position.set(sgn * (ROAD_HALF + 1.2), 3.2, 0);
    p.castShadow = true;
    g.add(p);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry((ROAD_HALF + 1.2) * 2 + 0.5, 0.9, 0.7), mat);
  beam.position.set(0, 6.0, 0);
  beam.castShadow = true;
  g.add(beam);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(11, 1.0),
    new THREE.MeshBasicMaterial({
      map: textPanel('N Ü R B U R G R I N G   N O R D S C H L E I F E',
        { w: 1024, h: 96, bg: '#10151c', fg: '#fff', size: 56, font: 'Arial' }),
      side: THREE.DoubleSide,
    }));
  banner.position.set(0, 6.0, -0.4);
  g.add(banner);
  g.position.copy(v0);
  g.rotation.y = Math.atan2(-track.tx[0], -track.tz[0]);
  scene.add(g);

  const lc = document.createElement('canvas'); lc.width = 128; lc.height = 16;
  const lg = lc.getContext('2d');
  for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
    lg.fillStyle = (x + y) % 2 ? '#111' : '#eee';
    lg.fillRect(x * 8, y * 8, 8, 8);
  }
  const line = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.8),
    new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(lc) }));
  line.rotation.order = 'YXZ';
  line.rotation.y = Math.atan2(-track.tx[0], -track.tz[0]);
  line.rotation.x = -Math.PI / 2;
  line.position.set(v0.x, v0.y + 0.02, v0.z);
  scene.add(line);
}

// red-striped 100/50 boards before significant corners
function addBrakingMarkers(scene, track, chunks) {
  const v = new THREE.Vector3();
  const majors = chunks.filter(c => c.maxCurv > 0.016 && (c.b - c.a) * track.step > 35);
  const boardGeo = new THREE.PlaneGeometry(0.7, 0.9);
  const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.1, 5);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x999da2 });
  for (const ch of majors) {
    let cs = 0; for (let k = ch.a; k < ch.b; k++) cs += track.curv[k];
    const side = cs > 0 ? 1 : -1;       // outside of the corner
    for (const dist of [100, 50]) {
      const i = ((ch.a - Math.round(dist / track.step)) % track.n + track.n) % track.n;
      track.edge(i, side * (RAIL_D - 1.1), 0, v);
      const gy = v.y - 0.10 - (RAIL_D - 1.1 - ROAD_HALF) * 0.05;
      const grp = new THREE.Group();
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.y = 0.55;
      grp.add(post);
      const tex = textPanel(String(dist), {
        w: 128, h: 160, bg: '#e8e8e4', fg: '#c0392b', size: 64, border: '#c0392b',
      });
      const board = new THREE.Mesh(boardGeo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
      board.position.y = 1.4;
      grp.add(board);
      grp.position.set(v.x, gy, v.z);
      grp.rotation.y = Math.atan2(-track.tx[i], -track.tz[i]);
      scene.add(grp);
    }
  }
}

function addKmPosts(scene, track) {
  const v = new THREE.Vector3();
  const postGeo = new THREE.BoxGeometry(0.12, 1.0, 0.06);
  const postMat = new THREE.MeshLambertMaterial({ color: 0xeeeeea });
  for (let km = 1; km <= Math.floor(track.total / 1000); km++) {
    const i = Math.round(km * 1000 / track.step) % track.n;
    track.edge(i, RAIL_D - 0.9, 0, v);
    const gy = v.y - 0.10 - (RAIL_D - 0.9 - ROAD_HALF) * 0.05;
    const grp = new THREE.Group();
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.y = 0.5;
    grp.add(post);
    const tex = textPanel(km + ' km', { w: 128, h: 64, size: 36 });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25),
      new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    plate.position.y = 1.05;
    grp.add(plate);
    grp.position.set(v.x, gy, v.z);
    grp.rotation.y = Math.atan2(-track.tx[i], -track.tz[i]);
    scene.add(grp);
  }
}

// the famous sponsor bridge on the approach to Tiergarten
function addAdBridge(scene, track) {
  const i = Math.round(1900 / track.step) % track.n;
  const v = new THREE.Vector3(); track.edge(i, 0, 0, v);
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xf5d020, roughness: 0.6 });
  const pillarGeo = new THREE.BoxGeometry(0.8, 7, 0.8);
  for (const sgn of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, mat);
    p.position.set(sgn * (RAIL_D + 1.5), 3.5, 0);
    p.castShadow = true;
    g.add(p);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry((RAIL_D + 1.5) * 2 + 0.8, 1.6, 1.2), mat);
  beam.position.y = 6.2;
  beam.castShadow = true;
  g.add(beam);
  const tex = textPanel('B I L S T E I N', { w: 1024, h: 128, bg: '#f5d020', fg: '#0a2e5c', size: 84 });
  for (const off of [-0.62, 0.62]) {
    const banner = new THREE.Mesh(new THREE.PlaneGeometry((RAIL_D + 1.5) * 2, 1.4),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    banner.position.set(0, 6.2, off);
    g.add(banner);
  }
  g.position.copy(v);
  g.rotation.y = Math.atan2(-track.tx[i], -track.tz[i]);
  scene.add(g);
}

function addAdBoards(scene, track) {
  const spots = [
    [3680, 'NÜRBURGRING'], [6650, 'GRÜNE HÖLLE'], [7900, 'NORDSCHLEIFE'],
    [11700, '2 0 . 8 3 2  K M'], [14800, 'KARUSSELL'], [16950, 'BRÜNNCHEN'],
    [19200, 'TOURISTENFAHRTEN'], [450, 'DÖTTINGER HÖHE'],
  ];
  const v = new THREE.Vector3();
  for (const [s, text] of spots) {
    const i = Math.round(s / track.step) % track.n;
    let cs = 0;
    for (let k = 0; k < 30; k++) cs += track.curv[(i + k) % track.n];
    const side = cs > 0 ? 1 : -1;
    track.edge(i, side * (RAIL_D + 2.5), 0, v);
    const gy = worldGround(track, v.x, v.z);
    const grp = new THREE.Group();
    const postMat = new THREE.MeshLambertMaterial({ color: 0x666b70 });
    for (const px of [-2.4, 2.4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), postMat);
      post.position.set(px, 1.3, 0);
      grp.add(post);
    }
    const tex = textPanel(text, { w: 1024, h: 160, bg: '#ffffff', fg: '#c0392b', size: 72, border: '#c0392b' });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.0),
      new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    panel.position.y = 2.3;
    grp.add(panel);
    grp.position.set(v.x, gy, v.z);
    grp.rotation.y = Math.atan2(-track.tx[i], -track.tz[i]);
    scene.add(grp);
  }
}

// fan paint on the tarmac (Brünnchen / Pflanzgarten tradition)
function addGraffiti(scene, track) {
  const items = [
    [16980, 'BTG'], [17120, '♥'], [17650, 'GRÜNE HÖLLE'],
    [18430, 'SEND IT'], [10460, 'RING'], [320, 'BTG'],
  ];
  const r = rng(31337);
  const v = new THREE.Vector3();
  for (const [s, text] of items) {
    const i = Math.round(s / track.step) % track.n;
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(240,240,240,0.50)';
    g.font = 'bold 110px Arial';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, 128);
    const tex = new THREE.CanvasTexture(c);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 2.2),
      new THREE.MeshLambertMaterial({
        map: tex, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      }));
    track.edge(i, (r() - 0.5) * 3, 0.015, v);
    mesh.position.copy(v);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = Math.atan2(-track.tx[i], -track.tz[i]) + (r() - 0.5) * 0.4;
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 3;
    scene.add(mesh);
  }
}

// Breidscheid sits in the Adenau valley — whitewashed houses, dark roofs
function addVillage(scene, track) {
  const r = rng(2026);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.9 });
  const wallMat2 = new THREE.MeshStandardMaterial({ color: 0xd8c9b0, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x5a4a42, roughness: 0.9 });
  const v = new THREE.Vector3();
  for (let k = 0; k < 14; k++) {
    const s = 10450 + r() * 600;
    const i = Math.round(s / track.step) % track.n;
    const side = r() < 0.5 ? -1 : 1;
    const d = side * (RAIL_D + 14 + r() * 45);
    track.edge(i, d, 0, v);
    const gy = worldGround(track, v.x, v.z);
    const w = 6 + r() * 4, dep = 5 + r() * 3, h = 2.6 + r() * 1.6;
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), r() < 0.5 ? wallMat : wallMat2);
    body.position.y = h / 2;
    body.castShadow = true;
    grp.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, dep) * 0.52, 1.6 + r(), 4), roofMat);
    roof.position.y = h + 0.8;
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(w / Math.hypot(w, dep) * 1.4, 1, dep / Math.hypot(w, dep) * 1.4);
    grp.add(roof);
    grp.position.set(v.x, gy, v.z);
    grp.rotation.y = r() * Math.PI;
    scene.add(grp);
  }
}

// Brünnchen spectator hill: camping, flags
function addSpectators(scene, track) {
  const r = rng(888);
  const v = new THREE.Vector3();
  const tentCols = [0xc0392b, 0x2980b9, 0xe67e22, 0x27ae60, 0x8e44ad, 0xf1c40f];
  for (let k = 0; k < 10; k++) {
    const s = 16980 + r() * 480;
    const i = Math.round(s / track.step) % track.n;
    const side = 1;                              // outside hill at Brünnchen
    const d = side * (RAIL_D + 8 + r() * 22);
    track.edge(i, d, 0, v);
    const gy = worldGround(track, v.x, v.z);
    const tent = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 1.5, 4),
      new THREE.MeshLambertMaterial({ color: tentCols[k % tentCols.length] }));
    tent.position.set(v.x, gy + 0.75, v.z);
    tent.rotation.y = r() * Math.PI;
    tent.castShadow = true;
    scene.add(tent);
  }
  for (let k = 0; k < 5; k++) {
    const s = 17000 + r() * 420;
    const i = Math.round(s / track.step) % track.n;
    const d = RAIL_D + 6 + r() * 14;
    track.edge(i, d, 0, v);
    const gy = worldGround(track, v.x, v.z);
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 5, 5),
      new THREE.MeshLambertMaterial({ color: 0xbbbbbb }));
    pole.position.y = 2.5;
    grp.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8),
      new THREE.MeshLambertMaterial({ color: tentCols[(k + 2) % tentCols.length], side: THREE.DoubleSide }));
    flag.position.set(0.7, 4.5, 0);
    grp.add(flag);
    grp.position.set(v.x, gy, v.z);
    grp.rotation.y = r() * Math.PI * 2;
    scene.add(grp);
  }
}
