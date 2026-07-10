// Car specifications: everything that differs between cars lives here.
// physics (mass/suspension/engine/gears/aero), audio profile, visuals.

export const CARS = {
  avante: {
    id: 'avante',
    name: 'Elantra N',
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
      gearbox: 'dct',
      tone: 900, rasp: 0.30, pops: 0.35, intake: 0.5, sub: 0.18,
    },
    // Antonio waveguide model — turbo 4-cyl: longer exhaust/big muffler = deep
    // boomy note, lots of overrun crackle.
    engine_model: {
      cyl: 4, intakeLen: 100, exhaustLen: 120, extractorLen: 100,
      straightPipeLen: 150, mufflerElements: [9, 14, 19, 26], mufflerAction: 0.16,
      ignitionTime: 0.011, intakeOpen: 0.25, intakeClosed: 0.9,
      exhaustOpen: 0.25, exhaustClosed: 0.95,
      outletGain: 1.1, intakeMix: 0.6, blockMix: 0.75, decelPops: 1.0, level: 0.72,
      // per-cylinder asymmetry: fills the half-orders (I4 grumble/rasp) that a
      // symmetric comb lacks — without it the note reads as an EV whine.
      // Matched to a 2025 Elantra N N-mode rev recording (half-order comb +
      // inter-peak floor + band energies, tests/engine_render.py A/B).
      cylLenVar: 0.22, phaseVar: 0.012, igniteVar: 1.0, exhNoise: 9.0, exhNoiseLP: 1200,
      // turbo I4: de-boom the sub, lift the firing body, NO treble shelf — the
      // turbo muffles upper harmonics.
      hpHz: 70, hpQ: 0.7, cutF: 1400, cutQ: 0.8, cutDb: -6.5, peakF: 250, peakQ: 0.6, peakDb: 4.0, shelfF: 2800, shelfDb: -9,
    },
    visual: {
      color: 0x1f4f9e, accent: 0xc8102e, wing: 'lip', roofY: 0.64, rearY: 0.36,
      // Ddiaz Design "2024 Hyundai Elantra N" (Sketchfab, CC-BY-NC) — fbx at
      // 1/100 with the per-corner wheel placement lost, hence scale + wheelTag
      model: {
        src: './models/elantra_n.glb', scale: 100, dz: 0.26, wheelY: 0.327, wheelR: 0.327,
        paint: 'HHyundai_ElantraNRewardRecycled_2022Paint_Material1',
        lights: 'HHyundai_ElantraNRewardRecycled_2022LightA_Material1',
        wheelTag: 'Wheel_1A_', caliperTag: 'Calliper_',
        tail: 'red_glass',                             // brake-light lens material
      },
    },
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
      gearbox: 'pdk',
      tone: 1500, rasp: 0.55, pops: 0.55, intake: 0.7, sub: 0.10,
    },
    // Antonio waveguide — same 4.0 NA flat-6 as the RS, slightly tamer exhaust.
    // Same de-boom + howl tone EQ (a touch less aggressive than the RS).
    engine_model: {
      cyl: 6, intakeLen: 85, exhaustLen: 48, extractorLen: 52,
      straightPipeLen: 58, mufflerElements: [5, 8, 11, 14], mufflerAction: 0.12,
      ignitionTime: 0.008, intakeOpen: 0.22, intakeClosed: 0.9,
      exhaustOpen: 0.22, exhaustClosed: 0.95,
      outletGain: 1.15, intakeMix: 0.9, blockMix: 0.60, decelPops: 0.3, level: 0.70,
      hpHz: 195, hpQ: 0.7, cutF: 150, cutQ: 1.1, cutDb: -6.0,
      peakF: 950, peakQ: 0.7, peakDb: 4.0, shelfF: 4200, shelfDb: 1.5,
    },
    visual: {
      color: 0xf2c200, accent: 0x111111, wing: 'gt', roofY: 0.58, rearY: 0.40,
      // real 911 exterior — "Porsche 911 Carrera 4S" by Karol Miklas (CC-BY-SA 4.0)
      model: {
        src: './models/911.glb', dz: -0.22, wheelY: -0.30, wheelR: 0.33,
        paint: 'paint', lights: 'lights', caliper: 'Material.001',
        axleFront: 'Cylinder001', axleRear: 'Cylinder000',
        tailNode: 'Plane001',                          // brake light: lens pixels in the map glow
      },
    },
    dialMax: 10, dialRed: 9, dialSpeed: 340,
  },

  gt3rs: {
    id: 'gt3rs',
    name: '911 GT3 RS',
    mass: 1525,                          // 992.1 GT3 RS, full aero package
    inertia: [2440, 2760, 660],
    comH: 0.39,
    drive: 'RWD',
    wheels: {
      fz: -1.50, rz: 0.96, htF: 0.84, htR: 0.88,
      attachY: 0.21, restLen: 0.26, radius: 0.34, iw: 1.4,
      kF: 78000, kR: 104000, cBF: 4800, cRF: 7600, cBR: 7000, cRR: 11000,   // stiff track setup
      maxC: 0.15, muF: 1.20, muR: 1.26,            // Cup 2 R + downforce traction
    },
    arbF: 42000, arbR: 28000,
    engine: {                            // 4.0 NA flat-6, 518 hp, 465 Nm @ 6300, 9000 rpm
      rpm: [900, 1500, 2500, 3500, 4500, 5500, 6300, 7000, 7800, 8500, 9000, 9300],
      nm:  [185, 250,  315,  350,  395,  440,  465,  462,  452,  438,  412,  95],
      idle: 950, redline: 9000, engBrake: [26, 0.015], shiftDown: 3600,
    },
    gears: [3.91, 2.44, 1.76, 1.37, 1.13, 0.97, 0.85], final: 4.30, reverse: 3.5,
    brakeT: 6900, bias: 0.60,
    aero: { cda: 1.06, cla: 2.30 },                // huge DRS wing: ~410kg@200, ~860kg@285 (≈3× GT3)
    audio: {
      cyl: 6, turbo: false,
      orders: [1, 0.5, 1.5, 2, 3, 1.03],
      gains:  [0.40, 0.12, 0.34, 0.24, 0.16, 0.26],
      gearbox: 'pdk',
      tone: 1800, rasp: 0.60, pops: 0.45, intake: 0.85, sub: 0.07,
    },
    // flat-6 NA, motorsport-derived — screams to 9000 with strong high-rpm
    // harmonics. (Tuned further in a later audio pass vs a 992 RS spectrogram.)
    engine_model: {
      cyl: 6, intakeLen: 80, exhaustLen: 44, extractorLen: 48,
      straightPipeLen: 52, mufflerElements: [5, 7, 10, 13], mufflerAction: 0.10,
      ignitionTime: 0.007, intakeOpen: 0.24, intakeClosed: 0.9,
      exhaustOpen: 0.24, exhaustClosed: 0.95,
      outletGain: 1.25, intakeMix: 1.0, blockMix: 0.55, decelPops: 0.3, level: 0.72,
      // tone EQ (this car only): kill the sub-150Hz boom, notch the 150Hz crank
      // order, lift the flat-6 howl band, add motorsport air — matched to a 992
      // RS spectrogram via offline-render A/B (tests/engine_render.py).
      hpHz: 200, hpQ: 0.7, cutF: 150, cutQ: 1.1, cutDb: -7.0,
      peakF: 950, peakQ: 0.7, peakDb: 5.0, shelfF: 4200, shelfDb: 2.5,
    },
    visual: {
      color: 0xa7d84b, accent: 0x111111, wing: 'gt', roofY: 0.57, rearY: 0.40,
      // real 911 exterior — "Porsche 911 Carrera 4S" by Karol Miklas (CC-BY-SA 4.0)
      model: {
        src: './models/911.glb', dz: -0.22, wheelY: -0.30, wheelR: 0.33,
        paint: 'paint', lights: 'lights', caliper: 'Material.001',
        axleFront: 'Cylinder001', axleRear: 'Cylinder000',
        tailNode: 'Plane001',                          // brake light: lens pixels in the map glow
      },
      // loft-surfaced body (carbody.js) — hand-tuned 992 GT3 RS silhouette
      body: {
        z0: -2.28, z1: 2.20, yLow: -0.30,
        // belt (shoulder) line: high front fenders, door dip, strong rear haunch
        belt: [[-2.28, -0.10], [-1.50, 0.10], [-0.70, 0.04], [0.30, 0.07], [0.96, 0.16], [1.70, 0.12], [2.20, 0.00]],
        // centreline: low nose -> low hood -> windshield -> roof -> fastback -> engine deck
        deck: [[-2.28, -0.14], [-1.85, -0.04], [-1.20, 0.02], [-0.62, 0.08], [-0.48, 0.16], [-0.05, 0.52], [0.40, 0.56], [0.75, 0.50], [1.05, 0.34], [1.45, 0.20], [2.20, 0.08]],
        // plan view half-width: nose taper, door tuck, wide rear hips
        width: [[-2.28, 0.66], [-1.50, 0.80], [-0.60, 0.75], [0.30, 0.77], [0.96, 0.89], [1.60, 0.83], [2.20, 0.70]],
        arches: [
          { z: -1.50, r: 0.46, lift: 0.92, flare: 0.045 },
          { z: 0.96, r: 0.48, lift: 0.92, flare: 0.075 },
        ],
        cabin: [-0.52, 1.05],
        pillars: [[-0.52, -0.45], [0.86, 1.05]],       // thin A-pillar band + fastback C-pillar
        glassInset: 0.09, roofW: 0.40, crown: 0.06,
        humpsAt: [{ z: -1.48, s: 0.50, h: 0.075 }],    // 911 front fenders above the hood
        lampX: 0.58, lampY: 0.02, tailW: 1.38, tailY: 0.10,
        mirrorY: 0.14, wingY: 0.50, wingZ: 1.62, wingDeckY: 0.17,
      },
    },
    dialMax: 10, dialRed: 9, dialSpeed: 320,
  },

  kart: {
    id: 'kart',
    hidden: true,                    // temporarily hidden from menu/UI (data kept)
    name: 'Shifter Kart',
    mass: 170,                       // kart + driver (KZ class min)
    inertia: [90, 120, 45],
    comH: 0.24,
    drive: 'RWD',                    // solid rear axle, no diff
    wheels: {
      fz: -0.52, rz: 0.55, htF: 0.58, htR: 0.62,
      attachY: 0.12, restLen: 0.10, radius: 0.14, iw: 0.85,
      // a kart has no real springs, but the chassis/axle FLEXES — modelled as a
      // soft suspension so all 4 wheels stay planted on uneven ground. (Too
      // stiff and the rigid frame teeters on a diagonal pair and loses grip.)
      kF: 42000, kR: 50000,
      cBF: 2400, cRF: 3000, cBR: 2700, cRR: 3300,
      maxC: 0.07, muF: 1.58, muR: 1.72,   // huge grip-to-weight (sticky slicks)
    },
    arbF: 40000, arbR: 30000,
    engine: {                        // 125cc 2-stroke, peaky powerband
      rpm: [2500, 5000, 7000, 9000, 10500, 11500, 12500, 13200, 14000, 14600],
      nm:  [10,   16,   23,   31,   38,    42,    41,    37,    30,    11],
      idle: 2800, redline: 14000, engBrake: [10, 0.006], shiftDown: 8500,
    },
    gears: [3.85, 2.95, 2.30, 1.82, 1.42, 1.05], final: 4.90, reverse: 3.0,
    brakeT: 1750, bias: 0.46,
    aero: { cda: 0.55, cla: 0.02 },
    audio: {
      cyl: 2, turbo: false,          // 2-cyl firing rate ~ a 2-stroke single's buzz
      orders: [1, 0.5, 1.5, 2, 3, 1.02],
      gains:  [0.5, 0.2, 0.3, 0.2, 0.12, 0.24],
      gearbox: 'direct',
      tone: 2200, rasp: 0.7, pops: 0.2, intake: 0.6, sub: 0.05,
    },
    // tiny screaming 2-stroke: short pipe = high pitch, bright, ringing
    engine_model: {
      cyl: 2, intakeLen: 42, exhaustLen: 38, extractorLen: 40,
      straightPipeLen: 50, mufflerElements: [4, 6, 8, 10], mufflerAction: 0.10,
      ignitionTime: 0.006, intakeOpen: 0.2, intakeClosed: 0.9,
      exhaustOpen: 0.2, exhaustClosed: 0.95,
      cylRefl: 0.68, pistonAmp: 0.8,
      outletGain: 1.05, intakeMix: 1.0, blockMix: 0.8, decelPops: 0.4, level: 0.55,
      // 2-cyl screamer: scoop the boomy firing region, push a bright 2-4kHz buzz
      // peak — the distinctive kart shriek (matched to a Rotax onboard). Sharp
      // ignition (0.006) generates the upper harmonics the buzz peak lifts.
      cutF: 210, cutQ: 0.8, cutDb: -7.0, peakF: 2700, peakQ: 0.8, peakDb: 9.0,
      shelfF: 3600, shelfDb: 4.0,
    },
    visual: { type: 'kart', color: 0xe23b2e, accent: 0x111111 },
    dialMax: 16, dialRed: 14, dialSpeed: 160,
  },

  f1: {
    id: 'f1',
    hidden: true,                    // temporarily hidden from menu/UI (data kept)
    name: 'F1',
    mass: 798,                       // 2024 regulation minimum
    inertia: [900, 1150, 340],       // low, long, centralized mass = agile
    comH: 0.30,
    drive: 'RWD',
    wheels: {
      fz: -1.72, rz: 1.88, htF: 0.92, htR: 0.94,
      attachY: 0.18, restLen: 0.10, radius: 0.34, iw: 1.5,
      kF: 220000, kR: 260000,        // very stiff (aero platform)
      cBF: 11000, cRF: 16000, cBR: 12000, cRR: 17000,
      maxC: 0.07, muF: 1.68, muR: 1.74,   // slicks; downforce does the rest
    },
    arbF: 90000, arbR: 70000,
    engine: {                        // 1.6 V6 turbo hybrid, ~1000 hp incl ERS
      rpm: [4000, 6000, 8000, 9000, 10000, 10800, 11500, 12200, 12800, 13200],
      nm:  [300,  430,  540,  600,  640,   650,   640,   615,   560,   200],
      idle: 4000, redline: 13000, engBrake: [40, 0.02], shiftDown: 6500,
    },
    gears: [2.80, 2.20, 1.80, 1.50, 1.28, 1.12, 1.00, 0.92], final: 5.00, reverse: 3.2,
    brakeT: 9500, bias: 0.58,
    aero: { cda: 1.20, cla: 5.5 },   // huge downforce — ~2x weight at 250 km/h
    audio: {
      cyl: 6, turbo: true,
      orders: [1, 0.5, 1.5, 2, 3, 1.03],
      gains:  [0.4, 0.12, 0.34, 0.24, 0.18, 0.26],
      gearbox: 'sequential',
      tone: 2600, rasp: 0.5, pops: 0.5, intake: 0.9, sub: 0.06,
    },
    // high-revving V6 turbo scream — short bright pipe, strong mech zing
    engine_model: {
      cyl: 6, intakeLen: 55, exhaustLen: 48, extractorLen: 52,
      straightPipeLen: 64, mufflerElements: [5, 7, 9, 12], mufflerAction: 0.10,
      ignitionTime: 0.009, intakeOpen: 0.22, intakeClosed: 0.9,
      exhaustOpen: 0.22, exhaustClosed: 0.95,
      cylRefl: 0.6, pistonAmp: 0.85,
      outletGain: 1.0, intakeMix: 1.1, blockMix: 0.5, decelPops: 0.45, level: 0.62,
      // V6 turbo: hard de-boom, strong 700Hz howl (firing ~600Hz at 12k), bright
      // top — energy centers 500-1kHz like the real PU (matched to onboard).
      hpHz: 210, hpQ: 0.7, cutF: 150, cutQ: 1.1, cutDb: -4.0,
      peakF: 760, peakQ: 0.5, peakDb: 6.0, shelfF: 2100, shelfDb: 5.0,
    },
    visual: { type: 'formula', color: 0x1568c8, accent: 0xece81a, wing: 'gt' },
    dialMax: 14, dialRed: 13, dialSpeed: 360,
  },
};

export function savedCarId() {
  const id = localStorage.getItem('ns-car');
  return CARS[id] && !CARS[id].hidden ? id : 'avante';
}
