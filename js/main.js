// Boot + game loop: fixed-step physics (240 Hz), camera rigs, HUD, audio.
import * as THREE from 'three';
import { TRACK as T_NORD } from './track_data.js';
import { TRACK as T_SPA } from './tracks/spa.js';
import { TRACK as T_EVER } from './tracks/everland.js';
import { TRACK as T_PRAC } from './tracks/practice.js';
import { TRACK as T_KART } from './tracks/kart.js';
import { DEM } from './dem_data.js';
import { setDem, demHeight } from './terrain.js';
import { trackMeta } from './tracks/index.js';
import { generateRandomTrack } from './tracks/random.js';
import { showMenu } from './menu.js';
import { Track, setTrackWidth } from './track.js';
import { Vehicle, DT, setWeatherGrip } from './physics.js';
import { buildWorld, groundHeightAt } from './world.js';
import { Atmosphere } from './atmo.js';
import { Rain } from './rain.js';
import { Post } from './post.js';
import { CarVisual } from './car.js';
import { Input } from './input.js';
import { TouchInput, isTouchDevice, showStartOverlay } from './touch.js';
import { AutoQuality } from './quality.js';
import { loadGfxCfg, saveGfxCfg, applyPreset, setOption, detectPreset, GFX_DEFS, PRESET_ORDER, LIVE_KEYS } from './gfx-config.js';
import { CARS, savedCarId } from './cars.js';
import { SettingsPanel } from './settings.js';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { SURF } from './track.js';
import { CarAudio } from './audio.js';
import { Hud } from './hud.js';
import { Ghost } from './ghost.js';
import { RaceLine } from './raceline.js';
import { IDEAL_PRACTICE } from './ideal-practice.js';
import { SCREEN_POS, IS_VIEW, TripleLink, screenQuad, applyOffAxis, loadGeo, saveGeo, singleHFov, openTriple, DEFAULT_GEO } from './triple.js';
import { BENCH, autoDrive, initGpuTimer, gpuBegin, gpuEnd, benchFrame, benchReset } from './bench.js';

const TRACK_DATA = { nordschleife: T_NORD, spa: T_SPA, everland: T_EVER, practice: T_PRAC, kart: T_KART };
const _savedTrack = localStorage.getItem('ns-track');
const isRandom = _savedTrack === 'random';
// a saved hidden/removed track (e.g. kart) falls back to the default
const trackId = isRandom ? 'random'
  : (_savedTrack && TRACK_DATA[_savedTrack] && !trackMeta(_savedTrack).hidden) ? _savedTrack : 'nordschleife';
let randomSeed = 0;
let TRACK;
if (isRandom) {
  // procedural circuit — generated from the stored seed so it's reproducible
  randomSeed = (+localStorage.getItem('ns-random-seed')) >>> 0;
  if (!randomSeed) randomSeed = (Math.random() * 0xffffffff) >>> 0;
  TRACK = generateRandomTrack(randomSeed);
  if (!TRACK) { randomSeed = (Math.random() * 0xffffffff) >>> 0; TRACK = generateRandomTrack(randomSeed); }
  localStorage.setItem('ns-random-seed', String(randomSeed));
} else {
  TRACK = TRACK_DATA[trackId] || T_NORD;
}
const tMeta = trackMeta(trackId);
// records/ghost keyed per generated layout so each seed keeps its own best
const lapTid = isRandom ? 'random-' + randomSeed : trackId;
setTrackWidth(TRACK.roadHalf || 4.5);               // narrow kart track, wide road circuits
setDem(trackId === 'nordschleife' ? DEM : null);   // real DEM only for the 'Ring
const track = new Track(TRACK);

const TOUCH = isTouchDevice();
// side view windows force a light profile (3 WebGL contexts on one machine):
// no post / shadows, minimal trees. The center (main) window keeps the user's gfx.
const gfx = IS_VIEW
  ? Object.assign(loadGfxCfg(), { pr: 1.0, msaa: 0, shadow: 0, soft: 0, bloom: 0, blur: 0, mirror: 0, trees: 0.4, aniso: 2 })
  : loadGfxCfg();
let _geo = loadGeo();          // triple-monitor geometry (defined early: settings reads it)
let _tripleActive = false;     // main window joins the triple (center off-axis) once side windows open
// auto-downgrade only when the user left graphics on 'auto'; a manual preset /
// custom choice forces AutoQuality.done (pass 'low') so it never fights the user.
const autoTier = gfx.preset === 'auto' ? detectPreset() : 'low';

const renderer = new THREE.WebGLRenderer({
  antialias: gfx.msaa === 0,          // composer tiers get MSAA via render target
  powerPreference: 'high-performance',
});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, gfx.pr));
renderer.shadowMap.enabled = gfx.shadow > 0;
renderer.shadowMap.type = gfx.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('app').appendChild(renderer.domElement);
if (BENCH) initGpuTimer(renderer);   // WebGL2 GPU timer for the benchmark

const scene = new THREE.Scene();
const atmo = new Atmosphere(scene, renderer, { shadow: gfx.shadow, farScale: gfx.far });
const world = buildWorld(scene, track, { trees: gfx.trees, aniso: gfx.aniso, nord: trackId === 'nordschleife' });
const roadMat = world.roadMat;
const streetlights = world.streetlights;

