// Touristenfahrten traffic: kinematic AI cars riding the track frame.
// Three driver classes (tourist / sports / fast), Ring etiquette (slow cars
// yield right, overtakes happen on the left), brake lights, player collision.
import * as THREE from 'three';
import { ROAD_HALF } from './track.js';

const BODY_COLORS = [0xd8d8d8, 0x9aa0a8, 0x2e3338, 0x8f2630, 0x1d3f7a,
  0x3f6b32, 0xcfc9b0, 0xe8e8e8, 0x6b3fa0, 0xb86a1f];

const CLASSES = [
  // weight = spawn probability
  { id: 'tourist', skill: [0.50, 0.66], accel: 2.2, brake: 5.5, weight: 0.55, van: 0.35 },
  { id: 'sports',  skill: [0.72, 0.82], accel: 3.5, brake: 7.5, weight: 0.33, van: 0 },
  { id: 'fast',    skill: [0.90, 0.95], accel: 4.5, brake: 9.0, weight: 0.12, van: 0 },
];

function pickClass(rnd) {
  let r = rnd(), acc = 0;
  for (const c of CLASSES) { acc += c.weight; if (r <= acc) return c; }
  return CLASSES[0];
}

function buildAiCar(color, isVan) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.6 });
  const H = isVan ? 0.78 : 0.50;
  const L = isVan ? 4.7 : 4.15;
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.62, H, L), paint);
  body.position.y = 0.30 + H / 2 - 0.25;
  body.castShadow = true;
  g.add(body);
  if (!isVan) {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.40, 0.40, 1.8), dark);
    cabin.position.set(0, 0.62, 0.12);
    g.add(cabin);
  } else {
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.30, 1.1), dark);
    win.position.set(0, 0.72, -1.45);
    g.add(win);
  }
  // brake lights (emissive toggled while decelerating)
  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x550a0c, emissive: 0xcc1015, emissiveIntensity: 0.15, roughness: 0.4,
  });
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.09, 0.05), brakeMat);
  tail.position.set(0, 0.42, L / 2 - 0.02);
  g.add(tail);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.07, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xd8dde2, emissive: 0xaab8c4, emissiveIntensity: 0.3 }));
  head.position.set(0, 0.30, -L / 2 + 0.02);
  g.add(head);
  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x191b1e, roughness: 0.9 });
  const wheels = [];
  for (const [x, z] of [[-0.78, -1.30], [0.78, -1.30], [-0.78, 1.30], [0.78, 1.30]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(x, 0.32, z * (L / 4.15));
    g.add(w);
    wheels.push(w);
  }
  return { group: g, brakeMat, wheels };
}

export class Traffic {
  constructor(scene, track, raceLine) {
    this.scene = scene;
    this.track = track;
    this.vAllowed = raceLine.vAllowed;
    this.offsets = raceLine.offsets;
    this.cars = [];
    this.count = 0;
    this.hit = 0;                       // collision flash for haptics/audio
    this._seed = 1234567;
    this._tmp = {
      m: new THREE.Matrix4(), right: new THREE.Vector3(), up: new THREE.Vector3(),
      back: new THREE.Vector3(), p: new THREE.Vector3(), q: new THREE.Quaternion(),
      rel: new THREE.Vector3(),
    };
    const saved = localStorage.getItem('ns-traffic');
    this.setDensity(saved != null ? +saved : 6);
  }

