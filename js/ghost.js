// Ghost lap: records your lap at 10 Hz; the best valid lap is saved to
// localStorage and replayed as a translucent ghost car. Also provides the
// live delta-to-best curve (time at every 25 m of track).
import * as THREE from 'three';

const SAMPLE_DT = 0.1;
const BUCKET = 25;            // meters per delta bucket

function buildGhostCar() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x66ccff, transparent: true, opacity: 0.32, depthWrite: false,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.5, 4.3), mat);
  body.position.y = 0.02;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.44, 1.9), mat);
  cabin.position.set(0, 0.48, 0.15);
  g.add(body, cabin);
  g.renderOrder = 4;
  return g;
}

export class Ghost {
  constructor(scene, track, trackId) {
    this.tid = trackId || 'nordschleife';
    this.track = track;
    this.nBuckets = Math.ceil(track.total / BUCKET);
    this.best = null;            // {dt, p:[...], q:[...], delta:[...], lap}
    this.enabled = true;
    this.mesh = buildGhostCar();
    this.mesh.visible = false;
    scene.add(this.mesh);
    this._rec = null;
    try {
      const raw = localStorage.getItem('ns-ghost2-' + this.tid);
      if (raw) this.best = JSON.parse(raw);
    } catch (e) { /* corrupt save */ }
  }

  get hasBest() { return !!this.best; }

  beginLap() {
    this._rec = {
      acc: 0, p: [], q: [],
      delta: new Float64Array(this.nBuckets).fill(-1),
      lastBucket: -1,
    };
  }

  // called every frame while driving
  update(dt, vehicle, elapsedMs) {
    const rec = this._rec;
    if (rec && elapsedMs != null) {
      rec.acc += dt;
      while (rec.acc >= SAMPLE_DT) {
        rec.acc -= SAMPLE_DT;
        const p = vehicle.pos, q = vehicle.quat;
        rec.p.push(+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2));
        rec.q.push(+q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3));
      }
      const b = Math.floor(vehicle.trackS / BUCKET) % this.nBuckets;
      if (b !== rec.lastBucket && rec.delta[b] < 0) {
        rec.delta[b] = elapsedMs / 1000;
        rec.lastBucket = b;
      }
    }

    // ghost playback
    if (this.best && this.enabled && elapsedMs != null) {
      const t = elapsedMs / 1000;
      const n = this.best.p.length / 3;
      const f = Math.min(t / this.best.dt, n - 1.001);
      if (f >= 0 && n > 2) {
        this.mesh.visible = true;
        const i = Math.floor(f), tt = f - i;
        const j = Math.min(i + 1, n - 1);
        const P = this.best.p, Q = this.best.q;
        this.mesh.position.set(
          P[i * 3] + (P[j * 3] - P[i * 3]) * tt,
          P[i * 3 + 1] + (P[j * 3 + 1] - P[i * 3 + 1]) * tt,
          P[i * 3 + 2] + (P[j * 3 + 2] - P[i * 3 + 2]) * tt);
        const qa = new THREE.Quaternion(Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3]);
        const qb = new THREE.Quaternion(Q[j * 4], Q[j * 4 + 1], Q[j * 4 + 2], Q[j * 4 + 3]);
        qa.slerp(qb, tt);
        this.mesh.quaternion.copy(qa);
      }
    } else {
      this.mesh.visible = false;
    }
  }

  // live delta vs best (ms); null if no reference yet
  deltaAt(s, elapsedMs) {
    if (!this.best || !this.best.delta) return null;
    const b = Math.floor(s / BUCKET) % this.nBuckets;
    const ref = this.best.delta[b];
    if (ref == null || ref < 0) return null;
    return elapsedMs - ref * 1000;
  }

  endLap(lapMs, isValidBest) {
    const rec = this._rec;
    this._rec = null;
    if (!rec || !isValidBest) return;
    this.best = {
      dt: SAMPLE_DT, lap: lapMs,
      p: rec.p, q: rec.q,
      delta: Array.from(rec.delta, v => v < 0 ? -1 : +v.toFixed(2)),
    };
    try {
      localStorage.setItem('ns-ghost2-' + this.tid, JSON.stringify(this.best));
    } catch (e) { /* quota */ }
  }
}
