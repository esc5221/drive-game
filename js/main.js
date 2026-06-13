// Boot + game loop: fixed-step physics (240 Hz), camera rigs, HUD, audio.
import * as THREE from 'three';
import { TRACK as T_NORD } from './track_data.js';
import { TRACK as T_SPA } from './tracks/spa.js';
import { TRACK as T_PRAC } from './tracks/practice.js';
import { DEM } from './dem_data.js';
import { setDem } from './terrain.js';
import { trackMeta } from './tracks/index.js';
import { showMenu } from './menu.js';
import { Track } from './track.js';
import { Vehicle, DT } from './physics.js';
import { buildWorld, groundHeightAt } from './world.js';
import { Atmosphere } from './atmo.js';
import { Post } from './post.js';
import { CarVisual } from './car.js';
import { Input } from './input.js';
import { TouchInput, isTouchDevice, showStartOverlay } from './touch.js';
import { TIERS, detectTier, AutoQuality } from './quality.js';
import { CARS, savedCarId } from './cars.js';
import { SettingsPanel } from './settings.js';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { SURF } from './track.js';
import { CarAudio } from './audio.js';
import { Hud } from './hud.js';
import { Ghost } from './ghost.js';
import { RaceLine } from './raceline.js';

const TRACK_DATA = { nordschleife: T_NORD, spa: T_SPA, practice: T_PRAC };
const trackId = localStorage.getItem('ns-track') || 'nordschleife';
const TRACK = TRACK_DATA[trackId] || T_NORD;
const tMeta = trackMeta(trackId);
setDem(trackId === 'nordschleife' ? DEM : null);   // real DEM only for the 'Ring
const track = new Track(TRACK);

const TOUCH = isTouchDevice();
const tierName = detectTier();
const TIER = TIERS[tierName];

const renderer = new THREE.WebGLRenderer({
  antialias: TIER.msaa === 0,          // composer tiers get MSAA via render target
  powerPreference: 'high-performance',
});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, TIER.pr));
renderer.shadowMap.enabled = TIER.shadow > 0;
renderer.shadowMap.type = TIER.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const atmo = new Atmosphere(scene, renderer, { shadow: TIER.shadow, farScale: TIER.farScale });
buildWorld(scene, track, { trees: TIER.trees, aniso: TIER.aniso });

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.06, 24000);
const post = new Post(renderer, scene, camera, TIER);
const autoQ = new AutoQuality(tierName, renderer, post, [
  { label: '미러 OFF', run: () => { TIER.mirror = 0; } },
]);

const SPAWN_S = tMeta.spawn;   // per-track start position
let carId = savedCarId();
let vehicle = new Vehicle(track, CARS[carId]);
vehicle.reset(SPAWN_S);

let carVis = new CarVisual(scene, renderer, CARS[carId]);
const input = TOUCH ? new TouchInput() : new Input();
const audio = new CarAudio();
const hud = new Hud(track, trackId);
const ghost = new Ghost(scene, track, trackId);
hud.ghost = ghost;
const raceLine = new RaceLine(scene, track);

let camMode = 0;     // 0 cockpit, 1 hood, 2 chase
carVis.setCameraMode(camMode);
let paused = false;

input.onKey = code => {
  const firstStart = !audio.started;
  audio.start();
  if (firstStart) audio.setEngine(CARS[carId]);
  if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  if (code.startsWith('__mode:')) {
    hud.flash(code.endsWith('tilt') ? '틸트 조향 — 폰을 핸들처럼 기울이세요' : '버튼 조향');
    return;
  }
  switch (code) {
    case 'KeyR':
      recoverToTrack();
      break;
    case 'KeyC':
      camMode = (camMode + 1) % 3;
      carVis.setCameraMode(camMode);
      break;
    case 'ShiftLeft': case 'ShiftRight': case 'ArrowUp':
      if (!vehicle.auto) vehicle.shiftUp();
      break;
    case 'ControlLeft': case 'ControlRight': case 'ArrowDown':
      if (!vehicle.auto) vehicle.shiftDown();
      break;
    case 'KeyM':
      vehicle.auto = !vehicle.auto;
      if (vehicle.gear < 1) vehicle.gear = 1;
      if (TOUCH) input.setManual(!vehicle.auto);
      hud.flash(vehicle.auto ? 'AUTOMATIC' : 'MANUAL — ↑ 업시프트 / ↓ 다운시프트, W/S 페달');
      break;
    case 'KeyT':
      vehicle.tc = !vehicle.tc;
      hud.flash('Traction Control ' + (vehicle.tc ? 'ON' : 'OFF'));
      break;
    case 'KeyB':
      vehicle.abs = !vehicle.abs;
      hud.flash('ABS ' + (vehicle.abs ? 'ON' : 'OFF'));
      break;
    case 'KeyH':
      hud.toggleHelp();
      break;
    case 'KeyN':
      hud.flash(atmo.cycle());
      applyNight();
      break;
    case 'KeyG':
      ghost.enabled = !ghost.enabled;
      hud.flash('고스트 ' + (ghost.enabled ? 'ON' : 'OFF') +
        (ghost.hasBest ? '' : ' (베스트 랩을 먼저 기록하세요)'));
      break;
    case 'KeyL':
      hud.flash('레이싱 라인: ' + raceLine.cycleMode());
      break;
    case 'KeyP': case 'Escape':
      settings.toggle();
      break;
  }
  if (['ArrowUp', 'KeyW'].includes(code)) hud.toggleHelp(false);
};

