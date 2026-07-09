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
  return {
    seq: dv.getUint16(o + 1, true),
    pos: new THREE.Vector3(dv.getFloat32(o + 3, true), dv.getFloat32(o + 7, true), dv.getFloat32(o + 11, true)),
    vel: new THREE.Vector3(dv.getInt16(o + 15, true) / 100, dv.getInt16(o + 17, true) / 100, dv.getInt16(o + 19, true) / 100),
    quat: new THREE.Quaternion(dv.getInt16(o + 21, true) / 32700, dv.getInt16(o + 23, true) / 32700,
      dv.getInt16(o + 25, true) / 32700, dv.getInt16(o + 27, true) / 32700).normalize(),
  };
}

// ---- remote player: jitter buffer + hermite playback ------------------------
const _p0 = new THREE.Vector3(), _q0 = new THREE.Quaternion();
class RemotePlayer {
  constructor(scene, idx, nick) {
    this.idx = idx; this.nick = nick;
    this.car = new RemoteCar(scene, idx, nick);
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
    this.buf.push({ t, pos: s.pos, vel: s.vel, quat: s.quat });
    if (this.buf.length > 24) this.buf.shift();
    this.lastRx = performance.now();
  }
  update() {
    const b = this.buf;
    if (!b.length || this.off == null) return;
    if (performance.now() - this.lastRx > 10000) { this.car.hide(); return; }
    const playT = performance.now() / 1000 - this.off - DELAY;
    let i = b.length - 1;
    while (i > 0 && b[i].t > playT) i--;
    const a = b[i], c = b[Math.min(i + 1, b.length - 1)];
    if (a === c || playT >= c.t) {       // beyond newest -> extrapolate (dead reckoning)
      const last = b[b.length - 1];
      const dt = Math.min(EXTRAP_MAX, Math.max(0, playT - last.t));
      _p0.copy(last.pos).addScaledVector(last.vel, dt);
      this.car.fade(playT - last.t > EXTRAP_MAX ? Math.max(0, 1 - (playT - last.t - EXTRAP_MAX) / 0.5) : 1);
      this.car.set(_p0, last.quat);
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
  }
  dispose() { this.car.dispose(); }
}

// ---- client ------------------------------------------------------------------
export class MPClient {
  constructor({ scene, trackId, randomSeed, carId, hud }) {
    this.scene = scene; this.trackId = trackId; this.randomSeed = randomSeed >>> 0;
    this.carId = carId; this.hud = hud;
    this.host = localStorage.getItem('ns-mp-host') || DEFAULT_HOST;
    this.ws = null; this.room = null; this.you = 0;
    this.players = new Map();            // idx -> RemotePlayer
    this.seq = 0; this._acc = 0; this._ka = 0;
    this._retries = 0;
    this._buf = new ArrayBuffer(32);
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
        sessionStorage.setItem('ns-go', '1');
        location.reload();
        return;
      }
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
        for (const p of m.roster) if (p.i !== this.you) this._add(p);
        this._render();
      } else if (m.t === 'join') {
        this._add(m.p);
        if (this.hud) this.hud.flash(m.p.nick + ' 입장', '#7ec8ff');
        this._render();
      } else if (m.t === 'leave') {
        const p = this.players.get(m.i);
        if (p) { if (this.hud) this.hud.flash(p.nick + ' 퇴장', '#8aa0b6'); p.dispose(); this.players.delete(m.i); }
        this._render();
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
    this.players.set(p.i, new RemotePlayer(this.scene, p.i, p.nick));
  }

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
      body.ns-view #mp-chip { display:none; }`;
    document.head.appendChild(st);
    const el = document.createElement('div');
    el.id = 'mp-chip';
    document.body.appendChild(el);
    this._chip = el;
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
  }
}
