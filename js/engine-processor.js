// Procedural engine AudioWorklet v2 — pulse-train + dual waveguide resonator.
//
// Architecture (the academic PTR model / Karplus-Strong exhaust, reimplemented
// from standard DSP — no third-party code):
//   crank angle -> per-cylinder firing -> combustion pressure pulse (the source)
//   -> exhaust header waveguide (closed engine end +R, open atmosphere end -1
//      => net NEGATIVE feedback comb => odd-harmonic "hollow" exhaust tone)
//   -> muffler/tailpipe resonator (longer, low -> the deep idle/cruise rumble)
//   + intake waveguide (open-open, all harmonics, opens with throttle)
//   + mechanical valvetrain zing (rpm-scaled)
// The PULSE TRAIN carries the pitch (rises with rpm, drops on upshift); the
// resonators only color it. Per-cylinder variance repeats every 720deg, which
// injects the half-engine-order content that makes it sound like a motor.
//
// Load: on-throttle = strong combustion + bright + intake roar; off-throttle
// over idle = combustion cut + overrun pops/bangs (the Elantra-N crackle).

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
    const sr = sampleRate;
    this.cyl = o.cyl || 4;
    this.fireAngles = o.fireAngles || Array.from({ length: this.cyl }, (_, i) => (720 / this.cyl) * i);

    this.combAttack = o.combAttack ?? 0.0006;      // pressure rise (s)
    this.combDecay = o.combDecay ?? 0.0026;        // blowdown decay (s)
    this.combNoise = o.combNoise ?? 0.5;           // burn turbulence

    // exhaust header: short pipe -> mid formant, negative feedback (quarter-wave)
    this.hzHeader = o.headerHz ?? 380;
    this.rHeader = o.headerR ?? 0.5;
    // muffler/tailpipe: long pipe -> deep rumble that dominates idle/cruise
    this.hzMuffler = o.mufflerHz ?? 90;
    this.rMuffler = o.mufflerR ?? 0.55;
    // intake: open-open pipe (positive feedback, all harmonics)
    this.hzIntake = o.intakeHz ?? 220;
    this.rIntake = o.intakeR ?? 0.45;

    this.intakeGain = o.intakeGain ?? 0.5;
    this.mechGain = o.mechGain ?? 0.22;
    this.idleLope = o.idleLope ?? 0.08;
    this.exhaustGain = o.exhaustGain ?? 1.0;
    this.mufflerMix = o.mufflerMix ?? 0.7;
    this.decelPops = o.decelPops ?? 0.5;
    this.loopLP = o.loopLP ?? 0.5;                 // in-loop damping

    // delay lines (round-trip 2L => first resonance sr/(2*D))
    const mkDelay = (hz) => {
      const D = Math.max(4, Math.round(sr / (2 * hz)));
      return { buf: new Float32Array(D), D, p: 0, lp: 0 };
    };
    this.hd = mkDelay(this.hzHeader);
    this.mf = mkDelay(this.hzMuffler);
    this.ik = mkDelay(this.hzIntake);

    // combustion envelopes
    this.combEnv = 0; this.attackRem = 0; this.attackG = 0;
    this.combNoiseEnv = 0; this.popEnv = 0;

    // brightness LP + DC block
    this.bright = 0; this.dcX = 0; this.dcY = 0;

    let s = 20240609;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    this.cylGain = this.fireAngles.map(() => 1 + (rnd() - 0.5) * this.idleLope * 5);
    this.cylPhase = this.fireAngles.map(() => (rnd() - 0.5) * this.idleLope * 7);
    this._rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

    this.cycleAngle = 0;
    this.alive = true;
    this._lastRpm = 0; this._fires = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.alive = false;
      else if (e.data === 'dbg') this.port.postMessage({ rpm: this._lastRpm, fires: this._fires });
    };
  }

  process(_in, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0][0];
    if (!out) return true;
    const n = out.length, sr = sampleRate;
    const rpm = params.rpm[0], thr = params.throttle[0], redline = params.redline[0];
    this._lastRpm = rpm;

    const degPerSample = (rpm / 60) * 360 / sr;
    const rpmF = Math.min(rpm / redline, 1.1);
    const attackK = Math.exp(-1 / (this.combAttack * sr));
    const decayK = Math.exp(-1 / (this.combDecay * sr));
    const cut = rpm > redline - 120 ? 0.55 : 0;          // limiter fuel cut
    const overrun = thr < 0.08 && rpm > 1300;             // off-load (engine braking)
    const hd = this.hd, mf = this.mf, ik = this.ik;
    const loopLP = this.loopLP;

    for (let i = 0; i < n; i++) {
      const prev = this.cycleAngle;
      let a = prev + degPerSample;
      if (a >= 720) a -= 720;
      this.cycleAngle = a;

      for (let c = 0; c < this.cyl; c++) {
        const fa = this.fireAngles[c] + this.cylPhase[c];
        const crossed = prev < a ? (fa > prev && fa <= a) : (fa > prev || fa <= a);
        if (!crossed) continue;
        if (cut > 0 && this._rnd() < cut) continue;
        this._fires++;
        // combustion strength: full on power, tiny on overrun
        const power = overrun ? 0.05 : (0.22 + thr * 0.9);
        const g = this.cylGain[c] * power;
        this.attackG = g; this.attackRem = this.combAttack * sr;  // start pressure rise
        this.combNoiseEnv = g * this.combNoise;
        // overrun unburnt-fuel pop / bang
        if (overrun && this._rnd() < 0.16 * this.decelPops) this.popEnv = 0.8 + this._rnd() * 0.6;
      }

      // combustion pressure: fast attack to peak, then blowdown decay
      if (this.attackRem > 0) {
        this.combEnv += (this.attackG - this.combEnv) * (1 - attackK);
        this.attackRem--;
      } else {
        this.combEnv *= decayK;
      }
      this.combNoiseEnv *= decayK * 0.95;
      this.popEnv *= 0.9986;
      const wn = this._rnd() * 2 - 1;
      const exc = this.combEnv + this.combNoiseEnv * wn + this.popEnv * wn;

      // --- exhaust header: negative-feedback comb (closed+open ends) ---
      let r = hd.buf[hd.p];
      hd.lp += (r - hd.lp) * (1 - loopLP);
      hd.buf[hd.p] = exc - this.rHeader * hd.lp;        // -R = open-end inversion
      hd.p = hd.p + 1 >= hd.D ? 0 : hd.p + 1;
      const header = r;

      // --- muffler / tailpipe: long low resonator (deep idle rumble) ---
      let rm = mf.buf[mf.p];
      mf.lp += (rm - mf.lp) * (1 - loopLP * 0.7);
      mf.buf[mf.p] = (exc + header * 0.5) - this.rMuffler * mf.lp;
      mf.p = mf.p + 1 >= mf.D ? 0 : mf.p + 1;
      const muffler = rm;

      let exhaust = (header + muffler * this.mufflerMix) * this.exhaustGain;

      // --- intake: open-open pipe (positive fb -> full harmonic series) ---
      const inExc = wn * (0.1 + thr * 0.9);
      let ri = ik.buf[ik.p];
      ik.lp += (ri - ik.lp) * (1 - loopLP * 0.5);
      ik.buf[ik.p] = inExc + this.rIntake * ik.lp;
      ik.p = ik.p + 1 >= ik.D ? 0 : ik.p + 1;
      const intake = ri * this.intakeGain * (0.12 + thr * 0.88) * (0.4 + rpmF * 0.6);

      // --- mechanical/valvetrain zing
      const mech = wn * this.mechGain * rpmF * rpmF * 0.2;

      // --- mix, brightness (opens with revs+load), DC block, soft clip
      let y = exhaust + intake * 0.7 + mech;
      const briCut = Math.min(0.95, (300 + rpmF * 2600 + thr * 1600) / sr * 2);
      this.bright += (y - this.bright) * briCut;
      // keep some of the deep low end even when the LP closes (idle body)
      y = this.bright * 0.75 + y * 0.25;
      const dcY = y - this.dcX + 0.996 * this.dcY;
      this.dcX = y; this.dcY = dcY;
      out[i] = Math.tanh(dcY * 1.5) * 0.5;
    }
    for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
    return true;
  }
}

registerProcessor('engine-processor', EngineProcessor);
