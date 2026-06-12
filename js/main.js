// Boot + game loop: fixed-step physics (240 Hz), camera rigs, HUD, audio.
import * as THREE from 'three';
import { TRACK } from './track_data.js';
import { Track } from './track.js';
import { Vehicle, DT } from './physics.js';
import { buildWorld, groundHeightAt } from './world.js';
import { Atmosphere } from './atmo.js';
import { Post } from './post.js';
import { CarVisual } from './car.js';
import { Input } from './input.js';
import { TouchInput, isTouchDevice, showStartOverlay } from './touch.js';
import { TIERS, detectTier, AutoQuality } from './quality.js';
import { CarAudio } from './audio.js';
import { Hud } from './hud.js';
import { Ghost } from './ghost.js';
import { RaceLine } from './raceline.js';

const track = new Track(TRACK);

const TOUCH = isTouchDevice();
const tierName = detectTier();
const TIER = TIERS[tierName];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, TIER.pr));
renderer.shadowMap.enabled = TIER.shadow > 0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const atmo = new Atmosphere(scene, renderer, { shadow: TIER.shadow, farScale: TIER.farScale });
buildWorld(scene, track, { trees: TIER.trees });

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.06, 24000);
const post = new Post(renderer, scene, camera, TIER);
const autoQ = new AutoQuality(tierName, renderer, post);

const vehicle = new Vehicle(track);
const SPAWN_S = 3550;          // just before Hatzenbach — corners right away
vehicle.reset(SPAWN_S);

const carVis = new CarVisual(scene, renderer);
const input = TOUCH ? new TouchInput() : new Input();
const audio = new CarAudio();
const hud = new Hud(track);
const ghost = new Ghost(scene, track);
hud.ghost = ghost;
const raceLine = new RaceLine(scene, track);

let camMode = 0;     // 0 cockpit, 1 hood, 2 chase
carVis.setCameraMode(camMode);
let paused = false;

input.onKey = code => {
  audio.start();
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
    case 'ShiftLeft': case 'ShiftRight':
      if (!vehicle.auto) vehicle.shiftUp();
      break;
    case 'ControlLeft': case 'ControlRight':
      if (!vehicle.auto) vehicle.shiftDown();
      break;
    case 'KeyM':
      vehicle.auto = !vehicle.auto;
      if (vehicle.gear < 1) vehicle.gear = 1;
      hud.flash(vehicle.auto ? 'AUTOMATIC' : 'MANUAL (Shift up / Ctrl down)');
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
      break;
    case 'KeyG':
      ghost.enabled = !ghost.enabled;
      hud.flash('고스트 ' + (ghost.enabled ? 'ON' : 'OFF') +
        (ghost.hasBest ? '' : ' (베스트 랩을 먼저 기록하세요)'));
      break;
    case 'KeyL':
      hud.flash('레이싱 라인 ' + (raceLine.toggle() ? 'ON' : 'OFF'));
      break;
    case 'KeyP': case 'Escape':
      paused = !paused;
      hud.flash(paused ? 'PAUSED (P to resume)' : 'GO');
      break;
  }
  if (['ArrowUp', 'KeyW'].includes(code)) hud.toggleHelp(false);
};

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
    if (!chaseInit) { chasePos.copy(behind); chaseInit = true; }
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
    // ABS pedal shudder -> subtle cabin buzz
    if (vehicle._absActive && vehicle.ctrl.brake > 0.3) {
      camera.position.y += (Math.random() - 0.5) * 0.006;
    }

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

if (TOUCH) {
  hud.toggleHelp(false);
  showStartOverlay(() => {
    audio.start();
    if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
    hud.flash(input.mode === 'tilt' ? '틸트 조향 — 폰을 핸들처럼' : '버튼 조향 (틸트 버튼으로 전환)');
  });
}

window.__vehicle = vehicle;   // debug / test handle
window.__track = track;
