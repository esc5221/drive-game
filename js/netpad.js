// NetPad — receives the phone tilt controller (see js/pad.js for the phone side).
//
// The game is the WebRTC HOST: it owns a pad room on the mp worker (created
// once, code persisted), waits for the phone's hello over the room WS, and
// drives the offer ladder — round 1 host-only candidates (pure LAN), round 2
// +STUN (NAT hairpin can cross AP isolation), and if neither DataChannel opens
// the room WS itself relays the packets. All modes feed the same parser.
//
// Injection contract (main.js): when fresh() and no keyboard driving key is
// held, main writes .steer/.throttle/.brake into the Input fields — the
// reverse-gear pedal swap and everything downstream keep working untouched.
const DEFAULT_HOST = 'https://drive-mp.esc5221.workers.dev';
const BTN = { GUP: 1, GDOWN: 2, RESET: 4, CAM: 8 };
const STALE_MS = 400;

export class NetPad {
  constructor({ hud, onShiftUp, onShiftDown, onReset, onCam } = {}) {
    this.hud = hud;
    this.onBtn = { [BTN.GUP]: onShiftUp, [BTN.GDOWN]: onShiftDown, [BTN.RESET]: onReset, [BTN.CAM]: onCam };
    this.host = localStorage.getItem('ns-mp-host') || DEFAULT_HOST;
    this.code = localStorage.getItem('ns-pad-room') || null;
    this.steer = 0; this.throttle = 0; this.brake = 0;
    this.path = null;                  // 'p2p' | 'relay' | null
    this.seqLast = -1;
    this._lastRx = 0; this._lastEcho = 0; this._btnPrev = 0;
    this._round = 0;
    this._ui();
    if (this.code) this._join(this.code);   // paired before: silently accept reconnects
  }

  fresh() { return this.path && performance.now() - this._lastRx < STALE_MS; }