// rain + a small pool of moving street-lamp lights (placed near the car)
const rain = new Rain(scene, renderer, Math.floor(5200 * (gfx.trees || 1)));
const lampLights = [];
for (let i = 0; i < (gfx.shadow > 0 ? 6 : 4); i++) {
  const pl = new THREE.PointLight(0xffd9a0, 0, 28, 2);
  scene.add(pl); lampLights.push(pl);
}
const lampBest = lampLights.map(() => ({ d: Infinity, i: -1 }));
let lampsActive = false;
const _roadColor0 = roadMat.color.clone();

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.06, 24000);
const post = new Post(renderer, scene, camera, { bloom: gfx.bloom, blur: gfx.blur, msaa: gfx.msaa });
let mirrorEvery = gfx.mirror;
const autoQ = new AutoQuality(autoTier, renderer, post, [
  { label: 'Mirror OFF', run: () => { mirrorEvery = 0; } },
]);

// live graphics apply (LIVE_KEYS only — pr/mirror/bloom/blur/soft); the rest
// reload via Settings. post.setBloom/setBlur are added to Post (contract).
function applyGfxLive(cfg) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, cfg.pr));
  post.resize(innerWidth, innerHeight);
  mirrorEvery = cfg.mirror;
  post.setBloom(!!cfg.bloom);
  post.setBlur(!!cfg.blur);
  renderer.shadowMap.type = cfg.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  renderer.shadowMap.needsUpdate = true;
}

const SPAWN_S = TRACK.spawn ?? tMeta.spawn;   // per-track start (random supplies its own)
let carId = savedCarId();
let vehicle = new Vehicle(track, CARS[carId]);
vehicle.reset(SPAWN_S);

let carVis = new CarVisual(scene, renderer, CARS[carId]);
const input = TOUCH ? new TouchInput() : new Input();
const audio = new CarAudio();
const hud = new Hud(track, lapTid, SPAWN_S);
const ghost = new Ghost(scene, track, lapTid);
hud.ghost = ghost;
const raceLine = new RaceLine(scene, track);
// ideal-lap guide is available only for the solved combo (practice + GT3 RS)
function refreshIdeal(cid) {
  if (trackId === 'practice' && cid === 'gt3rs') raceLine.setIdeal(IDEAL_PRACTICE.pts);
  else raceLine.clearIdeal();
}
refreshIdeal(carId);

let camMode = 0;     // 0 cockpit, 1 hood, 2 chase
// Horizon-tilt (RR3-style): in tilt-steering mode, roll the camera to keep the horizon
// level as the car banks/crests. Only takes effect when input.mode === 'tilt' (mobile).
let horizonTilt = (() => { try { return (localStorage.getItem('ns-horizon') ?? '1') === '1'; } catch (e) { return true; } })();
// restore persisted assist / display prefs (these used to reset every reload)
try {
  const ls = k => localStorage.getItem(k);
  if (ls('ns-tc') != null) vehicle.tc = ls('ns-tc') === '1';
  if (ls('ns-abs') != null) vehicle.abs = ls('ns-abs') === '1';
  if (ls('ns-auto') != null) { vehicle.auto = ls('ns-auto') === '1'; if (vehicle.gear < 1) vehicle.gear = 1; }
  if (ls('ns-ghost-on') != null) ghost.enabled = ls('ns-ghost-on') === '1';
  if (ls('ns-cam') != null) camMode = +ls('ns-cam') || 0;
  if (ls('ns-preset') != null) { atmo.apply(+ls('ns-preset') || 0); applyNight(); }
} catch (e) {}
carVis.setCameraMode(camMode);
let paused = false;

// persist user prefs so they survive a reload (assists / ghost / camera / weather)
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const persistAssists = () => { lsSet('ns-tc', vehicle.tc ? '1' : '0'); lsSet('ns-abs', vehicle.abs ? '1' : '0'); lsSet('ns-auto', vehicle.auto ? '1' : '0'); };

