// Engine AudioWorklet — a faithful port of Antonio-R1's physically-informed
// engine sound generator (bidirectional waveguides + valve-timed reflections),
// driven by our rpm/throttle params, with load (on/off-throttle) added on top.
//
// Core DSP (DelayLine / Waveguide / Cylinder / Muffler / the per-sample update)
// is adapted from:
//   engine-sound-generator (c) 2021-2022 Antonio-R1 — MIT
//   https://github.com/Antonio-R1/engine-sound-generator
// which itself implements Baldan et al.'s physically-informed engine model.
// Additions here: AudioWorklet wrapper, rpm/throttle as AudioParams, throttle
// load model (fuel-ignition scaling), overrun fuel-cut + pops, per-car config.

const SR = sampleRate;
const SR_INV = 1 / SR;

class LowpassFilter {
  constructor(freq, last = 0) {
    const w = 2 * Math.PI * SR_INV * freq;
    this.alpha = w / (w + 1);
    this.last = last;
  }
  get(v) { this.last += this.alpha * (v - this.last); return this.last; }
}

// RBJ biquad (DF1) for the optional per-car tone EQ on the engine output.
// Off by default — a car with no eq config never instantiates one, so the
// shared processor stays byte-identical for every other vehicle.
class Biquad {
  constructor(type, f0, Q, dBgain) {
    const A = Math.pow(10, (dBgain || 0) / 40);
    const w0 = 2 * Math.PI * f0 / SR, cw = Math.cos(w0), sw = Math.sin(w0);
    const alpha = sw / (2 * Q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'highpass') {
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === 'peaking') {
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
    } else { // highshelf
      const ap = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + ap);
      b1 = -2 * A * ((A - 1) + (A + 1) * cw);
      b2 = A * ((A + 1) + (A - 1) * cw - ap);
      a0 = (A + 1) - (A - 1) * cw + ap;
      a1 = 2 * ((A - 1) - (A + 1) * cw);
      a2 = (A + 1) - (A - 1) * cw - ap;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  get(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2
            - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

class DelayLine {
  constructor(length) {
    this.data = new Float32Array(length);
    this.index = 0;
  }
  updateLeft(v) { this.data[this.index] = v; if (++this.index >= this.data.length) this.index = 0; }
  updateRight(v) { this.data[this.index] = v; if (--this.index < 0) this.index = this.data.length - 1; }
  at0() { return this.data[this.index]; }
}

class Waveguide {
  constructor(length, reflLeft, reflRight) {
    this.upper = new DelayLine(length);
    this.lower = new DelayLine(length);
    this.reflectionFactorLeft = reflLeft;
    this.reflectionFactorRight = reflRight;
    this.outputLeft = 0; this.outputRight = 0;
  }
  add(valueLeft, valueRight) {
    const lo = this.lower.at0(), up = this.upper.at0();
    const reflLeft = lo * this.reflectionFactorLeft;
    this.outputLeft = lo * (1 - this.reflectionFactorLeft);
    const reflRight = up * this.reflectionFactorRight;
    this.outputRight = up * (1 - this.reflectionFactorRight);
    this.upper.updateRight(valueLeft + reflLeft);
    this.lower.updateLeft(valueRight + reflRight);
  }
}

class Cylinder {
  constructor(cfg) {
    this.index = cfg.index;
    this.cylinderWaveguide = new Waveguide(10, cfg.cylRefl, cfg.cylRefl);
    this.pistonAmp = cfg.pistonAmp;
    this.intakeWaveguide = new Waveguide(cfg.intakeLen, 0.01, cfg.intakeOpen);
    this.exhaustWaveguide = new Waveguide(cfg.exhaustLen, cfg.exhaustClosed, 0.01);
    this.extractorWaveguide = new Waveguide(cfg.extractorLen, 0.01, 0.01);
    this.intakeOpen = cfg.intakeOpen; this.intakeClosed = cfg.intakeClosed;
    this.exhaustOpen = cfg.exhaustOpen; this.exhaustClosed = cfg.exhaustClosed;
    this.ignitionTime = cfg.ignitionTime;
    this.intakeValve = 0; this.exhaustValve = 0;
    this._xPrev = 0; this._fireAmp = 1;
  }
  _updateReflections() {
    this.intakeWaveguide.reflectionFactorRight = this.intakeOpen * this.intakeValve + this.intakeClosed * (1 - this.intakeValve);
    this.cylinderWaveguide.reflectionFactorLeft = this.intakeWaveguide.reflectionFactorRight;
    this.exhaustWaveguide.reflectionFactorLeft = this.exhaustOpen * this.exhaustValve + this.exhaustClosed * (1 - this.exhaustValve);
    this.cylinderWaveguide.reflectionFactorRight = this.exhaustWaveguide.reflectionFactorLeft;
  }
  // load: scales fuel ignition (0 = overrun/no combustion, 1 = full power)
  update(intakeNoise, straightPipeOutputLeft, x, load) {
    this.exhaustValve = (0.75 < x && x < 1.0) ? -Math.sin(4 * Math.PI * x) : 0;
    this.intakeValve = (0 < x && x < 0.25) ? Math.sin(4 * Math.PI * x) : 0;
    const piston = Math.cos(4 * Math.PI * x);
    const t = this.ignitionTime;
    let ignition = (0 < x && x < 0.5 * t) ? Math.sin(2 * Math.PI * (x / t)) : 0;
    ignition *= load;
    this._updateReflections();

    intakeNoise *= this.intakeValve;
    // piston (mechanical) excitation scaled down — at high amplitude it rings
    // the short cylinder waveguide (~2.4kHz) into a metallic clatter that's
    // exposed on overrun (no combustion to mask it).
    const amp = piston * this.pistonAmp + ignition * 5.0;

    const exhaustOutRight = this.exhaustWaveguide.outputRight;
    const extractorOutLeft = this.extractorWaveguide.outputLeft;
    const cylOutRight = this.cylinderWaveguide.outputRight;
    const intakeOutRight = this.intakeWaveguide.outputRight;
    const cylOutLeft = this.cylinderWaveguide.outputLeft;

    this.extractorWaveguide.add(exhaustOutRight, straightPipeOutputLeft);
    this.exhaustWaveguide.add(cylOutRight, extractorOutLeft);
    this.cylinderWaveguide.add(
      amp + intakeOutRight * (1 - this.intakeWaveguide.reflectionFactorRight),
      extractorOutLeft * (1 - this.exhaustWaveguide.reflectionFactorLeft));
    this.intakeWaveguide.add(intakeNoise, cylOutLeft * (1 - this.intakeWaveguide.reflectionFactorRight));
  }
}

class Muffler {
  constructor(elementLengths, action) {
    this.elements = elementLengths.map(l => new Waveguide(l, 0.0, action));
    this.inv = 1 / elementLengths.length;
    this.outputLeft = 0; this.outputRight = 0;
  }
  update(mufflerInput, outletValue) {
    mufflerInput *= this.inv; outletValue *= this.inv;
    this.outputLeft = 0; this.outputRight = 0;
    for (const e of this.elements) {
      this.outputLeft += e.outputLeft;
      this.outputRight += e.outputRight;
      e.add(mufflerInput, outletValue);
    }
  }
}

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
    const cyl = o.cyl || 4;
    const cfg = {
      intakeLen: o.intakeLen || 100, exhaustLen: o.exhaustLen || 100,
      extractorLen: o.extractorLen || 100,
      intakeOpen: o.intakeOpen ?? 0.25, intakeClosed: o.intakeClosed ?? 0.95,
      exhaustOpen: o.exhaustOpen ?? 0.25, exhaustClosed: o.exhaustClosed ?? 0.95,
      ignitionTime: o.ignitionTime ?? 0.016,
      cylRefl: o.cylRefl ?? 0.62,        // was 0.75 — broaden the ~2.4kHz cylinder resonance
      pistonAmp: o.pistonAmp ?? 0.9,     // was 1.5 — gentler mechanical excitation
    };
    // per-cylinder asymmetry (opt-in): real engines never fire a perfect comb —
    // unequal runner lengths + per-cycle combustion variation put energy into
    // the half-orders (the I4 "grumble"). Symmetric cylinders collapse the
    // period to the firing order and read as an EV whine.
    let s0 = 987654321;
    const rnd0 = () => (s0 = (s0 * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const lenVar = o.cylLenVar || 0;             // fractional runner-length spread
    this.phaseVar = o.phaseVar || 0;             // constant per-cyl firing offset
    this.igniteVar = o.igniteVar || 0;           // per-cycle combustion variation
    this._phaseOff = [];
    this.cylinders = [];
    for (let i = 0; i < cyl; i++) {
      const d = (rnd0() * 2 - 1);
      this.cylinders.push(new Cylinder({
        ...cfg,
        exhaustLen: Math.max(4, Math.round(cfg.exhaustLen * (1 + lenVar * d))),
        extractorLen: Math.max(4, Math.round(cfg.extractorLen * (1 + lenVar * (rnd0() * 2 - 1)))),
        intakeLen: Math.max(4, Math.round(cfg.intakeLen * (1 + lenVar * (rnd0() * 2 - 1)))),
        index: i,
      }));
      this._phaseOff.push(this.phaseVar * (rnd0() * 2 - 1));
    }
    this.cylInv = 1 / cyl;
    this.straightPipe = new Waveguide(o.straightPipeLen || 128, 0.1, 0.1);
    this.muffler = new Muffler(o.mufflerElements || [10, 15, 20, 25], o.mufflerAction ?? 0.25);
    this.outlet = new Waveguide(5, 0.01, 0.01);

    // exhaust-valve turbulence (opt-in): broadband rasp summed into the
    // straight pipe — fills the inter-order floor a clean comb lacks. The
    // exhaust/extractor waveguides are side resonators (they only READ the
    // straight pipe), so the injection must happen at the straight-pipe input.
    this.exhNoiseK = o.exhNoise || 0;
    this.turbLP = new LowpassFilter(o.exhNoiseLP || 1400);

    this.intakeNoiseLP = new LowpassFilter(11000);
    this.crankshaftLP = new LowpassFilter(75);
    this.engineLP = new LowpassFilter(125);

    this.currentRevolution = 0;
    this.outletGain = o.outletGain ?? 1.0;     // exhaust loudness
    this.intakeMix = o.intakeMix ?? 1.0;
    this.blockMix = o.blockMix ?? 1.0;
    this.level = o.level ?? 0.5;
    this.decelPops = o.decelPops ?? 0.5;

    // optional per-car tone EQ: de-boom (highpass) + howl band (peaking) +
    // air (highshelf). Built only when configured, so other cars are untouched.
    this.eq = [];
    if (o.hpHz) this.eq.push(new Biquad('highpass', o.hpHz, o.hpQ ?? 0.707, 0));
    if (o.cutDb) this.eq.push(new Biquad('peaking', o.cutF ?? 150, o.cutQ ?? 1.2, o.cutDb));
    if (o.peakDb) this.eq.push(new Biquad('peaking', o.peakF ?? 1600, o.peakQ ?? 0.9, o.peakDb));
    if (o.shelfDb) this.eq.push(new Biquad('highshelf', o.shelfF ?? 3500, 0.707, o.shelfDb));

    this._load = 0; this._popEnv = 0; this._outLP = 0; this._lift = 0;
    let s = 20240609;
    this._rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

    this.alive = true;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.alive = false; };
  }

  process(_in, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0][0];
    if (!out) return true;
    const n = out.length;
    const rpm = params.rpm[0], thr = params.throttle[0], redline = params.redline[0];

    // load: combustion follows throttle; overrun (low thr, rpm>idle) cuts fuel
    const overrun = thr < 0.08 && rpm > 1300;
    const targetLoad = overrun ? 0.0 : (0.25 + thr * 0.75);
    const revPerSample = SR_INV * rpm / 120;     // cycles (2 revolutions) per sample
    const cyls = this.cylinders;

    for (let i = 0; i < n; i++) {
      this._load += (targetLoad - this._load) * 0.0008;   // smooth load change

      let intakeNoise = this.intakeNoiseLP.get(2 * this._rnd() - 1);
      if (rpm < 25) intakeNoise = 0;
      intakeNoise *= 0.06 + 0.94 * this._load;            // near-silent intake at idle
      const crank = this.crankshaftLP.get(0.25 * this._rnd());

      let block = 0;
      for (let c = 0; c < cyls.length; c++) {
        let x = (this.currentRevolution + c * (this.cylInv + crank) + this._phaseOff[c]) % 1;
        if (x < 0) x += 1;
        // per-cycle combustion variation: resample this cylinder's fire
        // strength each time its cycle wraps
        if (this.igniteVar) {
          if (x < cyls[c]._xPrev) cyls[c]._fireAmp = 1 + this.igniteVar * (this._rnd() * 2 - 1);
          cyls[c]._xPrev = x;
        }
        cyls[c].update(intakeNoise, this.straightPipe.outputLeft, x, this._load * (cyls[c]._fireAmp || 1));
        block += cyls[c].cylinderWaveguide.outputRight;
      }
      this.currentRevolution += revPerSample;
      if (this.currentRevolution > 1) this.currentRevolution -= 1;

      let intakeSound = 0, straightPipeInput = 0;
      for (let c = 0; c < cyls.length; c++) {
        intakeSound += cyls[c].intakeWaveguide.outputLeft;
        straightPipeInput += cyls[c].cylinderWaveguide.outputRight;
      }
      if (this.exhNoiseK) {
        let valve = 0;
        for (let c = 0; c < cyls.length; c++) valve += Math.abs(cyls[c].exhaustValve);
        straightPipeInput += this.turbLP.get(2 * this._rnd() - 1) * valve
                           * this.exhNoiseK * (0.25 + 0.75 * this._load);
      }
      this.straightPipe.add(straightPipeInput, this.muffler.outputLeft);
      this.outlet.add(this.muffler.outputRight, 0);
      const outletSound = this.outlet.outputRight;
      this.muffler.update(this.straightPipe.outputRight, this.outlet.outputLeft);

      // overrun crackle (Elantra-N "ta...ta-ta"): bursts right after lifting,
      // then sparse — NOT a constant machine-gun stream. _lift = seconds spent
      // in overrun; the crackle rate decays after the lift transient.
      this._lift = overrun ? Math.min(2, this._lift + 1 / SR) : 0;
      const burst = Math.exp(-this._lift * 2.5);              // strong ~first 0.6s
      const rate = (1.2 + 6 * burst) * this.decelPops;        // pops per second
      if (overrun && this._rnd() < rate / SR) {
        this._popEnv = 0.5 + this._rnd() * 0.5;
      }
      this._popEnv *= 0.9985;
      const pop = this._popEnv * (this._rnd() * 2 - 1);

      const blockFiltered = this.engineLP.get(block) * this.blockMix;
      let y = blockFiltered + intakeSound * this.intakeMix
            + (outletSound + pop) * this.outletGain;
      // load-dependent brightness: on-throttle keeps the bright combustion edge;
      // off-throttle (overrun) closes the top so the mechanical cylinder
      // resonance (~2.4kHz) doesn't ring out as a metallic clatter.
      const cut = (1100 + this._load * 5200) / SR * 2;
      this._outLP += (y - this._outLP) * Math.min(1, cut);
      let tone = this._outLP;
      for (let e = 0; e < this.eq.length; e++) tone = this.eq[e].get(tone);
      out[i] = Math.tanh(tone * 0.6 * this.level * 2) * 0.5;
    }
    for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
    return true;
  }
}

registerProcessor('engine-processor', EngineProcessor);
