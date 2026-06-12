// Procedural audio: engine (saw stack -> waveshaper -> lowpass),
// wind, tire screech, grass rumble, rail scrape. All WebAudio, no samples.
export class CarAudio {
  constructor() {
    this.ctx = null;
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    // ---- engine
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0.0;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = i / 128 - 1;
      curve[i] = Math.tanh(2.2 * x);
    }
    shaper.curve = curve;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 900; this.engFilter.Q.value = 1.2;
    this.oscs = [];
    const make = (type, mult, gain) => {
      const o = ctx.createOscillator(); o.type = type;
      const g = ctx.createGain(); g.gain.value = gain;
      o.connect(g); g.connect(shaper);
      o.start();
      this.oscs.push({ o, mult });
    };
    make('sawtooth', 1.0, 0.5);     // firing fundamental
    make('sawtooth', 0.5, 0.35);    // crank order
    make('square', 2.0, 0.10);      // harmonics
    make('sawtooth', 1.02, 0.25);   // detune beat
    shaper.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);

    // shared noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const noiseSrc = (filterType, freq, q) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q || 1;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
      return { f, g };
    };

    this.wind = noiseSrc('lowpass', 600, 0.5);
    this.screech = noiseSrc('bandpass', 950, 3.5);
    this.grass = noiseSrc('lowpass', 220, 0.8);
    this.scrape = noiseSrc('highpass', 1800, 1.0);
    this._noiseBuf = buf;

    // turbo whistle (spools with rpm x throttle)
    const tw = ctx.createOscillator(); tw.type = 'sine'; tw.frequency.value = 2000;
    const twG = ctx.createGain(); twG.gain.value = 0;
    tw.connect(twG); twG.connect(this.master); tw.start();
    this.turbo = { o: tw, g: twG };
    this._prevThr = 0;
    this._popCool = 0;
  }

  // short one-shot noise burst (blow-off psssh / exhaust pop)
  _burst(filterType, freq, q, gain, dur) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(); src.stop(t + dur + 0.05);
  }

  update(vehicle, dt) {
    if (!this.started) return;
    // sanitize: one NaN frame from physics must never kill the audio graph
    const rpm = isFinite(vehicle.rpm) ? vehicle.rpm : 900;
    const spd = isFinite(vehicle.speed) ? vehicle.speed : 0;
    if (!isFinite(vehicle.slipFront)) vehicle.slipFront = 0;
    if (!isFinite(vehicle.slipRear)) vehicle.slipRear = 0;
    if (!isFinite(vehicle.scrape)) vehicle.scrape = 0;
    const t = this.ctx.currentTime;
    const T = 0.06;

    // engine: 2 firing pulses per rev (4-cyl 4-stroke)
    const f0 = rpm / 60 * 2;
    for (const { o, mult } of this.oscs) o.frequency.setTargetAtTime(f0 * mult, t, T);
    const thr = vehicle.ctrl.throttle;
    const rpmF = rpm / 6900;
    this.engFilter.frequency.setTargetAtTime(500 + rpmF * 2600 + thr * 1800, t, T);
    this.engGain.gain.setTargetAtTime(0.10 + thr * 0.16 + rpmF * 0.10, t, T);

    const v = Math.abs(spd);
    this.wind.g.gain.setTargetAtTime(Math.min(0.5, Math.pow(v / 65, 2.6) * 0.5), t, 0.12);
    this.wind.f.frequency.setTargetAtTime(400 + v * 14, t, 0.12);

    const slip = Math.max(vehicle.slipFront, vehicle.slipRear);
    const onRoad = vehicle.onTrack;
    const sk = onRoad ? Math.max(0, slip - 0.5) * 1.8 : 0;
    this.screech.g.gain.setTargetAtTime(Math.min(0.30, sk * 0.3) * Math.min(1, v / 6), t, 0.05);
    this.screech.f.frequency.setTargetAtTime(800 + slip * 500, t, 0.08);

    this.grass.g.gain.setTargetAtTime(!onRoad && v > 2 ? Math.min(0.4, v / 40 + 0.12) : 0, t, 0.08);
    this.scrape.g.gain.setTargetAtTime(vehicle.scrape > 0.05 ? Math.min(0.5, vehicle.scrape * 0.5) : 0, t, 0.03);

    // ---- turbo character
    this.turbo.o.frequency.setTargetAtTime(1400 + rpm * 0.45, t, 0.08);
    this.turbo.g.gain.setTargetAtTime(thr * rpmF * rpmF * 0.045, t, 0.1);
    // blow-off on sharp lift at boost
    if (this._prevThr > 0.5 && thr < 0.1 && rpm > 3200) {
      this._burst('bandpass', 2600, 1.6, 0.22, 0.4);
    }
    // exhaust pops on overrun
    this._popCool -= dt;
    if (thr < 0.05 && rpm > 3400 && this._popCool <= 0 && Math.random() < dt * 5) {
      this._burst('lowpass', 350, 1.0, 0.35, 0.07);
      this._popCool = 0.12;
    }
    this._prevThr = thr;
  }
}