if (!IS_VIEW) input.onKey = code => {
  const firstStart = !audio.started;
  audio.start();
  if (firstStart) audio.setEngine(CARS[carId]);
  if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  if (code.startsWith('__mode:')) {
    hud.flash(code.endsWith('tilt') ? 'Tilt steering — tilt the phone like a wheel' : 'Button steering');
    return;
  }
  switch (code) {
    case 'KeyR':
      recoverToTrack();
      break;
    case 'KeyC':
      camMode = (camMode + 1) % 3;
      carVis.setCameraMode(camMode);
      lsSet('ns-cam', String(camMode));
      break;
    case 'ShiftLeft': case 'ShiftRight': case 'ArrowUp':
      if (!vehicle.auto || input.arrowsMode === 'shift') vehicle.shiftUp();
      break;
    case 'ControlLeft': case 'ControlRight': case 'ArrowDown':
      if (!vehicle.auto || input.arrowsMode === 'shift') vehicle.shiftDown();
      break;
    case 'KeyM':
      vehicle.auto = !vehicle.auto;
      if (vehicle.gear < 1) vehicle.gear = 1;
      if (TOUCH) input.setManual(!vehicle.auto);
      persistAssists();
      hud.flash(vehicle.auto ? 'AUTOMATIC' : 'MANUAL — ↑ upshift / ↓ downshift, W/S pedals');
      break;
    case 'KeyT':
      vehicle.tc = !vehicle.tc;
      persistAssists();
      hud.flash('Traction Control ' + (vehicle.tc ? 'ON' : 'OFF'));
      break;
    case 'KeyB':
      vehicle.abs = !vehicle.abs;
      persistAssists();
      hud.flash('ABS ' + (vehicle.abs ? 'ON' : 'OFF'));
      break;
    case 'KeyH':
      hud.toggleHelp();
      break;
    case 'KeyN':
      hud.flash(atmo.cycle());
      applyNight();
      lsSet('ns-preset', String(atmo.idx));
      break;
    case 'KeyG':
      ghost.enabled = !ghost.enabled;
      lsSet('ns-ghost-on', ghost.enabled ? '1' : '0');
      hud.flash('Ghost ' + (ghost.enabled ? 'ON' : 'OFF') +
        (ghost.hasBest ? '' : ' (set a best lap first)'));
      break;
    case 'KeyL':
      hud.flash('Racing line: ' + raceLine.cycleMode());
      break;
    case 'KeyV':
      setWatch(!watch);
      break;
    case 'KeyP': case 'Escape':
      settings.toggle();
      break;
  }
  if (watch && ['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) setWatch(false);
  if (['ArrowUp', 'KeyW'].includes(code)) hud.toggleHelp(false);
};

// environment state (preset) drives headlights, wet road, rain, streetlights, grip
function applyNight() {
  carVis.setHeadlights(atmo.isNight || atmo.rain);
  rain.setActive(atmo.rain);
  audio.setRain(atmo.rain);
  setWeatherGrip(atmo.grip);
  setWetRoad(atmo.wet);
  streetlights.group.visible = atmo.streetlights;
  lampsActive = atmo.streetlights;
  if (!lampsActive) for (const pl of lampLights) pl.intensity = 0;
}

function setWetRoad(on) {
  roadMat.roughness = on ? 0.42 : 0.94;
  roadMat.metalness = on ? 0.12 : 0;
  roadMat.envMapIntensity = on ? 1.5 : 1;
  if (on) roadMat.color.copy(_roadColor0).multiplyScalar(0.5);
  else roadMat.color.copy(_roadColor0);
  roadMat.needsUpdate = true;
}

// place the lamp-light pool on the nearest street lamps each frame
function updateLamps() {
  const hp = streetlights.headPos, cnt = hp.length / 3;
  const px = vehicle.pos.x, pz = vehicle.pos.z;
  for (const b of lampBest) { b.d = Infinity; b.i = -1; }
  for (let k = 0; k < cnt; k++) {
    const dx = hp[k * 3] - px, dz = hp[k * 3 + 2] - pz, d = dx * dx + dz * dz;
    if (d > 3600) continue;                       // 60 m radius
    let mi = 0;
    for (let j = 1; j < lampBest.length; j++) if (lampBest[j].d > lampBest[mi].d) mi = j;
    if (d < lampBest[mi].d) { lampBest[mi].d = d; lampBest[mi].i = k; }
  }
  for (let j = 0; j < lampLights.length; j++) {
    const b = lampBest[j], pl = lampLights[j];
    if (b.i >= 0) { pl.position.set(hp[b.i * 3], hp[b.i * 3 + 1], hp[b.i * 3 + 2]); pl.intensity = 22; }
    else pl.intensity = 0;
  }
}

// ---- car switching (rebuild vehicle + visuals at the same track position)
function setCar(id) {
  if (!CARS[id] || id === carId) return;
  carId = id;
  localStorage.setItem('ns-car', id);
  const s = vehicle.trackS;
  carVis.dispose();
  vehicle = new Vehicle(track, CARS[id]);
  vehicle.reset(s);
  carVis = new CarVisual(scene, renderer, CARS[id]);
  carVis.setCameraMode(camMode);
  carVis.setHeadlights(atmo.isNight || atmo.rain);
  audio.setEngine(CARS[id]);
  lastGear = 1;
  window.__vehicle = vehicle;
  refreshIdeal(id);
  hud.invalidateLap();
  hud.flash(CARS[id].name);
}

// ---- settings panel
const settings = new SettingsPanel({
  isTouch: TOUCH,
  getState: () => ({
    car: carId, cam: camMode, ctrl: TOUCH ? input.mode : 'buttons',
    tc: vehicle.tc, abs: vehicle.abs, auto: vehicle.auto,
    line: raceLine.mode, ghost: ghost.enabled, preset: atmo.idx,
    arrows: input.arrowsMode, watch, hasIdeal: raceLine.hasIdeal, inputOv,
    horizon: horizonTilt,
  }),
  setCar,
  setWatch: v => setWatch(v),
  setInputOv: v => setInputOv(v),
  setLineMode: m => { raceLine.setMode(m); },
  setCam: i => { camMode = i; carVis.setCameraMode(i); lsSet('ns-cam', String(i)); },
  setCtrl: m => { if (TOUCH) input.setMode(m); },
  setArrows: m => { if (input.setArrows) input.setArrows(m); },
  setPreset: i => { atmo.apply(i); applyNight(); lsSet('ns-preset', String(i)); },
  gfxCfg: () => gfx,
  gfxDefs: () => GFX_DEFS,
  gfxPresets: () => PRESET_ORDER,
  setGfxPreset: name => {
    Object.assign(gfx, applyPreset(name)); gfx.preset = name;
    saveGfxCfg(gfx); location.reload();          // full re-apply on preset switch
  },
  setGfxOption: (key, val) => {
    Object.assign(gfx, setOption(gfx, key, val));
    saveGfxCfg(gfx);
    if (LIVE_KEYS.includes(key)) applyGfxLive(gfx); else location.reload();
  },
  // triple-monitor: geometry tweaks apply live (broadcast each frame), start/stop
  tripleGeo: () => _geo,
  tripleHFov: () => singleHFov(_geo),
  setTripleGeo: (k, v) => { _geo = { ..._geo, [k]: v }; saveGeo(_geo); },
  tripleActive: () => _tripleActive,
  tripleStart: () => { _tripleActive = true; openTriple(); },
  tripleStop: () => { _tripleActive = false; },
  resetTripleGeo: () => { _geo = { ...DEFAULT_GEO }; saveGeo(_geo); },
  toggle: name => {
    if (name === 'tc') { vehicle.tc = !vehicle.tc; persistAssists(); }
    else if (name === 'abs') { vehicle.abs = !vehicle.abs; persistAssists(); }
    else if (name === 'auto') { vehicle.auto = !vehicle.auto; if (vehicle.gear < 1) vehicle.gear = 1; if (TOUCH) input.setManual(!vehicle.auto); persistAssists(); }
    else if (name === 'ghost') { ghost.enabled = !ghost.enabled; lsSet('ns-ghost-on', ghost.enabled ? '1' : '0'); }
    else if (name === 'horizon') { horizonTilt = !horizonTilt; try { localStorage.setItem('ns-horizon', horizonTilt ? '1' : '0'); } catch (e) {} }
  },
  resetRecords: () => {
    localStorage.removeItem('ns-best2');
    localStorage.removeItem('ns-best-sectors2');
    localStorage.removeItem('ns-ghost2');
    hud.bestLap = null; hud.bestSectors = [null, null, null];
    hud.el.best.textContent = 'BEST  --:--.---';
    ghost.best = null;
    hud.flash('Records cleared');
  },
  setPaused: v => { paused = v; updateAudioGate(); },
  audioLayers: () => audio.layerDefs(),
  audioState: () => audio.layerStates(),
  setAudioLayer: (k, on) => audio.setLayer(k, on),
});

// mute audio when paused (settings open) or when the tab/app is backgrounded
function updateAudioGate() {
  audio.setActive(!paused && !document.hidden);
}
document.addEventListener('visibilitychange', updateAudioGate);
addEventListener('pagehide', () => audio.setActive(false));

// haptics (mobile): curb buzz, rail scrape, gear shifts
let lastHaptic = 0;
let lastGear = 1;
function updateHaptics(now) {
  if (!TOUCH) return;
  const onCurb = vehicle.wheels.some(w => w.contact && w.surf === SURF.CURB);
  const speed = Math.abs(vehicle.speed);
  try {
    if (vehicle.gear !== lastGear) {
      // upshift only (accelerating); no haptic on downshift
      if (vehicle.gear > lastGear && lastGear >= 1) {
        Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      }
      lastGear = vehicle.gear;
    }
    if (vehicle.landImpact > 0.55) {
      lastHaptic = now;
      Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
      return;
    }
    if (now - lastHaptic < 110) return;
    if (vehicle.scrape > 0.25) {
      lastHaptic = now;
      Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
    } else if (onCurb && speed > 8) {
      lastHaptic = now;
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    }
  } catch (e) { /* web fallback may be unavailable */ }
}

// recover to track: works upside down, off-track, airborne — always
function recoverToTrack(reason) {
  vehicle.reset(vehicle.trackS);
  hud.invalidateLap();
  hud.flash(reason === 'flip' ? 'Flipped — recovering' : 'Reset to track');
}
const resetBtn = document.getElementById('reset-btn');
resetBtn.addEventListener('click', () => {
  recoverToTrack();
  resetBtn.blur();          // give keyboard focus back to the game
  audio.start();
});

// reverse handling: holding brake at standstill engages reverse.
// NOTE: read RAW input, not vehicle.ctrl — pedals are swapped while in reverse
// (ctrl.throttle = the reverse-accel pedal), so testing ctrl.throttle made the
// reverse-accel input look like "go forward" and flip-flopped gear -1 <-> 1.
function autoReverse() {
  if (!vehicle.auto) return;
  if (input.brake > 0.4 && Math.abs(vehicle.speed) < 0.6 && vehicle.gear === 1) {
    vehicle.gear = -1;
  } else if (vehicle.gear === -1 && input.throttle > 0.3 && vehicle.speed > -0.6) {
    vehicle.gear = 1;   // forward intent (up key) only — never the reverse pedal
  }
}

// in reverse, swap pedals so DOWN arrow actually backs up
function applyControls() {
  if (vehicle.gear === -1) {
    vehicle.ctrl.throttle = input.brake;
    vehicle.ctrl.brake = input.throttle;
  } else {
    vehicle.ctrl.throttle = input.throttle;
    vehicle.ctrl.brake = input.brake;
  }
  vehicle.ctrl.steer = input.steer;
  vehicle.ctrl.handbrake = input.handbrake;
}

// ---- autopilot (Watch mode): the grip-ellipse slip controller (same as the
// ideal-lap solver) drives the racing line in real time. Lap is not recorded.
let watch = false, _tcBak = true, _absBak = true, apLaunched = false;
const _apFwd = new THREE.Vector3(), _apRgt = new THREE.Vector3();
const AP_L = 2.65;                                   // GT3 RS wheelbase
// Reproduces the CMA-optimized minimum-time lap (raceLine.offsets = optimized line,
// raceLine.idealSpd = optimized speed plan, raceLine.idealSK = line's signed curvature).
// Same controller the optimizer scored against: pure-pursuit + curvature feed-forward
// + body-slip damping for steering; speed-error tracking for the pedals (TC/ABS on).
function autopilot(v) {
  const off = raceLine.offsets, vp = raceLine.idealSpd, sk = raceLine.idealSK;
  if (!off || !vp || !sk) return;
  const n = track.n, step = track.step;
  const q = track.query(v.pos.x, v.pos.z, {}, v.pos.y);
  if (!q) return;
  const i = ((Math.floor(q.s / step) % n) + n) % n, spd = v.speedKmh;
  // ---- steering: pure-pursuit + curvature feed-forward + body-slip damping -----
  const la = THREE.MathUtils.clamp(5 + spd * 0.22, 4, 22);
  const j = (i + Math.max(1, Math.floor(la / step))) % n;
  _apFwd.set(0, 0, -1).applyQuaternion(v.quat);
  _apRgt.set(1, 0, 0).applyQuaternion(v.quat);
  const tx = track.px[j] + track.rx[j] * off[j], tz = track.pz[j] + track.rz[j] * off[j];
  const dx = tx - v.pos.x, dz = tz - v.pos.z, dl = Math.hypot(dx, dz) || 1;
  const sinA = THREE.MathUtils.clamp(_apFwd.x * (dz / dl) - _apFwd.z * (dx / dl), -1, 1);
  const vLat = v.vel.x * _apRgt.x + v.vel.z * _apRgt.z;
  const bsl = Math.atan2(vLat, Math.max(8, Math.abs(v.speed)));
  const ms = Math.max(0.08, v.maxSteerAngle());
  let steerT = THREE.MathUtils.clamp(sinA * 4.0 + 0.3 * Math.atan(AP_L * sk[j]) / ms - 0.5 * bsl, -1, 1);
  // launch off the line dead-straight (no steering) until rolling: a stationary car that
  // both floors it AND turns toward the line burns lateral grip and just spins. The start
  // is a straight, so going straight lets all grip go longitudinal — a clean full-power launch.
  if (!apLaunched) { if (spd > 50) apLaunched = true; else if (spd < 35) steerT = 0; }
  v.ctrl.steer += THREE.MathUtils.clamp(steerT - v.ctrl.steer, -0.14, 0.14);
  // ---- speed target: optimized plan, with a short lag look-ahead (already braked) ---
  let vt = vp[i]; const ahead = Math.max(1, Math.floor(Math.abs(v.speed) * 0.10 / step));
  for (let d = 1; d <= ahead; d++) { const k = (i + d) % n; if (vp[k] < vt) vt = vp[k]; }
  const err = vt - spd, DE = 0.8;                    // km/h; coast band separates pedals
  let u;
  if (err > DE) u = THREE.MathUtils.clamp((err - DE) * 0.14, 0, 1);
  else if (err < -DE) u = THREE.MathUtils.clamp((err + DE) * 0.12, -1, 0);
  else u = 0;
  const cur = v.ctrl.throttle - v.ctrl.brake;
  const rate = (u > cur ? 16 : 24) / 240;
  const cmd = cur + THREE.MathUtils.clamp(u - cur, -rate, rate);
  v.ctrl.throttle = Math.max(0, cmd);
  v.ctrl.brake = Math.max(0, -cmd);
  v.ctrl.handbrake = false;
  // ---- traction control at low speed --------------------------------------------
  if (cmd > 0 && spd < 60) {
    const di = v.drivenFront ? 0 : 2, w0 = v.wheels[di], w1 = v.wheels[di + 1];
    const srR = (w0.contact && w1.contact) ? (w0.slipRatio + w1.slipRatio) / 2 : 0;
    if (!apLaunched) {
      // initial launch: full throttle, cap only extreme wheelspin (straight line → it hooks up)
      v.ctrl.throttle = srR > 0.30 ? Math.max(0, v.ctrl.throttle - 0.10) : 1;
    } else if (srR > 0.13) {
      // low-speed corner exits (steering → combined slip): modulate to peak grip, no spin
      v.ctrl.throttle = Math.max(0, v.ctrl.throttle - 0.15);
    } else {
      v.ctrl.throttle = Math.min(1, v.ctrl.throttle + 0.02);
    }
    v.ctrl.brake = 0;
  }
}
function setWatch(on) {
  watch = !!on;
  if (watch) {
    _tcBak = vehicle.tc; _absBak = vehicle.abs;
    vehicle.tc = true; vehicle.abs = true;            // let the car's own TC/ABS smooth the slip edge
    apLaunched = vehicle.speedKmh > 50;               // straight full-throttle launch only from low speed
    hud.invalidateLap();
    hud.flash('Autopilot ON — ideal line (lap not recorded). Press a key to take over');
  } else {
    vehicle.tc = _tcBak; vehicle.abs = _absBak;
    hud.flash('Autopilot OFF — you have control');
  }
}

// ---- input overlay (streaming-style): shows throttle/brake/steer from ctrl,
// so it works for both manual driving and Watch (autopilot).
const _iov = {
  el: document.getElementById('input-ov'),
  up: document.getElementById('iov-up'), down: document.getElementById('iov-down'),
  left: document.getElementById('iov-left'), right: document.getElementById('iov-right'),
};
let inputOv = (() => { try { return localStorage.getItem('ns-inputov') === '1'; } catch (e) { return false; } })();
function setInputOv(on) { inputOv = !!on; try { localStorage.setItem('ns-inputov', inputOv ? '1' : '0'); } catch (e) {} }
function updateInputOverlay() {
  if (!_iov.el) return;
  const show = inputOv || watch;
  _iov.el.classList.toggle('show', show);
  if (!show) return;
  const c = vehicle.ctrl;
  const set = (k, v) => { v = Math.min(1, Math.max(0, v)); k.querySelector('b').style.height = (v * 100) + '%'; k.classList.toggle('on', v > 0.05); };
  set(_iov.up, c.throttle); set(_iov.down, c.brake);
  set(_iov.left, c.steer < 0 ? -c.steer : 0); set(_iov.right, c.steer > 0 ? c.steer : 0);
}

// ---- camera rigs
const headPos = new THREE.Vector3();
const headOffset = new THREE.Vector3();
const camQuatTarget = new THREE.Quaternion();
const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
let headLean = new THREE.Vector3();
const chasePos = new THREE.Vector3();
let chaseInit = false;
// per-frame scratch (reused, no allocation in updateCamera)
const _camTmp = {
  behind: new THREE.Vector3(), look: new THREE.Vector3(),
  hoodEye: new THREE.Vector3(), gB: new THREE.Vector3(),
  qInv: new THREE.Quaternion(), lean: new THREE.Vector3(),
};
const HORIZON_SIGN = -1;         // counter the phone's physical roll so the horizon stays level

function updateCamera(dtVis) {
  const q = vehicle.quat;
  if (camMode === 2) {
    // chase: spring-damped follow
    const behind = _camTmp.behind.set(0, 1.6, 6.2).applyQuaternion(q).add(vehicle.pos);
    if (!chaseInit || chasePos.distanceTo(behind) > 40) { chasePos.copy(behind); chaseInit = true; }
    chasePos.lerp(behind, Math.min(1, dtVis * 4.5));
    // keep above visual ground (incl. hillsides)
    const gq = track.query(chasePos.x, chasePos.z, {}, chasePos.y);
    if (gq) {
      const gy = groundHeightAt(track, gq, chasePos.x, chasePos.z, chasePos.y);
      if (chasePos.y < gy + 0.7) chasePos.y = gy + 0.7;
    }
    camera.position.copy(chasePos);
    const look = _camTmp.look.set(0, 0.7, -2).applyQuaternion(q).add(vehicle.pos);
    camera.lookAt(look);
    camera.fov = 68;
  } else {
    const eyeLocal = camMode === 0 ? carVis.eyeLocal : _camTmp.hoodEye.set(0, 0.55, -1.0);
    // g-force head motion (body frame)
    const gB = _camTmp.gB.copy(vehicle.gForce).applyQuaternion(_camTmp.qInv.copy(q).invert());
    const targetLean = _camTmp.lean.set(
      THREE.MathUtils.clamp(-gB.x * 0.0035, -0.05, 0.05),
      THREE.MathUtils.clamp(-Math.abs(gB.x) * 0.0006, -0.02, 0.005),
      THREE.MathUtils.clamp(gB.z * 0.0030, -0.06, 0.045));
    headLean.lerp(targetLean, Math.min(1, dtVis * 7));
    headOffset.copy(eyeLocal).add(headLean);
    headPos.copy(headOffset).applyQuaternion(q).add(vehicle.pos);
    camera.position.copy(headPos);
    // cabin vibration: suspension activity + speed buzz + ABS shudder + landing slam.
    // Speed buzz is kept subtle so the rear-view mirror stays readable at speed.
    const v2 = vehicle.speed * vehicle.speed;
    let vib = Math.min(0.006, vehicle.suspActivity * 0.0011 + v2 * 5e-7);
    if (vehicle._absActive && vehicle.ctrl.brake > 0.3) vib += 0.003;
    camera.position.y += (Math.random() - 0.5) * vib + vehicle.landImpact * -0.035;
    camera.position.x += (Math.random() - 0.5) * vib * 0.6;

    // horizon tilt (tilt steering): the player physically rolls the phone to steer,
    // so the screen rolls with it and the horizon looks tilted. Counter-roll the camera
    // by the phone's physical tilt so the rendered horizon stays level to the eyes — the
    // whole view rotates to keep level (RR3 tilt feel), no black corners (camera roll).
    const roll = (horizonTilt && input.mode === 'tilt' && input.tiltRoll)
      ? HORIZON_SIGN * input.tiltRoll : 0;
    // look slightly into the corner + small pitch with acceleration + horizon-level roll
    lookEuler.set(
      THREE.MathUtils.clamp(gB.z * 0.0028, -0.05, 0.05),
      -vehicle.ctrl.steer * 0.10,
      roll);
    camQuatTarget.setFromEuler(lookEuler).premultiply(q);
    camera.quaternion.slerp(camQuatTarget, Math.min(1, dtVis * 14));
    camera.fov = 72 + Math.min(10, vehicle.speedKmh * 0.028);   // subtle speed FOV
  }
  camera.updateProjectionMatrix();
}

// ---- triple-monitor link (multi-window sync)
const link = new TripleLink();
let _rx = null;
if (IS_VIEW) link.onState(s => { _rx = s; });

// view window: apply the broadcast state to the (physics-less) vehicle, then
// render with this eye's yaw offset. No physics / input / audio / hud here.
function viewFrame(dtVis) {
  if (_rx) {
    vehicle.pos.fromArray(_rx.p); vehicle.quat.fromArray(_rx.q);
    vehicle.ctrl.steer = _rx.st; vehicle.rpm = _rx.rpm; vehicle.gear = _rx.g; vehicle.speed = _rx.sp;
    if (_rx.w) for (let i = 0; i < 4; i++) { const w = vehicle.wheels[i], r = _rx.w[i]; if (r) { w.spinAngle = r.s; w.steer = r.t; w.comp = r.c; } }
    if (_rx.pr !== atmo.idx) { atmo.apply(_rx.pr); applyNight(); }
    if (_rx.cam !== camMode) { camMode = _rx.cam; carVis.setCameraMode(camMode); }
    if (_rx.geo) _geo = _rx.geo;                  // live triple-geometry updates from main
  }
  carVis.update(vehicle, dtVis);
  updateCamera(dtVis);                          // eye pose (position + car/head orientation)
  applyOffAxis(camera, camera.position, camera.quaternion, screenQuad(SCREEN_POS, _geo), 0.06, 24000);
  atmo.follow(vehicle.pos);
  rain.update(dtVis, camera, vehicle.vel);
  post.render();
}

// state the main window broadcasts each frame (small, 60 Hz)
function broadcastState() {
  link.send({
    p: vehicle.pos.toArray(), q: vehicle.quat.toArray(),
    st: vehicle.ctrl.steer, rpm: vehicle.rpm, g: vehicle.gear, sp: vehicle.speed,
    w: vehicle.wheels.map(w => ({ s: w.spinAngle, t: w.steer, c: w.comp })),
    pr: atmo.idx, cam: camMode, geo: _geo,
  });
}

// ---- main loop
let last = performance.now();
let acc = 0;
let frame = 0;
// cap physics catch-up substeps: 240 Hz is kept, but a low-FPS frame can't
// trigger an unbounded step spiral (CPU runaway) on weak devices.
const MAX_SUBSTEPS = TOUCH ? 12 : 20;

function loop(now) {
  requestAnimationFrame(loop);
  let dtReal = (now - last) / 1000;
  last = now;
  if (dtReal > 0.1) dtReal = 0.1;

  if (IS_VIEW) { viewFrame(dtReal); return; }

  if (!paused) {
    if (BENCH) autoDrive(vehicle, track, raceLine);   // deterministic load for measurement
    else if (watch) autopilot(vehicle);               // Watch mode: autonomous ideal-line drive
    else { input.update(dtReal, vehicle); autoReverse(); applyControls(); }
    if (mp && mp.inputLocked) {                       // race countdown: hold on the grid
      vehicle.ctrl.steer = 0; vehicle.ctrl.throttle = 0;
      vehicle.ctrl.brake = 1; vehicle.ctrl.handbrake = true;
    }
    acc += dtReal;
    let steps = 0;
    while (acc >= DT && steps < MAX_SUBSTEPS) {
      vehicle.step(DT);
      acc -= DT;
      steps++;
    }
    if (vehicle.rollover) recoverToTrack('flip');   // stuck on side/roof -> respawn
    const _lapsBefore = hud.lapCount;
    hud.update(vehicle, dtReal);
    if (mp && hud.lapCount > _lapsBefore) mp.onLap(hud.lastLap, hud.lapValid);   // race finish hook
    ghost.update(dtReal, vehicle, hud.lapStart !== null ? hud.now() - hud.lapStart : null);
    raceLine.update(vehicle.trackS, Math.abs(vehicle.speed));
    audio.update(vehicle, dtReal);
    updateHaptics(now);
  }

  carVis.update(vehicle, dtReal);
  updateInputOverlay();
  if (mp) mp.update(dtReal, vehicle, paused);   // multiplayer: remote playback + gated state send
  updateCamera(dtReal);
  if (_tripleActive) applyOffAxis(camera, camera.position, camera.quaternion, screenQuad('C', _geo), 0.06, 24000);
  atmo.follow(vehicle.pos);
  rain.update(dtReal, camera, vehicle.vel);
  if (lampsActive) updateLamps();
  post.setSpeed(camMode === 2 ? 0 : vehicle.speedKmh);

  autoQ.tick(dtReal, fps => hud.flash(`Performance adjusted (${fps} fps)`));
  hud.fps = hud.fps === undefined ? 60 : hud.fps * 0.95 + (1 / Math.max(dtReal, 1e-3)) * 0.05;

  frame++;
  if (camMode === 0 && mirrorEvery > 0 && frame % mirrorEvery === 0) {
    carVis.renderMirror(renderer, scene, vehicle);
  }
  const _gq = BENCH ? gpuBegin() : null;
  post.render();
  if (BENCH) { gpuEnd(_gq); benchFrame(dtReal); }
  broadcastState();          // feed any open triple-monitor view windows
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.resize(innerWidth, innerHeight);
});

applyNight();          // apply initial preset's environment (grip/wet/rain/lamps)
requestAnimationFrame(loop);

// commit to driving: start audio, (touch) go fullscreen + lock landscape. Must run from
// a user gesture. Fullscreen is awaited before the orientation lock — locking before the
// element is fullscreen fails on Android Chrome, which is why portrait→landscape was flaky.
async function beginDrive() {
  paused = false;
  hud.toggleHelp(false);
  audio.start();                                  // synchronous in the gesture (Web Audio unlock)
  audio.setEngine(CARS[carId]);
  if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  updateAudioGate();
  if (TOUCH) {
    try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) {}
    try { await screen.orientation.lock('landscape'); } catch (e) {}
    TouchInput.requestMotionPermission();
    hud.flash(input.mode === 'tilt' ? 'Tilt steering — tilt the phone like a wheel' : 'Button steering');
  }
}

