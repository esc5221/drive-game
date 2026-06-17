// Audio layer registry — every distinct sound is a named layer that can be
// toggled and gain-trimmed independently, at runtime, persisted to localStorage.
// audio.js gates every sound through cfg[key]; main.js / the HUD panel flip them.
//
// group is only for grouping in the toggle UI. `on` and `gain` are the live
// state. Add a layer here + gate it in audio.js with this._g('key', value).

export const AUDIO_LAYER_DEFS = [
  // powertrain
  { key: 'engine',      label: 'Engine',        group: 'Powertrain' },
  { key: 'exhaust',     label: 'Exhaust rasp',  group: 'Powertrain' },
  { key: 'shift',       label: 'Gear shift',    group: 'Powertrain' },
  { key: 'limiter',     label: 'Rev limiter',   group: 'Powertrain' },
  { key: 'turbo',       label: 'Turbo',         group: 'Powertrain' },
  // tires
  { key: 'tireSqueal',  label: 'Tire squeal',   group: 'Tires' },
  { key: 'tireScrub',   label: 'Tire scrub',    group: 'Tires' },
  { key: 'lockup',      label: 'Brake lockup',  group: 'Tires' },
  // road / chassis
  { key: 'roar',        label: 'Road roar',     group: 'Road' },
  { key: 'seams',       label: 'Road seams',    group: 'Road' },
  { key: 'curb',        label: 'Kerb strikes',  group: 'Road' },
  { key: 'grass',       label: 'Off-track',     group: 'Road' },
  { key: 'scrape',      label: 'Floor scrape',  group: 'Road' },
  { key: 'landing',     label: 'Jolts/landing', group: 'Chassis' },
  // brakes
  { key: 'brakeRub',    label: 'Brake friction',group: 'Brakes' },
  { key: 'brakeSqueal', label: 'Brake squeal',  group: 'Brakes' },
  // ambient
  { key: 'wind',        label: 'Wind',          group: 'Ambient' },
  { key: 'rain',        label: 'Rain',          group: 'Ambient' },
];

export function defaultAudioCfg() {
  const c = {};
  for (const d of AUDIO_LAYER_DEFS) c[d.key] = { on: true, gain: 1 };
  return c;
}

const LS_KEY = 'ns-audio-cfg';

// merge persisted overrides onto the defaults (so new layers appear enabled
// even for users with an older saved config).
export function loadAudioCfg() {
  const c = defaultAudioCfg();
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    for (const k in c) if (saved[k]) {
      if (typeof saved[k].on === 'boolean') c[k].on = saved[k].on;
      if (typeof saved[k].gain === 'number') c[k].gain = saved[k].gain;
    }
  } catch (e) {}
  return c;
}

export function saveAudioCfg(cfg) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) {}
}
