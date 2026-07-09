// Vehicle physics: rigid body (6DOF) + 4-wheel raycast suspension +
// combined-slip Pacejka tires + engine/gearbox/diff + aero.
// Fixed substep integration at 240 Hz.
import * as THREE from 'three';
import { SURF, WALL_D } from './track.js';

const G = 9.81;
export const DT = 1 / 240;

// surface grip
const MU = { [SURF.ROAD]: 1.22, [SURF.CURB]: 1.10, [SURF.GRASS]: 0.55 };

// global grip multiplier for weather (1 = dry, <1 = wet/slippery)
export let WEATHER_GRIP = 1;
export function setWeatherGrip(g) { WEATHER_GRIP = g; }

// engine torque from the car spec's curve
const DRIVE_EFF = 0.90;

function engineTorque(eng, rpm) {
  const R = eng.rpm, N = eng.nm;
  if (rpm <= R[0]) return N[0];
  for (let i = 1; i < R.length; i++) {
    if (rpm <= R[i]) {
      const t = (rpm - R[i - 1]) / (R[i] - R[i - 1]);
      return N[i - 1] + t * (N[i] - N[i - 1]);
    }
  }
  return 0;
}

// normalized combined-slip curve: peaks at 1.0 when rho == 1
function tireCurve(rho) {
  return Math.sin(1.5 * Math.atan(1.73 * rho));
}

const V = () => new THREE.Vector3();

// body-frame contact corners for the guardrail test (module const — no per-step alloc)
const CORNERS = [[-0.92, -2.15], [0.92, -2.15], [-0.92, 2.15], [0.92, 2.15]];

export class Vehicle {
  constructor(track, spec) {
    this.track = track;
    this.spec = spec;

    this.mass = spec.mass;
    this.invMass = 1 / this.mass;
    this.inertia = new THREE.Vector3(...spec.inertia);     // pitch(x), yaw(y), roll(z)
    this.pos = V(); this.vel = V();
    this.quat = new THREE.Quaternion();
    this.angVel = V();                                      // world frame
    this.comH = spec.comH;
    this.drivenFront = spec.drive === 'FWD';

    // wheels: FL FR RL RR.  body frame: +x right, +y up, -z forward
    const W = spec.wheels;
    this.wheels = [
      { x: -W.htF, z: W.fz, front: true },
      { x: +W.htF, z: W.fz, front: true },
      { x: -W.htR, z: W.rz, front: false },
      { x: +W.htR, z: W.rz, front: false },
    ].map(w => ({
      ...w,
      attachY: W.attachY,
      restLen: W.restLen, radius: W.radius, inertiaW: W.iw,
      k: w.front ? W.kF : W.kR,
      cBump: w.front ? W.cBF : W.cBR, cReb: w.front ? W.cRF : W.cRR,
      maxCompress: W.maxC,
      comp: 0, prevComp: 0, contact: false,
      omega: 0,
      slipRatio: 0, slipAngle: 0, load: 0, surf: SURF.ROAD,
      muScale: w.front ? W.muF : W.muR,
      q: {},
      worldPos: V(),
      steer: 0, spinAngle: 0,
    }));
    this.arbF = spec.arbF; this.arbR = spec.arbR;

    // drivetrain
    this.gear = 1;                    // 1..N (0 = neutral via clutch), -1 reverse
    this.rpm = spec.engine.idle;
    this.auto = true;
    this.shiftTimer = 0; this.shiftCooldown = 0;
    this.tc = true; this.abs = true;
    this.tcCut = 0;

    // controls (set externally each frame)
    this.ctrl = { steer: 0, throttle: 0, brake: 0, handbrake: false };

    // telemetry
    this.speed = 0; this.gForce = new THREE.Vector3();
    this.gBody = new THREE.Vector3();           // gForce in body frame (HUD)
    this.trackS = 0; this.trackD = 0; this.onTrack = true;
    this.scrape = 0; this.airborne = false;
    this.suspActivity = 0;            // smoothed sum |comp rate| (cabin vibration)
    this.landImpact = 0;              // spike on touchdown after airtime
    this._airTime = 0;
    this.distAccum = 0; this._prevS = 0;
    this.slipFront = 0; this.slipRear = 0;
    this._flipTime = 0; this.rollover = false;   // sustained inverted -> auto-recover
    this._manualHold = 0;   // manual gear change -> hold auto-shift off briefly
    this._parkHeld = false; this._parkX = 0; this._parkZ = 0;   // standstill sleep anchor

    // scratch pool — every per-step temp reuses one of these so the 240 Hz hot
    // path allocates nothing (no GC jank). f/p/r/v/t1..t3/q are general temps;
    // the named ones below are persistent within a step (body axes) or per-call
    // temps for _addTorque/_walls.
    this._scratch = {
      f: V(), p: V(), r: V(), v: V(), t1: V(), t2: V(), t3: V(), q: new THREE.Quaternion(),
      bodyUp: V(), bodyFwd: V(), bodyRight: V(),   // body axes — persist for the whole step
      tRight: V(), tVc: V(),                       // tire right vector + contact-point velocity
      atR: V(), atCross: V(),                      // _addTorque temps
      wallP: V(), wallN: V(), wallQ: {},           // _walls temps
      dq: new THREE.Quaternion(),                  // quaternion derivative
    };
    this._tDrive = [0, 0, 0, 0];
    this._tBrake = [0, 0, 0, 0];
    this._bodyQ = {};
  }

