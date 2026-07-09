// Multiplayer client — link-only rooms over a Durable Object relay.
// Loaded only with ?room= (dynamic import), so the home page ships nothing.
//
// Cost gating (the invariant: pay only while friends actually drive together):
//   - solo in room  -> send 0 Hz (DO hibernates; we only wait for a join event)
//   - tab hidden / paused -> send 0 Hz
//   - otherwise 12 Hz binary state, relayed (outgoing is free on CF)
//
// Remote playback: per-player jitter buffer on the SENDER's clock (seq * 1/12 s),
// mapped to local time with a min-biased offset EWMA; Hermite interpolation
// (pos+vel) + quaternion slerp, <=250 ms dead-reckoning then fade.
import * as THREE from 'three';
import { RemoteCar } from './remotecars.js';

const SEND_HZ = 12, SEND_DT = 1 / SEND_HZ;
const DELAY = 0.15;                     // playback delay (s) behind the mapped sender clock
const EXTRAP_MAX = 0.25;                // dead-reckoning budget (s)
const DEFAULT_HOST = 'https://drive-mp.esc5221.workers.dev';

// ---- binary codec (32 B) ----------------------------------------------------
function encodeState(buf, seq, v) {
  const dv = new DataView(buf);
  dv.setUint8(0, 1);
  dv.setUint16(1, seq & 0xffff, true);
  dv.setFloat32(3, v.pos.x, true); dv.setFloat32(7, v.pos.y, true); dv.setFloat32(11, v.pos.z, true);
  const cl = (x, m) => Math.max(-m, Math.min(m, x));
  dv.setInt16(15, cl(v.vel.x * 100, 32700) | 0, true);
  dv.setInt16(17, cl(v.vel.y * 100, 32700) | 0, true);
  dv.setInt16(19, cl(v.vel.z * 100, 32700) | 0, true);
  dv.setInt16(21, v.quat.x * 32700 | 0, true); dv.setInt16(23, v.quat.y * 32700 | 0, true);
  dv.setInt16(25, v.quat.z * 32700 | 0, true); dv.setInt16(27, v.quat.w * 32700 | 0, true);
  dv.setInt8(29, cl(v.ctrl.steer * 127, 127) | 0);
  dv.setUint8(30, (Math.min(15, v.ctrl.throttle * 15) | 0) | ((Math.min(15, v.ctrl.brake * 15) | 0) << 4));
  dv.setUint8(31, 0);
}
function decodeState(dv, o) {
  const tb = dv.getUint8(o + 30);
  return {
    seq: dv.getUint16(o + 1, true),
    pos: new THREE.Vector3(dv.getFloat32(o + 3, true), dv.getFloat32(o + 7, true), dv.getFloat32(o + 11, true)),
    vel: new THREE.Vector3(dv.getInt16(o + 15, true) / 100, dv.getInt16(o + 17, true) / 100, dv.getInt16(o + 19, true) / 100),
    quat: new THREE.Quaternion(dv.getInt16(o + 21, true) / 32700, dv.getInt16(o + 23, true) / 32700,
      dv.getInt16(o + 25, true) / 32700, dv.getInt16(o + 27, true) / 32700).normalize(),
    steer: dv.getInt8(o + 29) / 127,
    brake: (tb >> 4) / 15,
  };
}

