// Touch controls: tilt (gyro) or on-screen button steering, pedal pads,
// action buttons mapped to the same key codes the keyboard uses.
// Interface-compatible with Input (steer/throttle/brake/handbrake/update/onKey).

export function isTouchDevice() {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

function step(cur, target, rate, dt) {
  const d = target - cur, m = rate * dt;
  return Math.abs(d) <= m ? target : cur + Math.sign(d) * m;
}

const BTN = (id, label, cls) => {
  const b = document.createElement('div');
  b.id = id;
  b.className = 'tbtn ' + (cls || '');
  b.textContent = label;
  return b;
};

export class TouchInput {
  constructor() {
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.onKey = null;
    this.anyInput = false;

    this.mode = localStorage.getItem('ns-ctrl') || 'buttons';   // 'buttons' | 'tilt'
    this._tiltRaw = 0;
    this._tiltZero = 0;
    this._lastBeta = 0;
    this._state = { left: false, right: false, gas: false, brake: false, hb: false };

    this._buildUI();
    this._listenTilt();
  }

  _buildUI() {
    const root = document.createElement('div');
    root.id = 'touch-ui';

    // steering pads (hidden in tilt mode)
    this.leftBtn = BTN('t-left', '◀', 'steer');
    this.rightBtn = BTN('t-right', '▶', 'steer');
    // pedals
    this.gasBtn = BTN('t-gas', 'GAS', 'pedal gas');
    this.brakeBtn = BTN('t-brake', 'BRK', 'pedal brake');
    this.hbBtn = BTN('t-hb', 'HB', 'small');

    root.append(this.leftBtn, this.rightBtn, this.gasBtn, this.brakeBtn, this.hbBtn);

    // minimal in-game bar: pause/settings + reset only (rest lives in settings)
    const bar = document.createElement('div');
    bar.id = 't-actions';
    for (const [label, code] of [['⏸', 'KeyP'], ['복구', 'KeyR']]) {
      const b = BTN('t-' + code, label, 'small');
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (this.onKey) this.onKey(code);
      });
      bar.appendChild(b);
    }
    root.appendChild(bar);
    document.body.appendChild(root);

    const hold = (el, key) => {
      const set = (v) => (e) => {
        e.preventDefault();
        this._state[key] = v;
        this.anyInput = true;
      };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointercancel', set(false));
      el.addEventListener('pointerleave', set(false));
    };
    hold(this.leftBtn, 'left');
    hold(this.rightBtn, 'right');
    hold(this.gasBtn, 'gas');
    hold(this.brakeBtn, 'brake');
    hold(this.hbBtn, 'hb');

    this.setMode(this.mode, true);
  }

  setMode(mode, silent) {
    this.mode = mode;
    localStorage.setItem('ns-ctrl', mode);
    const tilt = mode === 'tilt';
    this.leftBtn.style.display = tilt ? 'none' : 'flex';
    this.rightBtn.style.display = tilt ? 'none' : 'flex';
    if (tilt) this._tiltZero = this._lastBeta;     // recenter on enable
  }

  _listenTilt() {
    addEventListener('deviceorientation', e => {
      if (e.beta == null) return;
      // landscape: rolling the phone like a wheel = beta (sign flips with side)
      const angle = (screen.orientation && screen.orientation.angle) || 0;
      let raw;
      if (angle === 90) raw = e.beta;
      else if (angle === 270 || angle === -90) raw = -e.beta;
      else raw = e.gamma || 0;                     // portrait fallback
      this._lastBeta = raw;
      const v = (raw - this._tiltZero) / 22;       // full lock at ~22 deg
      const dead = 0.06;
      this._tiltRaw = Math.abs(v) < dead ? 0 :
        Math.max(-1, Math.min(1, v - Math.sign(v) * dead));
    });
  }

  // iOS 13+ motion permission — must be called from a user gesture
  static async requestMotionPermission() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        await DeviceOrientationEvent.requestPermission();
      }
    } catch (e) { /* denied — button mode still works */ }
  }

  update(dt, vehicle) {
    // steering: same feel as keyboard (speed-aware attack, slip-aware gain)
    const assist = 1 - Math.min(0.45, vehicle.slipRear * 0.55);
    let target;
    if (this.mode === 'tilt') {
      target = this._tiltRaw * assist;
      // tilt is already analog — track it quickly
      this.steer = step(this.steer, target, 6.5, dt);
    } else {
      target = ((this._state.right ? 1 : 0) - (this._state.left ? 1 : 0)) * assist;
      const v = Math.abs(vehicle.speed);
      const attack = 3.4 / (1 + v * 0.022);
      const rate = Math.abs(target) > Math.abs(this.steer) ? attack : 5.5;
      this.steer = step(this.steer, target, rate, dt);
      if (Math.abs(this.steer) < 0.001 && target === 0) this.steer = 0;
    }

    this.throttle = step(this.throttle, this._state.gas ? 1 : 0, this._state.gas ? 3.5 : 8, dt);
    this.brake = step(this.brake, this._state.brake ? 1 : 0, this._state.brake ? 5.5 : 10, dt);
    this.handbrake = this._state.hb;
  }
}

// fullscreen + orientation + audio unlock gate, shown once on touch devices
export function showStartOverlay(onStart) {
  const ov = document.createElement('div');
  ov.id = 'tap-start';
  ov.innerHTML = '<div><h2>NÜRBURGRING NORDSCHLEIFE</h2><p>탭하여 시작</p></div>';
  document.body.appendChild(ov);
  ov.addEventListener('pointerdown', async () => {
    try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) {}
    try { await screen.orientation.lock('landscape'); } catch (e) {}
    await TouchInput.requestMotionPermission();
    ov.remove();
    onStart();
  }, { once: true });
}
