// Car visuals: first-person cockpit (dash, wheel, gauges, mirror, pillars)
// and a simple exterior shell + wheels for the chase camera.
import * as THREE from 'three';

const BODY_COL = 0x1f4f9e;   // Performance Blue

function dialTexture(label, maxVal, major, redFrom) {
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#101216'; g.beginPath(); g.arc(S/2, S/2, S/2, 0, 7); g.fill();
  g.strokeStyle = '#2a2e36'; g.lineWidth = 6;
  g.beginPath(); g.arc(S/2, S/2, S/2 - 4, 0, 7); g.stroke();
  // sweep: 220deg, from 200deg to -20deg (clockwise as value rises)
  const a0 = Math.PI * 200 / 180, a1 = -Math.PI * 20 / 180;
  const ticks = maxVal / major;
  for (let i = 0; i <= ticks; i++) {
    const f = i / ticks;
    const a = a0 + (a1 - a0) * f;
    const val = i * major;
    const inRed = redFrom != null && val >= redFrom;
    g.strokeStyle = inRed ? '#e03b30' : '#dfe3ea';
    g.lineWidth = 4;
    const r1 = S/2 - 12, r2 = S/2 - 30;
    g.beginPath();
    g.moveTo(S/2 + Math.cos(a) * r1, S/2 - Math.sin(a) * r1);
    g.lineTo(S/2 + Math.cos(a) * r2, S/2 - Math.sin(a) * r2);
    g.stroke();
    g.fillStyle = inRed ? '#e03b30' : '#cfd4dc';
    g.font = 'bold 26px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const rt = S/2 - 52;
    g.fillText(String(val), S/2 + Math.cos(a) * rt, S/2 - Math.sin(a) * rt);
  }
  g.fillStyle = '#8a919c'; g.font = 'bold 20px Arial';
  g.fillText(label, S/2, S/2 + 56);
  return new THREE.CanvasTexture(c);
}

export class CarVisual {
  constructor(scene, renderer) {
    this.renderer = renderer;
    this.root = new THREE.Group();
    scene.add(this.root);

    this.cockpit = new THREE.Group();
    this.exterior = new THREE.Group();
    this.root.add(this.cockpit, this.exterior);

    this._buildExterior();
    this._buildCockpit();

    // rear-view mirror render target
    this.mirrorRT = new THREE.WebGLRenderTarget(384, 112);
    this.mirrorCam = new THREE.PerspectiveCamera(26, 384 / 112, 0.5, 1500);
    this.mirrorMat.map = this.mirrorRT.texture;
    this.mirrorMat.map.repeat.x = -1;       // mirror flip
    this.mirrorMat.map.offset.x = 1;
    this.mirrorMat.needsUpdate = true;

    this.eyeLocal = new THREE.Vector3(-0.37, 0.82, -0.24);
  }

