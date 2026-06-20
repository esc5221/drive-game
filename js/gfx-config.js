// Graphics config: presets (low/medium/high/ultra) + per-option overrides,
// persisted to localStorage. Mirrors the audio-config.js pattern so Settings can
// offer a preset picker on top and individual graphics controls underneath.
//
// cfg shape (flat):  { preset, pr, msaa, shadow, soft, bloom, blur, mirror,
//                      trees, far, aniso }
//   preset: 'auto' | 'low' | 'medium' | 'high' | 'ultra' | 'custom'
//   the rest are the resolved values currently in effect.
//
// LIVE_KEYS apply instantly without a reload; everything else needs a reload
// (composer/world/fog rebuilds) — Settings calls location.reload() for those.

export const GFX_PRESETS = {
  ultra:  { pr: 2.0, msaa: 4, shadow: 2048, soft: 1, bloom: 1, blur: 1, mirror: 2, trees: 1.0, far: 1.0,  aniso: 8 },
  high:   { pr: 2.0, msaa: 4, shadow: 1024, soft: 0, bloom: 1, blur: 1, mirror: 3, trees: 0.7, far: 0.85, aniso: 4 },
  medium: { pr: 1.5, msaa: 2, shadow: 512,  soft: 0, bloom: 1, blur: 0, mirror: 6, trees: 0.7, far: 0.85, aniso: 4 },
  low:    { pr: 1.0, msaa: 0, shadow: 0,    soft: 0, bloom: 0, blur: 0, mirror: 0, trees: 0.4, far: 0.6,  aniso: 2 },
};

export const PRESET_ORDER = ['auto', 'low', 'medium', 'high', 'ultra'];

// individual options shown under the preset picker (Settings → Graphics)
export const GFX_DEFS = [
  { key: 'pr',     label: 'Resolution',     group: 'Display',  opts: [['1.0×', 1.0], ['1.5×', 1.5], ['2.0×', 2.0]] },
  { key: 'msaa',   label: 'Anti-aliasing',  group: 'Display',  opts: [['Off', 0], ['2×', 2], ['4×', 4]] },
  { key: 'shadow', label: 'Shadows',        group: 'Lighting', opts: [['Off', 0], ['Low', 512], ['High', 1024], ['Ultra', 2048]] },
  { key: 'soft',   label: 'Soft shadows',   group: 'Lighting', opts: [['Off', 0], ['On', 1]] },
  { key: 'bloom',  label: 'Bloom',          group: 'Effects',  opts: [['Off', 0], ['On', 1]] },
  { key: 'blur',   label: 'Speed blur',     group: 'Effects',  opts: [['Off', 0], ['On', 1]] },
  { key: 'mirror', label: 'Rear mirror',    group: 'Effects',  opts: [['Off', 0], ['Low', 8], ['Med', 6], ['High', 3]] },
  { key: 'trees',  label: 'Foliage',        group: 'World',    opts: [['Low', 0.4], ['Med', 0.7], ['High', 1.0]] },
  { key: 'far',    label: 'View distance',  group: 'World',    opts: [['Near', 0.6], ['Med', 0.85], ['Far', 1.0]] },
  { key: 'aniso',  label: 'Texture filter', group: 'World',    opts: [['Low', 2], ['Med', 4], ['High', 8]] },
];

// keys that can be applied live (no reload). Everything else => reload.
export const LIVE_KEYS = ['pr', 'mirror', 'bloom', 'blur', 'soft'];

const KEYS = Object.keys(GFX_PRESETS.high);
const STORE = 'ns-gfx';

// auto-detect a sensible preset. Desktop = ultra. Mobile is scaled by device
// memory / cores / pixel ratio — the old policy shoved most 8-core phones into
// 'high' (pr 2.0 = 4× pixels); medium is the right default for mid-range phones.
export function detectPreset() {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (!mobile) return 'ultra';
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const dpr = window.devicePixelRatio || 1;
  if (mem >= 8 && cores >= 8 && dpr <= 2.1) return 'high';
  if (mem >= 4 && cores >= 6) return 'medium';
  return 'low';
}

function resolvePreset(name) {
  const real = name === 'auto' ? detectPreset() : name;
  return GFX_PRESETS[real] ? GFX_PRESETS[real] : GFX_PRESETS.high;
}

export function defaultGfxCfg() {
  return { preset: 'auto', ...resolvePreset('auto') };
}

export function loadGfxCfg() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { /* ignore */ }
  const base = defaultGfxCfg();
  if (!saved) return base;
  // merge saved values onto the defaults so a newly added key still has a value
  const cfg = { ...base, ...saved };
  for (const k of KEYS) if (typeof cfg[k] !== 'number') cfg[k] = base[k];
  return cfg;
}

export function saveGfxCfg(cfg) {
  try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
}

// return a new cfg switched to `name` (preset values applied). preset stays as
// typed ('auto' keeps re-detecting on future loads).
export function applyPreset(name) {
  return { preset: name, ...resolvePreset(name) };
}

// return a new cfg with one option overridden; flips preset to 'custom'.
export function setOption(cfg, key, val) {
  return { ...cfg, [key]: val, preset: 'custom' };
}