// ---- remote player: jitter buffer + hermite playback ------------------------
const _p0 = new THREE.Vector3(), _q0 = new THREE.Quaternion();
class RemotePlayer {
  constructor(scene, idx, nick, carId) {
    this.idx = idx; this.nick = nick;
    this.car = new RemoteCar(scene, idx, nick, carId);
    this._lastUp = performance.now();
    this.buf = [];                       // {t (sender s), pos, vel, quat}
    this.seqBase = -1; this.seqLast = 0;
    this.off = null;                     // local-minus-sender clock offset (min-biased)
    this.lastRx = performance.now();
  }
  push(s) {
    // unwrap u16 seq -> monotonically increasing sender time
    if (this.seqBase < 0) { this.seqBase = s.seq; this.seqLast = s.seq; }
    let d = s.seq - (this.seqLast & 0xffff);
    if (d < -32768) d += 65536; else if (d > 32768) d -= 65536;
    this.seqLast += d;
    if (d <= 0) return;                  // stale / duplicate
    const t = this.seqLast * SEND_DT;
    const now = performance.now() / 1000;
    const off = now - t;
    this.off = this.off == null ? off : (off < this.off ? off : this.off + (off - this.off) * 0.05);
    this.buf.push({ t, pos: s.pos, vel: s.vel, quat: s.quat, steer: s.steer || 0, brake: s.brake || 0 });
    if (this.buf.length > 24) this.buf.shift();
    this.lastRx = performance.now();
  }
  update() {
    const b = this.buf;
    if (!b.length || this.off == null) return;
    if (performance.now() - this.lastRx > 10000) { this.car.hide(); return; }
    const now = performance.now();
    const frameDt = Math.min(0.1, (now - this._lastUp) / 1000);
    this._lastUp = now;
    const playT = now / 1000 - this.off - DELAY;
    let i = b.length - 1;
    while (i > 0 && b[i].t > playT) i--;
    const a = b[i], c = b[Math.min(i + 1, b.length - 1)];
    if (a === c || playT >= c.t) {       // beyond newest -> extrapolate (dead reckoning)
      const last = b[b.length - 1];
      const dt = Math.min(EXTRAP_MAX, Math.max(0, playT - last.t));
      _p0.copy(last.pos).addScaledVector(last.vel, dt);
      this.car.fade(playT - last.t > EXTRAP_MAX ? Math.max(0, 1 - (playT - last.t - EXTRAP_MAX) / 0.5) : 1);
      this.car.set(_p0, last.quat);
      this.car.drive(last.vel.length(), last.steer, last.brake, frameDt);
      return;
    }
    const span = c.t - a.t || SEND_DT;
    const u = Math.min(1, Math.max(0, (playT - a.t) / span));
    // cubic Hermite with velocity tangents (C1 — no corner-cutting at speed)
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    _p0.set(
      h00 * a.pos.x + h10 * span * a.vel.x + h01 * c.pos.x + h11 * span * c.vel.x,
      h00 * a.pos.y + h10 * span * a.vel.y + h01 * c.pos.y + h11 * span * c.vel.y,
      h00 * a.pos.z + h10 * span * a.vel.z + h01 * c.pos.z + h11 * span * c.vel.z);
    _q0.slerpQuaternions(a.quat, c.quat, u);
    this.car.fade(1);
    this.car.set(_p0, _q0);
    this.car.drive(
      a.vel.length() + (c.vel.length() - a.vel.length()) * u,
      a.steer + (c.steer - a.steer) * u,
      Math.max(a.brake, c.brake), frameDt);
  }
  dispose() { this.car.dispose(); }
}

// ---- client ------------------------------------------------------------------
export class MPClient {
  constructor({ scene, trackId, randomSeed, carId, hud, grid, forceCar, forcePreset }) {
    this.scene = scene; this.trackId = trackId; this.randomSeed = randomSeed >>> 0;
    this.carId = carId; this.hud = hud;
    this.gridFn = grid || (() => {});     // (slot) => reset the car to its grid slot
    this.forceCar = forceCar || (() => {});     // room-unified car (live setCar)
    this.forcePreset = forcePreset || (() => {}); // room weather (live atmo apply)
    this.host = localStorage.getItem('ns-mp-host') || DEFAULT_HOST;
    this.ws = null; this.room = null; this.you = 0;
    this.players = new Map();            // idx -> RemotePlayer
    this.seq = 0; this._acc = 0; this._ka = 0;
    this._retries = 0;
    this._buf = new ArrayBuffer(32);
    // race session state (everyone READY -> countdown -> GO -> finish order)
    this.readySet = new Set();           // player indices that pressed READY
    this.myReady = false;
    this.racing = false;                 // between GO and my finish
    this.inputLocked = false;            // grid hold during the countdown
    this.finishers = [];                 // [{i, nick, ms}] in arrival order
    this._ui();
  }

  get others() { return this.players.size; }
  get connected() { return this.ws && this.ws.readyState === 1; }

  auto() {
    const room = new URLSearchParams(location.search).get('room');
    if (room) this.join(room.toUpperCase());
  }

  nick() {
    let n = localStorage.getItem('ns-nick');
    if (!n) {
      n = 'Driver-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      const typed = prompt('닉네임 (멀티플레이어 표시 이름)', n);
      n = (typed || n).slice(0, 16);
      localStorage.setItem('ns-nick', n);
    }
    return n;
  }