  _buildExterior() {
    const paint = new THREE.MeshPhysicalMaterial({
      color: BODY_COL, metalness: 0.32, roughness: 0.38,
      clearcoat: 1.0, clearcoatRoughness: 0.1, envMapIntensity: 0.8,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0c1117, metalness: 0.4, roughness: 0.15,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.6 });

    // body from a side-profile silhouette, extruded across the width
    const prof = [
      [-2.15, -0.30], [-2.15, 0.00], [-1.80, 0.09], [-0.90, 0.17],
      [-0.32, 0.60], [0.50, 0.64], [1.20, 0.44], [1.90, 0.36],
      [2.13, 0.32], [2.13, -0.30],
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

    // glass canopy (slightly narrower, dark)
    const gProf = [[-0.84, 0.18], [-0.30, 0.585], [0.48, 0.625], [1.16, 0.43], [0.9, 0.30], [-0.5, 0.22]];
    const gShape = new THREE.Shape();
    gShape.moveTo(gProf[0][0], gProf[0][1]);
    for (let i = 1; i < gProf.length; i++) gShape.lineTo(gProf[i][0], gProf[i][1]);
    gShape.closePath();
    const glassGeo = new THREE.ExtrudeGeometry(gShape, { depth: 1.40, bevelEnabled: false });
    glassGeo.translate(0, 0.02, -0.70);
    glassGeo.rotateY(-Math.PI / 2);
    this.exterior.add(new THREE.Mesh(glassGeo, glassMat));

    // details: grille, lights, mirrors, spoiler, red N accent line
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
        new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.4 }));
      accent.position.set(sgn * 0.845, -0.245, 0);
      this.exterior.add(accent);
    }
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.04), tailMat);
    tail.position.set(0, 0.16, 2.16);
    this.exterior.add(tail);
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.30, 0.035, 0.30), paint);
    spoiler.position.set(0, 0.50, 1.95);
    spoiler.castShadow = true;
    this.exterior.add(spoiler);
    for (const sgn of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.16), darkMat);
      strut.position.set(sgn * 0.5, 0.42, 1.98);
      this.exterior.add(strut);
    }

    // wheels (also shown in cockpit mode: fronts peek out — they don't, hidden by hood; cheap anyway)
    this.wheelMeshes = [];
    const tireGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.26, 18);
    tireGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshLambertMaterial({ color: 0x16181a });
    const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.27, 12);
    hubGeo.rotateZ(Math.PI / 2);
    const hubMat = new THREE.MeshLambertMaterial({ color: 0x9aa2ab });
    for (let i = 0; i < 4; i++) {
      const grp = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireMat);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      const spin = new THREE.Group();
      spin.add(tire, hub);
      grp.add(spin);
      grp.userData.spin = spin;
      this.exterior.add(grp);
      this.wheelMeshes.push(grp);
    }
  }

  _buildCockpit() {
    const dark = new THREE.MeshLambertMaterial({ color: 0x262b33 });
    const darker = new THREE.MeshLambertMaterial({ color: 0x171a20 });
    const cp = this.cockpit;

    // hood (visible from driver seat)
    const hoodGeo = new THREE.PlaneGeometry(1.78, 1.35, 8, 4);
    const hp = hoodGeo.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      const x = hp.getX(i), y = hp.getY(i);
      hp.setZ(i, -0.10 * (y + 0.675) - 0.18 * (x * x) / 0.8);  // slopes down & crowns
    }
    hoodGeo.computeVertexNormals();
    const hood = new THREE.Mesh(hoodGeo, new THREE.MeshLambertMaterial({ color: BODY_COL }));
    hood.rotation.x = -Math.PI / 2 + 0.06;
    hood.position.set(0, 0.42, -1.62);
    cp.add(hood);

    // dash
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.30, 0.55), dark);
    dash.position.set(0, 0.36, -0.92);
    dash.rotation.x = 0.12;
    cp.add(dash);
    const dashTop = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.30), darker);
    dashTop.position.set(0, 0.50, -1.05);
    cp.add(dashTop);

    // gauge cluster behind wheel
    const cluster = new THREE.Group();
    cluster.position.set(-0.37, 0.52, -0.86);
    cluster.rotation.x = -0.30;
    const backing = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.26, 0.03),
      new THREE.MeshLambertMaterial({ color: 0x14171d }));
    backing.position.set(0, 0, -0.018);
    cluster.add(backing);

    const tachTex = dialTexture('RPM x1000', 8, 1, 7);
    const spdTex = dialTexture('km/h', 300, 50, null);
    const mkDial = (tex, x) => {
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.085, 32),
        new THREE.MeshBasicMaterial({ map: tex }));
      d.position.set(x, 0, 0);
      cluster.add(d);
      const needle = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.075, 0.004),
        new THREE.MeshBasicMaterial({ color: 0xff5040 }));
      needle.geometry.translate(0, 0.030, 0);
      needle.position.set(x, 0, 0.004);
      cluster.add(needle);
      return needle;
    };
    this.needleTach = mkDial(tachTex, -0.105);
    this.needleSpd = mkDial(spdTex, 0.105);

    // shift lights: 3 green + 2 red LEDs above the cluster
    this.shiftLeds = [];
    for (let k = 0; k < 5; k++) {
      const led = new THREE.Mesh(
        new THREE.BoxGeometry(0.013, 0.009, 0.004),
        new THREE.MeshBasicMaterial({ color: 0x1c2024 }));
      led.position.set(-0.044 + k * 0.022, 0.118, 0.004);
      led.userData.onColor = k < 3 ? 0x2bdd55 : 0xff2418;
      cluster.add(led);
      this.shiftLeds.push(led);
    }
    // TC/ESC intervention lamp (amber, blinks while assists act)
    this.tcLamp = new THREE.Mesh(
      new THREE.CircleGeometry(0.0085, 12),
      new THREE.MeshBasicMaterial({ color: 0xffaa00 }));
    this.tcLamp.position.set(0.155, 0.095, 0.004);
    this.tcLamp.visible = false;
    cluster.add(this.tcLamp);

    // small digital panel (gear + speed)
    this.digCanvas = document.createElement('canvas');
    this.digCanvas.width = 128; this.digCanvas.height = 64;
    this.digTex = new THREE.CanvasTexture(this.digCanvas);
    const dig = new THREE.Mesh(new THREE.PlaneGeometry(0.10, 0.05),
      new THREE.MeshBasicMaterial({ map: this.digTex }));
    dig.position.set(0, -0.065, 0.003);
    cluster.add(dig);
    cp.add(cluster);

    // steering wheel
    this.wheelGroup = new THREE.Group();
    this.wheelGroup.position.set(-0.37, 0.45, -0.70);
    this.wheelGroup.rotation.x = -0.42;        // column rake
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.020, 12, 36),
      new THREE.MeshLambertMaterial({ color: 0x22262e }));
    this.wheelSpin = new THREE.Group();
    this.wheelSpin.add(rim);
    for (const a of [0, 2.094, -2.094]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.16, 0.015), dark);
      spoke.position.set(Math.sin(a) * 0.085, -Math.cos(a) * 0.085, 0);
      spoke.rotation.z = a;
      this.wheelSpin.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 16), dark);
    hub.rotation.x = Math.PI / 2;
    this.wheelSpin.add(hub);
    // marker at top of rim for rotation readability
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.030, 0.012),
      new THREE.MeshBasicMaterial({ color: 0xcc2222 }));
    marker.position.set(0, 0.172, 0);
    this.wheelSpin.add(marker);
    this.wheelGroup.add(this.wheelSpin);
    cp.add(this.wheelGroup);

    // windshield frame: A-pillars + roof edge
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0x14171c });
    for (const sgn of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.85, 0.09), pillarMat);
      pil.position.set(sgn * 0.83, 0.78, -0.78);
      pil.rotation.x = 0.42;
      pil.rotation.z = sgn * 0.12;
      cp.add(pil);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 1.3), pillarMat);
    roof.position.set(0, 1.15, -0.02);
    cp.add(roof);
    const headliner = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.012, 1.26),
      new THREE.MeshLambertMaterial({ color: 0x2b2f36 }));
    headliner.position.set(0, 1.12, -0.02);
    cp.add(headliner);

    // windshield glass (subtle)
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.62, 0.78),
      new THREE.MeshBasicMaterial({ color: 0x88aabb, transparent: true, opacity: 0.06, depthWrite: false }));
    glass.position.set(0, 0.80, -0.80);
    glass.rotation.x = 0.40;
    cp.add(glass);

    // doors / side window sills
    for (const sgn of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 1.9), dark);
      door.position.set(sgn * 0.86, 0.42, 0.05);
      cp.add(door);
    }

    // seats
    for (const x of [-0.37, 0.37]) {
      const seatB = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.14, 0.50), darker);
      seatB.position.set(x, 0.12, 0.25);
      const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.62, 0.14), darker);
      seatBack.position.set(x, 0.45, 0.52);
      cp.add(seatB, seatBack);
    }

    // center console
    const console_ = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.22, 0.9), dark);
    console_.position.set(0, 0.18, -0.30);
    cp.add(console_);

    // rear-view mirror
    this.mirrorMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mirFrame = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.105, 0.02),
      new THREE.MeshLambertMaterial({ color: 0x111419 }));
    mirFrame.position.set(0, 1.02, -0.60);
    mirFrame.rotation.x = -0.10;
    cp.add(mirFrame);
    const mir = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.088), this.mirrorMat);
    mir.position.set(0, 1.02, -0.588);
    mir.rotation.x = -0.10;
    cp.add(mir);
  }

  // mode: 0 cockpit, 1 hood, 2 chase
  setCameraMode(mode) {
    this.mode = mode;
    this.cockpit.visible = mode === 0;
    this.exterior.visible = mode === 2;
  }

  update(vehicle, dtVis) {
    this.root.position.copy(vehicle.pos);
    this.root.quaternion.copy(vehicle.quat);

    // steering wheel: 2.3 visual turns lock-to-lock relative to max steer
    const ratio = 0.56 / vehicle.maxSteerAngle();
    this.wheelSpin.rotation.z = vehicle.ctrl.steer * 2.4 * ratio * -1;

    // gauges
    const a0 = Math.PI * 200 / 180, a1 = -Math.PI * 20 / 180;
    const rpmF = Math.min(vehicle.rpm / 8000, 1);
    const spdF = Math.min(vehicle.speedKmh / 300, 1);
    // needle geometry points up (90deg); rotate so it sweeps the dial
    this.needleTach.rotation.z = (a0 + (a1 - a0) * rpmF) - Math.PI / 2;
    this.needleSpd.rotation.z = (a0 + (a1 - a0) * spdF) - Math.PI / 2;

    // wheels (chase view)
    for (let i = 0; i < 4; i++) {
      const w = vehicle.wheels[i];
      const g = this.wheelMeshes[i];
      g.position.set(w.x, w.attachY - w.restLen + w.comp - 0.0, w.z);
      g.rotation.y = -w.steer;
      g.userData.spin.rotation.x = -w.spinAngle;
    }

    // shift lights: stage in from 5300 rpm, all-blink at the limiter
    const blink = (performance.now() * 0.012 | 0) % 2 === 0;
    const atLimiter = vehicle.rpm > 6800;
    for (let k = 0; k < 5; k++) {
      const led = this.shiftLeds[k];
      const on = atLimiter ? blink : vehicle.rpm > 5300 + k * 320;
      led.material.color.set(on ? led.userData.onColor : 0x1c2024);
    }
    // TC/ABS intervention lamp
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
