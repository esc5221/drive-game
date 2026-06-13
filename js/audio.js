// Procedural audio v2 — per-car profiles, layered engine synthesis,
// two-layer tire model, road roar and rhythmic curb strikes.
// Engine chain: 6-osc order bank -> waveshaper -> tracking lowpass + tone peak
//             + exhaust rasp (noise BP @ 2nd order) + intake hiss + sub thump.
import { SURF } from './track.js';

export class CarAudio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.engineReady = false;
    this.engineNode = null;
    this._engineSpec = null;
  }

  start() {
    if (this.started) return;
    this.started = true;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    // engine bus (worklet attaches here later, if available)
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;
    this.engineGain.connect(this.master);

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
    this.wind = noiseSrc('lowpass', 600, 0.5);
    this.squeal = noiseSrc('bandpass', 950, 4.0);    // lateral tire cry
    this.scrub = noiseSrc('bandpass', 420, 2.0);     // combined-slip grind
    this.roar = noiseSrc('lowpass', 280, 0.7);       // asphalt rumble
    this.grass = noiseSrc('lowpass', 220, 0.8);
    this.scrapeN = noiseSrc('highpass', 1800, 1.0);
    this.brakeRub = noiseSrc('bandpass', 1400, 1.6);  // pad-on-disc friction hiss

    // brake squeal: a high tonal cry (two detuned partials) gated by braking
    this.bsOsc1 = ctx.createOscillator(); this.bsOsc1.type = 'sawtooth'; this.bsOsc1.frequency.value = 3100;
    this.bsOsc2 = ctx.createOscillator(); this.bsOsc2.type = 'sawtooth'; this.bsOsc2.frequency.value = 3170;
    this.bsBP = ctx.createBiquadFilter(); this.bsBP.type = 'bandpass'; this.bsBP.frequency.value = 3200; this.bsBP.Q.value = 7;
    this.bsGain = ctx.createGain(); this.bsGain.gain.value = 0;
    this.bsOsc1.connect(this.bsBP); this.bsOsc2.connect(this.bsBP);
    this.bsBP.connect(this.bsGain); this.bsGain.connect(this.master);
    this.bsOsc1.start(); this.bsOsc2.start();

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

    // ---- engine: procedural firing-pulse worklet, loaded LAST and guarded.
    // AudioWorklet requires a secure context (https or localhost); on plain
    // http (e.g. a LAN IP) ctx.audioWorklet is undefined — degrade to a
    // silent engine while tires/wind/turbo keep working.
    if (ctx.audioWorklet && ctx.audioWorklet.addModule) {
      ctx.audioWorklet.addModule(new URL('./engine-processor.js', import.meta.url))
        .then(() => { this.engineReady = true; if (this._engineSpec) this._buildEngine(this._engineSpec); })
        .catch(() => { /* unsupported — engine stays silent */ });
    } else {
      console.warn('[audio] AudioWorklet unavailable (needs https or localhost) — engine muted');
    }
  }

  // (re)build the engine worklet node for a car spec's engine_model
  _buildEngine(spec) {
    if (!this.engineReady) { this._engineSpec = spec; return; }
    if (this.engineNode) {
      try { this.engineNode.port.postMessage('stop'); } catch (e) {}
      this.engineNode.disconnect();
    }
    const m = spec.engine_model || { cyl: spec.audio.cyl, level: 0.5 };
    this.engineNode = new AudioWorkletNode(this.ctx, 'engine-processor', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: m,
    });
    this.engineNode.connect(this.engineGain);
    this._engineLevel = m.level ?? 0.5;
    this._engineSpec = spec;
  }

  // called by main when the car changes
  setEngine(spec) {
    if (!this.started) { this._engineSpec = spec; return; }
    this._buildEngine(spec);
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

    // ---- engine: drive the worklet's crank params
    const thr = vehicle.ctrl.throttle;
    const rpmF = rpm / redline;
    if (this.engineNode) {
      this.engineNode.parameters.get('rpm').setTargetAtTime(rpm, t, 0.02);
      this.engineNode.parameters.get('throttle').setTargetAtTime(thr, t, 0.03);
      this.engineNode.parameters.get('redline').value = redline;
      // worklet already applies per-car level; this is just a presence trim
      this.engineGain.gain.setTargetAtTime(1.5 * (0.7 + thr * 0.25 + rpmF * 0.1), t, T);
    }
    // extra exhaust bite layered on top of the waveguide
    this.rasp.f.frequency.setTargetAtTime(Math.min(4200, rpm / 60 * P.cyl), t, T);
    this.rasp.g.gain.setTargetAtTime(P.rasp * (0.2 + thr * 0.8) * rpmF * 0.1, t, T);

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

    // ---- brakes: pad friction hiss + disc squeal (loudest at low-mid speed,
    // the way real brakes squeal as you slow to a stop)
    const brake = vehicle.ctrl.brake;
    const braking = brake > 0.12 && v > 0.6;
    this.brakeRub.g.gain.setTargetAtTime(braking ? Math.min(0.10, brake * 0.10) : 0, t, 0.04);
    this.brakeRub.f.frequency.setTargetAtTime(900 + v * 6, t, 0.08);
    // squeal: needs firm pressure, peaks ~10-40 km/h, fades at high speed & crawl
    const sp = v;
    const speedWin = Math.max(0, Math.min(1, (sp - 1.5) / 4)) * Math.max(0, 1 - sp / 22);
    let squealAmt = brake > 0.35 ? (brake - 0.35) * 1.5 * speedWin : 0;
    if (vehicle._absActive) squealAmt *= 0.4 + 0.6 * ((performance.now() * 0.02 | 0) % 2);  // ABS chops it
    this.bsGain.gain.setTargetAtTime(Math.min(0.16, squealAmt * 0.16), t, 0.03);
    const bf = 2600 + sp * 70;
    this.bsBP.frequency.setTargetAtTime(bf, t, 0.06);
    this.bsOsc1.frequency.setTargetAtTime(bf * 0.97, t, 0.06);
    this.bsOsc2.frequency.setTargetAtTime(bf * 1.02, t, 0.06);

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

    // ---- turbo character (profile-gated). Overrun pops now come from the
    // engine worklet (decelPops), so only the turbo blow-off lives here.
    if (P.turbo) {
      this.turbo.o.frequency.setTargetAtTime(1400 + rpm * 0.45, t, 0.08);
      this.turbo.g.gain.setTargetAtTime(thr * rpmF * rpmF * 0.045, t, 0.1);
      if (this._prevThr > 0.5 && thr < 0.1 && rpm > 3200) {
        this._burst('bandpass', 2600, 1.6, 0.22, 0.4);   // blow-off "psssh"
      }
    } else {
      this.turbo.g.gain.setTargetAtTime(0, t, 0.1);
    }
    this._prevThr = thr;
  }

  // one-shot enveloped noise burst (turbo blow-off)
  _burst(filterType, freq, q, gain, dur) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(); src.stop(t + dur + 0.05);
  }
}