// night state propagates to the headlights
function applyNight() {
  carVis.setHeadlights(atmo.isNight);
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
  carVis.setHeadlights(atmo.isNight);
  audio.setEngine(CARS[id]);
  lastGear = 1;
  window.__vehicle = vehicle;
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
  }),
  setCar,
  setLineMode: m => { raceLine.setMode(m); },
  setCam: i => { camMode = i; carVis.setCameraMode(i); },
  setCtrl: m => { if (TOUCH) input.setMode(m); },
  setPreset: i => { atmo.apply(i); applyNight(); },
  setTier: name => {
    if (name) localStorage.setItem('ns-tier', name);
    else localStorage.removeItem('ns-tier');
    location.reload();
  },
  toggle: name => {
    if (name === 'tc') vehicle.tc = !vehicle.tc;
    else if (name === 'abs') vehicle.abs = !vehicle.abs;
    else if (name === 'auto') { vehicle.auto = !vehicle.auto; if (vehicle.gear < 1) vehicle.gear = 1; if (TOUCH) input.setManual(!vehicle.auto); }
    else if (name === 'ghost') ghost.enabled = !ghost.enabled;
  },
  resetRecords: () => {
    localStorage.removeItem('ns-best2');
    localStorage.removeItem('ns-best-sectors2');
    localStorage.removeItem('ns-ghost2');
    hud.bestLap = null; hud.bestSectors = [null, null, null];
    hud.el.best.textContent = 'BEST  --:--.---';
    ghost.best = null;
    hud.flash('기록 초기화 완료');
  },
  setPaused: v => { paused = v; updateAudioGate(); },
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
      lastGear = vehicle.gear;
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
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
function recoverToTrack() {
  vehicle.reset(vehicle.trackS);
  hud.invalidateLap();
  hud.flash('트랙 복구');
}
const resetBtn = document.getElementById('reset-btn');
resetBtn.addEventListener('click', () => {
  recoverToTrack();
  resetBtn.blur();          // give keyboard focus back to the game
  audio.start();
});

