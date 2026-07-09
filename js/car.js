// Car visuals v2: spec-driven exterior (color/wing/profile), detailed cockpit
// (layered dash, center stack, bolstered seats, visors, paddles), gloved hands
// on a wheel that now turns with the real steering angle, working mirror.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { buildRoadBody } from './carbody.js';

// shared GLTF loader (draco decoder served from ./draco/, fetched lazily)
let _gltfLoader = null;
function gltfLoader() {
  if (!_gltfLoader) {
    const draco = new DRACOLoader();
    draco.setDecoderPath('./draco/');
    _gltfLoader = new GLTFLoader();
    _gltfLoader.setDRACOLoader(draco);
  }
  return _gltfLoader;
}

// split a mesh into the half whose triangles lie on one side of x=0 (world),
// baked into world space and re-centred on `centre` — used to separate the
// left/right wheels that ship as a single axle mesh in the 911 model.
function halfMeshGeometry(mesh, sgn, centre, qFix) {
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const p = src.attributes.position, n = src.attributes.normal;
  const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const pos = [], nor = [];
  for (let t = 0; t < p.count; t += 3) {
    let cx = 0;
    for (let k = 0; k < 3; k++) cx += v.fromBufferAttribute(p, t + k).applyMatrix4(mesh.matrixWorld).x;
    if ((cx / 3) * sgn <= 0.02) continue;
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(p, t + k).applyMatrix4(mesh.matrixWorld).sub(centre);
      if (qFix) v.applyQuaternion(qFix);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, t + k).applyMatrix3(nm).normalize();
      if (qFix) v.applyQuaternion(qFix);
      nor.push(v.x, v.y, v.z);
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

// true spin axis of a (possibly cambered/toed) wheel: the direction of least
// variance of the rim's vertices — smallest-eigenvector of their covariance,
// found by power-iterating (trace·I − C).
function wheelAxis(meshes, sgn, centre) {
  const v = new THREE.Vector3();
  const C = [0, 0, 0, 0, 0, 0];                      // xx, yy, zz, xy, xz, yz
  let cnt = 0;
  for (const mesh of meshes) {
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      if (v.x * sgn <= 0.02) continue;
      v.sub(centre);
      C[0] += v.x * v.x; C[1] += v.y * v.y; C[2] += v.z * v.z;
      C[3] += v.x * v.y; C[4] += v.x * v.z; C[5] += v.y * v.z;
      cnt++;
    }
  }
  if (cnt < 24) return null;
  for (let i = 0; i < 6; i++) C[i] /= cnt;
  const tr = C[0] + C[1] + C[2];
  const B = [tr - C[0], -C[3], -C[4], -C[3], tr - C[1], -C[5], -C[4], -C[5], tr - C[2]];
  let a = new THREE.Vector3(1, 0.1, 0.1).normalize();
  for (let it = 0; it < 40; it++) {
    a.set(B[0] * a.x + B[1] * a.y + B[2] * a.z,
          B[3] * a.x + B[4] * a.y + B[5] * a.z,
          B[6] * a.x + B[7] * a.y + B[8] * a.z).normalize();
  }
  if (a.x < 0) a.negate();
  return a;
}

function dialTexture(label, maxVal, major, redFrom) {
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#101216'; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 7); g.fill();
  g.strokeStyle = '#2a2e36'; g.lineWidth = 6;
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 4, 0, 7); g.stroke();
  const a0 = Math.PI * 200 / 180, a1 = -Math.PI * 20 / 180;
  const ticks = maxVal / major;
  for (let i = 0; i <= ticks; i++) {
    const f = i / ticks;
    const a = a0 + (a1 - a0) * f;
    const val = i * major;
    const inRed = redFrom != null && val >= redFrom;
    g.strokeStyle = inRed ? '#e03b30' : '#dfe3ea';
    g.lineWidth = 4;
    const r1 = S / 2 - 12, r2 = S / 2 - 30;
    g.beginPath();
    g.moveTo(S / 2 + Math.cos(a) * r1, S / 2 - Math.sin(a) * r1);
    g.lineTo(S / 2 + Math.cos(a) * r2, S / 2 - Math.sin(a) * r2);
    g.stroke();
    g.fillStyle = inRed ? '#e03b30' : '#cfd4dc';
    g.font = 'bold 26px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const rt = S / 2 - 52;
    g.fillText(String(val), S / 2 + Math.cos(a) * rt, S / 2 - Math.sin(a) * rt);
  }
  g.fillStyle = '#8a919c'; g.font = 'bold 20px Arial';
  g.fillText(label, S / 2, S / 2 + 56);
  return new THREE.CanvasTexture(c);
}

function screenTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0e14'; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#1d2733'; g.lineWidth = 2; g.strokeRect(3, 3, 250, 122);
  g.strokeStyle = '#2f86c9'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(30, 100); g.bezierCurveTo(90, 30, 150, 110, 226, 40); g.stroke();
  g.fillStyle = '#46e6a0'; g.beginPath(); g.arc(96, 78, 5, 0, 7); g.fill();
  g.fillStyle = '#8a93a0'; g.font = '12px Arial';
  g.fillText('Nürburgring', 14, 20);
  return new THREE.CanvasTexture(c);
}

export class CarVisual {
  constructor(scene, renderer, spec) {
    this.scene = scene;
    this.renderer = renderer;
    this.spec = spec;
    this.root = new THREE.Group();
    scene.add(this.root);

    this.cockpit = new THREE.Group();
    this.exterior = new THREE.Group();
    this.root.add(this.cockpit, this.exterior);

    this.type = (spec.visual && spec.visual.type) || 'road';
    // eye position must be known before the cockpit builds (open cars place the
    // wheel/cluster relative to it)
    this.eyeLocal = this.type === 'kart' ? new THREE.Vector3(0, 0.52, 0.10)
                  : this.type === 'formula' ? new THREE.Vector3(0, 0.62, 0.30)
                  : new THREE.Vector3(-0.37, 0.82, -0.24);
    if (this.type === 'kart') this._buildKart();
    else if (this.type === 'formula') this._buildFormula();
    else this._buildExterior();
    this._buildCockpit();

    this.mirrorRT = new THREE.WebGLRenderTarget(320, 96);
    this.mirrorCam = new THREE.PerspectiveCamera(26, 320 / 96, 0.5, 400);
    this.mirrorMat.map = this.mirrorRT.texture;
    this.mirrorMat.map.repeat.x = -1;
    this.mirrorMat.map.offset.x = 1;
    this.mirrorMat.needsUpdate = true;

    this.mode = 0;

    // headlights (night): two spots casting a pool down the road
    this.headlights = [];
    for (const sgn of [-1, 1]) {
      const spot = new THREE.SpotLight(0xfff0d0, 0, 170, 0.46, 0.55, 1.5);
      spot.position.set(sgn * 0.62, 0.05, -2.0);
      spot.target.position.set(sgn * 1.4, -1.6, -42);
      spot.visible = false;
      this.root.add(spot, spot.target);
      this.headlights.push(spot);
    }
    this._headlightMat = null;          // set in _buildExterior
  }