// boot: view windows render-only; otherwise skip the menu on a track-pick
// reload, else show it.
if (IS_VIEW) {
  paused = false;
  hud.toggleHelp(false);
  document.body.classList.add('ns-view');     // chrome hidden via CSS (.ns-view)
  if (post.setBloom) post.setBloom(false);    // side views stay cheap
  if (post.setBlur) post.setBlur(false);
  // fullscreen needs a user gesture in this window → one-tap overlay
  const fsOv = document.createElement('div');
  fsOv.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.6);color:#ffd24a;font-family:monospace;font-size:18px;letter-spacing:2px;cursor:pointer;text-align:center;';
  fsOv.innerHTML = '<div>▶ CLICK FOR FULLSCREEN<br><br><span style="color:#8a929c;font-size:13px;">' + SCREEN_POS + ' screen</span></div>';
  document.body.appendChild(fsOv);
  fsOv.addEventListener('click', async () => {
    try { await document.documentElement.requestFullscreen(); } catch (e) {}
    fsOv.remove();
  });
} else if (BENCH) {
  hud.toggleHelp(false);
  beginDrive();
  hud.flash('Benchmark running…');
} else if (sessionStorage.getItem('ns-go')) {
  sessionStorage.removeItem('ns-go');
  // a track change reloaded the page, so the start tap's gesture is gone — fullscreen +
  // landscape lock need a fresh one. On touch, a one-tap overlay provides it; desktop drives straight in.
  if (TOUCH) showStartOverlay(() => { hud.flash(tMeta.name); beginDrive(); });
  else { hud.flash(tMeta.name); beginDrive(); }
} else {
  paused = true;                 // freeze behind the menu
  hud.toggleHelp(false);
  showMenu({
    trackData: TRACK_DATA, currentTrack: trackId, currentCar: carId,
    isTouch: TOUCH,
    currentCtrl: TOUCH ? input.mode : 'buttons',
    onCtrl: m => { if (TOUCH) input.setMode(m); },
    onStart: (selTrack, selCar) => {
      // random always reloads so the (possibly rerolled) seed is regenerated fresh
      if (selTrack !== trackId || selTrack === 'random') {   // different track -> reload into it
        localStorage.setItem('ns-track', selTrack);
        localStorage.setItem('ns-car', selCar);
        sessionStorage.setItem('ns-go', '1');
        location.reload();
      } else {                                  // same track -> start now
        if (selCar !== carId) { localStorage.setItem('ns-car', selCar); setCar(selCar); }
        beginDrive();
      }
    },
  });
  // add a "Triple monitor" entry to the menu links (rendered by showMenu)
  const links = document.getElementById('menu-links');
  if (links) {
    const sep = document.createElement('span');
    sep.style.cssText = 'color:#3e4348;margin:0 9px;'; sep.textContent = '·';
    const a = document.createElement('a');
    a.href = '#'; a.textContent = 'Triple monitor ↗';
    a.style.cssText = 'color:#6a7177;text-decoration:none;';
    a.addEventListener('click', e => { e.preventDefault(); _tripleActive = true; openTriple(); });
    links.append(sep, a);
  }
}

