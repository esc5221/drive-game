// Showroom — a clean studio to design the car bodies in a fast capture loop.
// Dev tool only (never linked from the game). Run with `vite dev` so source edits
// and tmp/ref/*.glb are served directly.
//
//   /showroom.html?car=gt3rs          game car (the REAL CarVisual code path)
//   /showroom.html?src=tmp/ref/x.glb  reference model (e.g. the three.js ferrari)
//   &view=f34|side|rear34|front|rear|top   fixed camera preset (default f34)
//   &zoom=1.1  &color=a7d84b  &turn=1 (slow turntable)
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CARS } from './cars.js';
import { CarVisual } from './car.js';

const q = new URLSearchParams(location.search);
const carId = q.get('car') || (q.get('src') ? null : 'gt3rs');
const view = q.get('view') || 'f34';
const zoom = +(q.get('zoom') || 1);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x191b1e);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

// ---- studio set: dark floor disc + soft gradient backdrop ------------------
{
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(14, 64),
    new THREE.MeshStandardMaterial({ color: 0x232629, roughness: 0.55, metalness: 0.0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(13.6, 14, 64),
    new THREE.MeshBasicMaterial({ color: 0x35393e, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002;
  scene.add(ring);
}

// ---- lighting: key + rim + fill (env does the base) --------------------------
{
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(4.5, 6, 3.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -5; key.shadow.camera.right = 5;
  key.shadow.camera.top = 5; key.shadow.camera.bottom = -5;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfd8ff, 1.4);
  rim.position.set(-5, 4, -6);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xfff2df, 0.5);
  fill.position.set(-3, 2, 5);
  scene.add(fill);
}

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 200);
const hud = document.getElementById('hud');

// ---- subject ---------------------------------------------------------------
const subject = new THREE.Group();
scene.add(subject);
let ready = false;

function visibleBox(root) {
  const box = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  root.traverse(o => {
    if (!o.visible) return;
    let p = o.parent, vis = true;
    while (p) { if (!p.visible) { vis = false; break; } p = p.parent; }
    if (vis && o.isMesh && o.geometry) {
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      box.union(b);
    }
  });
  return box;
}

function frameSubject() {
  const box = visibleBox(subject);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // sit on the floor
  subject.position.y -= box.min.y;
  center.y -= box.min.y; center.y += size.y * 0;
  const L = Math.max(size.x, size.z), H = size.y;
  const d = (L * 1.35 + H) / zoom;
  const cy = H * 0.45;
  const V = {
    f34:    [ d * 0.72, d * 0.34, -d * 0.72],
    rear34: [ d * 0.72, d * 0.34,  d * 0.72],
    side:   [ d * 1.05, d * 0.22,  0       ],
    front:  [ 0,        d * 0.26, -d * 1.05],
    rear:   [ 0,        d * 0.26,  d * 1.05],
    top:    [ 0.01,     d * 1.35,  0       ],
  }[view] || [d * 0.72, d * 0.34, -d * 0.72];
  camera.position.set(center.x + V[0], cy + V[1], center.z + V[2]);
  camera.lookAt(center.x, cy, center.z);
  hud.textContent = `${carId || q.get('src')}  view=${view}\nL=${size.z.toFixed(2)} W=${size.x.toFixed(2)} H=${size.y.toFixed(2)}`;
}

if (carId) {
  // the real game visual (exterior mode) — what we're sculpting
  const spec = JSON.parse(JSON.stringify(CARS[carId] || CARS.gt3rs));
  if (q.get('color')) spec.visual.color = parseInt(q.get('color'), 16);
  const vis = new CarVisual(subject, renderer, spec);
  vis.setCameraMode(2);                 // exterior visible, cockpit hidden
  // rest pose: park the wheels where the game's suspension would settle them
  const W = spec.wheels, yLow = spec.visual.body ? spec.visual.body.yLow : -0.30;
  const poses = [[-W.htF, W.fz], [W.htF, W.fz], [-W.htR, W.rz], [W.htR, W.rz]];
  if (vis.wheelMeshes) vis.wheelMeshes.forEach((m, i) => m.position.set(poses[i][0], yLow + W.radius - 0.02, poses[i][1]));
  subject.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  window.__vis = vis;
  // async GLB exteriors attach later — wait for the bbox to stabilise, then frame
  let lastVol = -1, stable = 0;
  const poll = setInterval(() => {
    const b = visibleBox(subject);
    if (b.isEmpty()) return;
    const s = b.getSize(new THREE.Vector3());
    const vol = s.x * s.y * s.z;
    if (Math.abs(vol - lastVol) < 1e-4) stable++; else stable = 0;
    lastVol = vol;
    if (stable >= 3) {
      clearInterval(poll);
      subject.traverse(o => { if (o.isMesh) o.castShadow = true; });
      if (vis.wheelMeshes) vis.wheelMeshes.forEach((m, i) =>
        m.position.set(vis._wheelXFix ? vis._wheelXFix[i] : poses[i][0], yLow + W.radius - 0.02, poses[i][1]));
      frameSubject();
      ready = true;
    }
  }, 200);
} else {
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.load('./' + q.get('src'), g => {
    subject.add(g.scene);
    subject.traverse(o => { if (o.isMesh) o.castShadow = true; });
    if (q.get('dump')) {                 // structure dump for integration work
      subject.updateWorldMatrix(true, true);
      const rows = [];
      subject.traverse(o => {
        if (!o.isMesh) return;
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
        const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
        rows.push([o.name || o.parent.name, o.material?.name,
          c.toArray().map(x => +x.toFixed(2)).join(','), s.toArray().map(x => +x.toFixed(2)).join(',')].join(' | '));
      });
      window.__dump = rows;
      console.log(rows.join('\n'));
    }
    frameSubject();
    ready = true;
  });
}

// slow turntable if &turn=1
const turn = q.get('turn') === '1';
renderer.setAnimationLoop(t => {
  if (turn) subject.rotation.y = t / 4000;
  renderer.render(scene, camera);
  if (ready) window.__ready = true;     // capture scripts wait on this
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
