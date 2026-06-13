// Car specifications: everything that differs between cars lives here.
// physics (mass/suspension/engine/gears/aero), audio profile, visuals.

export const CARS = {
  avante: {
    id: 'avante',
    name: '아반떼 N',
    mass: 1430,
    inertia: [2200, 2550, 580],
    comH: 0.45,
    drive: 'FWD',
    wheels: {
      fz: -1.06, rz: 1.59, htF: 0.80, htR: 0.81,
      attachY: 0.21, restLen: 0.30, radius: 0.33, iw: 1.3,
      kF: 68000, kR: 48000, cBF: 5200, cRF: 8200, cBR: 3700, cRR: 5900,
      maxC: 0.17, muF: 0.99, muR: 1.07,
    },
    arbF: 26000, arbR: 16000,
    engine: {
      rpm: [800, 1400, 1800, 2100, 2800, 3600, 4400, 4700, 5200, 5800, 6200, 6600, 6900, 7300],
      nm:  [140, 220,  310,  385,  392,  392,  392,  392,  375,  345,  315,  285,  255,  70],
      idle: 850, redline: 6900, engBrake: [16, 0.010], shiftDown: 2300,
    },
    gears: [3.62, 2.19, 1.52, 1.13, 0.89, 0.72], final: 4.20, reverse: 3.4,
    brakeT: 4800, bias: 0.64,
    aero: { cda: 0.72, cla: 0.28 },
    audio: {
      cyl: 4, turbo: true,
      orders: [1, 0.5, 1.5, 2, 3, 1.02],
      gains:  [0.50, 0.30, 0.08, 0.12, 0.04, 0.22],
      tone: 900, rasp: 0.30, pops: 0.35, intake: 0.5, sub: 0.18,
    },
    // procedural engine worklet model — turbo 4-cyl: deep raspy boom, lopey
    engine_model: {
      cyl: 4, combDecay: 0.0024, combNoise: 0.62, intakeGain: 0.55, mechGain: 0.12,
      idleLope: 0.07, exhaustGain: 1.1, level: 0.6, bright: 0.85, body: 0.12, bodyHz: 150,
    },
    visual: { color: 0x1f4f9e, accent: 0xc8102e, wing: 'lip', roofY: 0.64, rearY: 0.36 },
    dialMax: 8, dialRed: 7, dialSpeed: 300,
  },

  gt3: {
    id: 'gt3',
    name: '911 GT3',
    mass: 1435,
    inertia: [2300, 2600, 620],
    comH: 0.40,
    drive: 'RWD',                       // rear engine: 39/61 weight
    wheels: {
      fz: -1.50, rz: 0.96, htF: 0.82, htR: 0.86,
      attachY: 0.21, restLen: 0.28, radius: 0.34, iw: 1.4,
      kF: 62000, kR: 88000, cBF: 4100, cRF: 6700, cBR: 6200, cRR: 9900,
      maxC: 0.16, muF: 1.08, muR: 1.12,            // Cup 2 R
    },
    arbF: 32000, arbR: 20000,
    engine: {
      rpm: [900, 1500, 2500, 3500, 4500, 5500, 6000, 6300, 7000, 8000, 8500, 9000, 9400],
      nm:  [180, 240,  305,  345,  385,  430,  455,  465,  460,  440,  420,  385,  90],
      idle: 900, redline: 9000, engBrake: [25, 0.014], shiftDown: 3400,
    },
    gears: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84], final: 4.19, reverse: 3.5,
    brakeT: 6400, bias: 0.61,
    aero: { cda: 0.79, cla: 0.95 },                // swan-neck wing: ~180kg @200
    audio: {
      cyl: 6, turbo: false,
      orders: [1, 0.5, 1.5, 2, 3, 1.03],
      gains:  [0.46, 0.14, 0.30, 0.20, 0.12, 0.24],
      tone: 1500, rasp: 0.55, pops: 0.55, intake: 0.7, sub: 0.10,
    },
    // flat-6 NA: tight even firing, bright metallic formants, screaming top end
    engine_model: {
      cyl: 6, combDecay: 0.0013, combNoise: 0.40, intakeGain: 0.85, mechGain: 0.38,
      idleLope: 0.03, exhaustGain: 1.0, level: 0.52, bright: 1.3, body: 0.1, bodyHz: 300,
    },
    visual: { color: 0xf2c200, accent: 0x111111, wing: 'gt', roofY: 0.58, rearY: 0.40 },
    dialMax: 10, dialRed: 9, dialSpeed: 340,
  },
};

export function savedCarId() {
  const id = localStorage.getItem('ns-car');
  return CARS[id] ? id : 'avante';
}
