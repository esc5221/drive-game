// Phone tilt controller (/pad) — no three.js, standalone like the lobby.
//
// Pairing: the game creates a pad room on the mp worker and shows its code as
// a QR; this page joins the same room over WSS and the two exchange one round
// of WebRTC signaling (non-trickle, host-driven). Data then flows over an
// unreliable/unordered DataChannel — LAN-direct with iceServers:[], STUN on
// the second attempt, and if P2P never opens the room WS itself becomes the
// transport (the DO already relays binary).
//
// Packet (phone -> game, ~66 Hz, latest-wins):
//   u8 kind=2 | u16 seq | i16 steer | u8 thr | u8 brk | u8 buttons | u32 tms
// Game -> phone: u8 kind=3 | u32 tms echo (RTT), plus u8 kind=4 | u8 mag (rumble).
const HOST = localStorage.getItem('ns-mp-host') || 'https://drive-mp.esc5221.workers.dev';
const $ = id => document.getElementById(id);

const BTN = { GUP: 1, GDOWN: 2, RESET: 4, CAM: 8 };

const state = {
  ws: null, pc: null, dc: null,
  mode: 'idle',              // 'p2p' | 'relay' | 'idle'
  code: null,
  seq: 0, buttons: 0,
  steer: 0, thr: 0, brk: 0,
  tiltZero: 0, tiltRaw: 0,
  rtt: null, _lastSend: 0,
};

// ---- connect screen ----------------------------------------------------------
const qs = new URLSearchParams(location.search);
const codeIn = $('code'), goBtn = $('go'), cstat = $('cstat');
const last = localStorage.getItem('ns-pad-last');
if (last) { $('recent').style.display = 'block'; $('recent').textContent = `최근: ${last} 재연결`; }
$('recent').onclick = () => { codeIn.value = last; join(last); };
goBtn.onclick = () => { const c = codeIn.value.trim().toUpperCase(); if (c) join(c); };
codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') goBtn.onclick(); });
if (qs.get('c')) { codeIn.value = qs.get('c').toUpperCase(); join(codeIn.value); }

function cmsg(t, err) { cstat.textContent = t; cstat.className = err ? 'err' : ''; }

function join(code) {
  state.code = code;
  goBtn.disabled = true;
  cmsg('연결 중…');
  const ws = new WebSocket(`${HOST.replace(/^http/, 'ws')}/room/${code}/ws?nick=__pad`);
  ws.binaryType = 'arraybuffer';
  state.ws = ws;
  const dead = setTimeout(() => { try { ws.close(); } catch (e) {} }, 8000);
  ws.onopen = () => { clearTimeout(dead); cmsg('게임 찾는 중…'); send({ t: 'rtc', k: 'hello' }); };
  ws.onmessage = e => onWs(e.data);
  ws.onclose = () => {
    goBtn.disabled = false;
    if (state.mode === 'idle') cmsg('연결 실패 — 코드를 확인하세요', true);
    else { setStat('재연결 중…', 'err'); setTimeout(() => state.code && join(state.code), 1500); }
  };
}
function send(o) { try { state.ws.send(JSON.stringify(o)); } catch (e) {} }

// ---- signaling (phone answers whatever round the game offers) -----------------
async function onWs(data) {
  // binary over the room WS is DO-relayed = 1-byte sender-index prefix
  if (typeof data !== 'string') { onBin(new DataView(data, 1)); return; }
  let m; try { m = JSON.parse(data); } catch (e) { return; }
  if (m.t !== 'rtc') return;
  if (m.k === 'offer') {
    cmsg('P2P 연결 중…');
    if (state.pc) { try { state.pc.close(); } catch (e) {} }
    const pc = new RTCPeerConnection({ iceServers: m.stun ? [{ urls: 'stun:stun.l.google.com:19302' }] : [] });
    state.pc = pc;
    pc.ondatachannel = ev => {
      const dc = ev.channel;
      dc.onopen = () => { state.dc = dc; setMode('p2p'); };
      dc.onclose = () => { if (state.dc === dc) { state.dc = null; if (state.mode === 'p2p') setMode('idle'); } };
      dc.onmessage = e2 => onBin(new DataView(e2.data));
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    send({ t: 'rtc', k: 'answer', sdp: pc.localDescription.sdp, round: m.round });
  } else if (m.k === 'relay') {
    setMode('relay');
  } else if (m.k === 'ping') {
    send({ t: 'rtc', k: 'pong', ts: m.ts });
  }
}
function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(res => {
    const t = setTimeout(res, 2500);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); }
    });
  });
}

function setMode(mode) {
  state.mode = mode;
  if (mode === 'p2p' || mode === 'relay') {
    localStorage.setItem('ns-pad-last', state.code);
    if ($('drive').style.display !== 'block') { $('connect').style.display = 'none'; $('calib').style.display = 'flex'; }
    setStat(mode === 'p2p' ? '● P2P' : '● 릴레이', mode);
    buzz(30);
  } else setStat('연결 끊김', 'err');
}
function setStat(txt, cls) { const s = $('stat'); s.textContent = txt + (state.rtt != null ? ` ${state.rtt}ms` : ''); s.className = cls || ''; }

// ---- game -> phone binary (RTT echo + rumble) ---------------------------------
function onBin(dv) {
  if (dv.byteLength < 1) return;
  const kind = dv.getUint8(0);
  if (kind === 3 && dv.byteLength >= 5) {
    state.rtt = Math.max(0, (performance.now() | 0) - dv.getUint32(1, true)) & 0xffff;
    setStat(state.mode === 'p2p' ? '● P2P' : '● 릴레이', state.mode);
  } else if (kind === 4 && dv.byteLength >= 2) {
    buzz(dv.getUint8(1));
  }
}
function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

