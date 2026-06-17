// Procedural audio v3 — per-car layered synthesis. Every sound is a named
// layer (see audio-config.js) gated through this._g(key, value), so any layer
// can be toggled / trimmed live (window.__audio.setLayer / .setGain) and the
// choice persists. Engine is a waveguide worklet; everything else is synthesized
// here (tires, brakes, road, wind, shift, rev-limiter, jolts, lockup, seams).
import { SURF } from './track.js';
import { loadAudioCfg, saveAudioCfg, AUDIO_LAYER_DEFS } from './audio-config.js';

export class CarAudio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.engineReady = false;
    this.engineNode = null;
    this._engineSpec = null;
    this.cfg = loadAudioCfg();
    // per-frame state for event-driven layers
    this._prevGear = null; this._prevAir = false;
    this._lastSeam = null; this._gearbox = 'manual';
  }

  // layer gate: returns 0 when the layer is off, else value * its trim gain.
  _g(key, v) { const c = this.cfg[key]; return c && c.on ? v * c.gain : 0; }

  // runtime layer control (exposed via window.__audio)
  setLayer(key, on) { if (this.cfg[key]) { this.cfg[key].on = !!on; saveAudioCfg(this.cfg); } }
  setGain(key, g)  { if (this.cfg[key]) { this.cfg[key].gain = +g; saveAudioCfg(this.cfg); } }
  layerStates() { return this.cfg; }
  layerDefs() { return AUDIO_LAYER_DEFS; }

  start() {
    if (this.started) return;
    this.started = true;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.master = ctx.createGain();
    this.masterTarget = 0.5;
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);
    this._active = true;
    this._suspendTimer = null;

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
    this.rain = noiseSrc('highpass', 1100, 0.3);      // rain hiss (weather)
    this.rainLow = noiseSrc('bandpass', 420, 0.6);    // heavier drumming layer
    this.lockup = noiseSrc('bandpass', 480, 2.4);     // longitudinal lock skid
    this._rainOn = false;

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

    // rev-limiter stutter: a buzzy band chopped by a fast square LFO, gated on
    // when the engine bounces off the limiter (worklet cuts fuel → this fills it)
    this.limN = noiseSrc('bandpass', 1300, 1.4);
    this.limLfo = ctx.createOscillator(); this.limLfo.type = 'square';
    this.limLfo.frequency.value = 38;                // flutter rate
    this.limDepth = ctx.createGain(); this.limDepth.gain.value = 0;
    this.limLfo.connect(this.limDepth);
    this.limDepth.connect(this.limN.g.gain);
    this.limLfo.start();

    // turbo whistle
    const tw = ctx.createOscillator(); tw.type = 'sine'; tw.frequency.value = 2000;
    const twG = ctx.createGain(); twG.gain.value = 0;
    tw.connect(twG); twG.connect(this.master); tw.start();
    this.turbo = { o: tw, g: twG };
    this._prevThr = 0;
    this._popCool = 0;

    // ---- engine worklet, loaded LAST and guarded (needs secure context).
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
    this._gearbox = (spec.audio && spec.audio.gearbox) || 'manual';
  }

  setActive(on) {
    if (!this.started) return;
    this._active = on;
    if (this._suspendTimer) { clearTimeout(this._suspendTimer); this._suspendTimer = null; }
    if (on) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.master.gain.setTargetAtTime(this.masterTarget, this.ctx.currentTime, 0.03);
    } else {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
      this._suspendTimer = setTimeout(() => {
        if (!this._active && this.ctx.state === 'running') this.ctx.suspend();
      }, 160);
    }
  }

  setEngine(spec) {
    if (!this.started) { this._engineSpec = spec; this._gearbox = (spec.audio && spec.audio.gearbox) || 'manual'; return; }
    this._buildEngine(spec);
  }

  setRain(on) {
    this._rainOn = on;
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.rain.g.gain.setTargetAtTime(this._g('rain', on ? 0.06 : 0), t, 0.8);
    this.rainLow.g.gain.setTargetAtTime(this._g('rain', on ? 0.022 : 0), t, 0.8);
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
      this.engineGain.gain.setTargetAtTime(this._g('engine', 1.5 * (0.7 + thr * 0.25 + rpmF * 0.1)), t, T);
    }
    // extra exhaust bite layered on top of the waveguide
    this.rasp.f.frequency.setTargetAtTime(Math.min(4200, rpm / 60 * P.cyl), t, T);
    this.rasp.g.gain.setTargetAtTime(this._g('exhaust', P.rasp * (0.2 + thr * 0.8) * rpmF * 0.1), t, T);

    // ---- rev limiter: fires when revs bounce off the cut line under power
    const atLimit = rpm >= redline - 70 && thr > 0.55;
    const limAmt = atLimit ? 0.085 : 0;
    this.limN.g.gain.setTargetAtTime(this._g('limiter', limAmt), t, 0.008);
    this.limDepth.gain.setTargetAtTime(this._g('limiter', limAmt), t, 0.008);
    this.limN.f.frequency.setTargetAtTime(900 + P.cyl * rpm / 60 * 0.5, t, 0.05);

    // ---- gear shift: detect a gear change and fire a one-shot per gearbox type
    const gear = vehicle.gear;
    if (this._prevGear != null && gear !== this._prevGear && gear >= 1 && this._prevGear >= 1) {
      this._triggerShift(gear > this._prevGear, rpmF);
    }
    this._prevGear = gear;

    // ---- landing slam: physics' landImpact spikes the frame we touch down
    // (after >0.25s airborne) then decays at ~2.2/s. Fire one thump+thud on the
    // touchdown edge, scaled by impact. (suspActivity is unusable here — it's
    // smoothed and includes accel/brake squat, not just road roughness.)
    const imp = isFinite(vehicle.landImpact) ? vehicle.landImpact : 0;
    if (this._prevAir && !vehicle.airborne && imp > 0.06) {
      this._thump(62, this._g('landing', 0.6 * imp), 0.22);
      this._burst('lowpass', 300, 0.8, this._g('landing', 0.32 * imp), 0.13);
    }
    this._prevAir = vehicle.airborne;

    // ---- wind / speed
    const v = Math.abs(spd);
    this.wind.g.gain.setTargetAtTime(this._g('wind', Math.min(0.5, Math.pow(v / 65, 2.6) * 0.5)), t, 0.12);
    this.wind.f.frequency.setTargetAtTime(400 + v * 14, t, 0.12);

    // ---- tires: split lateral squeal vs combined scrub vs longitudinal lockup
    const onRoad = vehicle.onTrack;
    let latSlip = 0, longSlip = 0, onCurb = false, lock = 0;
    for (const w of vehicle.wheels) {
      if (!w.contact) continue;
      latSlip = Math.max(latSlip, Math.abs(Math.sin(w.slipAngle)));
      longSlip = Math.max(longSlip, Math.abs(w.slipRatio));
      if (w.slipRatio < -0.18) lock = Math.max(lock, -w.slipRatio);   // wheel locking up
      if (w.surf === SURF.CURB) onCurb = true;
    }
    const vF = Math.min(1, v / 7);
    const sq = onRoad ? Math.max(0, latSlip - 0.12) * 2.2 : 0;
    this.squeal.g.gain.setTargetAtTime(this._g('tireSqueal', Math.min(0.30, sq * 0.30) * vF), t, 0.05);
    this.squeal.f.frequency.setTargetAtTime(750 + latSlip * 900 + v * 2, t, 0.08);
    const sc = onRoad ? Math.max(0, longSlip - 0.12) * 1.6 : 0;
    this.scrub.g.gain.setTargetAtTime(this._g('tireScrub', Math.min(0.25, sc * 0.25) * vF), t, 0.05);
    // lockup: hard braking, ABS not catching, wheel sliding (distinct lower cry)
    const braking = vehicle.ctrl.brake > 0.4 && v > 2;
    const lockAmt = (braking && !vehicle._absActive) ? Math.min(1, (lock - 0.18) * 2.2) : 0;
    this.lockup.g.gain.setTargetAtTime(this._g('lockup', Math.min(0.22, lockAmt * 0.22) * Math.min(1, v / 5)), t, 0.04);
    this.lockup.f.frequency.setTargetAtTime(430 + v * 4, t, 0.1);

    // asphalt roar (subtle, grows with speed)
    this.roar.g.gain.setTargetAtTime(this._g('roar', onRoad ? Math.min(0.10, v * 0.0011) : 0), t, 0.15);
    this.roar.f.frequency.setTargetAtTime(180 + v * 2.2, t, 0.15);

    // road seams: periodic expansion-joint thuds, distance-paced, on tarmac only
    if (onRoad && v > 12 && vehicle.surf !== SURF.GRASS) {
      const s = vehicle.trackS || 0;
      if (this._lastSeam == null) this._lastSeam = s;
      if (Math.abs(s - this._lastSeam) >= 19) {
        this._lastSeam = s;
        this._burst('lowpass', 230, 0.9, this._g('seams', Math.min(0.10, 0.03 + v * 0.0006)), 0.05);
      }
    }

    // ---- brakes: pad friction hiss + disc squeal
    const brake = vehicle.ctrl.brake;
    const brakingHiss = brake > 0.12 && v > 0.6;
    this.brakeRub.g.gain.setTargetAtTime(this._g('brakeRub', brakingHiss ? Math.min(0.10, brake * 0.10) : 0), t, 0.04);
    this.brakeRub.f.frequency.setTargetAtTime(900 + v * 6, t, 0.08);
    const sp = v;
    const speedWin = Math.max(0, Math.min(1, (sp - 1.5) / 4)) * Math.max(0, 1 - sp / 22);
    let squealAmt = brake > 0.35 ? (brake - 0.35) * 1.5 * speedWin : 0;
    if (vehicle._absActive) squealAmt *= 0.4 + 0.6 * ((performance.now() * 0.02 | 0) % 2);  // ABS chops it
    this.bsGain.gain.setTargetAtTime(this._g('brakeSqueal', Math.min(0.16, squealAmt * 0.16)), t, 0.03);
    const bf = 2600 + sp * 70;
    this.bsBP.frequency.setTargetAtTime(bf, t, 0.06);
    this.bsOsc1.frequency.setTargetAtTime(bf * 0.97, t, 0.06);
    this.bsOsc2.frequency.setTargetAtTime(bf * 1.02, t, 0.06);

    // rhythmic curb: strike rate = speed / 2m stripe pitch
    if (onCurb && v > 3) {
      this.curbLfo.frequency.setTargetAtTime(Math.max(4, v / 2), t, 0.05);
      const amp = this._g('curb', Math.min(0.22, 0.08 + v * 0.0015));
      this.curb.g.gain.setTargetAtTime(amp, t, 0.03);
      this.curbDepth.gain.setTargetAtTime(amp, t, 0.03);
    } else {
      this.curb.g.gain.setTargetAtTime(0, t, 0.05);
      this.curbDepth.gain.setTargetAtTime(0, t, 0.05);
    }

    this.grass.g.gain.setTargetAtTime(this._g('grass', !onRoad && v > 2 ? Math.min(0.4, v / 40 + 0.12) : 0), t, 0.08);
    this.scrapeN.g.gain.setTargetAtTime(this._g('scrape', vehicle.scrape > 0.05 ? Math.min(0.5, vehicle.scrape * 0.5) : 0), t, 0.03);

    // ---- turbo character (profile-gated)
    if (P.turbo) {
      this.turbo.o.frequency.setTargetAtTime(1400 + rpm * 0.45, t, 0.08);
      this.turbo.g.gain.setTargetAtTime(this._g('turbo', thr * rpmF * rpmF * 0.045), t, 0.1);
      if (this._prevThr > 0.5 && thr < 0.1 && rpm > 3200) {
        this._burst('bandpass', 2600, 1.6, this._g('turbo', 0.22), 0.4);   // blow-off "psssh"
      }
    } else {
      this.turbo.g.gain.setTargetAtTime(0, t, 0.1);
    }
    this._prevThr = thr;
  }

  // gearbox-flavored shift one-shot. up = upshift (ign-cut pop), else rev-match.
  _triggerShift(up, rpmF) {
    const gb = this._gearbox;
    // mechanical engagement click — crisp & quiet for PDK/DCT, hard & metallic
    // for a sequential dog box, a soft chain clack for a kart.
    const P = { pdk:  { click: 0.16, cf: 3600, cq: 1.2, cd: 0.035, pop: 0.13, braap: 0.20 },
                dct:  { click: 0.14, cf: 3200, cq: 1.0, cd: 0.040, pop: 0.10, braap: 0.17 },
                sequential: { click: 0.30, cf: 2700, cq: 0.9, cd: 0.050, pop: 0.16, braap: 0.24 },
                direct: { click: 0.05, cf: 4200, cq: 1.4, cd: 0.025, pop: 0.0, braap: 0.0 },
                manual: { click: 0.10, cf: 3000, cq: 1.0, cd: 0.045, pop: 0.06, braap: 0.12 } }[gb]
              || { click: 0.10, cf: 3000, cq: 1.0, cd: 0.045, pop: 0.06, braap: 0.12 };
    const w = 0.5 + 0.5 * rpmF;                       // louder near the top end
    this._burst('bandpass', P.cf, P.cq, this._g('shift', P.click * w), P.cd);
    if (up && P.pop > 0) {
      // ignition-cut exhaust pop on the upshift
      this._burst('bandpass', 600, 1.4, this._g('shift', P.pop * w), 0.07);
    } else if (!up && P.braap > 0) {
      // downshift rev-match "braap": short boosted exhaust burst + a pop
      this._burst('bandpass', 720, 1.2, this._g('shift', P.braap * w), 0.13);
      this._burst('lowpass', 380, 0.8, this._g('shift', P.braap * 0.6 * w), 0.10);
    }
  }

  // one-shot enveloped noise burst
  _burst(filterType, freq, q, gain, dur) {
    if (gain <= 0.0005) return;
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

  // one-shot decaying tone (chassis thump on landing/bump)
  _thump(freq, gain, dur) {
    if (gain <= 0.0005) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.5), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(t + dur + 0.05);
  }
}
