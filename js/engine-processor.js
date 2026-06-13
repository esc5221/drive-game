// Procedural engine AudioWorklet: a crank-angle firing-pulse model fed through
// an exhaust waveguide. This is the heart of the engine sound — discrete
// combustion impulses (not steady oscillators) give the "thump-thump" of a
// real motor; the feedback delay line gives the exhaust pipe its tone/rasp.
//
// Per-sample DSP at the audio rate. Config (cylinders, firing angles, pipe
// length...) comes via processorOptions; rpm/throttle drive it via AudioParams.

const C_SOUND = 343;            // m/s, for pipe-length -> delay conversion

class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 900, minValue: 0, maxValue: 12000, automationRate: 'k-rate' },
      { name: 'throttle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'redline', defaultValue: 7000, minValue: 1000, maxValue: 12000, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.cyl = o.cyl || 4;
    // even firing angles across the 720-degree 4-stroke cycle unless given
    this.fireAngles = o.fireAngles || Array.from({ length: this.cyl }, (_, i) => (720 / this.cyl) * i);
    this.combDecay = o.combDecay || 0.0016;        // combustion pulse decay (s)
    this.combNoise = o.combNoise ?? 0.5;           // burn roughness
    this.intakeGain = o.intakeGain ?? 0.5;
    this.mechGain = o.mechGain ?? 0.25;            // valvetrain zing
    this.idleLope = o.idleLope ?? 0.04;            // per-cylinder variance
    this.exhaustGain = o.exhaustGain ?? 1.0;
    this.bright = o.bright ?? 1.0;                  // brightness scaler
    this.body = o.body ?? 0.5;                      // single resonant body peak
    this.bodyHz = o.bodyHz ?? 220;
    // output shaping state
    this.lp = 0;                                    // brightness 1-pole LP
    this.dc = 0;                                    // DC blocker
    this.dcPrev = 0;
    this.bLow = 0; this.bBand = 0;                  // one body resonance (low mix)
    // light diffusion allpass for "air" (no strong pitch)
    this.apLen = Math.max(8, (o.apLen || 0.011) * sampleRate | 0);
    this.ap = new Float32Array(this.apLen); this.apI = 0; this.apFb = 0.28;

    // crank state
    this.cycleAngle = 0;                           // 0..720 crank degrees

    // combustion excitation envelopes (retriggered per firing)
    this.combEnv = 0;
    this.combNoiseEnv = 0;
    this.popEnv = 0;                               // backfire/overrun crackle

    // intake resonant bandpass (state-variable) on noise
    this.svLow = 0; this.svBand = 0;

    // per-cylinder gain variance (deterministic)
    let s = 123457;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    this.cylGain = this.fireAngles.map(() => 1 + (rnd() - 0.5) * this.idleLope * 4);
    this.cylPhase = this.fireAngles.map(() => (rnd() - 0.5) * this.idleLope * 6);

    this._rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    this.alive = true;
    this._dbg = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.alive = false;
      else if (e.data === 'dbg') this.port.postMessage({ rpm: this._lastRpm, fires: this._fires });
    };
    this._lastRpm = 0; this._fires = 0;
  }

  process(_inputs, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0][0];
    if (!out) return true;
    const n = out.length;
    const sr = sampleRate;

    const rpm = params.rpm[0];
    const thr = params.throttle[0];
    const redline = params.redline[0];
    this._lastRpm = rpm;
    const degPerSample = (rpm / 60) * 360 / sr;    // crank deg advanced per sample
    const combDecayK = Math.exp(-1 / (this.combDecay * sr));
    const rpmF = Math.min(rpm / redline, 1.1);

    // fuel cut near the limiter: probability the next firing is skipped
    const cut = rpm > redline - 120 ? 0.5 : 0;

    for (let i = 0; i < n; i++) {
      const prev = this.cycleAngle;
      let a = prev + degPerSample;
      if (a >= 720) a -= 720;
      this.cycleAngle = a;

      // detect crossing of each cylinder's firing angle within this step
      for (let c = 0; c < this.cyl; c++) {
        const fa = this.fireAngles[c] + this.cylPhase[c];
        const crossed = prev < a ? (fa > prev && fa <= a)
                                 : (fa > prev || fa <= a);   // wrapped 720->0
        if (!crossed) continue;
        if (cut > 0 && this._rnd() < cut) continue;          // limiter skip
        this._fires++;
        // combustion strength: strong on power, faint on overrun
        const power = 0.18 + thr * 0.95;
        const g = this.cylGain[c] * power;
        this.combEnv = g;
        this.combNoiseEnv = g * this.combNoise;
        // overrun unburnt-fuel pop: occasional sharp crackle off-throttle
        if (thr < 0.06 && rpmF > 0.4 && this._rnd() < 0.12) this.popEnv = 0.9;
      }

      // excitation = decaying combustion pulse + burn noise + pops.
      // This pulse train carries the firing fundamental (rate=firing freq),
      // so the perceived engine pitch rises with rpm.
      this.combEnv *= combDecayK;
      this.combNoiseEnv *= combDecayK * 0.96;
      this.popEnv *= 0.9988;
      const wn = this._rnd() * 2 - 1;
      const exc = this.combEnv + this.combNoiseEnv * wn + this.popEnv * wn * (this._rnd() < 0.5 ? 1 : 0);

      // --- exhaust = pulse train shaped by an rpm-tracking brightness LP.
      // The pulse train carries the pitch; the LP only opens with revs/load,
      // so the perceived note rises with rpm (it never gets pinned to a fixed
      // resonance). One gentle body resonance is mixed low for warmth.
      const briCut = Math.min(0.9, (260 + rpmF * 3200 * this.bright + thr * 1800) / sr * 2);
      this.lp += (exc - this.lp) * briCut;
      let exhaust = this.lp;
      // optional faint body resonance for warmth (default off; high damping so
      // it broadens rather than rings a fixed pitch)
      if (this.body > 0.001) {
        const bf = Math.min(0.4, 2 * Math.sin(Math.PI * this.bodyHz / sr));
        this.bLow += bf * this.bBand;
        const bhi = exc - this.bLow - 1.4 * this.bBand;
        this.bBand += bf * bhi;
        exhaust += this.bBand * this.body;
      }
      // DC block
      const dcOut = exhaust - this.dcPrev + 0.995 * this.dc;
      this.dcPrev = exhaust; this.dc = dcOut;
      exhaust = dcOut;
      // diffusion allpass for a touch of "air"
      const apR = this.ap[this.apI];
      const apIn = exhaust - this.apFb * apR;
      this.ap[this.apI] = apIn;
      this.apI = this.apI + 1 >= this.apLen ? 0 : this.apI + 1;
      exhaust = (exhaust * 0.8 + (apR + this.apFb * apIn) * 0.3) * this.exhaustGain;

      // --- intake: resonant bandpass on noise, opens with throttle
      const fc = Math.min(0.45, (180 + rpm * 0.06) / sr * 6.283);
      const q = 0.18;
      this.svLow += fc * this.svBand;
      const hi = wn - this.svLow - q * this.svBand;
      this.svBand += fc * hi;
      const intake = this.svBand * this.intakeGain * (0.15 + thr * 0.85) * (0.4 + rpmF * 0.6);

      // --- mechanical/valvetrain zing (rpm-scaled high-freq noise)
      const mech = wn * this.mechGain * rpmF * rpmF * 0.22;

      // mix + soft clip
      let y = exhaust + intake * 0.6 + mech;
      y = Math.tanh(y * 1.4) * 0.5;
      out[i] = y;
    }

    // copy to remaining channels if stereo
    for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
    return true;
  }
}

registerProcessor('engine-processor', EngineProcessor);
