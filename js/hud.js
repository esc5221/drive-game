// HUD: lap timing (sectors, best in localStorage), minimap, section names,
// assists indicators, help overlay.
const fmt = ms => {
  if (ms == null || !isFinite(ms)) return '--:--.---';
  const m = Math.floor(ms / 60000), s = Math.floor(ms % 60000 / 1000), x = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(x).padStart(3, '0')}`;
};

export class Hud {
  constructor(track) {
    this.track = track;
    this.ghost = null;           // wired by main.js
    this.el = {
      delta: document.getElementById('lap-delta'),
      cur: document.getElementById('lap-cur'),
      last: document.getElementById('lap-last'),
      best: document.getElementById('lap-best'),
      sector: document.getElementById('lap-sector'),
      section: document.getElementById('section-name'),
      dist: document.getElementById('section-dist'),
      assists: document.getElementById('assists'),
      msg: document.getElementById('center-msg'),
      help: document.getElementById('help'),
      speedbar: document.getElementById('speedbar'),
    };
    this.lapStart = null;          // performance-time ms when lap began
    this.lapValid = true;
    this.lastLap = null;
    this.bestLap = Number(localStorage.getItem('ns-best2')) || null;
    this.sectorTimes = [null, null, null];
    this.bestSectors = JSON.parse(localStorage.getItem('ns-best-sectors2') || '[null,null,null]');
    this.curSector = 0;
    this.lapCount = 0;
    this._lastSection = null;
    this._msgTimer = 0;

    this.el.best.textContent = 'BEST  ' + fmt(this.bestLap);
    this._lastSectorMark = 0;
    this._initMinimap();
    this.teleCv = document.getElementById('telemetry');
    this.teleCtx = this.teleCv.getContext('2d');
  }

  _initMinimap() {
    const cv = document.getElementById('minimap');
    const g = cv.getContext('2d');
    const t = this.track;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < t.n; i++) {
      minX = Math.min(minX, t.px[i]); maxX = Math.max(maxX, t.px[i]);
      minZ = Math.min(minZ, t.pz[i]); maxZ = Math.max(maxZ, t.pz[i]);
    }
    const W = cv.width, H = cv.height, pad = 12;
    const sc = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
    this.mapFn = (x, z) => [
      pad + (x - minX) * sc + (W - pad * 2 - (maxX - minX) * sc) / 2,
      pad + (z - minZ) * sc + (H - pad * 2 - (maxZ - minZ) * sc) / 2,
    ];
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const og = off.getContext('2d');
    og.strokeStyle = 'rgba(255,255,255,0.85)';
    og.lineWidth = 2.5;
    og.beginPath();
    for (let i = 0; i <= t.n; i += 3) {
      const [x, y] = this.mapFn(t.px[i % t.n], t.pz[i % t.n]);
      i === 0 ? og.moveTo(x, y) : og.lineTo(x, y);
    }
    og.closePath(); og.stroke();
    // start/finish dot
    const [sx, sy] = this.mapFn(t.px[0], t.pz[0]);
    og.fillStyle = '#ffd24a';
    og.fillRect(sx - 3, sy - 3, 6, 6);
    this.mapBase = off;
    this.mapCtx = g;
    this.mapCv = cv;
  }

  now() { return performance.now(); }

  // called every frame with vehicle state
  update(vehicle, dt) {
    const t = this.track;
    const s = vehicle.trackS;
    const T = t.total;

    if (this.lapStart === null && Math.abs(vehicle.speed) > 0.5) {
      this.lapStart = this.now();   // first movement starts the clock
      if (this.ghost) this.ghost.beginLap();
    }

    // sector boundaries at T/3, 2T/3, T(=0)
    const sec = Math.floor(s / (T / 3));
    if (sec !== this.curSector && this.lapStart !== null) {
      const crossedFinish = this.curSector === 2 && sec === 0;
      const elapsed = this.now() - this.lapStart;
      if (crossedFinish) {
        this._recordSector(2, elapsed - this._lastSectorMark);
        this._lastSectorMark = 0;
        if (vehicle.distAccum > T * 0.9) {
          this.lapCount++;
          this.lastLap = elapsed;
          this.el.last.textContent = 'LAST  ' + fmt(this.lastLap) + (this.lapValid ? '' : ' *');
          const isBest = this.lapValid && (this.bestLap === null || elapsed < this.bestLap);
          if (this.ghost) this.ghost.endLap(elapsed, isBest);
          if (isBest) {
            this.bestLap = elapsed;
            localStorage.setItem('ns-best2', String(elapsed));
            this.el.best.textContent = 'BEST  ' + fmt(this.bestLap);
            this.flash('NEW BEST LAP  ' + fmt(elapsed), '#ffd24a');
          } else {
            this.flash('LAP ' + fmt(elapsed) + (this.lapValid ? '' : ' (invalid)'), '#ffffff');
          }
        } else if (this.ghost) this.ghost.endLap(0, false);
        this.lapStart = this.now();
        this.lapValid = true;
        vehicle.distAccum = 0;
        this.curSector = 0;
        if (this.ghost) this.ghost.beginLap();
      } else if (sec === this.curSector + 1) {
        this._recordSector(this.curSector, elapsed - this._lastSectorMark);
        this._lastSectorMark = elapsed;
        this.curSector = sec;
      } else {
        this.curSector = sec;            // jumped (reset) — don't record
        this._lastSectorMark = elapsed;
      }
    }

    if (this.lapStart !== null) {
      const elapsed = this.now() - this.lapStart;
      this.el.cur.textContent = fmt(elapsed);
      // live delta vs best lap
      if (this.ghost && this.lapValid) {
        const d = this.ghost.deltaAt(s, elapsed);
        if (d !== null) {
          const sign = d >= 0 ? '+' : '−';
          this.el.delta.textContent = sign + (Math.abs(d) / 1000).toFixed(2);
          this.el.delta.style.color = d >= 0 ? '#ff6655' : '#4be38a';
        } else this.el.delta.textContent = '';
      } else this.el.delta.textContent = '';
    }

    // section name + distance into lap
    const seg = t.sectionAt(s);
    if (seg && seg.name !== this._lastSection) {
      this._lastSection = seg.name;
      this.el.section.textContent = seg.name;
      this.el.section.style.opacity = 1;
      this._sectionFade = 4;
    }
    if (this._sectionFade > 0) {
      this._sectionFade -= dt;
      if (this._sectionFade <= 0) this.el.section.style.opacity = 0.35;
    }
    this.el.dist.textContent = (s / 1000).toFixed(2) + ' / ' + (T / 1000).toFixed(2) + ' km';

    // assists
    const a = [];
    a.push(vehicle.tc ? 'TC ON' : 'TC OFF');
    a.push(vehicle.abs ? 'ABS ON' : 'ABS OFF');
    a.push(vehicle.auto ? 'AUTO' : 'MANUAL');
    if (this.fps !== undefined) a.push(Math.round(this.fps) + ' FPS');
    this.el.assists.textContent = a.join('   ');

    // speed bar (subtle redundancy with cockpit gauges)
    this.el.speedbar.textContent =
      `${String(Math.round(vehicle.speedKmh)).padStart(3, ' ')} km/h   ${vehicle.gearLabel}   ${Math.round(vehicle.rpm)} rpm`;

    if (this._msgTimer > 0) {
      this._msgTimer -= dt;
      if (this._msgTimer <= 0) this.el.msg.style.opacity = 0;
    }

    this._drawMinimap(vehicle);
    this._drawTelemetry(vehicle);
  }

  // sector display: purple = all-time best, green = close, white = slower
  _recordSector(idx, ms) {
    if (!this.lapValid || ms < 1000) return;
    this.sectorTimes[idx] = ms;
    let color = '#ffffff';
    const best = this.bestSectors[idx];
    if (best == null || ms < best) {
      color = '#c77dff';
      this.bestSectors[idx] = ms;
      localStorage.setItem('ns-best-sectors2', JSON.stringify(this.bestSectors));
    } else if (ms < best + 500) color = '#4be38a';
    this.el.sector.textContent = `S${idx + 1}  ` + fmt(ms);
    this.el.sector.style.color = color;
  }

  // current-lap gain/loss painted onto the minimap as a colored trail
  _drawDeltaTrail(g) {
    const gh = this.ghost;
    if (!gh || !gh.hasBest || !gh._rec || !gh.best.delta) return;
    const t = this.track;
    const cur = gh._rec.delta, ref = gh.best.delta;
    for (let b = 0; b < cur.length; b++) {
      if (cur[b] < 0 || ref[b] == null || ref[b] < 0) continue;
      const i = Math.round(b * 25 / t.step) % t.n;
      const [x, y] = this.mapFn(t.px[i], t.pz[i]);
      g.fillStyle = cur[b] <= ref[b] ? 'rgba(75,227,138,0.85)' : 'rgba(255,80,70,0.85)';
      g.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
  }

  _drawTelemetry(vehicle) {
    const g = this.teleCtx, W = 210, H = 130;
    g.clearRect(0, 0, W, H);

    // ---- tires (top-down car, FL FR RL RR)
    const TX = [26, 62], TY = [22, 74];
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 1.5;
    g.strokeRect(33, 26, 28, 64);              // body outline between wheels
    for (let wi = 0; wi < 4; wi++) {
      const w = vehicle.wheels[wi];
      const x = TX[wi % 2], y = TY[wi >> 1];
      let col = 'rgba(110,116,124,0.9)';       // no load
      if (w.contact) {
        const rho = Math.hypot(w.slipRatio / 0.10, w.slipAngle / 0.14);
        if (w.slipRatio < -0.12 && vehicle.ctrl.brake > 0.2) col = '#3aa8ff';        // locking
        else if (w.slipRatio > 0.16 && vehicle.ctrl.throttle > 0.2) col = '#ff8c1a'; // spinning
        else if (rho >= 1.0) col = '#ff3326';
        else if (rho >= 0.72) col = '#ffd024';
        else col = '#5fcf6f';
      }
      g.fillStyle = col;
      g.beginPath();
      g.roundRect(x - 7, y - 13, 14, 26, 4);
      g.fill();
    }

    // ---- g-circle (1.3 g full scale)
    const cx = 150, cy = 58, R = 40;
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
    g.beginPath(); g.arc(cx, cy, R / 2, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy);
    g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    const gb = vehicle.gBody;
    const sc = R / (1.3 * 9.81);
    const gx = Math.max(-R, Math.min(R, gb.x * sc));
    const gy = Math.max(-R, Math.min(R, gb.z * sc));
    const mag = Math.hypot(gb.x, gb.z) / 9.81;
    g.fillStyle = mag > 1.05 ? '#ff3326' : mag > 0.75 ? '#ffd024' : '#5fcf6f';
    g.beginPath(); g.arc(cx + gx, cy + gy, 5, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.font = '10px monospace'; g.textAlign = 'center';
    g.fillText(mag.toFixed(2) + ' G', cx, cy + R + 12);

    // ---- pedal bars + steering
    const bx = 12, bw = 78;
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(bx, 104, bw, 6); g.fillRect(bx, 113, bw, 6);
    g.fillStyle = '#46e070';
    g.fillRect(bx, 104, bw * vehicle.ctrl.throttle, 6);
    g.fillStyle = '#ff4538';
    g.fillRect(bx, 113, bw * vehicle.ctrl.brake, 6);
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(bx, 122, bw, 4);
    g.fillStyle = '#fff';
    g.fillRect(bx + bw / 2 + vehicle.ctrl.steer * (bw / 2 - 3) - 2, 121, 4, 6);
  }

  _drawMinimap(vehicle) {
    const g = this.mapCtx;
    g.clearRect(0, 0, this.mapCv.width, this.mapCv.height);
    g.drawImage(this.mapBase, 0, 0);
    this._drawDeltaTrail(g);
    const [x, y] = this.mapFn(vehicle.pos.x, vehicle.pos.z);
    g.fillStyle = '#ff4136';
    g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,65,54,0.6)';
    g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke();
  }

  invalidateLap() {
    if (this.lapValid) {
      this.lapValid = false;
      this.flash('LAP INVALIDATED (reset)', '#ff7755');
    }
  }

  flash(text, color) {
    this.el.msg.textContent = text;
    this.el.msg.style.color = color || '#fff';
    this.el.msg.style.opacity = 1;
    this._msgTimer = 2.6;
  }

  toggleHelp(force) {
    const h = this.el.help;
    const show = force != null ? force : h.style.display === 'none';
    h.style.display = show ? 'block' : 'none';
  }
}
