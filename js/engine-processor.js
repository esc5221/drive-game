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
    this.cylinderWaveguide = new Waveguide(10, 0.75, 0.75);
    this.intakeWaveguide = new Waveguide(cfg.intakeLen, 0.01, cfg.intakeOpen);
    this.exhaustWaveguide = new Waveguide(cfg.exhaustLen, cfg.exhaustClosed, 0.01);
    this.extractorWaveguide = new Waveguide(cfg.extractorLen, 0.01, 0.01);
    this.intakeOpen = cfg.intakeOpen; this.intakeClosed = cfg.intakeClosed;
    this.exhaustOpen = cfg.exhaustOpen; this.exhaustClosed = cfg.exhaustClosed;
    this.ignitionTime = cfg.ignitionTime;
    this.intakeValve = 0; this.exhaustValve = 0;
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
    const amp = piston * 1.5 + ignition * 5.0;

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
    };
    this.cylinders = [];
    for (let i = 0; i < cyl; i++) this.cylinders.push(new Cylinder({ ...cfg, index: i }));
    this.cylInv = 1 / cyl;
    this.straightPipe = new Waveguide(o.straightPipeLen || 128, 0.1, 0.1);
    this.muffler = new Muffler(o.mufflerElements || [10, 15, 20, 25], o.mufflerAction ?? 0.25);
    this.outlet = new Waveguide(5, 0.01, 0.01);

    this.intakeNoiseLP = new LowpassFilter(11000);
    this.crankshaftLP = new LowpassFilter(75);
    this.engineLP = new LowpassFilter(125);

    this.currentRevolution = 0;
    this.outletGain = o.outletGain ?? 1.0;     // exhaust loudness
    this.intakeMix = o.intakeMix ?? 1.0;
    this.blockMix = o.blockMix ?? 1.0;
    this.level = o.level ?? 0.5;
    this.decelPops = o.decelPops ?? 0.5;

    this._load = 0; this._popEnv = 0;
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
        const x = (this.currentRevolution + c * (this.cylInv + crank)) % 1;
        cyls[c].update(intakeNoise, this.straightPipe.outputLeft, x < 0 ? x + 1 : x, this._load);
        block += cyls[c].cylinderWaveguide.outputRight;
      }
      this.currentRevolution += revPerSample;
      if (this.currentRevolution > 1) this.currentRevolution -= 1;

      let intakeSound = 0, straightPipeInput = 0;
      for (let c = 0; c < cyls.length; c++) {
        intakeSound += cyls[c].intakeWaveguide.outputLeft;
        straightPipeInput += cyls[c].cylinderWaveguide.outputRight;
      }
      this.straightPipe.add(straightPipeInput, this.muffler.outputLeft);
      this.outlet.add(this.muffler.outputRight, 0);
      const outletSound = this.outlet.outputRight;
      this.muffler.update(this.straightPipe.outputRight, this.outlet.outputLeft);

      // overrun pops/bangs (Elantra-N crackle): random sharp bursts off-throttle
      if (overrun && this._rnd() < 0.0009 * this.decelPops * (rpm / redline)) {
        this._popEnv = 0.8 + this._rnd() * 0.7;
      }
      this._popEnv *= 0.9985;
      const pop = this._popEnv * (this._rnd() * 2 - 1);

      const blockFiltered = this.engineLP.get(block) * this.blockMix;
      let y = blockFiltered + intakeSound * this.intakeMix
            + (outletSound + pop) * this.outletGain;
      out[i] = Math.tanh(y * 0.6 * this.level * 2) * 0.5;
    }
    for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
    return true;
  }
}

registerProcessor('engine-processor', EngineProcessor);