  async create() {
    try {
      const r = await fetch(this.host + '/create', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ track: this.trackId, seed: this.randomSeed }),
      });
      const { code } = await r.json();
      const u = new URL(location.href); u.searchParams.set('room', code);
      history.replaceState(null, '', u);
      this.join(code);
    } catch (e) { this._status('서버 연결 실패'); }
  }

  async join(code) {
    this.room = code;
    try {
      const r = await fetch(`${this.host}/room/${code}/meta`);
      if (!r.ok) { this._status('방 없음: ' + code); this.room = null; this._render(); return; }
      const meta = await r.json();
      // the room owns track+seed — align (guests reload into the right layout)
      const needTrack = meta.track !== this.trackId;
      const needSeed = meta.track === 'random' && (meta.seed >>> 0) !== this.randomSeed;
      if (needTrack || needSeed) {
        localStorage.setItem('ns-track', meta.track);
        if (meta.track === 'random') localStorage.setItem('ns-random-seed', String(meta.seed >>> 0));
        if (meta.car) localStorage.setItem('ns-car', meta.car);
        if (meta.preset != null) localStorage.setItem('ns-preset', String(meta.preset));
        sessionStorage.setItem('ns-go', '1');
        location.reload();
        return;
      }
      // same track: apply the room's world live — WEATHER FIRST, then the car, so the
      // rebuilt CarVisual is constructed under the final environment map (building it
      // first and then swapping the env left its cockpit materials holding a disposed
      // texture — rendered as magenta).
      if (meta.preset != null) this.forcePreset(meta.preset);
      if (meta.car) { this.forceCar(meta.car); this.carId = meta.car; }
      this._connect(code);
    } catch (e) { this._status('서버 연결 실패'); }
  }

  _connect(code) {
    const wsHost = this.host.replace(/^http/, 'ws');
    const q = `nick=${encodeURIComponent(this.nick())}&car=${encodeURIComponent(this.carId)}`;
    const ws = new WebSocket(`${wsHost}/room/${code}/ws?${q}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => { this._retries = 0; this._render(); };
    ws.onmessage = e => this._onMsg(e.data);
    ws.onclose = () => {
      this.ws = null;
      for (const p of this.players.values()) p.dispose();
      this.players.clear();
      this._render();
      if (this.room && this._retries < 6) {            // quiet auto-reconnect
        this._retries++;
        setTimeout(() => this.room && this._connect(this.room), 1500 * this._retries);
      }
    };
  }

  leave() {
    this.room = null;
    if (this.ws) this.ws.close();
    const u = new URL(location.href); u.searchParams.delete('room');
    history.replaceState(null, '', u);
    this._render();
  }

  _onMsg(data) {
    if (typeof data === 'string') {
      let m; try { m = JSON.parse(data); } catch (e) { return; }
      if (m.t === 'hello') {
        this.you = m.you;
        for (const p of m.roster) {
          if (p.i !== this.you) this._add(p);
          if (p.ready) this.readySet.add(p.i);
        }
        this._render();
      } else if (m.t === 'join') {
        this._add(m.p);
        if (this.hud) this.hud.flash(m.p.nick + ' 입장', '#7ec8ff');
        this._render();
      } else if (m.t === 'leave') {
        const p = this.players.get(m.i);
        this.readySet.delete(m.i);
        if (p) { if (this.hud) this.hud.flash(p.nick + ' 퇴장', '#8aa0b6'); p.dispose(); this.players.delete(m.i); }
        this._render();
      } else if (m.t === 'ready') {
        if (m.v) this.readySet.add(m.i); else this.readySet.delete(m.i);
        if (m.i === this.you) this.myReady = m.v;
        this._render();
      } else if (m.t === 'race') {
        this._startRace();
      } else if (m.t === 'lap') {
        this._finish(m.i, m.ms);
      }
      return;
    }
    const dv = new DataView(data);
    const idx = dv.getUint8(0);
    const p = this.players.get(idx);
    if (p && data.byteLength >= 33) p.push(decodeState(dv, 1));
  }

  _add(p) {
    if (this.players.has(p.i)) return;
    this.players.set(p.i, new RemotePlayer(this.scene, p.i, p.nick, p.car));
  }

  // ---- race session -----------------------------------------------------------
  toggleReady() {
    if (!this.connected) return;
    this.myReady = !this.myReady;
    try { this.ws.send(JSON.stringify({ t: 'ready', v: this.myReady })); } catch (e) {}
    this._render();
  }

  _startRace() {
    // grid slot = my rank among all indices (deterministic, same on every client)
    const ids = [this.you, ...this.players.keys()].sort((a, b) => a - b);
    const slot = Math.max(0, ids.indexOf(this.you));
    this.readySet.clear(); this.myReady = false;
    this.finishers = []; this.racing = false;
    this._cdActive = true;               // hide the READY CTA through the countdown
    this._hideResults();
    this.gridFn(slot);                   // park the car on its grid slot (behind the line)
    this.inputLocked = true;
    this._countdown(3);
    this._render();
  }

  _countdown(n) {
    const ov = this._cd;
    ov.style.display = 'flex';
    if (n > 0) {
      ov.textContent = n;
      this._beep(440, 0.12);
      setTimeout(() => this._countdown(n - 1), 1000);
    } else {
      ov.textContent = 'GO!';
      ov.style.color = '#7ee0a8';
      this._beep(880, 0.4);
      this.inputLocked = false;
      this.racing = true;
      this._cdActive = false;
      setTimeout(() => { ov.style.display = 'none'; ov.style.color = '#ffd24a'; }, 900);
    }
  }

  _beep(freq, dur) {
    try {
      const ctx = this._actx || (this._actx = new (window.AudioContext || window.webkitAudioContext)());
      if (ctx.state === 'suspended') ctx.resume();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; o.type = 'square';
      g.gain.setValueAtTime(0.12, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g).connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + dur);
    } catch (e) { /* no audio — fine */ }
  }

  // called from the game loop when a lap completes (main.js watches hud.lapCount)
  onLap(ms, valid) {
    if (!this.racing || !this.connected) return;
    this.racing = false;                 // my race lap is done
    try { this.ws.send(JSON.stringify({ t: 'lap', ms: Math.round(ms) })); } catch (e) {}
    this._finish(this.you, Math.round(ms));
    this._render();                      // READY CTA returns for the rematch
  }

  _finish(i, ms) {
    if (this.finishers.some(f => f.i === i)) return;
    const nick = i === this.you ? '나' : (this.players.get(i)?.nick || '?');
    this.finishers.push({ i, nick, ms });
    this._showResults();
  }

  _showResults() {
    const el = this._res;
    const fmt = ms => { const s = ms / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`; };
    el.innerHTML = '<div class="mp-res-title">RACE RESULT</div>' + this.finishers.map((f, k) =>
      `<div class="mp-res-row${f.i === this.you ? ' me' : ''}"><b>${k + 1}</b><span>${f.nick}</span><i>${fmt(f.ms)}</i></div>`).join('') +
      '<div class="mp-res-hint">READY를 누르면 다음 판</div>';
    el.style.display = 'block';
    clearTimeout(this._resT);
    this._resT = setTimeout(() => this._hideResults(), 20000);
  }
  _hideResults() { if (this._res) this._res.style.display = 'none'; }

  // called every frame from the game loop
  update(dt, vehicle, paused) {
    for (const p of this.players.values()) p.update();
    if (!this.connected) return;
    this._ka += dt;
    if (this._ka > 25) { this._ka = 0; try { this.ws.send('ping'); } catch (e) {} }
    // ---- cost gating: only stream state when someone is actually watching ----
    if (this.others === 0 || paused || document.hidden) return;
    this._acc += dt;
    if (this._acc < SEND_DT) return;
    this._acc %= SEND_DT;
    encodeState(this._buf, this.seq++, vehicle);
    try { this.ws.send(this._buf); } catch (e) {}
  }

  // ---- room chip UI (self-contained, hidden on .ns-view) ---------------------
  _ui() {
    const st = document.createElement('style');
    st.textContent = `
      #mp-chip { position:fixed; top:8px; left:50%; transform:translateX(-50%); z-index:60;
        display:flex; gap:6px; align-items:center; font-family:system-ui,sans-serif; font-size:13px;
        background:rgba(8,14,22,0.72); border:1px solid rgba(126,200,255,0.35); border-radius:9px;
        padding:5px 10px; color:#dfe4ea; pointer-events:auto; }
      #mp-chip b { color:#7ec8ff; letter-spacing:1px; }
      #mp-chip button { background:rgba(126,200,255,0.15); color:#cfe8ff; border:1px solid rgba(126,200,255,0.4);
        border-radius:6px; padding:3px 9px; font-size:12px; cursor:pointer; font-family:inherit; }
      #mp-chip button:active { background:rgba(126,200,255,0.35); }
      body.ns-view #mp-chip { display:none; }
      #mp-cta { position:fixed; top:13vh; left:50%; transform:translateX(-50%); z-index:70;
        display:none; pointer-events:auto; font-family:system-ui,sans-serif; }
      #mp-cta button.big { font-size:19px; font-weight:800; letter-spacing:3px; color:#07140e;
        background:linear-gradient(180deg,#7ee0a8,#46c483); border:none; border-radius:14px;
        padding:15px 40px; cursor:pointer; font-family:inherit;
        animation:mpPulse 2s ease-in-out infinite; }
      #mp-cta button.big small { display:block; font-size:11px; font-weight:600; letter-spacing:1px;
        color:rgba(7,20,14,0.65); margin-top:2px; }
      @keyframes mpPulse {
        0%,100% { box-shadow:0 0 0 0 rgba(126,224,168,0), 0 4px 22px rgba(70,196,131,0.35); }
        50%     { box-shadow:0 0 0 8px rgba(126,224,168,0.14), 0 4px 30px rgba(70,196,131,0.55); } }
      #mp-cta .wait { font-size:13px; font-weight:600; color:#aef3c9; background:rgba(8,14,22,0.72);
        border:1px solid rgba(126,224,168,0.45); border-radius:999px; padding:9px 20px; }
      body.ns-view #mp-cta { display:none !important; }
      #mp-cd { position:fixed; inset:0; z-index:90; display:none; align-items:center; justify-content:center;
        font-family:system-ui,sans-serif; font-size:min(34vw,190px); font-weight:800; color:#ffd24a;
        text-shadow:0 0 40px rgba(0,0,0,0.8); pointer-events:none; }
      #mp-res { position:fixed; top:14%; left:50%; transform:translateX(-50%); z-index:85; display:none;
        min-width:min(340px,86vw); background:rgba(6,12,20,0.92); border:1px solid rgba(126,200,255,0.4);
        border-radius:13px; padding:16px 20px; font-family:system-ui,sans-serif; color:#dfe4ea; }
      .mp-res-title { font-size:13px; letter-spacing:3px; color:#7ec8ff; font-weight:700; margin-bottom:10px; text-align:center; }
      .mp-res-row { display:flex; gap:12px; align-items:baseline; padding:6px 2px; border-bottom:1px solid rgba(255,255,255,0.08); font-size:15px; }
      .mp-res-row b { color:#ffd24a; width:20px; }
      .mp-res-row span { flex:1; }
      .mp-res-row i { font-style:normal; font-family:ui-monospace,monospace; }
      .mp-res-row.me { background:rgba(126,200,255,0.10); border-radius:6px; }
      .mp-res-hint { margin-top:10px; font-size:11.5px; color:#8aa0b6; text-align:center; }`;
    document.head.appendChild(st);
    const el = document.createElement('div');
    el.id = 'mp-chip';
    document.body.appendChild(el);
    this._chip = el;
    this._cd = document.createElement('div');
    this._cd.id = 'mp-cd';
    document.body.appendChild(this._cd);
    this._cta = document.createElement('div');
    this._cta.id = 'mp-cta';
    document.body.appendChild(this._cta);
    this._res = document.createElement('div');
    this._res.id = 'mp-res';
    document.body.appendChild(this._res);
    this._render();
  }
  _status(msg) { if (this.hud) this.hud.flash(msg, '#ff9a66'); }
  _render() {
    const el = this._chip;
    if (!el) return;
    el.innerHTML = '';
    // room creation lives in the lobby (/mp) — in-game the chip is status-only
    el.style.display = this.room ? 'flex' : 'none';
    if (!this.room) return;
    const dot = document.createElement('span');
    dot.textContent = this.connected ? '●' : '○';
    dot.style.color = this.connected ? '#5fcf6f' : '#ff9a66';
    const label = document.createElement('b');
    label.textContent = this.room;
    const n = document.createElement('span');
    n.textContent = (this.others + (this.connected ? 1 : 0)) + '명';
    const copy = document.createElement('button');
    copy.textContent = '링크 복사';
    copy.onclick = () => {
      const link = location.origin + '/multi?room=' + this.room;   // invites land on the lobby
      navigator.clipboard?.writeText(link).then(() => { copy.textContent = '복사됨!'; setTimeout(() => copy.textContent = '링크 복사', 1200); });
    };
    const out = document.createElement('button');
    out.textContent = '나가기';
    out.onclick = () => this.leave();
    el.append(dot, label, n, copy, out);
    this._renderCta();
  }

  // READY call-to-action: big, centered, breathing — reads as "press this to race".
  // Driving works without it, but the prompt stays up until you commit.
  _renderCta() {
    const el = this._cta;
    if (!el) return;
    const total = this.others + (this.connected ? 1 : 0);
    const active = this.room && this.connected && this.others > 0 && !this._cdActive && !this.racing;
    if (!active) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = '';
    if (!this.myReady) {
      const b = document.createElement('button');
      b.className = 'big';
      b.innerHTML = `▶ READY &nbsp;${this.readySet.size}/${total}<small>전원 준비되면 레이스 시작</small>`;
      b.onclick = () => this.toggleReady();
      el.appendChild(b);
    } else {
      const w = document.createElement('div');
      w.className = 'wait';
      w.textContent = `준비 완료 · 대기 중 ${this.readySet.size}/${total}  (다시 탭하면 취소)`;
      w.style.cursor = 'pointer';
      w.onclick = () => this.toggleReady();
      el.appendChild(w);
    }
  }
}