// reverse handling: holding brake at standstill engages reverse
function autoReverse() {
  if (!vehicle.auto) return;
  if (vehicle.ctrl.brake > 0.4 && Math.abs(vehicle.speed) < 0.6 && vehicle.gear === 1) {
    vehicle.gear = -1;
  } else if (vehicle.gear === -1 && vehicle.ctrl.throttle > 0.3 && vehicle.speed > -0.6) {
    vehicle.gear = 1;
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

// ---- camera rigs
const headPos = new THREE.Vector3();
const headOffset = new THREE.Vector3();
const camQuatTarget = new THREE.Quaternion();
const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
let headLean = new THREE.Vector3();
const chasePos = new THREE.Vector3();
let chaseInit = false;

function updateCamera(dtVis) {
  const q = vehicle.quat;
  if (camMode === 2) {
    // chase: spring-damped follow
    const behind = new THREE.Vector3(0, 1.6, 6.2).applyQuaternion(q).add(vehicle.pos);
    if (!chaseInit || chasePos.distanceTo(behind) > 40) { chasePos.copy(behind); chaseInit = true; }
    chasePos.lerp(behind, Math.min(1, dtVis * 4.5));
    // keep above visual ground (incl. hillsides)
    const gq = track.query(chasePos.x, chasePos.z, {});
    if (gq) {
      const gy = groundHeightAt(track, gq, chasePos.x, chasePos.z);
      if (chasePos.y < gy + 0.7) chasePos.y = gy + 0.7;
    }
    camera.position.copy(chasePos);
    const look = new THREE.Vector3(0, 0.7, -2).applyQuaternion(q).add(vehicle.pos);
    camera.lookAt(look);
    camera.fov = 68;
  } else {
    const eyeLocal = camMode === 0 ? carVis.eyeLocal : new THREE.Vector3(0, 0.55, -1.0);
    // g-force head motion (body frame)
    const gB = vehicle.gForce.clone().applyQuaternion(q.clone().invert());
    const targetLean = new THREE.Vector3(
      THREE.MathUtils.clamp(-gB.x * 0.0035, -0.05, 0.05),
      THREE.MathUtils.clamp(-Math.abs(gB.x) * 0.0006, -0.02, 0.005),
      THREE.MathUtils.clamp(gB.z * 0.0030, -0.06, 0.045));
    headLean.lerp(targetLean, Math.min(1, dtVis * 7));
    headOffset.copy(eyeLocal).add(headLean);
    headPos.copy(headOffset).applyQuaternion(q).add(vehicle.pos);
    camera.position.copy(headPos);
    // cabin vibration: suspension activity + speed buzz + ABS shudder + landing slam
    const v2 = vehicle.speed * vehicle.speed;
    let vib = Math.min(0.010, vehicle.suspActivity * 0.0011 + v2 * 1.6e-6);
    if (vehicle._absActive && vehicle.ctrl.brake > 0.3) vib += 0.003;
    camera.position.y += (Math.random() - 0.5) * vib + vehicle.landImpact * -0.035;
    camera.position.x += (Math.random() - 0.5) * vib * 0.6;

    // look slightly into the corner + small pitch with acceleration
    lookEuler.set(
      THREE.MathUtils.clamp(gB.z * 0.0028, -0.05, 0.05),
      -vehicle.ctrl.steer * 0.10,
      0);
    camQuatTarget.setFromEuler(lookEuler).premultiply(q);
    camera.quaternion.slerp(camQuatTarget, Math.min(1, dtVis * 14));
    camera.fov = 72 + Math.min(10, vehicle.speedKmh * 0.028);   // subtle speed FOV
  }
  camera.updateProjectionMatrix();
}

// ---- main loop
let last = performance.now();
let acc = 0;
let frame = 0;

function loop(now) {
  requestAnimationFrame(loop);
  let dtReal = (now - last) / 1000;
  last = now;
  if (dtReal > 0.1) dtReal = 0.1;

  if (!paused) {
    input.update(dtReal, vehicle);
    autoReverse();
    applyControls();
    acc += dtReal;
    let steps = 0;
    while (acc >= DT && steps < 30) {
      vehicle.step(DT);
      acc -= DT;
      steps++;
    }
    hud.update(vehicle, dtReal);
    ghost.update(dtReal, vehicle, hud.lapStart !== null ? hud.now() - hud.lapStart : null);
    raceLine.update(vehicle.trackS, Math.abs(vehicle.speed));
    audio.update(vehicle, dtReal);
    updateHaptics(now);
  }

  carVis.update(vehicle, dtReal);
  updateCamera(dtReal);
  atmo.follow(vehicle.pos);
  post.setSpeed(camMode === 2 ? 0 : vehicle.speedKmh);

  autoQ.tick(dtReal, fps => hud.flash(`성능 최적화 적용 (${fps} fps)`));
  hud.fps = hud.fps === undefined ? 60 : hud.fps * 0.95 + (1 / Math.max(dtReal, 1e-3)) * 0.05;

  frame++;
  if (camMode === 0 && TIER.mirror > 0 && frame % TIER.mirror === 0) {
    carVis.renderMirror(renderer, scene, vehicle);
  }
  post.render();
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.resize(innerWidth, innerHeight);
});

requestAnimationFrame(loop);

// commit to driving: start audio, (touch) go fullscreen + lock orientation
function beginDrive() {
  paused = false;
  hud.toggleHelp(false);
  audio.start();
  audio.setEngine(CARS[carId]);
  if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  updateAudioGate();
  if (TOUCH) {
    try { document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) {}
    try { screen.orientation.lock('landscape'); } catch (e) {}
    TouchInput.requestMotionPermission();
    hud.flash(input.mode === 'tilt' ? '틸트 조향 — 폰을 핸들처럼' : '버튼 조향 (설정에서 틸트 전환)');
  }
}

// boot: skip the menu if we just reloaded from a track pick, else show it
if (sessionStorage.getItem('ns-go')) {
  sessionStorage.removeItem('ns-go');
  hud.flash(tMeta.name);
  beginDrive();
} else {
  paused = true;                 // freeze behind the menu
  hud.toggleHelp(false);
  showMenu({
    trackData: TRACK_DATA, currentTrack: trackId, currentCar: carId,
    onStart: (selTrack, selCar) => {
      if (selTrack !== trackId) {              // different track -> reload into it
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
}

window.__vehicle = vehicle;   // debug / test handle
window.__track = track;
window.__renderer = renderer;
window.__audio = audio;