  // ---- room ---------------------------------------------------------------------
  async openPair() {
    if (!this.code) {
      try {
        const r = await fetch(this.host + '/create', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ track: 'pad' }),
        });
        this.code = (await r.json()).code;
        localStorage.setItem('ns-pad-room', this.code);
        this._join(this.code);
      } catch (e) { if (this.hud) this.hud.flash('컨트롤러 서버 연결 실패', '#ff9a66'); return; }
    }
    this._showCard();
  }

  _join(code) {
    const ws = new WebSocket(`${this.host.replace(/^http/, 'ws')}/room/${code}/ws?nick=__host`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onmessage = e => this._onWs(e.data);
    ws.onclose = () => {
      this.ws = null;
      if (this.path === 'relay') this.path = null;
      setTimeout(() => this.code && this._join(this.code), 3000);
    };
    this._ka = this._ka || setInterval(() => { try { this.ws && this.ws.send('ping'); } catch (e) {} }, 25000);
  }

  _onWs(data) {
    if (typeof data !== 'string') {
      const dv = new DataView(data);
      if (dv.byteLength >= 13 && dv.getUint8(1) === 2) this._packet(dv, 1);   // relayed: index prefix
      return;
    }
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (m.t === 'rtc' && m.k === 'hello') this._offer(1);
    else if (m.t === 'rtc' && m.k === 'answer') {
      if (m.round === this._round && this.pc) {
        this.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }).catch(() => {});
      }
    }
  }

  // ---- WebRTC host ladder ---------------------------------------------------------
  async _offer(round) {
    this._round = round;
    if (this.pc) { try { this.pc.close(); } catch (e) {} }
    const stun = round >= 2;
    const pc = new RTCPeerConnection({ iceServers: stun ? [{ urls: 'stun:stun.l.google.com:19302' }] : [] });
    this.pc = pc;
    const dc = pc.createDataChannel('pad', { ordered: false, maxRetransmits: 0 });
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => { this.dc = dc; this._connected('p2p'); };
    dc.onmessage = e => this._packet(new DataView(e.data), 0);
    dc.onclose = () => { if (this.dc === dc) { this.dc = null; if (this.path === 'p2p') this.path = null; } };
    await pc.setLocalDescription(await pc.createOffer());
    await this._gathered(pc);
    try { this.ws.send(JSON.stringify({ t: 'rtc', k: 'offer', sdp: pc.localDescription.sdp, round, stun })); } catch (e) {}
    clearTimeout(this._ladderT);
    this._ladderT = setTimeout(() => {
      if (this.path === 'p2p') return;
      if (round === 1) this._offer(2);
      else {                                   // both P2P rounds failed -> WS relay
        try { this.ws.send(JSON.stringify({ t: 'rtc', k: 'relay' })); } catch (e) {}
        this._connected('relay');
      }
    }, 7000);
  }

  _gathered(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(res => {
      const t = setTimeout(res, 2500);
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); }
      });
    });
  }

  _connected(path) {
    clearTimeout(this._ladderT);
    this.path = path;
    if (this.hud) this.hud.flash(`📱 폰 컨트롤러 연결됨 (${path === 'p2p' ? 'P2P 직결' : '릴레이'})`, '#7ee0a8');
    this._cardStatus(path === 'p2p' ? '✅ 연결됨 · P2P 직결' : '✅ 연결됨 · 릴레이 경유', true);
  }

  // ---- packets ---------------------------------------------------------------------
  _packet(dv, o) {
    if (dv.getUint8(o) !== 2 || dv.byteLength < o + 12) return;
    const seq = dv.getUint16(o + 1, true);
    let d = seq - (this.seqLast & 0xffff);
    if (d < -32768) d += 65536; else if (d > 32768) d -= 65536;
    if (this.seqLast >= 0 && d <= 0) return;   // stale
    this.seqLast = this.seqLast < 0 ? seq : this.seqLast + d;
    this.steer = dv.getInt16(o + 3, true) / 32000;
    this.throttle = dv.getUint8(o + 5) / 255;
    this.brake = dv.getUint8(o + 6) / 255;
    const btn = dv.getUint8(o + 7);
    this._lastRx = performance.now();
    if (!this.path) this.path = 'relay';        // packets before any handshake state
    // rising-edge buttons
    const rise = btn & ~this._btnPrev;
    this._btnPrev = btn;
    for (const bit of [BTN.GUP, BTN.GDOWN, BTN.RESET, BTN.CAM]) {
      if ((rise & bit) && this.onBtn[bit]) this.onBtn[bit]();
    }
    // RTT echo (~4 Hz): kind=3 + the phone's timestamp back
    const now = performance.now();
    if (now - this._lastEcho > 250) {
      this._lastEcho = now;
      const out = new ArrayBuffer(5), odv = new DataView(out);
      odv.setUint8(0, 3); odv.setUint32(1, dv.getUint32(o + 8, true), true);
      try {
        if (this.dc && this.dc.readyState === 'open') this.dc.send(out);
        else if (this.ws && this.ws.readyState === 1) this.ws.send(out);
      } catch (e) {}
    }
  }

  rumble(mag) {                               // game event -> phone vibration
    if (!this.fresh()) return;
    const out = new ArrayBuffer(2), odv = new DataView(out);
    odv.setUint8(0, 4); odv.setUint8(1, Math.min(255, mag | 0));
    try {
      if (this.dc && this.dc.readyState === 'open') this.dc.send(out);
      else if (this.ws && this.ws.readyState === 1) this.ws.send(out);
    } catch (e) {}
  }

  // ---- pairing card ------------------------------------------------------------------
  _ui() {
    const st = document.createElement('style');
    st.textContent = `
      #pad-card { position:fixed; inset:0; z-index:120; display:none; align-items:center; justify-content:center;
        background:rgba(3,7,13,0.78); font-family:system-ui,sans-serif; }
      #pad-card .in { background:#0b1420; border:1px solid rgba(126,200,255,0.4); border-radius:16px;
        padding:26px 34px; text-align:center; color:#dfe4ea; }
      #pad-card h3 { margin:0 0 4px; font-size:16px; letter-spacing:2px; color:#7ec8ff; }
      #pad-card .hint { font-size:12.5px; color:#8aa0b6; margin-bottom:14px; }
      #pad-card canvas { background:#fff; border-radius:10px; padding:8px; }
      #pad-card .code { font-size:30px; font-weight:800; letter-spacing:8px; color:#ffd24a; margin:12px 0 2px; }
      #pad-card .url { font-size:12px; color:#5c6b7c; font-family:ui-monospace,monospace; }
      #pad-card .st { min-height:20px; font-size:13.5px; color:#8aa0b6; margin-top:10px; }
      #pad-card .st.ok { color:#7ee0a8; font-weight:700; }
      #pad-card button { margin-top:14px; background:rgba(126,200,255,0.15); color:#cfe8ff;
        border:1px solid rgba(126,200,255,0.4); border-radius:8px; padding:8px 22px;
        font-size:13px; cursor:pointer; font-family:inherit; }`;
    document.head.appendChild(st);
    const el = document.createElement('div');
    el.id = 'pad-card';
    el.innerHTML = `<div class="in"><h3>📱 폰 컨트롤러</h3>
      <div class="hint">폰 카메라로 QR을 스캔하세요</div>
      <canvas width="196" height="196"></canvas>
      <div class="code"></div><div class="url"></div><div class="st"></div>
      <button>닫기</button></div>`;
    el.querySelector('button').onclick = () => { el.style.display = 'none'; };
    el.addEventListener('click', e => { if (e.target === el) el.style.display = 'none'; });
    document.body.appendChild(el);
    this._card = el;
  }

  async _showCard() {
    const el = this._card;
    const url = location.origin + '/pad?c=' + this.code;
    el.querySelector('.code').textContent = this.code;
    el.querySelector('.url').textContent = url.replace(/^https?:\/\//, '');
    this._cardStatus(this.fresh() ? '✅ 연결됨' : '폰 접속 대기 중…', this.fresh());
    el.style.display = 'flex';
    try {
      const QR = (await import('qrcode')).default;
      await QR.toCanvas(el.querySelector('canvas'), url, { width: 196, margin: 1 });
    } catch (e) { /* QR lib missing — code entry still works */ }
  }

  _cardStatus(txt, ok) {
    if (!this._card) return;
    const s = this._card.querySelector('.st');
    s.textContent = txt; s.className = 'st' + (ok ? ' ok' : '');
  }
}
