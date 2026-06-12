// Procedural audio v2 — per-car profiles, layered engine synthesis,
// two-layer tire model, road roar and rhythmic curb strikes.
// Engine chain: 6-osc order bank -> waveshaper -> tracking lowpass + tone peak
//             + exhaust rasp (noise BP @ 2nd order) + intake hiss + sub thump.
import { SURF } from './track.js';

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
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    // ---- engine order bank
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) curve[i] = Math.tanh(2.4 * (i / 128 - 1));
    shaper.curve = curve;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 900; this.engFilter.Q.value = 1.1;
    this.tonePeak = ctx.createBiquadFilter();
    this.tonePeak.type = 'peaking'; this.tonePeak.frequency.value = 1200;
    this.tonePeak.Q.value = 1.0; this.tonePeak.gain.value = 5;

    this.oscs = [];
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'square' : 'sawtooth';
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(shaper);
      o.start();
      this.oscs.push({ o, g });
    }
    shaper.connect(this.engFilter);
    this.engFilter.connect(this.tonePeak);
    this.tonePeak.connect(this.engGain);
    this.engGain.connect(this.master);

    // sub thump (low-order sine, felt more than heard)
    this.sub = ctx.createOscillator(); this.sub.type = 'sine';
    this.subG = ctx.createGain(); this.subG.gain.value = 0;
    this.sub.connect(this.subG); this.subG.connect(this.master);
    this.sub.start();

    // shared noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;

    const noiseSrc = (filterType, freq, q) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q || 1;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
      return { f, g };
    };

    this.rasp = noiseSrc('bandpass', 1800, 1.2);     // exhaust texture
    this.intake = noiseSrc('bandpass', 800, 0.9);    // induction hiss
    this.wind = noiseSrc('lowpass', 600, 0.5);
    this.squeal = noiseSrc('bandpass', 950, 4.0);    // lateral tire cry
    this.scrub = noiseSrc('bandpass', 420, 2.0);     // combined-slip grind
    this.roar = noiseSrc('lowpass', 280, 0.7);       // asphalt rumble
    this.grass = noiseSrc('lowpass', 220, 0.8);
    this.scrapeN = noiseSrc('highpass', 1800, 1.0);

    // rhythmic curb strikes: square LFO amplitude-modulates a thump band
    this.curb = noiseSrc('lowpass', 240, 1.0);
    this.curbLfo = ctx.createOscillator(); this.curbLfo.type = 'square';
    this.curbLfo.frequency.value = 10;
    this.curbDepth = ctx.createGain(); this.curbDepth.gain.value = 0;
    this.curbLfo.connect(this.curbDepth);
    this.curbDepth.connect(this.curb.g.gain);        // gain = base ± depth
    this.curbLfo.start();

    // turbo whistle
    const tw = ctx.createOscillator(); tw.type = 'sine'; tw.frequency.value = 2000;
    const twG = ctx.createGain(); twG.gain.value = 0;
    tw.connect(twG); twG.connect(this.master); tw.start();
    this.turbo = { o: tw, g: twG };
    this._prevThr = 0;
    this._popCool = 0;

  }

  update(vehicle, dt) {
    if (!this.started) return;
    const P = vehicle.spec.audio;
    const rpm = isFinite(vehicle.rpm) ? vehicle.rpm : 900;
    const spd = isFinite(vehicle.speed) ? vehicle.speed : 0;
    if (!isFinite(vehicle.slipFront)) vehicle.slipFront = 0;
    if (!isFinite(vehicle.slipRear)) vehicle.slipRear = 0;
    if (!isFinite(vehicle.scrape)) vehicle.scrape = 0;
    const t = this.ctx.currentTime;
    const T = 0.06;
    const redline = vehicle.spec.engine.redline;

    // ---- engine
    const f0 = rpm / 60 * (P.cyl / 2);               // firing fundamental
    const thr = vehicle.ctrl.throttle;
    const rpmF = rpm / redline;
    for (let i = 0; i < 6; i++) {
      this.oscs[i].o.frequency.setTargetAtTime(f0 * P.orders[i], t, T);
      this.oscs[i].g.gain.setTargetAtTime(P.gains[i], t, 0.2);
    }
    this.engFilter.frequency.setTargetAtTime(
      420 + rpmF * (P.tone + 1800) + thr * 1900, t, T);
    this.tonePeak.frequency.setTargetAtTime(P.tone * (0.7 + rpmF * 0.8), t, T);
    // on/off-throttle timbre contrast
    this.engGain.gain.setTargetAtTime(0.085 + thr * 0.15 + rpmF * 0.11, t, T);

    this.rasp.f.frequency.setTargetAtTime(Math.min(4000, f0 * 2.0), t, T);
    this.rasp.g.gain.setTargetAtTime(P.rasp * (0.25 + thr * 0.75) * rpmF * 0.25, t, T);
    this.intake.f.frequency.setTargetAtTime(500 + thr * 1100, t, T);
    this.intake.g.gain.setTargetAtTime(P.intake * thr * (0.5 + rpmF * 0.5) * 0.10, t, T);
    this.sub.frequency.setTargetAtTime(Math.max(28, f0 * 0.5), t, T);
    this.subG.gain.setTargetAtTime(P.sub * thr * Math.max(0, 1 - rpmF * 1.2), t, 0.1);

    // ---- wind / speed
    const v = Math.abs(spd);
    this.wind.g.gain.setTargetAtTime(Math.min(0.5, Math.pow(v / 65, 2.6) * 0.5), t, 0.12);
    this.wind.f.frequency.setTargetAtTime(400 + v * 14, t, 0.12);

    // ---- tires: split lateral squeal vs combined scrub
    const onRoad = vehicle.onTrack;
    let latSlip = 0, longSlip = 0, onCurb = false;
    for (const w of vehicle.wheels) {
      if (!w.contact) continue;
      latSlip = Math.max(latSlip, Math.abs(Math.sin(w.slipAngle)));
      longSlip = Math.max(longSlip, Math.abs(w.slipRatio));
      if (w.surf === SURF.CURB) onCurb = true;
    }
    const vF = Math.min(1, v / 7);
    const sq = onRoad ? Math.max(0, latSlip - 0.12) * 2.2 : 0;
    this.squeal.g.gain.setTargetAtTime(Math.min(0.30, sq * 0.30) * vF, t, 0.05);
    this.squeal.f.frequency.setTargetAtTime(750 + latSlip * 900 + v * 2, t, 0.08);
    const sc = onRoad ? Math.max(0, longSlip - 0.12) * 1.6 : 0;
    this.scrub.g.gain.setTargetAtTime(Math.min(0.25, sc * 0.25) * vF, t, 0.05);

    // asphalt roar (subtle, grows with speed)
    this.roar.g.gain.setTargetAtTime(onRoad ? Math.min(0.10, v * 0.0011) : 0, t, 0.15);
    this.roar.f.frequency.setTargetAtTime(180 + v * 2.2, t, 0.15);

    // rhythmic curb: strike rate = speed / 2m stripe pitch
    if (onCurb && v > 3) {
      this.curbLfo.frequency.setTargetAtTime(Math.max(4, v / 2), t, 0.05);
      const amp = Math.min(0.22, 0.08 + v * 0.0015);
      this.curb.g.gain.setTargetAtTime(amp, t, 0.03);
      this.curbDepth.gain.setTargetAtTime(amp, t, 0.03);
    } else {
      this.curb.g.gain.setTargetAtTime(0, t, 0.05);
      this.curbDepth.gain.setTargetAtTime(0, t, 0.05);
    }

    this.grass.g.gain.setTargetAtTime(!onRoad && v > 2 ? Math.min(0.4, v / 40 + 0.12) : 0, t, 0.08);
    this.scrapeN.g.gain.setTargetAtTime(vehicle.scrape > 0.05 ? Math.min(0.5, vehicle.scrape * 0.5) : 0, t, 0.03);

    // ---- turbo character (profile-gated)
    if (P.turbo) {
      this.turbo.o.frequency.setTargetAtTime(1400 + rpm * 0.45, t, 0.08);
      this.turbo.g.gain.setTargetAtTime(thr * rpmF * rpmF * 0.045, t, 0.1);
      if (this._prevThr > 0.5 && thr < 0.1 && rpm > 3200) {
        this._burst('bandpass', 2600, 1.6, 0.22, 0.4);
      }
    } else {
      this.turbo.g.gain.setTargetAtTime(0, t, 0.1);
    }
    // overrun pops/crackle
    this._popCool -= dt;
    if (thr < 0.05 && rpmF > 0.45 && this._popCool <= 0 && Math.random() < dt * 6 * P.pops) {
      this._burst('lowpass', 380, 1.0, 0.30 * P.pops + 0.1, 0.06 + Math.random() * 0.05);
      this._popCool = 0.09;
    }
    this._prevThr = thr;
  }
}