  setHeadlights(on) {
    for (const s of this.headlights) { s.visible = on; s.intensity = on ? 380 : 0; }
    if (this._headlightMat) this._headlightMat.emissiveIntensity = on ? 3.2 : 0.5;
  }

  dispose() {
    this._modelDead = true;              // late async GLB load must not attach
    this.scene.remove(this.root);
    this.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
    this.mirrorRT.dispose();
  }

  // ---------------------------------------------------------------- exterior
  _buildExterior() {
    const V = this.spec.visual;
    if (V.model) { this._buildModelExterior(); return; } // real GLB exterior
    if (V.body) { this._buildLoftExterior(); return; }   // loft-surfaced cars (carbody.js)
    const paint = new THREE.MeshPhysicalMaterial({
      color: V.color, metalness: 0.32, roughness: 0.38,
      clearcoat: 1.0, clearcoatRoughness: 0.1, envMapIntensity: 0.8,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0c1117, metalness: 0.4, roughness: 0.15,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.6 });

    const roofY = V.roofY, rearY = V.rearY;
    const prof = [
      [-2.15, -0.30], [-2.15, 0.00], [-1.80, 0.09], [-0.90, 0.17],
      [-0.32, roofY - 0.04], [0.50, roofY], [1.20, rearY + 0.08], [1.90, rearY],
      [2.13, rearY - 0.04], [2.13, -0.30],
    ];
    const shape = new THREE.Shape();
    shape.moveTo(prof[0][0], prof[0][1]);
    for (let i = 1; i < prof.length; i++) shape.lineTo(prof[i][0], prof[i][1]);
    shape.closePath();
    const bodyGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 1.46, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 2,
    });
    bodyGeo.translate(0, 0, -0.73);
    // Round the flat extruded roof: above the beltline, crown the section into an
    // arch (drop the width edges) and pull the greenhouse in (tumblehome). Done in
    // the extrude frame (x=fore/aft, y=up, z=±half-width) before the rotateY swap.
    const crownRoof = (geo) => {
      const beltline = 0.17, halfW = 0.73, CROWN = 0.12, TUMBLE = 0.18;
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i), z = p.getZ(i);
        const t = Math.min(1, Math.max(0, (y - beltline) / (roofY - beltline)));
        if (t <= 0) continue;
        const zr = Math.min(1, Math.abs(z) / halfW);
        p.setY(i, y - t * zr * zr * CROWN);   // arch the roof crown
        p.setZ(i, z * (1 - t * TUMBLE));       // narrow the greenhouse toward the top
      }
      geo.computeVertexNormals();
    };
    crownRoof(bodyGeo);
    bodyGeo.rotateY(-Math.PI / 2);
    const body = new THREE.Mesh(bodyGeo, paint);
    body.castShadow = true;
    this.exterior.add(body);

    const gTop = roofY - 0.015;
    const gProf = [[-0.84, 0.18], [-0.30, gTop - 0.04], [0.48, gTop],
      [1.16, rearY + 0.07], [0.9, 0.30], [-0.5, 0.22]];
    const gShape = new THREE.Shape();
    gShape.moveTo(gProf[0][0], gProf[0][1]);
    for (let i = 1; i < gProf.length; i++) gShape.lineTo(gProf[i][0], gProf[i][1]);
    gShape.closePath();
    const glassGeo = new THREE.ExtrudeGeometry(gShape, { depth: 1.40, bevelEnabled: false });
    glassGeo.translate(0, 0.02, -0.70);
    crownRoof(glassGeo);                        // follow the roof crown + tumblehome
    glassGeo.rotateY(-Math.PI / 2);
    this.exterior.add(new THREE.Mesh(glassGeo, glassMat));

    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.24, 0.06), darkMat);
    grille.position.set(0, -0.10, -2.16);
    this.exterior.add(grille);
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xdddddd, emissive: 0xb0c4d8, emissiveIntensity: 0.5, roughness: 0.3,
    });
    this._headlightMat = lightMat;
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0x55060a, emissive: 0x990a10, emissiveIntensity: 0.7, roughness: 0.3,
    });
    for (const sgn of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.05), lightMat);
      hl.position.set(sgn * 0.62, 0.04, -2.17);
      this.exterior.add(hl);
      const mir = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.18), paint);
      mir.position.set(sgn * 0.88, 0.30, -0.62);
      this.exterior.add(mir);
      const accent = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.05, 3.4),
        new THREE.MeshStandardMaterial({ color: V.accent, roughness: 0.4 }));
      accent.position.set(sgn * 0.845, -0.245, 0);
      this.exterior.add(accent);
    }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.04), tailMat);
    tail.position.set(0, rearY - 0.20, 2.16);
    this.exterior.add(tail);

    // ---- completion details: arches, splitter, diffuser, rockers, exhaust, fin
    const W = this.spec.wheels;
    const archGeo = new THREE.TorusGeometry(W.radius + 0.09, 0.045, 6, 10, Math.PI);
    for (const [sx, wz] of [[-1, W.fz], [1, W.fz], [-1, W.rz], [1, W.rz]]) {
      const arch = new THREE.Mesh(archGeo, darkMat);
      arch.position.set(sx * (W.htF + 0.10), -0.06, wz);
      arch.rotation.y = Math.PI / 2;
      this.exterior.add(arch);
    }
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.035, 0.22), darkMat);
    splitter.position.set(0, -0.325, -2.12);
    this.exterior.add(splitter);
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.30, 0.09, 0.28), darkMat);
    diffuser.position.set(0, -0.295, 2.04);
    diffuser.rotation.x = -0.18;
    this.exterior.add(diffuser);
    for (const fx of [-0.4, 0, 0.4]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.10, 0.26), darkMat);
      fin.position.set(fx, -0.30, 2.05);
      fin.rotation.x = -0.18;
      this.exterior.add(fin);
    }
    for (const sgn of [-1, 1]) {
      const rocker = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 2.35), darkMat);
      rocker.position.set(sgn * 0.80, -0.315, 0.05);
      this.exterior.add(rocker);
    }
    // exhaust: GT3 = center dual, hatch = side dual
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.9, roughness: 0.3 });
    const pipeGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.10, 10);
    pipeGeo.rotateX(Math.PI / 2);
    const pipeXs = V.wing === 'gt' ? [-0.10, 0.10] : [-0.56, 0.56];
    for (const px of pipeXs) {
      const pipe = new THREE.Mesh(pipeGeo, pipeMat);
      pipe.position.set(px, -0.22, 2.14);
      this.exterior.add(pipe);
    }
    const fin2 = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.055, 0.16), darkMat);
    fin2.position.set(0, roofY + 0.085, 0.85);   // shark-fin antenna
    this.exterior.add(fin2);

    if (V.wing === 'gt') {
      // swan-neck GT wing
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.030, 0.34), darkMat);
      plank.position.set(0, rearY + 0.34, 1.90);
      plank.rotation.x = -0.10;
      plank.castShadow = true;
      this.exterior.add(plank);
      for (const sgn of [-1, 1]) {
        const neck = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.30, 0.16), darkMat);
        neck.position.set(sgn * 0.45, rearY + 0.20, 1.84);
        neck.rotation.x = 0.25;
        this.exterior.add(neck);
      }
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.10, 0.015), darkMat);
      plate.position.set(0.71 - 0.0, rearY + 0.30, 1.90);
      // endplates
      for (const sgn of [-1, 1]) {
        const ep = plate.clone();
        ep.position.set(sgn * 0.71, rearY + 0.345, 1.90);
        ep.rotation.x = -0.10;
        ep.scale.set(0.06 / 0.26, 1, 22);
        this.exterior.add(ep);
      }
    } else {
      const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.30, 0.035, 0.30), paint);
      spoiler.position.set(0, rearY + 0.14, 1.95);
      spoiler.castShadow = true;
      this.exterior.add(spoiler);
      for (const sgn of [-1, 1]) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.16), darkMat);
        strut.position.set(sgn * 0.5, rearY + 0.06, 1.98);
        this.exterior.add(strut);
      }
    }

    this._buildWheels(0.26);
  }

  // ---- real GLB exterior (spec.visual.model) ---------------------------------
  // Loads the model async (placeholder wheels drive immediately), recolours the
  // paint material, wires the headlight material, and rebinds the model's wheels
  // to the physics: each axle ships as ONE mesh containing both wheels, so it is
  // split by world-x sign, re-centred, and mounted into the 4 wheel groups.
  _buildModelExterior() {
    const V = this.spec.visual, M = V.model, W = this.spec.wheels;
    this._buildWheels(0.30);                       // physics-driven placeholders
    const staticWheelY = W.attachY - W.restLen + 0.08;   // where update() parks a settled wheel
    gltfLoader().load(M.src, g => {
      if (this._modelDead) return;
      const root = g.scene;
      const junk = [];
      root.traverse(o => { if (o.isLight || /^Hemi/.test(o.name || '')) junk.push(o); });
      junk.forEach(o => o.parent && o.parent.remove(o));

      // materials: paint recolour + headlight emissive hook
      root.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true;
        const m = o.material;
        if (!m) return;
        if (m.name === M.paint) {
          m.color.set(V.color);
          m.clearcoat = 1.0; m.clearcoatRoughness = 0.06; m.envMapIntensity = 1.1;
        }
        if (m.name === (M.lights || 'lights')) {
          this._headlightMat = m;
          m.emissiveIntensity = 0.5;
        }
      });

      const wrap = new THREE.Group();
      wrap.rotation.y = Math.PI;                   // model +z forward -> game -z forward
      wrap.add(root);
      wrap.updateWorldMatrix(true, true);

      // wheels: model space AFTER the flip — axleFront node sits at -z (game front)
      for (const [nodeName, base] of [[M.axleFront, 0], [M.axleRear, 2]]) {
        const node = root.getObjectByName(nodeName);
        if (!node) continue;
        const parts = node.children.filter(c => c.isMesh);
        for (const sgn of [-1, 1]) {
          // wheel centre from the round parts only (the off-axis caliper would bias it)
          const box = new THREE.Box3(); const v = new THREE.Vector3();
          const roundParts = parts.filter(m => m.material.name !== M.caliper);
          for (const mesh of roundParts) {
            const p = mesh.geometry.attributes.position;
            for (let i = 0; i < p.count; i++) {
              v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
              if (v.x * sgn > 0.02) box.expandByPoint(v);
            }
          }
          if (box.isEmpty()) continue;
          const centre = box.getCenter(new THREE.Vector3());
          // the model bakes camber/toe into the wheels — spinning around raw x wobbles.
          // Fit the TRUE axle axis from the rim vertices and align it to x.
          const rimParts = parts.filter(m => (M.spin || ['silver']).includes(m.material.name));
          const axis = wheelAxis(rimParts.length ? rimParts : roundParts, sgn, centre);
          const qFix = axis ? new THREE.Quaternion().setFromUnitVectors(axis, new THREE.Vector3(1, 0, 0)) : null;
          const wi = base + (sgn < 0 ? 0 : 1);     // wheel order: FL, FR, RL, RR
          // visual wheel x follows the MODEL's fenders (physics track is wider —
          // wheels poking out of the arches read broken; 10 cm is imperceptible)
          (this._wheelXFix || (this._wheelXFix = []))[wi] = centre.x;
          const grp = this.wheelMeshes[wi];
          grp.clear();
          const spin = new THREE.Group();
          grp.add(spin);
          grp.userData.spin = spin;
          for (const mesh of parts) {
            const geo = halfMeshGeometry(mesh, sgn, centre, qFix);
            if (!geo) continue;
            const part = new THREE.Mesh(geo, mesh.material);
            part.castShadow = true;
            // ONLY the rim spins. The tyre bakes a parked contact flat-spot and the
            // 'plastic' prim contains non-circular wheel-tub/duct bits — spinning
            // either reads lumpy. Rotationally-symmetric black parts look identical
            // static, and the flat spot stays squashed against the road.
            const spins = (M.spin || ['silver']).includes(mesh.material.name);
            (spins ? spin : grp).add(part);
          }
          grp.scale.setScalar(W.radius / (M.wheelR || W.radius));
        }
        node.visible = false;
      }

      // body placement: align wheel centres to the physics wheels
      wrap.position.set(0, staticWheelY - M.wheelY, M.dz || 0);
      this.exterior.add(wrap);
      this._model = wrap;
    });
  }

  // ---- loft-surfaced exterior (carbody.js) — cars with spec.visual.body ------
  _buildLoftExterior() {
    const V = this.spec.visual;
    const B = { ...V.body };
    // fender humps from data -> closure
    if (B.humpsAt) { const H = B.humpsAt; B.humps = z => H.reduce((s, h) => s + h.h * Math.exp(-(((z - h.z) / h.s) ** 2)), 0); }
    const paint = new THREE.MeshPhysicalMaterial({
      color: V.color, metalness: 0.28, roughness: 0.32,
      clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.0,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x10151c, metalness: 0.55, roughness: 0.12, envMapIntensity: 1.2,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.62 });
    this.exterior.add(buildRoadBody(B, { paint, glass: glassMat, dark: darkMat }));

    // ---- lights -------------------------------------------------------------
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xe8eef4, emissive: 0xb0c4d8, emissiveIntensity: 0.5, roughness: 0.25,
    });
    this._headlightMat = lightMat;
    for (const sgn of [-1, 1]) {                       // oval lamps on the fender front
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 12), lightMat);
      hl.scale.set(1.0, 0.78, 0.5);
      hl.position.set(sgn * B.lampX, B.lampY, B.z0 + 0.10);
      this.exterior.add(hl);
    }
    const tailMat = new THREE.MeshStandardMaterial({
      color: 0x420508, emissive: 0xcc0a12, emissiveIntensity: 0.9, roughness: 0.3,
    });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(B.tailW, 0.045, 0.03), tailMat);   // full-width light bar
    bar.position.set(0, B.tailY, B.z1 - 0.015);
    this.exterior.add(bar);

    // ---- aero / trim ----------------------------------------------------------
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(V.body.width[0][1] * 2 + 0.1, 0.035, 0.30), darkMat);
    splitter.position.set(0, B.yLow - 0.015, B.z0 + 0.13);
    this.exterior.add(splitter);
    const intake = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.16, 0.06), darkMat);   // front bumper intake
    intake.position.set(0, B.yLow + 0.13, B.z0 + 0.015);
    intake.rotation.x = 0.08;
    this.exterior.add(intake);
    const diff = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.16, 0.24), darkMat);      // rear diffuser
    diff.position.set(0, B.yLow + 0.02, B.z1 - 0.10);
    this.exterior.add(diff);
    for (const sgn of [-1, 1]) {                       // side mirrors on the A-pillar base
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.03), paint);
      arm.position.set(sgn * (this._loftW(B, B.cabin[0]) + 0.06), B.mirrorY, B.cabin[0] + 0.10);
      this.exterior.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.20), paint);
      head.position.set(sgn * (this._loftW(B, B.cabin[0]) + 0.15), B.mirrorY + 0.02, B.cabin[0] + 0.12);
      this.exterior.add(head);
    }

    // ---- wing --------------------------------------------------------------
    if (V.wing === 'gt') {
      const wingY = B.wingY, wingZ = B.wingZ ?? (B.z1 - 0.55);
      const deckY = B.wingDeckY ?? 0.16;               // where the arms root on the decklid
      const el = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.03, 0.34), darkMat);     // main element
      el.rotation.x = -0.14;
      el.position.set(0, wingY, wingZ);
      el.castShadow = true;
      this.exterior.add(el);
      for (const sgn of [-1, 1]) {
        // swan-neck arms: from the decklid up+forward to the element's top surface
        const len = Math.hypot(wingY - deckY, 0.18);
        const neck = new THREE.Mesh(new THREE.BoxGeometry(0.05, len, 0.09), darkMat);
        neck.rotation.x = 0.32;
        neck.position.set(sgn * 0.42, (wingY + deckY) / 2 + 0.02, wingZ - 0.04);
        this.exterior.add(neck);
        const ep = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.15, 0.40), darkMat);  // endplates
        ep.position.set(sgn * 0.73, wingY - 0.02, wingZ);
        this.exterior.add(ep);
      }
    } else if (V.wing === 'lip') {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.035, 0.20), paint);
      lip.position.set(0, B.tailY + 0.10, B.z1 - 0.10);
      lip.rotation.x = -0.10;
      this.exterior.add(lip);
    }

    // exhaust
    for (const sgn of [-1, 1]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.10, 12), darkMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(sgn * 0.16, B.yLow + 0.06, B.z1 - 0.02);
      this.exterior.add(pipe);
    }

    this._buildWheels(0.30);
  }
  _loftW(B, z) {                                       // body half-width at z (mirror mount)
    const stops = B.width;
    let i = 0; while (i + 1 < stops.length && stops[i + 1][0] < z) i++;
    const [z0, v0] = stops[i], [z1, v1] = stops[Math.min(i + 1, stops.length - 1)];
    const t = z1 === z0 ? 0 : Math.min(1, Math.max(0, (z - z0) / (z1 - z0)));
    return v0 + (v1 - v0) * t * t * (3 - 2 * t);
  }

  // four spinning wheel groups (positioned each frame in update)
  _buildWheels(tireW) {
    this.wheelMeshes = [];
    const R = this.spec.wheels.radius;
    const tireGeo = new THREE.CylinderGeometry(R, R, tireW, 18);
    tireGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x16181a, roughness: 0.92 });
    const hubGeo = new THREE.CylinderGeometry(R * 0.55, R * 0.55, tireW + 0.01, 12);
    hubGeo.rotateZ(Math.PI / 2);
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, metalness: 0.7, roughness: 0.35 });
    for (let i = 0; i < 4; i++) {
      const grp = new THREE.Group();
      const spin = new THREE.Group();
      spin.add(new THREE.Mesh(tireGeo, tireMat), new THREE.Mesh(hubGeo, hubMat));
      grp.add(spin);
      grp.userData.spin = spin;
      this.exterior.add(grp);
      this.wheelMeshes.push(grp);
    }
  }

  // ---------------------------------------------------------------- open-wheel exteriors
  // Go-kart: low flat frame, exposed wheels, seat, sidepods, bumpers.
  _buildKart() {
    const V = this.spec.visual;
    const paint = new THREE.MeshStandardMaterial({ color: V.color, metalness: 0.3, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.7 });
    const e = this.exterior;
    const W = this.spec.wheels;
    // chassis floor pan
    const floor = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 1.5), dark);
    floor.position.set(0, -0.16, 0.05); floor.castShadow = true; e.add(floor);
    // front fairing (nose)
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.16, 0.36), paint);
    nose.position.set(0, -0.10, -0.95); e.add(nose);
    // side pods
    for (const sgn of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.20, 0.85), paint);
      pod.position.set(sgn * 0.46, -0.08, 0.05); e.add(pod);
    }
    // seat (bucket)
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.34, 0.42), dark);
    seat.position.set(0, 0.05, 0.30); e.add(seat);
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.40, 0.10), dark);
    seatBack.position.set(0, 0.10, 0.52); e.add(seatBack);
    // steering column + small wheel (visible from chase)
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), dark);
    col.position.set(0, 0.05, -0.30); col.rotation.x = 0.7; e.add(col);
    // rear bumper + engine block on the right
    const eng = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.3), dark);
    eng.position.set(0.34, 0.0, 0.62); e.add(eng);
    const rearBar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.05), dark);
    rearBar.position.set(0, -0.05, 0.86); e.add(rearBar);
    this._buildWheels(0.16);
    this._headlightMat = null;
  }

  // Formula car: long nose, raised airbox, big front+rear wings, halo, exposed wheels.
  _buildFormula() {
    const V = this.spec.visual;
    const paint = new THREE.MeshPhysicalMaterial({ color: V.color, metalness: 0.35, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x121418, roughness: 0.6 });
    const accent = new THREE.MeshStandardMaterial({ color: V.accent, roughness: 0.5 });
    const e = this.exterior;
    // monocoque tub
    const tub = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 2.6), paint);
    tub.position.set(0, -0.05, 0.2); tub.castShadow = true; e.add(tub);
    // long tapering nose
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.22, 1.5, 8), paint);
    nose.rotation.x = Math.PI / 2; nose.position.set(0, -0.12, -1.9); e.add(nose);
    // sidepods
    for (const sgn of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.30, 1.3), paint);
      pod.position.set(sgn * 0.62, -0.04, 0.45); e.add(pod);
    }
    // airbox behind the driver
    const airbox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.7), paint);
    airbox.position.set(0, 0.34, 1.25); airbox.castShadow = true; e.add(airbox);
    // halo
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 8, 16, Math.PI), dark);
    halo.rotation.x = -0.5; halo.position.set(0, 0.30, 0.15); e.add(halo);
    const haloPost = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6), dark);
    haloPost.position.set(0, 0.18, -0.35); e.add(haloPost);
    // front wing
    const fw = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.04, 0.5), accent);
    fw.position.set(0, -0.28, -2.55); e.add(fw);
    for (const sgn of [-1, 1]) {
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.5), dark);
      ep.position.set(sgn * 0.86, -0.18, -2.55); e.add(ep);
    }
    // rear wing (tall)
    const rw = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.05, 0.42), accent);
    rw.position.set(0, 0.5, 2.35); rw.castShadow = true; e.add(rw);
    for (const sgn of [-1, 1]) {
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 0.42), dark);
      ep.position.set(sgn * 0.52, 0.34, 2.35); e.add(ep);
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.1), dark);
      pylon.position.set(sgn * 0.2, 0.3, 2.4); e.add(pylon);
    }
    // diffuser
    const diff = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.3), dark);
    diff.position.set(0, -0.26, 2.2); e.add(diff);
    this._buildWheels(0.35);
    this._headlightMat = null;
  }

  // ---------------------------------------------------------------- cockpit
  _buildCockpit() {
    const V = this.spec.visual;
    const cp = this.cockpit;
    const padMat = new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.92 });
    const graphite = new THREE.MeshStandardMaterial({ color: 0x2c313a, roughness: 0.75 });
    const darker = new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.85 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: V.accent, roughness: 0.5, emissive: V.accent, emissiveIntensity: 0.15,
    });

    const open = this.type !== 'road';   // kart / formula = open cockpit (no cabin)
    const drvX = open ? 0 : -0.37;        // centered driver in open-wheel cars

    if (!open) {
      // hood
      const hoodGeo = new THREE.PlaneGeometry(1.78, 1.35, 8, 4);
      const hp = hoodGeo.attributes.position;
      for (let i = 0; i < hp.count; i++) {
        const x = hp.getX(i), y = hp.getY(i);
        hp.setZ(i, -0.10 * (y + 0.675) - 0.18 * (x * x) / 0.8);
      }
      hoodGeo.computeVertexNormals();
      const hood = new THREE.Mesh(hoodGeo, new THREE.MeshPhysicalMaterial({
        color: V.color, metalness: 0.32, roughness: 0.38, clearcoat: 1.0, clearcoatRoughness: 0.1,
      }));
      hood.rotation.x = -Math.PI / 2 + 0.06;
      hood.position.set(0, 0.42, -1.62);
      cp.add(hood);

      // layered dash: soft top pad / mid roll / lower panel + accent line
      const dashTop = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.07, 0.36), padMat);
      dashTop.position.set(0, 0.515, -1.02);
      cp.add(dashTop);
      const dashMid = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.17, 0.30), graphite);
      dashMid.position.set(0, 0.41, -0.95);
      dashMid.rotation.x = 0.10;
      cp.add(dashMid);
      const dashLow = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.20, 0.24), darker);
      dashLow.position.set(0, 0.27, -0.90);
      cp.add(dashLow);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.012, 0.015), accentMat);
      trim.position.set(0, 0.475, -0.832);
      cp.add(trim);

      for (const x of [-0.62, 0.62]) {
        const vent = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.06, 0.02),
          new THREE.MeshStandardMaterial({ color: 0x0b0d11, roughness: 0.6 }));
        vent.position.set(x, 0.46, -0.845);
        cp.add(vent);
      }
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.15),
        new THREE.MeshBasicMaterial({ map: screenTexture() }));
      screen.position.set(0.02, 0.46, -0.838);
      screen.rotation.x = -0.08;
      cp.add(screen);
      const stack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), darker);
      stack.position.set(0.02, 0.30, -0.86);
      cp.add(stack);
    }

    // gauge cluster — on the dash (road) or on a small steering-column pod (open)
    const cluster = new THREE.Group();
    // open cars: gauges sit low on/just above the wheel (F1-style, on-wheel
    // display) well below the sightline so the track ahead is clear.
    if (open) {
      // gauges sit on the wheel, ~0.5 m ahead and below the eye — in the lower
      // third of the view (visible) without blocking the track ahead.
      cluster.position.set(drvX, this.eyeLocal.y - 0.20, this.eyeLocal.z - 0.48);
      cluster.scale.setScalar(0.55);
      cluster.rotation.x = -0.5;
    } else {
      cluster.position.set(drvX, 0.52, -0.86);
      cluster.rotation.x = -0.30;
    }
    const backing = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.26, 0.03), darker);
    backing.position.set(0.07, 0, -0.018);
    cluster.add(backing);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.05, 0.06), padMat);
    bezel.position.set(0.07, 0.145, -0.01);
    cluster.add(bezel);

    const D = this.spec;
    const tachTex = dialTexture('RPM x1000', D.dialMax, 1, D.dialRed);
    const spdTex = dialTexture('km/h', D.dialSpeed, 50, null);
    const mkDial = (tex, x) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.006, 8, 28),
        new THREE.MeshStandardMaterial({ color: 0x3a414c, metalness: 0.6, roughness: 0.4 }));
      ring.position.set(x, 0, 0.002);
      cluster.add(ring);
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.085, 32),
        new THREE.MeshBasicMaterial({ map: tex }));
      d.position.set(x, 0, 0);
      cluster.add(d);
      const needle = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.075, 0.004),
        new THREE.MeshBasicMaterial({ color: 0xff5040 }));
      needle.geometry.translate(0, 0.030, 0);
      needle.position.set(x, 0, 0.006);
      cluster.add(needle);
      const cap = new THREE.Mesh(new THREE.CircleGeometry(0.012, 12),
        new THREE.MeshBasicMaterial({ color: 0x0c0e12 }));
      cap.position.set(x, 0, 0.008);
      cluster.add(cap);
      return needle;
    };
    this.needleTach = mkDial(tachTex, -0.105);
    this.needleSpd = mkDial(spdTex, 0.105);

    // shift lights
    this.shiftLeds = [];
    for (let k = 0; k < 5; k++) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.009, 0.004),
        new THREE.MeshBasicMaterial({ color: 0x1c2024 }));
      led.position.set(-0.044 + k * 0.022, 0.118, 0.004);
      led.userData.onColor = k < 3 ? 0x2bdd55 : 0xff2418;
      cluster.add(led);
      this.shiftLeds.push(led);
    }
    this.tcLamp = new THREE.Mesh(new THREE.CircleGeometry(0.0085, 12),
      new THREE.MeshBasicMaterial({ color: 0xffaa00 }));
    this.tcLamp.position.set(0.155, 0.095, 0.004);
    this.tcLamp.visible = false;
    cluster.add(this.tcLamp);

    // big gear indicator LCD — right of the speed dial, clear of the wheel
    this.digCanvas = document.createElement('canvas');
    this.digCanvas.width = 128; this.digCanvas.height = 128;
    this.digTex = new THREE.CanvasTexture(this.digCanvas);
    const dig = new THREE.Mesh(new THREE.PlaneGeometry(0.105, 0.105),
      new THREE.MeshBasicMaterial({ map: this.digTex }));
    dig.position.set(0.305, 0.035, 0.012);
    dig.rotation.y = -0.35;                 // tilt toward the driver's eye
    cluster.add(dig);
    cp.add(cluster);

    // ---- steering wheel (flat bottom) + paddles + hands
    this.wheelGroup = new THREE.Group();
    this.wheelGroup.position.set(drvX, open ? this.eyeLocal.y - 0.26 : 0.45, open ? this.eyeLocal.z - 0.50 : -0.70);
    this.wheelGroup.rotation.x = open ? -0.5 : -0.42;   // open cars: wheel ~0.5m ahead, lower third of view
    if (open) this.wheelGroup.scale.setScalar(0.82);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.7 });
    this.wheelSpin = new THREE.Group();
    // hands ride a SEPARATE spin that's angle-limited: the wheel turns to its
    // real lock (13:1, no clip) while the grips shuffle within a natural range
    // so big steering can't twist the arms (the rim slides under the grip).
    this.handSpin = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.021, 12, 36, Math.PI * 1.72), rimMat);
    rim.rotation.z = Math.PI / 2 + (Math.PI * 2 - Math.PI * 1.72) / 2;
    this.wheelSpin.add(rim);
    const flatBar = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.034, 0.030), rimMat);
    flatBar.position.set(0, -0.165, 0);
    this.wheelSpin.add(flatBar);
    for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) {     // 3-9-6 spokes
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.13, 0.014), graphite);
      spoke.position.set(Math.sin(a) * 0.092, -Math.cos(a) * 0.092, 0);
      spoke.rotation.z = a;
      this.wheelSpin.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.045, 18), graphite);
    hub.rotation.x = Math.PI / 2;
    this.wheelSpin.add(hub);
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.032, 0.012),
      new THREE.MeshBasicMaterial({ color: V.accent }));
    marker.position.set(0, 0.172, 0);
    this.wheelSpin.add(marker);

    // ---- hands: four articulated fingers + thumb wrapping the rim tube.
    // Built in a canonical frame (rim tube along +y, radial-out +x,
    // driver side +z), then mirrored onto the 9 & 3 grip points.
    // The hands ride wheelSpin (correct grip kinematics); the arms are
    // solved separately with 2-bone IK from fixed shoulder anchors.
    const glove = new THREE.MeshStandardMaterial({ color: 0x4a515c, roughness: 0.88 });
    const gloveDark = new THREE.MeshStandardMaterial({ color: 0x343a43, roughness: 0.9 });
    const knuckleMat = new THREE.MeshStandardMaterial({ color: V.accent, roughness: 0.6 });
    this.wristAnchors = [];
    const buildHand = () => {
      const h = new THREE.Group();
      // smooth back-of-hand mass (ellipsoid) hugging the outside of the rim
      const back = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), glove);
      back.position.set(0.040, 0.002, 0.010);
      back.scale.set(0.80, 1.55, 1.05);
      h.add(back);
      // racing-glove knuckle accent strip
      const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.085, 0.022), knuckleMat);
      knuckle.position.set(0.062, 0.006, 0.002);
      knuckle.rotation.y = 0.10;
      h.add(knuckle);
      const heel = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), glove);
      heel.position.set(0.040, -0.060, 0.018);
      heel.scale.set(0.85, 1.0, 0.95);
      h.add(heel);
      // four fingers: short arcs over the FAR side of the rim only — from the
      // driver seat you see knuckles + fingertips peeking past the tube
      for (let f = 0; f < 4; f++) {
        const r = 0.0290 - f * 0.0010;
        const arc = 2.35;
        const geo = new THREE.TorusGeometry(r, 0.0105, 7, 10, arc);
        geo.rotateZ(0.30);
        geo.rotateX(-Math.PI / 2);               // wrap from knuckles to far side
        const y = 0.043 - f * 0.0215;
        const finger = new THREE.Mesh(geo, glove);
        finger.position.set(0.006, y, 0);
        h.add(finger);
        // rounded fingertip closing the open arc end
        const endA = 0.30 + arc;
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 8, 6), glove);
        tip.position.set(0.006 + Math.cos(endA) * r, y, -Math.sin(endA) * r);
        h.add(tip);
      }
      // thumb: lies ALONG the rim on the near side, pointing up the wheel
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0115, 0.055, 4, 8), gloveDark);
      thumb.position.set(-0.014, -0.018, 0.028);
      thumb.rotation.z = -0.18;
      thumb.rotation.x = 0.25;
      h.add(thumb);
      // wrist: smooth bridge from the heel toward the forearm
      const wrist = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.055, 4, 9), gloveDark);
      wrist.position.set(0.052, -0.052, 0.034);
      wrist.rotation.z = 0.55;
      wrist.rotation.x = -0.65;
      h.add(wrist);
      // IK target: where the forearm meets the hand
      const anchor = new THREE.Object3D();
      anchor.position.set(0.062, -0.055, 0.058);
      h.add(anchor);
      return { h, anchor };
    };
    for (const sgn of [-1, 1]) {
      const { h, anchor } = buildHand();
      // grips slightly above 9-and-3 (more visible from the driver's eye)
      const lift = 0.32;                                        // ~18 deg up
      const ang = sgn === -1 ? Math.PI - lift : lift;
      h.rotation.z = ang;
      h.position.set(Math.cos(ang) * 0.175, Math.sin(ang) * 0.175, 0.014);
      this.handSpin.add(h);
      this.wristAnchors.push(anchor);
    }
    this.wheelGroup.add(this.wheelSpin, this.handSpin);

    // ---- arms: 2-bone IK (shoulder fixed to the seat, elbow via pole)
    const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.92 });
    this.arms = [];
    const shY = open ? this.eyeLocal.y - 0.06 : 0.61;
    const shZ = open ? this.eyeLocal.z + 0.16 : -0.07;
    this.shoulders = [
      new THREE.Vector3(drvX - 0.19, shY, shZ),  // left
      new THREE.Vector3(drvX + 0.19, shY, shZ),  // right
    ];
    this.armLen = [0.34, 0.34];                   // upper, forearm
    for (let i = 0; i < 2; i++) {
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.043, 0.31, 4, 8), sleeveMat);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.31, 4, 8), sleeveMat);
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.044, 10, 8), sleeveMat);
      cp.add(upper, fore, elbow);
      this.arms.push({ upper, fore, elbow });
    }
    this._ikTmp = {
      w: new THREE.Vector3(), d: new THREE.Vector3(), perp: new THREE.Vector3(),
      pole: new THREE.Vector3(), e: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0),
      q: new THREE.Quaternion(), m: new THREE.Vector3(),
    };

    // paddles
    for (const sgn of [-1, 1]) {
      const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.10, 0.008), graphite);
      paddle.position.set(sgn * 0.10, 0.01, -0.045);
      this.wheelGroup.add(paddle);
    }
    cp.add(this.wheelGroup);

    // pillars / roof / headliner / visors / glass / doors / seats / console —
    // the enclosed cabin; open-wheel cars (kart/formula) skip all of it.
    if (!open) {
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.8 });
    for (const sgn of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 0.08), pillarMat);
      pil.position.set(sgn * 0.83, 0.78, -0.78);
      pil.rotation.x = 0.42;
      pil.rotation.z = sgn * 0.12;
      cp.add(pil);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 1.3), pillarMat);
    roof.position.set(0, 1.15, -0.02);
    cp.add(roof);
    const headliner = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.012, 1.26),
      new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.95 }));
    headliner.position.set(0, 1.12, -0.02);
    cp.add(headliner);
    for (const x of [-0.40, 0.40]) {
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.17), padMat);
      visor.position.set(x, 1.075, -0.56);
      visor.rotation.x = 0.30;
      cp.add(visor);
    }

    // windshield
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.62, 0.78),
      new THREE.MeshBasicMaterial({ color: 0x88aabb, transparent: true, opacity: 0.06, depthWrite: false }));
    glass.position.set(0, 0.80, -0.80);
    glass.rotation.x = 0.40;
    cp.add(glass);

    // door cards + armrests
    for (const sgn of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.46, 1.9), graphite);
      door.position.set(sgn * 0.865, 0.40, 0.05);
      cp.add(door);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.05, 0.65), padMat);
      arm.position.set(sgn * 0.82, 0.34, -0.05);
      cp.add(arm);
    }

    // bolstered sport seats
    for (const x of [-0.37, 0.37]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.13, 0.48), darker);
      base.position.set(x, 0.12, 0.25);
      cp.add(base);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.60, 0.11), darker);
      back.position.set(x, 0.44, 0.52);
      back.rotation.x = -0.12;
      cp.add(back);
      for (const sgn of [-1, 1]) {
        const bol = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.52, 0.15), padMat);
        bol.position.set(x + sgn * 0.20, 0.42, 0.50);
        bol.rotation.x = -0.12;
        bol.rotation.z = -sgn * 0.10;
        cp.add(bol);
      }
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.15, 0.09), darker);
      head.position.set(x, 0.82, 0.56);
      cp.add(head);
      const stitch = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.50, 0.115), accentMat);
      stitch.position.set(x, 0.43, 0.523);
      stitch.rotation.x = -0.12;
      cp.add(stitch);
    }

    // center console + rear shelf (closes the cabin)
    const console_ = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.22, 0.9), graphite);
    console_.position.set(0, 0.18, -0.30);
    cp.add(console_);
    const shifter = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.12, 8), darker);
    shifter.position.set(0, 0.34, -0.18);
    cp.add(shifter);
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.5), darker);
    shelf.position.set(0, 0.55, 0.95);
    cp.add(shelf);
    }

    // rear-view mirror (the road car shows a center mirror; open cars don't,
    // but the material/RT is always created so renderMirror stays valid)
    this.mirrorMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    if (!open) {
      const mirFrame = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.11, 0.025), padMat);
      mirFrame.position.set(0, 1.02, -0.60);
      mirFrame.rotation.x = -0.10;
      cp.add(mirFrame);
      const mir = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.088), this.mirrorMat);
      mir.position.set(0, 1.02, -0.586);
      mir.rotation.x = -0.10;
      cp.add(mir);
    }

    if (open) this._buildOpenBodywork(cp, V);
  }

  // What an open-wheel driver actually sees from the seat: the nose/bodywork
  // ahead and below, cockpit sides, and (F1) the halo splitting the view.
  _buildOpenBodywork(cp, V) {
    const ey = this.eyeLocal.y, ez = this.eyeLocal.z;
    const paint = new THREE.MeshStandardMaterial({ color: V.color, metalness: 0.3, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.7 });
    if (this.type === 'formula') {
      // nose deck stretching far ahead and dropping away — well below sightline
      const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.22, 2.2, 10), paint);
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, ey - 0.62, ez - 1.55);
      cp.add(nose);
      // cockpit coaming (survival-cell rim) low at the driver's sides
      for (const sgn of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 1.0), paint);
        rail.position.set(sgn * 0.36, ey - 0.24, ez - 0.10);
        cp.add(rail);
      }
      // halo: side mounts + ring arcing overhead (above the sightline, no center bar in view)
      for (const sgn of [-1, 1]) {
        const mnt = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.40, 8), dark);
        mnt.position.set(sgn * 0.33, ey + 0.06, ez - 0.30);
        mnt.rotation.x = 0.3;
        cp.add(mnt);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.028, 8, 20, Math.PI), dark);
      ring.rotation.x = -0.5;
      ring.position.set(0, ey + 0.30, ez - 0.30);
      cp.add(ring);
    } else { // kart
      // front fairing / nose cone ahead and low
      const fairing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.13, 0.42), paint);
      fairing.position.set(0, ey - 0.60, ez - 1.0);
      cp.add(fairing);
      const floor = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 1.2), dark);
      floor.position.set(0, ey - 0.6, ez - 0.35);
      cp.add(floor);
      // steering column down to the wheel
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.42, 6), dark);
      col.position.set(0, ey - 0.46, ez - 0.40);
      col.rotation.x = 0.62;
      cp.add(col);
    }
  }

  setCameraMode(mode) {
    this.mode = mode;
    this.cockpit.visible = mode === 0;
    this.exterior.visible = mode === 2;
  }

  // place a capsule (axis +y, native length L) between two cockpit-space points
  _seg(mesh, a, b, baseLen) {
    const T = this._ikTmp;
    T.m.copy(a).add(b).multiplyScalar(0.5);
    mesh.position.copy(T.m);
    T.d.copy(b).sub(a);
    const len = T.d.length();
    mesh.quaternion.setFromUnitVectors(T.up, T.d.normalize());
    mesh.scale.set(1, Math.max(0.3, len / baseLen), 1);
  }

  _solveArms() {
    if (!this.cockpit.visible) return;
    const T = this._ikTmp;
    const [L1, L2] = this.armLen;
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? -1 : 1;
      // wrist target: hand anchor -> cockpit-local
      T.w.setFromMatrixPosition(this.wristAnchors[i].matrixWorld);
      this.cockpit.worldToLocal(T.w);
      const sh = this.shoulders[i];
      T.d.copy(T.w).sub(sh);
      // NOTE: T.w (the real wrist) is never moved — if the target is out of
      // reach we solve the elbow at full extension and let the forearm
      // stretch to the hand, so the arm can never visibly detach.
      let dist = Math.min(T.d.length(), L1 + L2 - 0.02);
      T.d.normalize();
      // elbow pole: down and slightly outward (natural driving posture)
      T.pole.set(sgn * 0.45, -1, 0.1).normalize();
      T.perp.copy(T.pole).addScaledVector(T.d, -T.pole.dot(T.d));
      if (T.perp.lengthSq() < 1e-6) T.perp.set(0, -1, 0);
      T.perp.normalize();
      const cosA = THREE.MathUtils.clamp(
        (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
      const sinA = Math.sqrt(1 - cosA * cosA);
      T.e.copy(sh).addScaledVector(T.d, cosA * L1).addScaledVector(T.perp, sinA * L1);
      const arm = this.arms[i];
      this._seg(arm.upper, sh, T.e, 0.31 + 0.086);
      arm.elbow.position.copy(T.e);
      this._seg(arm.fore, T.e, T.w, 0.31 + 0.072);
    }
  }

  update(vehicle, dtVis) {
    this.root.position.copy(vehicle.pos);
    this.root.quaternion.copy(vehicle.quat);

    // wheel turns with the ACTUAL steering angle x typical 13:1 column ratio,
    // clamped so the hands never cross over awkwardly
    const realAngle = vehicle.ctrl.steer * vehicle.maxSteerAngle();
    const wheelRot = -realAngle * 13;                  // true 13:1 column ratio, no clip → real lock (~±417° at full)
    this.wheelSpin.rotation.z = wheelRot;
    // hands shuffle: follow the wheel but cap at a natural grip range (~±115°);
    // past that the rim slides under the grip instead of twisting the arms.
    this.handSpin.rotation.z = THREE.MathUtils.clamp(wheelRot, -2.0, 2.0);
    this._solveArms();

    const a0 = Math.PI * 200 / 180, a1 = -Math.PI * 20 / 180;
    const rpmF = Math.min(vehicle.rpm / (this.spec.dialMax * 1000), 1);
    const spdF = Math.min(vehicle.speedKmh / this.spec.dialSpeed, 1);
    this.needleTach.rotation.z = (a0 + (a1 - a0) * rpmF) - Math.PI / 2;
    this.needleSpd.rotation.z = (a0 + (a1 - a0) * spdF) - Math.PI / 2;

    for (let i = 0; i < 4; i++) {
      const w = vehicle.wheels[i];
      const g = this.wheelMeshes[i];
      g.position.set(this._wheelXFix ? this._wheelXFix[i] : w.x, w.attachY - w.restLen + w.comp, w.z);
      g.rotation.y = -w.steer;
      g.userData.spin.rotation.x = -w.spinAngle;
    }

    // shift lights scale with the car's redline
    const redline = this.spec.engine.redline;
    const blink = (performance.now() * 0.012 | 0) % 2 === 0;
    // map the 5 lights to END just as the (full-throttle) upshift fires at
    // redline-80, so the last LED lights right before the shift instead of ~800
    // rpm early — no "lights full, still not shifting" dead zone.
    const atLimiter = vehicle.rpm > redline - 80;
    const start = redline * 0.85, step = (redline - 80 - redline * 0.85) / 4;
    for (let k = 0; k < 5; k++) {
      const led = this.shiftLeds[k];
      const on = atLimiter ? blink : vehicle.rpm > start + k * step;
      led.material.color.set(on ? led.userData.onColor : 0x1c2024);
    }
    this.tcLamp.visible =
      (vehicle.tcCut > 0.04 || (vehicle._absActive && vehicle.ctrl.brake > 0.3)) && blink;

    this._digTimer = (this._digTimer || 0) + dtVis;
    if (this._digTimer > 0.08) {
      this._digTimer = 0;
      const g = this.digCanvas.getContext('2d');
      const rl = vehicle.spec.engine.redline;
      const hot = vehicle.rpm > rl * 0.92;
      const limiter = vehicle.rpm > rl - 150;
      g.fillStyle = '#081a14'; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#1d3a30'; g.lineWidth = 3; g.strokeRect(2, 2, 124, 124);
      // gear: huge digit, amber near redline, red flash at the limiter
      g.fillStyle = limiter ? (blink ? '#ff2418' : '#7a1410')
                  : hot ? '#ffb024' : '#5cf0ae';
      g.font = 'bold 96px "Arial Black", Arial';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(vehicle.gearLabel, 64, 56);
      g.fillStyle = '#9fd8c2'; g.font = 'bold 24px monospace';
      g.fillText(String(Math.round(vehicle.speedKmh)), 64, 112);
      this.digTex.needsUpdate = true;
    }
  }

  renderMirror(renderer, scene, vehicle) {
    if (this.mode !== 0) return;
    const eye = this.eyeLocal.clone().applyQuaternion(vehicle.quat).add(vehicle.pos);
    this.mirrorCam.position.copy(eye);
    const back = new THREE.Vector3(0, 0.04, 1).applyQuaternion(vehicle.quat);
    this.mirrorCam.lookAt(eye.clone().add(back));
    const vis = this.cockpit.visible;
    this.cockpit.visible = false;
    this.exterior.visible = false;
    renderer.setRenderTarget(this.mirrorRT);
    renderer.render(scene, this.mirrorCam);
    renderer.setRenderTarget(null);
    this.cockpit.visible = vis;
    this.exterior.visible = this.mode === 2;
  }
}
