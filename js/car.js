// Car visuals v2: spec-driven exterior (color/wing/profile), detailed cockpit
// (layered dash, center stack, bolstered seats, visors, paddles), gloved hands
// on a wheel that now turns with the real steering angle, working mirror.
import * as THREE from 'three';

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
  g.fillText('Nordschleife', 14, 20);
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

    this._buildExterior();
    this._buildCockpit();

    this.mirrorRT = new THREE.WebGLRenderTarget(384, 112);
    this.mirrorCam = new THREE.PerspectiveCamera(26, 384 / 112, 0.5, 1500);
    this.mirrorMat.map = this.mirrorRT.texture;
    this.mirrorMat.map.repeat.x = -1;
    this.mirrorMat.map.offset.x = 1;
    this.mirrorMat.needsUpdate = true;

    this.eyeLocal = new THREE.Vector3(-0.37, 0.82, -0.24);
    this.mode = 0;
  }

  dispose() {
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
    glassGeo.rotateY(-Math.PI / 2);
    this.exterior.add(new THREE.Mesh(glassGeo, glassMat));

    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.24, 0.06), darkMat);
    grille.position.set(0, -0.10, -2.16);
    this.exterior.add(grille);
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xdddddd, emissive: 0xb0c4d8, emissiveIntensity: 0.5, roughness: 0.3,
    });
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

    // wheels
    this.wheelMeshes = [];
    const R = this.spec.wheels.radius;
    const tireGeo = new THREE.CylinderGeometry(R, R, 0.26, 18);
    tireGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x16181a, roughness: 0.9 });
    const hubGeo = new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.27, 12);
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

    // vents
    for (const x of [-0.62, 0.62]) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.06, 0.02),
        new THREE.MeshStandardMaterial({ color: 0x0b0d11, roughness: 0.6 }));
      vent.position.set(x, 0.46, -0.845);
      cp.add(vent);
    }

    // center stack: infotainment screen + buttons hint
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.15),
      new THREE.MeshBasicMaterial({ map: screenTexture() }));
    screen.position.set(0.02, 0.46, -0.838);
    screen.rotation.x = -0.08;
    cp.add(screen);
    const stack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), darker);
    stack.position.set(0.02, 0.30, -0.86);
    cp.add(stack);

    // gauge cluster
    const cluster = new THREE.Group();
    cluster.position.set(-0.37, 0.52, -0.86);
    cluster.rotation.x = -0.30;
    const backing = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.26, 0.03), darker);
    backing.position.set(0, 0, -0.018);
    cluster.add(backing);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.05, 0.06), padMat);
    bezel.position.set(0, 0.145, -0.01);
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

    this.digCanvas = document.createElement('canvas');
    this.digCanvas.width = 128; this.digCanvas.height = 64;
    this.digTex = new THREE.CanvasTexture(this.digCanvas);
    const dig = new THREE.Mesh(new THREE.PlaneGeometry(0.10, 0.05),
      new THREE.MeshBasicMaterial({ map: this.digTex }));
    dig.position.set(0, -0.065, 0.003);
    cluster.add(dig);
    cp.add(cluster);

    // ---- steering wheel (flat bottom) + paddles + hands
    this.wheelGroup = new THREE.Group();
    this.wheelGroup.position.set(-0.37, 0.45, -0.70);
    this.wheelGroup.rotation.x = -0.42;
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.7 });
    this.wheelSpin = new THREE.Group();
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

    // gloved hands at 9 & 3 + forearms (rotate with the rim)
    const glove = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.85 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.9 });
    for (const sgn of [-1, 1]) {
      const hand = new THREE.Group();
      // fingers: a partial torus wrapping the rim tube
      const fingers = new THREE.Mesh(new THREE.TorusGeometry(0.030, 0.017, 8, 10, 3.6), glove);
      fingers.rotation.y = Math.PI / 2;
      fingers.rotation.x = Math.PI * 0.1;
      hand.add(fingers);
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.095, 0.052), glove);
      palm.position.set(sgn * 0.012, -0.01, 0.035);
      hand.add(palm);
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.05, 0.02), glove);
      thumb.position.set(-sgn * 0.022, 0.028, 0.012);
      thumb.rotation.z = sgn * 0.5;
      hand.add(thumb);
      const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.046, 0.30, 10), sleeve);
      forearm.position.set(sgn * 0.045, -0.13, 0.13);
      forearm.rotation.x = -0.85;
      forearm.rotation.z = sgn * 0.28;
      hand.add(forearm);
      hand.position.set(sgn * 0.175, 0, 0.012);
      this.wheelSpin.add(hand);
    }
    this.wheelGroup.add(this.wheelSpin);

    // paddles
    for (const sgn of [-1, 1]) {
      const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.10, 0.008), graphite);
      paddle.position.set(sgn * 0.10, 0.01, -0.045);
      this.wheelGroup.add(paddle);
    }
    cp.add(this.wheelGroup);

    // pillars / roof / headliner / visors
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

    // rear-view mirror
    this.mirrorMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mirFrame = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.11, 0.025), pillarMat);
    mirFrame.position.set(0, 1.02, -0.60);
    mirFrame.rotation.x = -0.10;
    cp.add(mirFrame);
    const mir = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.088), this.mirrorMat);
    mir.position.set(0, 1.02, -0.586);
    mir.rotation.x = -0.10;
    cp.add(mir);
  }

  setCameraMode(mode) {
    this.mode = mode;
    this.cockpit.visible = mode === 0;
    this.exterior.visible = mode === 2;
  }

  update(vehicle, dtVis) {
    this.root.position.copy(vehicle.pos);
    this.root.quaternion.copy(vehicle.quat);

    // wheel turns with the ACTUAL steering angle x typical 13:1 column ratio,
    // clamped so the hands never cross over awkwardly
    const realAngle = vehicle.ctrl.steer * vehicle.maxSteerAngle();
    this.wheelSpin.rotation.z = THREE.MathUtils.clamp(-realAngle * 13, -2.6, 2.6);

    const a0 = Math.PI * 200 / 180, a1 = -Math.PI * 20 / 180;
    const rpmF = Math.min(vehicle.rpm / (this.spec.dialMax * 1000), 1);
    const spdF = Math.min(vehicle.speedKmh / this.spec.dialSpeed, 1);
    this.needleTach.rotation.z = (a0 + (a1 - a0) * rpmF) - Math.PI / 2;
    this.needleSpd.rotation.z = (a0 + (a1 - a0) * spdF) - Math.PI / 2;

    for (let i = 0; i < 4; i++) {
      const w = vehicle.wheels[i];
      const g = this.wheelMeshes[i];
      g.position.set(w.x, w.attachY - w.restLen + w.comp, w.z);
      g.rotation.y = -w.steer;
      g.userData.spin.rotation.x = -w.spinAngle;
    }

    // shift lights scale with the car's redline
    const redline = this.spec.engine.redline;
    const blink = (performance.now() * 0.012 | 0) % 2 === 0;
    const atLimiter = vehicle.rpm > redline - 120;
    const start = redline * 0.77, step = redline * 0.032;
    for (let k = 0; k < 5; k++) {
      const led = this.shiftLeds[k];
      const on = atLimiter ? blink : vehicle.rpm > start + k * step;
      led.material.color.set(on ? led.userData.onColor : 0x1c2024);
    }
    this.tcLamp.visible =
      (vehicle.tcCut > 0.04 || (vehicle._absActive && vehicle.ctrl.brake > 0.3)) && blink;

    this._digTimer = (this._digTimer || 0) + dtVis;
    if (this._digTimer > 0.12) {
      this._digTimer = 0;
      const g = this.digCanvas.getContext('2d');
      g.fillStyle = '#06231a'; g.fillRect(0, 0, 128, 64);
      g.fillStyle = '#46e6a0'; g.font = 'bold 40px monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(vehicle.gearLabel, 28, 34);
      g.font = 'bold 24px monospace';
      g.fillText(String(Math.round(vehicle.speedKmh)), 84, 34);
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