  _rnd() { return (this._seed = (this._seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }

  setNight(on) {
    this.night = on;
    for (const c of this.cars) {
      c.vis.group.traverse(o => {
        if (o.material && o.material.emissive && o.material.color.r > 0.7 &&
            o.material.color.g > 0.7) {
          o.material.emissiveIntensity = on ? 2.6 : 0.3;     // headlights glow
        }
      });
    }
  }

  setDensity(n) {
    this.count = n;
    localStorage.setItem('ns-traffic', String(n));
    while (this.cars.length > n) {
      const c = this.cars.pop();
      this.scene.remove(c.vis.group);
      c.vis.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    this._needSpawn = true;             // fill up relative to the player next update
  }

  _spawn(playerS, rel) {
    const cls = pickClass(this._rnd.bind(this));
    const isVan = this._rnd() < cls.van;
    const vis = buildAiCar(BODY_COLORS[(this._rnd() * BODY_COLORS.length) | 0], isVan);
    this.scene.add(vis.group);
    const car = {
      cls, vis, isVan,
      s: (playerS + rel + this.track.total) % this.track.total,
      d: 0.6 + this._rnd() * 0.8,
      v: 12,
      skill: cls.skill[0] + this._rnd() * (cls.skill[1] - cls.skill[0]),
      braking: false, yielding: 0, passing: 0,
      cool: 0, blocked: 0, spin: 0,
      half: isVan ? 2.35 : 2.08,
    };
    this.cars.push(car);
    return car;
  }

  // wrapped arc distance from a to b (positive = b ahead of a)
  _ds(a, b) {
    const T = this.track.total;
    let d = b - a;
    if (d > T / 2) d -= T; else if (d < -T / 2) d += T;
    return d;
  }

  update(dt, vehicle) {
    if (this.count === 0 && this.cars.length === 0) return;
    const t = this.track, T = t.total;
    const pS = vehicle.trackS, pD = vehicle.trackD;
    const pV = Math.abs(vehicle.speed);
    dt = Math.min(dt, 0.05);
    this.hit = Math.max(0, this.hit - dt * 3);

    // maintain population in a window around the player
    if (this._needSpawn) {
      this._needSpawn = false;
      while (this.cars.length < this.count) {
        const behind = this._rnd() < 0.22;
        this._spawn(pS, behind ? -(120 + this._rnd() * 300) : 220 + this._rnd() * 1500);
      }
    }
    for (const c of this.cars) {
      const rel = this._ds(pS, c.s);
      if (rel < -500 || rel > 2300) {
        // recycle far cars back into the window ahead of the player
        c.s = (pS + 350 + this._rnd() * 1100) % T;
        c.v = 16;
        c.skill = c.cls.skill[0] + this._rnd() * (c.cls.skill[1] - c.cls.skill[0]);
      }
    }

    for (const c of this.cars) {
      const i = Math.floor(c.s / t.step) % t.n;
      // corner-aware target: min allowed speed over the braking horizon
      let target = 1e9;
      const horizon = Math.max(4, Math.ceil((c.v * 2.2) / t.step));
      for (let k = 0; k < horizon; k += 2) {
        const va = this.vAllowed[(i + k) % t.n] * c.skill;
        if (va < target) target = va;
      }
      target = Math.min(target, c.cls.id === 'tourist' ? 33 : 1e9);

      const relP = this._ds(c.s, pS);              // player relative to AI (+ = ahead)
      const gap = Math.abs(relP);

      // --- Ring etiquette ---
      c.yielding = Math.max(0, c.yielding - dt);
      c.passing = Math.max(0, c.passing - dt);
      // player approaching fast from behind -> keep right, lift slightly
      if (relP < 0 && gap < 90 && pV > c.v + 2) c.yielding = 1.2;
      // fast AI stuck behind a slower player -> set up a pass on the left
      if (c.cls.id === 'fast' && relP > 0 && gap < 60 && target > pV + 4) {
        c.blocked += dt;
        if (c.blocked > 1.2) c.passing = 3.0;
      } else c.blocked = Math.max(0, c.blocked - dt);

      // don't rear-end the player: brake when close in the same lane
      if (relP > 0 && gap < 38 && Math.abs(pD - c.d) < 1.7 && c.passing <= 0) {
        target = Math.min(target, Math.max(0, pV - 1.5 + gap * 0.12));
      }
      // don't rear-end other AI (no AI-vs-AI overtaking — keeps it sane)
      for (const o of this.cars) {
        if (o === c) continue;
        const g2 = this._ds(c.s, o.s);
        if (g2 > 0 && g2 < 30 && Math.abs(o.d - c.d) < 1.6) {
          target = Math.min(target, Math.max(2, o.v - 0.5 + g2 * 0.15));
        }
      }

      // lateral: relaxed racing line, overridden by etiquette
      let dTarget = this.offsets[i] * 0.35 * c.skill + 0.55;     // default: center-right
      if (c.yielding > 0) dTarget = 2.1;                          // hug the right edge
      if (c.passing > 0) dTarget = -2.1;                          // pull left to pass
      dTarget = THREE.MathUtils.clamp(dTarget, -2.3, 2.3);
      c.d += (dTarget - c.d) * Math.min(1, dt * 1.4);

      // longitudinal
      const dv = target - c.v;
      c.v = Math.max(0, c.v + THREE.MathUtils.clamp(dv, -c.cls.brake * dt, c.cls.accel * dt));
      c.braking = dv < -1.2;
      c.s = (c.s + c.v * dt) % T;

      // --- pose on the track frame (tangent + banking roll) ---
      const ii = Math.floor(c.s / t.step) % t.n;
      const jj = (ii + 1) % t.n;
      const ft = c.s / t.step - Math.floor(c.s / t.step);
      const L = (A, B) => A + (B - A) * ft;
      const tmp = this._tmp;
      const tanX = L(t.tx[ii], t.tx[jj]), tanY = L(t.ty[ii], t.ty[jj]), tanZ = L(t.tz[ii], t.tz[jj]);
      const rx = L(t.rx[ii], t.rx[jj]), rz = L(t.rz[ii], t.rz[jj]);
      const roll = L(t.roll[ii], t.roll[jj]);
      const cr = Math.cos(roll), sr = Math.sin(roll);
      tmp.right.set(rx * cr, sr, rz * cr).normalize();
      tmp.back.set(-tanX, -tanY, -tanZ).normalize();
      tmp.up.crossVectors(tmp.back, tmp.right).normalize();   // right x fwd = up? back x right
      if (tmp.up.y < 0) tmp.up.negate();
      const cx = L(t.px[ii], t.px[jj]) + rx * c.d;
      const cy = L(t.py[ii], t.py[jj]) + c.d * Math.tan(roll);
      const cz = L(t.pz[ii], t.pz[jj]) + rz * c.d;
      c.vis.group.position.set(cx, cy + 0.02, cz);
      tmp.m.makeBasis(tmp.right, tmp.up, tmp.back);
      c.vis.group.quaternion.setFromRotationMatrix(tmp.m);

      // dressing: brake lights + wheel spin + gentle body bob over the road
      c.vis.brakeMat.emissiveIntensity = c.braking ? 2.2 : (this.night ? 0.8 : 0.15);
      for (const w of c.vis.wheels) w.rotation.x -= (c.v / 0.32) * dt;
      c.vis.group.position.y += Math.sin(c.s * 2.3 + c.d * 5) * 0.012;

      // --- player collision (track-space OBB approximation) ---
      c.cool = Math.max(0, c.cool - dt);
      if (gap < 8 && c.cool <= 0) {
        const dLat = pD - c.d;
        if (gap < c.half + 2.12 && Math.abs(dLat) < 1.68) {
          // separate mostly laterally, kill some closing speed
          const pushLat = Math.sign(dLat || (this._rnd() - 0.5));
          const pushLong = Math.sign(relP || 1) * -1;   // push player away along track
          tmp.p.set(t.rx[ii] * pushLat, 0, t.rz[ii] * pushLat).normalize();
          vehicle.vel.addScaledVector(tmp.p, 2.2);
          vehicle.vel.x += tanX * pushLong * -1.2;
          vehicle.vel.z += tanZ * pushLong * -1.2;
          vehicle.angVel.y += (this._rnd() - 0.5) * 1.2;
          vehicle.scrape = 1;                          // reuse scrape audio
          c.v = Math.max(3, c.v * 0.8);
          c.yielding = 1.5;
          c.cool = 0.6;
          this.hit = 1;
        }
      }
    }
  }
}