window.__atmo = atmo;
window.__rain = rain;
window.__setPreset = i => { atmo.apply(i); applyNight(); };
window.__vehicle = vehicle;   // debug / test handle
window.__track = track;
window.__renderer = renderer;
window.__audio = audio;
window.__demHeight = demHeight;
window.__CARS = CARS;
window.__Vehicle = vehicle.constructor;
window.__CarAudio = audio.constructor;   // debug / test handle (isolated audio)
window.__raceLine = raceLine;            // ideal-lap harness reads offsets/vAllowed
window.__input = input;                  // debug / test handle (control mode)

// ---- multiplayer (link-only — the home page ships none of it) --------------------
// The lobby lives at /mp (mp.html via Pages pretty URLs); the game side activates
// only with ?room=. (Stale /mp-301 visitors are rescued by an inline script in
// index.html before any asset loads.)
let mp = null;
const MP_ON = !IS_VIEW && !BENCH && new URLSearchParams(location.search).has('room');
if (MP_ON) {
  import('./net.js').then(({ MPClient }) => {
    mp = new MPClient({
      scene, trackId, randomSeed, carId, hud,
      // race grid: slot 0 sits just behind the start line, others staggered behind
      grid: slot => {
        const s = ((SPAWN_S - 10 - 9 * slot) % track.total + track.total) % track.total;
        vehicle.reset(s);
        hud.lapStart = null;             // clock re-arms; crossing the line starts the lap
        if (watch) setWatch(false);      // no autopilot racing
      },
      // room-owned world: unified car / weather applied live on join (no reload)
      forceCar: id => { if (CARS[id] && id !== carId) { localStorage.setItem('ns-car', id); setCar(id); } },
      forcePreset: i => { if (i !== atmo.idx) { atmo.apply(i); applyNight(); lsSet('ns-preset', String(i)); } },
    });
    mp.track = track;                    // gap/rank chip (along-track distances)
    mp.camera = camera;                  // distance-scaled name tags
    mp.auto();
    window.__mp = mp;                    // debug / test handle
  }).catch(() => { /* multiplayer is an add-on — never block the game */ });
}
window.__hud = hud;                      // debug / test handle (lap timing)
window.__camera = camera;                // debug / test handle (camera rig)
if (BENCH) window.__benchReset = benchReset;   // CDP runner clears the warmup window