// ---- tilt (same mapping as the in-game tilt mode) ------------------------------
addEventListener('deviceorientation', e => {
  if (e.beta == null) return;
  const angle = (screen.orientation && screen.orientation.angle) || 0;
  let raw;
  if (angle === 90) raw = e.beta;
  else if (angle === 270 || angle === -90) raw = -e.beta;
  else raw = e.gamma || 0;
  state._lastBeta = raw;
  const delta = raw - state.tiltZero;
  const v = delta / 24;                          // full lock at ~24 deg
  const dead = 0.05;
  let s = Math.abs(v) < dead ? 0 : Math.max(-1, Math.min(1, (v - Math.sign(v) * dead) / (1 - dead)));
  s = Math.sign(s) * Math.pow(Math.abs(s), 1.4); // centre precision
  if ((s === 1 || s === -1) && Math.abs(state.tiltRaw) < 1) buzz(15);   // full-lock tick
  state.tiltRaw = s;
});
function zero() { state.tiltZero = state._lastBeta ?? 0; buzz(20); }

// ---- calibrate -> drive --------------------------------------------------------
$('start').onclick = async () => {
  try { if (DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission(); } catch (e) {}
  try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) {}
  try { screen.orientation.lock && await screen.orientation.lock('landscape'); } catch (e) {}
  try { state._lock = await navigator.wakeLock.request('screen'); } catch (e) {}
  zero();
  $('calib').style.display = 'none';
  $('drive').style.display = 'block';
};
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && !state._lock) { try { state._lock = await navigator.wakeLock.request('screen'); } catch (e) {} }
});
$('zero').onclick = zero;

// ---- pedals (analog: press + drag up = deeper) ---------------------------------
function pedal(id, set) {
  const el = $(id), fill = el.querySelector('.fill');
  const apply = t => {
    const r = el.getBoundingClientRect();
    const v = Math.max(0, Math.min(1, (r.bottom - t.clientY) / (r.height * 0.82)));
    set(v); fill.style.height = (v * 100) + '%';
  };
  el.addEventListener('touchstart', e => { e.preventDefault(); apply(e.targetTouches[0]); }, { passive: false });
  el.addEventListener('touchmove', e => { e.preventDefault(); apply(e.targetTouches[0]); }, { passive: false });
  const off = e => { e.preventDefault(); if (!e.targetTouches.length) { set(0); fill.style.height = '0%'; } };
  el.addEventListener('touchend', off); el.addEventListener('touchcancel', off);
}
pedal('throttle', v => { state.thr = v; });
pedal('brake', v => { state.brk = v; });

// ---- buttons (held bits; edge-detected game-side) -------------------------------
function bindBtn(id, bit) {
  const el = $(id);
  el.addEventListener('touchstart', e => { e.preventDefault(); state.buttons |= bit; buzz(10); }, { passive: false });
  const off = e => { e.preventDefault(); state.buttons &= ~bit; };
  el.addEventListener('touchend', off); el.addEventListener('touchcancel', off);
}
bindBtn('gup', BTN.GUP); bindBtn('gdown', BTN.GDOWN);
bindBtn('reset', BTN.RESET); bindBtn('cam', BTN.CAM);

// ---- send loop (latest state, ~66 Hz p2p / 30 Hz relay) -------------------------
const buf = new ArrayBuffer(12), dv = new DataView(buf);
function tick(now) {
  requestAnimationFrame(tick);
  const period = state.mode === 'relay' ? 33 : 15;
  if (now - state._lastSend < period) return;
  state._lastSend = now;
  if (state.mode === 'idle') return;
  $('needle').style.left = (50 + state.tiltRaw * 48) + '%';
  dv.setUint8(0, 2);
  dv.setUint16(1, state.seq++ & 0xffff, true);
  dv.setInt16(3, state.tiltRaw * 32000 | 0, true);
  dv.setUint8(5, state.thr * 255 | 0);
  dv.setUint8(6, state.brk * 255 | 0);
  dv.setUint8(7, state.buttons);
  dv.setUint32(8, performance.now() | 0, true);
  try {
    if (state.mode === 'p2p' && state.dc && state.dc.readyState === 'open') state.dc.send(buf);
    else if (state.ws && state.ws.readyState === 1) state.ws.send(buf);
  } catch (e) {}
}
requestAnimationFrame(tick);

// deadman: leaving the page zeroes the pedals on the game side via silence,
// but send an explicit zero packet too for instant response
addEventListener('pagehide', () => {
  state.thr = 0; state.brk = 0; state.tiltRaw = 0;
  dv.setUint8(0, 2); dv.setUint16(1, state.seq++ & 0xffff, true);
  dv.setInt16(3, 0, true); dv.setUint8(5, 0); dv.setUint8(6, 0); dv.setUint8(7, 0);
  try { state.dc && state.dc.readyState === 'open' && state.dc.send(buf); } catch (e) {}
  try { state.ws && state.ws.readyState === 1 && state.ws.send(buf); } catch (e) {}
});

window.__pad = state;                      // debug / test handle

// portrait warning while driving
function checkRotate() {
  const landscape = innerWidth > innerHeight;
  $('rotate').style.display = ($('drive').style.display === 'block' && !landscape) ? 'flex' : 'none';
}
addEventListener('resize', checkRotate);
setInterval(checkRotate, 800);