  reset(s = 0) {
    const p = this.track.poseAt(s);
    // align with the FULL 3D tangent (pitch included) — spawning level on a
    // steep grade buries an axle and the bottom-out springs catapult the car
    const tan = new THREE.Vector3(p.tx, p.ty, p.tz).normalize();
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0),
      tan, new THREE.Vector3(0, 1, 0));
    this.quat.setFromRotationMatrix(m);
    // height: clear the highest wheel-contact point, not just the center
    this.pos.set(p.x, p.y, p.z);
    let maxY = p.y;
    const wp = new THREE.Vector3();
    for (const w of this.wheels) {
      wp.set(w.x, 0, w.z).applyQuaternion(this.quat).add(this.pos);
      const q = this.track.query(wp.x, wp.z, {});
      if (q) maxY = Math.max(maxY, q.y);
    }
    this.pos.y = maxY + this.comH + 0.03;
    this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    this.gear = 1; this.rpm = this.spec.engine.idle; this.shiftTimer = 0;
    this.distAccum = 0;
    for (const w of this.wheels) { w.omega = 0; w.comp = 0; w.prevComp = 0; }
    this._flipTime = 0; this.rollover = false;
    this._manualHold = 0;
    this._parkHeld = false;                       // sleep anchor must not survive a teleport
    const q = this.track.query(p.x, p.z, {});
    if (q) { this.trackS = q.s; this._prevS = q.s; }
  }

  shiftUp() { if (this.gear >= 1 && this.gear < this.spec.gears.length && this.shiftTimer <= 0) { this.gear++; this.shiftTimer = 0.18; this._manualHold = 2.0; } else if (this.gear === -1) this.gear = 1; else if (this.gear === 0) this.gear = 1; }
  shiftDown() {
    if (this.gear > 1 && this.shiftTimer <= 0) {
      // block downshifts that would overrev
      const ratio = this.spec.gears[this.gear - 2] * this.spec.final;
      const di = this.drivenFront ? 0 : 2;
      const wAvg = (this.wheels[di].omega + this.wheels[di + 1].omega) / 2;
      if (wAvg * ratio * 60 / (2 * Math.PI) < this.spec.engine.redline + 300) { this.gear--; this.shiftTimer = 0.18; this._manualHold = 2.0; }
    } else if (this.gear === 1 && Math.abs(this.speed) < 1.5) this.gear = -1;
  }

  step(dt) {
    const S = this._scratch;
    const force = S.t1.set(0, -this.mass * G, 0);   // accumulate world force
    const torque = S.t2.set(0, 0, 0);               // accumulate world torque
    const bodyUp = S.bodyUp.set(0, 1, 0).applyQuaternion(this.quat);
    const bodyFwd = S.bodyFwd.set(0, 0, -1).applyQuaternion(this.quat);
    const bodyRight = S.bodyRight.set(1, 0, 0).applyQuaternion(this.quat);

    const vFwd = this.vel.dot(bodyFwd);
    this.speed = vFwd;

    // ---- steering (applied per substep, already smoothed by input layer)
    const maxSteer = this.maxSteerAngle();
    let steerAngle = this.ctrl.steer * maxSteer;
    // keyboard stability assist (tied to TC): counter-steer toward the slide
    // once body slip angle passes a deadzone, like a driver's reflex.
    if (this.tc) {
      const vLatB = this.vel.dot(bodyRight), vLongB = vFwd;
      if (Math.abs(vLongB) > 8) {
        const beta = Math.atan2(vLatB, Math.abs(vLongB));
        const dead = 0.05;
        if (Math.abs(beta) > dead) {
          // strong reflex: slides snap back as soon as you ease the keys
          steerAngle += THREE.MathUtils.clamp(
            (beta - Math.sign(beta) * dead) * 0.62, -0.12, 0.12);
        }
      }
    }

    const sp = this.spec, ENG = sp.engine;

    // ---- engine & drivetrain (computed BEFORE shift logic so the gearbox sees
    // a wheelspin-immune engine speed and never false-shifts off a launch spike)
    const reverse = this.gear === -1;
    const ratio = (reverse ? sp.reverse : sp.gears[Math.max(0, this.gear - 1)]) * sp.final;
    const di = this.drivenFront ? 0 : 2;            // driven axle index
    const wAvg = (this.wheels[di].omega + this.wheels[di + 1].omega) / 2;
    let rpmFromWheels = Math.abs(wAvg) * ratio * 60 / (2 * Math.PI);
    // road-speed rpm: what the engine WOULD turn with no wheelspin. Used for
    // shift decisions so a spinning wheel can't spike revs past the upshift line.
    const roadRpm = Math.abs(vFwd) / this.wheels[di].radius * ratio * 60 / (2 * Math.PI);
    // launch clutch: in 1st gear under throttle, the clutch slips and holds the
    // engine high in the powerband until the wheels spin up to meet it, then
    // locks. (A real hard launch slips the clutch to ~30-40 km/h — without this
    // the revs crater the instant the clutch grabs and the car bogs.)
    const launchRpm = ENG.idle + this.ctrl.throttle * (ENG.redline - ENG.idle) * 0.55;
    const launching = this.gear === 1 && this.ctrl.throttle > 0.2 &&
                      roadRpm < launchRpm * 0.92;
    const clutchLocked = !launching;
    if (launching) this.rpm = Math.max(ENG.idle, launchRpm);
    else this.rpm = Math.max(ENG.idle, Math.min(rpmFromWheels, ENG.redline + 200));

    // ---- shift logic (uses roadRpm: immune to wheelspin spikes; blocks
    // upshifts while launching or near standstill)
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (this.shiftCooldown > 0) this.shiftCooldown -= dt;
    if (this._manualHold > 0) this._manualHold -= dt;
    if (this.auto && this.gear >= 1 && this.shiftTimer <= 0 && this.shiftCooldown <= 0 && !launching && this._manualHold <= 0) {
      // Classic, predictable auto-shift — what most racing games actually do:
      // upshift near the limiter, downshift once the revs fall below the band.
      // rpm comes from road speed (wheelspin-immune) so a launch can't false-shift,
      // and lifting off lets revs fall naturally → no upshift while coasting.
      if (roadRpm > ENG.redline - 350 && this.gear < sp.gears.length) {
        this.gear++; this.shiftTimer = 0.08; this.shiftCooldown = 0.4;   // fast DCT/PDK shift
      } else if (roadRpm < ENG.shiftDown && this.gear > 1 && this.ctrl.brake < 0.7) {
        this.gear--; this.shiftTimer = 0.10; this.shiftCooldown = 0.35;
      }
    }

    // during a launch the torque cap below limits traction, so don't also let the
    // TC chop the throttle (double-limiting wastes the launch). Otherwise normal TC.
    let thr = this.ctrl.throttle * (launching ? 1 : (1 - this.tcCut));
    if (this.shiftTimer > 0) thr = 0;
    if (this.rpm >= ENG.redline) thr = 0;                          // limiter
    let tEngine = engineTorque(ENG, this.rpm) * thr;
    // clutch is OPEN during a gear change — no drive AND no engine braking.
    // (Otherwise engine-brake torque, multiplied by the gear ratio, slams the
    // car on every upshift — brutal on light/small-wheel vehicles like the kart.)
    const clutchEngaged = clutchLocked && this.shiftTimer <= 0;
    // drive torque: engine spins the wheels in the gear's direction
    let tAxle = tEngine * ratio * DRIVE_EFF * (reverse ? -1 : 1);
    // engine braking RESISTS wheel rotation — it acts opposite to the driven
    // wheels' spin and must fade to zero at rest, otherwise it pushes a stopped
    // car backwards (worst on the light, short-geared kart) into a runaway.
    const ebMag = (ENG.engBrake[0] + ENG.engBrake[1] * this.rpm) * (1 - thr) *
                  (clutchEngaged ? 1 : 0) * ratio * DRIVE_EFF;
    tAxle -= Math.sign(wAvg) * Math.min(1, Math.abs(wAvg) / 3) * ebMag;
    if (this.gear === 0) tAxle = 0;
    // launch control: cap drive torque to the driven-axle traction limit so the
    // tires sit near peak slip (max longitudinal g) instead of spinning up and
    // forcing the TC to chop power. This is what gets a high-power RWD car off
    // the line — without it the launch wastes ~0.7s vs the traction-limited ideal.
    if (launching) {
      const muDrv = MU[SURF.ROAD] * (this.drivenFront ? sp.wheels.muF : sp.wheels.muR) * WEATHER_GRIP;
      const drvFrac = this.drivenFront ? 0.62 : 0.60;       // static weight on the driven axle
      const tracCap = muDrv * this.mass * G * drvFrac * this.wheels[di].radius * 1.18;
      if (tAxle > tracCap) tAxle = tracCap;
    }

    // LSD on the driven axle
    // standstill hold: with no pedal input at (near) rest, park the drivetrain.
    // Without it, LSD + tyre feedback at tiny wheel speeds can limit-cycle the
    // driven axle (the two wheels counter-rotate against each other) and slowly
    // walk the "stopped" car around. Releases the instant any pedal is touched.
    const parked = this.ctrl.throttle < 0.02 && this.ctrl.brake < 0.02 &&
                   !this.ctrl.handbrake && this.gear !== -1 && Math.abs(vFwd) < 0.4;

    // LSD on the driven axle (meaningless at a standstill — and unstable there)
    const dOmega = this.wheels[di].omega - this.wheels[di + 1].omega;
    const tLsd = parked ? 0 : THREE.MathUtils.clamp(dOmega * 350, -1000, 1000);
    const tDrive = this._tDrive;
    tDrive[0] = tDrive[1] = tDrive[2] = tDrive[3] = 0;
    tDrive[di] = tAxle / 2 - tLsd / 2;
    tDrive[di + 1] = tAxle / 2 + tLsd / 2;

    // brakes
    const brakeT = this.ctrl.brake * sp.brakeT;
    const bias = sp.bias;
    const tBrake = this._tBrake;
    tBrake[0] = brakeT * bias; tBrake[1] = brakeT * bias;
    tBrake[2] = brakeT * (1 - bias); tBrake[3] = brakeT * (1 - bias);
    if (this.ctrl.handbrake) { tBrake[2] += 3000; tBrake[3] += 3000; }
    if (parked) { tBrake[0] += 900; tBrake[1] += 900; tBrake[2] += 900; tBrake[3] += 900; }  // auto-hold

    // ---- per wheel: suspension + tire
    let tcWorst = 0, absActive = false;
    let contactCount = 0;
    this.slipFront = 0; this.slipRear = 0;

    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      w.steer = w.front ? steerAngle : 0;

      // ray origin (attach point) in world
      const attach = S.p.set(w.x, w.attachY, w.z).applyQuaternion(this.quat).add(this.pos);
      // iterate ground height under the wheel (rays are near-vertical; 2 iterations converge)
      let gx = attach.x, gz = attach.z, q = null;
      for (let it = 0; it < 2; it++) {
        q = this.track.query(gx, gz, w.q);
        if (!q) break;
        // slide contact guess down the -bodyUp direction
        const t = (attach.y - q.y) / Math.max(0.4, bodyUp.y);
        gx = attach.x - bodyUp.x * t; gz = attach.z - bodyUp.z * t;
      }
      if (!q) { w.contact = false; w.load = 0; this._spinWheel(w, tDrive[wi], tBrake[wi], 0, dt); continue; }

      const rayLen = (attach.y - q.y) / Math.max(0.4, bodyUp.y);   // distance along -bodyUp to surface
      const comp = w.restLen + w.radius - rayLen;
      w.prevComp = w.comp;

      if (comp < -0.04) {       // airborne
        w.contact = false; w.comp = Math.max(comp, -0.12); w.load = 0; w.surf = q.surf;
        this._spinWheel(w, tDrive[wi], tBrake[wi], 0, dt);
        w.worldPos.copy(attach).addScaledVector(bodyUp, -(w.restLen + Math.min(0.12, -comp)));
        continue;
      }
      contactCount++;
      w.contact = true; w.surf = q.surf;
      w.comp = Math.min(comp, w.maxCompress + 0.08);
      // clamp the damper input: a surface kink crossed at speed must read as
      // a bump, not as a 20 m/s compression spike that launches the car
      const compRate = THREE.MathUtils.clamp((w.comp - w.prevComp) / dt, -4, 4);
      w.rate = compRate;

      // spring + bottom-out + damper + ARB
      let fSus = w.k * Math.max(0, w.comp);
      if (w.comp > w.maxCompress) fSus += (w.comp - w.maxCompress) * w.k * 6;
      fSus += compRate * (compRate > 0 ? w.cBump : w.cReb);
      const opp = this.wheels[wi ^ 1];                  // FL<->FR, RL<->RR
      fSus += (w.front ? this.arbF : this.arbR) * (w.comp - opp.comp);
      fSus = THREE.MathUtils.clamp(fSus, 0, 30000);     // ~2.1g per corner max

      const normal = S.r.set(q.nx, q.ny, q.nz);
      const contactPt = S.v.copy(attach).addScaledVector(bodyUp, -rayLen);
      w.worldPos.copy(attach).addScaledVector(bodyUp, -(rayLen - w.radius));

      // suspension force along surface normal
      force.addScaledVector(normal, fSus);
      this._addTorque(torque, contactPt, normal, fSus);

      // ---- tire forces
      const load = fSus;
      w.load = load;
      if (load > 1) {
        // wheel heading projected on contact plane
        const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
        const fwd = S.f.copy(bodyFwd).multiplyScalar(cs).addScaledVector(bodyRight, sn);
        fwd.addScaledVector(normal, -fwd.dot(normal)).normalize();
        const right = S.tRight.crossVectors(fwd, normal).normalize();

        // contact point velocity
        const vc = S.tVc.copy(this.angVel).cross(S.p.copy(contactPt).sub(this.pos)).add(this.vel);
        const vLong = vc.dot(fwd), vLat = vc.dot(right);

        const slipRatio = (w.omega * w.radius - vLong) / Math.max(Math.abs(vLong), 2.0);
        const slipAngle = Math.atan2(vLat, Math.max(Math.abs(vLong), 0.8));
        w.slipRatio = slipRatio; w.slipAngle = slipAngle;

        // load sensitivity
        let mu = MU[w.surf] * w.muScale * WEATHER_GRIP * (1 - 2.2e-5 * Math.max(0, load - 3400));
        const kp = 0.10, ap = 0.14;
        const sx = slipRatio / kp, sy = slipAngle / ap;
        const rho = Math.max(1e-4, Math.hypot(sx, sy));
        const f = tireCurve(Math.min(rho, 3));
        let fx = mu * load * f * (sx / rho);
        let fy = -mu * load * f * (sy / rho);

        // low speed: blend to viscous model so the car comes to rest cleanly
        const vTot = Math.hypot(vLong, vLat);
        if (vTot < 1.2) {
          const b = vTot / 1.2;
          fy = fy * b - vLat * load * 0.9 * (1 - b);
          if (Math.abs(w.omega) < 0.8 && this.ctrl.throttle < 0.05) fx = fx * b - vLong * load * 0.5 * (1 - b);
        }

        force.addScaledVector(fwd, fx).addScaledVector(right, fy);
        this._addTorque(torque, contactPt, fwd, fx);
        this._addTorque(torque, contactPt, right, fy);

        // wheel spin with tire reaction
        this._spinWheel(w, tDrive[wi], tBrake[wi], fx, dt);

        // assists bookkeeping
        const driven = w.front === this.drivenFront;
        if (driven && this.ctrl.throttle > 0.1) {
          // hold wheelspin near the tire's peak-grip slip (~0.10-0.15) instead of
          // slamming the throttle shut: cut scales with slip EXCESS over target.
          if (slipRatio > 0.15) tcWorst = Math.max(tcWorst, (slipRatio - 0.15) * 3.0);
          // ESP: FWD plow / RWD power-oversteer — both fixed by easing throttle
          const latEx = Math.abs(slipAngle) - (this.drivenFront ? 0.15 : 0.13);
          if (latEx > 0 && Math.abs(vLong) > 6) tcWorst = Math.max(tcWorst, latEx * (this.drivenFront ? 0.9 : 1.2));
        }
        if (slipRatio < -0.13 && this.ctrl.brake > 0.1) absActive = true;
        const drift = Math.abs(Math.sin(slipAngle)) * Math.min(1, vTot / 8);
        if (w.front) this.slipFront = Math.max(this.slipFront, drift);
        else this.slipRear = Math.max(this.slipRear, drift);
      } else {
        this._spinWheel(w, tDrive[wi], tBrake[wi], 0, dt);
      }
    }
    this.airborne = contactCount === 0;

    // cabin-feel telemetry: suspension business + landing slam
    let act = 0;
    for (const w of this.wheels) if (w.contact) act += Math.abs(w.rate || 0);
    this.suspActivity += (act - this.suspActivity) * Math.min(1, dt * 14);
    if (this.airborne) {
      this._airTime += dt;
    } else {
      if (this._airTime > 0.25) {
        this.landImpact = Math.min(1, this._airTime * 0.8 + Math.abs(this.vel.y) * 0.07);
      }
      this._airTime = 0;
    }
    this.landImpact = Math.max(0, this.landImpact - dt * 2.2);

    // ---- ABS: directly limit wheel lockup (handled in _spinWheel via flag)
    this._absActive = this.abs && absActive;

    // ---- TC
    if (this.tc) {
      const target = tcWorst > 0 ? Math.min(0.80, tcWorst * 1.7) : 0;
      this.tcCut += (target - this.tcCut) * Math.min(1, dt * 18);
    } else this.tcCut = 0;

    // ---- aero (sedan body, small lip spoiler)
    const v2 = this.vel.lengthSq();
    if (v2 > 0.1) {
      const vDir = S.p.copy(this.vel).normalize();
      force.addScaledVector(vDir, -0.5 * 1.2 * sp.aero.cda * v2);                 // drag
      const down = 0.5 * 1.2 * sp.aero.cla * Math.min(v2, 90 * 90);
      force.addScaledVector(bodyUp, -down);
      const dfPoint = S.v.copy(this.pos).addScaledVector(bodyFwd, -0.25);        // slight rear bias
      this._addTorque(torque, dfPoint, bodyUp, -down);
    }

    // ---- guardrail walls
    this.scrape = Math.max(0, this.scrape - dt * 6);
    this._walls(force, torque);

    // ---- integrate body (semi-implicit)
    const acc = S.p.copy(force).multiplyScalar(this.invMass);
    this.gForce.lerp(S.v.set(acc.x, acc.y + G, acc.z), Math.min(1, dt * 12));
    this.vel.addScaledVector(acc, dt);

    // torque -> body frame, gyroscopic term, integrate
    const qInv = S.q.copy(this.quat).invert();
    this.gBody.copy(this.gForce).applyQuaternion(qInv);
    const tB = torque.applyQuaternion(qInv);
    const wB = S.p.copy(this.angVel).applyQuaternion(qInv);
    const I = this.inertia;
    const dwx = (tB.x - (wB.y * wB.z * (I.z - I.y))) / I.x;
    const dwy = (tB.y - (wB.z * wB.x * (I.x - I.z))) / I.y;
    const dwz = (tB.z - (wB.x * wB.y * (I.y - I.x))) / I.z;
    wB.x += dwx * dt; wB.y += dwy * dt; wB.z += dwz * dt;
    // mild angular damping for numeric robustness
    wB.multiplyScalar(1 - 0.06 * dt);
    // hard cap: the explicit gyroscopic term diverges past ~30 rad/s
    // (crash tumbles) — 25 rad/s = 4 rev/s is already a violent flip
    const wMag = wB.length();
    if (wMag > 25) wB.multiplyScalar(25 / wMag);
    this.angVel.copy(wB.applyQuaternion(this.quat));

    const vMag = this.vel.length();
    if (vMag > 130) this.vel.multiplyScalar(130 / vMag);   // 468 km/h sanity cap
    // static friction / sleep for the parked car: the wheel hold stops the axle
    // limit-cycle, but the settled body is slightly pitched, so the suspension has a
    // constant horizontal force component that balances tyre drag at a ~2 cm/s creep —
    // damping alone can't remove a steady force. Anchor the horizontal position
    // instead (physics-engine "sleeping"); vertical stays live so the suspension
    // breathes, and any pedal input releases it instantly.
    if (parked && contactCount > 0 && vMag < 0.25) {
      if (!this._parkHeld) { this._parkHeld = true; this._parkX = this.pos.x; this._parkZ = this.pos.z; }
      this.vel.x = 0; this.vel.z = 0;
      this.pos.x = this._parkX; this.pos.z = this._parkZ;
    } else this._parkHeld = false;
    this.pos.addScaledVector(this.vel, dt);
    const om = this.angVel;
    const dq = S.dq.set(om.x * dt / 2, om.y * dt / 2, om.z * dt / 2, 0).multiply(this.quat);
    this.quat.x += dq.x; this.quat.y += dq.y; this.quat.z += dq.z; this.quat.w += dq.w;
    this.quat.normalize();

    // visual wheel spin angle
    for (const w of this.wheels) w.spinAngle = (w.spinAngle + w.omega * dt) % (Math.PI * 2);

    // ---- NaN watchdog: a violent numeric blowup auto-recovers to the track
    if (!isFinite(this.pos.x + this.pos.y + this.pos.z +
                  this.vel.x + this.vel.y + this.vel.z + this.quat.w)) {
      this.reset(isFinite(this.trackS) ? this.trackS : 0);
      return;
    }

    // ---- rollover watchdog: car body-up Y < 0.3 (≈72° tilted/inverted) held for
    // 1.5 s = stuck on its side/roof. The suspension raycast props the car up in
    // any orientation, so a flip is otherwise a stable state — flag for recovery.
    const upY = 1 - 2 * (this.quat.x * this.quat.x + this.quat.z * this.quat.z);
    if (upY < 0.3) this._flipTime += dt; else this._flipTime = 0;
    this.rollover = this._flipTime > 1.5;

    // ---- track position / lap distance
    const tq = this.track.query(this.pos.x, this.pos.z, this._bodyQ);
    if (tq) {
      let ds = tq.s - this._prevS;
      const T = this.track.total;
      if (ds > T / 2) ds -= T; else if (ds < -T / 2) ds += T;
      this.distAccum += Math.max(0, ds);
      this._prevS = tq.s;
      this.trackS = tq.s; this.trackD = tq.d;
      this.onTrack = tq.surf !== SURF.GRASS;
    }
  }

  _spinWheel(w, tDrive, tBrake, fxReaction, dt) {
    // ABS releases brake torque when wheel is about to lock
    if (this._absActive && w.slipRatio < -0.10) tBrake *= 0.25;
    w.omega += (tDrive - fxReaction * w.radius) * dt / w.inertiaW;
    const dwB = tBrake * dt / w.inertiaW;
    if (Math.abs(w.omega) <= dwB) w.omega = 0;
    else w.omega -= Math.sign(w.omega) * dwB;
    // engine-side floor: clutch locked wheels can't fall below stall... keep free, fine.
    if (!isFinite(w.omega)) w.omega = 0;
  }

  _addTorque(torqueAccum, point, dir, mag) {
    const S = this._scratch;
    const r = S.atR.copy(point).sub(this.pos);
    torqueAccum.addScaledVector(S.atCross.crossVectors(r, dir), mag);
  }

  _walls(force, torque) {
    const S = this._scratch;
    for (const [cx, cz] of CORNERS) {
      // apply the wall normal force at CoM height (y=0): pushing below the CoM
      // produced a roll torque that flipped the car when grinding the rail.
      const p = S.wallP.set(cx, 0.0, cz).applyQuaternion(this.quat).add(this.pos);
      const q = this.track.query(p.x, p.z, S.wallQ);
      if (!q) continue;
      const pen = Math.abs(q.d) - WALL_D;
      if (pen <= 0) continue;
      const outX = Math.sign(q.d) * q.rx, outZ = Math.sign(q.d) * q.rz;     // outward lateral
      const vc = S.tVc.copy(this.angVel).cross(S.p.copy(p).sub(this.pos)).add(this.vel);
      const vOut = vc.x * outX + vc.z * outZ;
      let fN = pen * 50000 + Math.max(0, vOut) * 4000;
      fN = Math.min(fN, 55000);
      const n = S.wallN.set(-outX, 0, -outZ);
      force.addScaledVector(n, fN);
      this._addTorque(torque, p, n, fN);
      // scrape friction along the rail — applied at CoM (no torque) so a
      // glancing hit slows the car instead of spinning it like a top
      const tangVx = vc.x - vOut * outX, tangVz = vc.z - vOut * outZ;
      const tl = Math.hypot(tangVx, tangVz);
      if (tl > 0.5) {
        force.x += -tangVx / tl * fN * 0.22;
        force.z += -tangVz / tl * fN * 0.22;
      }
      // bleed off yaw rate while grinding the rail
      this.angVel.y *= 1 - Math.min(0.5, fN / 55000) * 0.04;
      // bleed ROLL rate (rotation about the car's longitudinal axis) on contact:
      // a wall hit tips the car and the corner force then feeds the tilt into a
      // flip. Damping only the roll component stops the easy rollover while
      // leaving yaw (cornering) and pitch (jumps/landings) untouched — so the
      // rest of the driving feel is unaffected.
      const rollRate = this.angVel.dot(S.bodyFwd);
      this.angVel.addScaledVector(S.bodyFwd, -rollRate * Math.min(0.7, fN / 55000) * 0.16);
      this.scrape = Math.min(1, Math.max(this.scrape, fN / 30000));
    }
  }

  maxSteerAngle() {
    // speed-sensitive lock matched to tire physics: roughly the angle that
    // saturates front slip + kinematic term, so full keyboard deflection is
    // always near (not far past) the grip limit. 32deg crawling, ~3deg at 180.
    const v = Math.abs(this.speed);
    return THREE.MathUtils.clamp(0.56 / (1 + Math.pow(v / 11, 1.5)), 0.05, 0.56);
  }

  get speedKmh() { return Math.abs(this.speed) * 3.6; }
  get gearLabel() { return this.gear === -1 ? 'R' : this.gear === 0 ? 'N' : String(this.gear); }
}
