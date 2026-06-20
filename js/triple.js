// Triple-monitor multi-window (sim-racing style). The main window (center
// screen) runs physics/input and broadcasts the car state over a same-origin
// BroadcastChannel; side windows opened as `?screen=L|R` render-only. Each
// window builds an OFF-AXIS (Kooima generalized perspective) frustum from the
// triple geometry, so the three monitors form one continuous, correctly-angled
// view (not a yaw approximation). Works on the deployed HTTPS site, not just
// localhost (BroadcastChannel needs same-origin; Window Management API needs a
// secure context = HTTPS or localhost).
import * as THREE from 'three';

export const SCREEN = new URLSearchParams(location.search).get('screen'); // null | 'L' | 'R'
export const IS_VIEW = SCREEN === 'L' || SCREEN === 'R';
export const SCREEN_POS = IS_VIEW ? SCREEN : 'C';                          // this window's screen

const CH = 'ns-triple';

export class TripleLink {
  constructor() { this.bc = ('BroadcastChannel' in window) ? new BroadcastChannel(CH) : null; }
  send(s) { if (this.bc) this.bc.postMessage(s); }
  onState(cb) { if (this.bc) this.bc.onmessage = e => cb(e.data); }
}

// ---- triple geometry (sim-racing standard params) -------------------------
const GKEY = 'ns-triple-geo';
export const DEFAULT_GEO = {
  diagIn: 27,            // monitor diagonal (inches)
  ratioW: 16, ratioH: 9, // aspect
  bezelMm: 12,           // gap between adjacent screens (two half-bezels + air)
  distM: 0.65,           // eye → center screen (metres)
  angleDeg: 50,          // side monitor inward angle (toward the driver)
};
export function loadGeo() {
  try { return { ...DEFAULT_GEO, ...(JSON.parse(localStorage.getItem(GKEY) || 'null') || {}) }; }
  catch (e) { return { ...DEFAULT_GEO }; }
}
export function saveGeo(g) { try { localStorage.setItem(GKEY, JSON.stringify(g)); } catch (e) {} }

// horizontal FOV of a single monitor (degrees) — for display in settings.
export function singleHFov(geo) {
  const diag = geo.diagIn * 0.0254, n = Math.hypot(geo.ratioW, geo.ratioH);
  const W = diag * geo.ratioW / n;
  return 2 * Math.atan((W / 2) / geo.distM) * 180 / Math.PI;
}

// eye-local screen rectangle for a screen position. Returns corners
// {pa: bottom-left, pb: bottom-right, pc: top-left} in metres, eye at origin
// looking -Z (car forward), +X right, +Y up.
export function screenQuad(pos, geo) {
  const diag = geo.diagIn * 0.0254, n = Math.hypot(geo.ratioW, geo.ratioH);
  const W = diag * geo.ratioW / n, H = diag * geo.ratioH / n;
  const d = geo.distM, bz = geo.bezelMm / 1000, th = geo.angleDeg * Math.PI / 180;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  if (pos === 'C') {
    return { pa: V(-W / 2, -H / 2, -d), pb: V(W / 2, -H / 2, -d), pc: V(-W / 2, H / 2, -d) };
  }
  const s = pos === 'R' ? 1 : -1;                 // +1 right monitor, -1 left
  const hingeX = s * (W / 2 + bz);                // inner edge (next to center) + bezel gap
  // from the hinge, the screen runs outward but rotated inward (toward driver, +z)
  const outX = hingeX + s * W * Math.cos(th);
  const outZ = -d + W * Math.sin(th);
  if (pos === 'R') {                               // driver's left edge = hinge (inner)
    return { pa: V(hingeX, -H / 2, -d), pb: V(outX, -H / 2, outZ), pc: V(hingeX, H / 2, -d) };
  }
  // left monitor: driver's left edge = outer
  return { pa: V(outX, -H / 2, outZ), pb: V(hingeX, -H / 2, -d), pc: V(outX, H / 2, outZ) };
}

// ---- off-axis projection (Kooima generalized perspective) -----------------
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3();
const _vr = new THREE.Vector3(), _vu = new THREE.Vector3(), _vn = new THREE.Vector3();
const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3();
const _M = new THREE.Matrix4(), _T = new THREE.Matrix4();

// Set camera projection + world matrices for an off-axis screen. eyePos/eyeQuat
// = world eye pose (position + car/head orientation); quad = eye-local corners.
// Drives camera.matrixWorld(Inverse) directly (autoupdate off), so any screen
// angle/offset is exact — not a yaw fudge.
export function applyOffAxis(camera, eyePos, eyeQuat, quad, near, far) {
  _pa.copy(quad.pa).applyQuaternion(eyeQuat).add(eyePos);
  _pb.copy(quad.pb).applyQuaternion(eyeQuat).add(eyePos);
  _pc.copy(quad.pc).applyQuaternion(eyeQuat).add(eyePos);
  _vr.subVectors(_pb, _pa).normalize();           // screen right
  _vu.subVectors(_pc, _pa).normalize();           // screen up
  _vn.crossVectors(_vr, _vu).normalize();         // screen normal (toward eye)
  _va.subVectors(_pa, eyePos);
  _vb.subVectors(_pb, eyePos);
  _vc.subVectors(_pc, eyePos);
  const dist = -_va.dot(_vn);                      // eye→screen distance (>0)
  const sc = near / Math.max(dist, 1e-4);
  const l = _vr.dot(_va) * sc, r = _vr.dot(_vb) * sc;
  const b = _vu.dot(_va) * sc, t = _vu.dot(_vc) * sc;
  camera.projectionMatrix.makePerspective(l, r, t, b, near, far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  // view = orthonormal basis (rows vr,vu,vn) · translate(-eye)
  _M.set(_vr.x, _vr.y, _vr.z, 0, _vu.x, _vu.y, _vu.z, 0, _vn.x, _vn.y, _vn.z, 0, 0, 0, 0, 1);
  _T.makeTranslation(-eyePos.x, -eyePos.y, -eyePos.z);
  camera.matrixWorldInverse.multiplyMatrices(_M, _T);
  camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;
  camera.position.copy(eyePos);                   // keep .position valid for rain/etc.
}

// ---- open the side windows on the correct monitors -------------------------
// Uses the main window's current screen to pick the monitor immediately to its
// left/right (so L/R never get swapped). Falls back to plain popups (drag + F11)
// when the Window Management API is unavailable / denied.
export function openTriple() {
  // Open the windows SYNCHRONOUSLY inside the click gesture. Awaiting
  // getScreenDetails() first loses the user-gesture context → popup blocked
  // (that's why the side windows weren't appearing). Reposition afterwards.
  const here = location.pathname;
  const feat = 'popup,width=1024,height=640';
  const wl = window.open(here + '?screen=L', 'ns-L', feat);
  const wr = window.open(here + '?screen=R', 'ns-R', feat);
  if (!wl || !wr) console.warn('[triple] popup blocked — allow popups for this site (both side windows)');
  // place each on the correct monitor (main window's left/right neighbour)
  if (window.getScreenDetails) {
    window.getScreenDetails().then(sd => {
      const screens = [...sd.screens].sort((a, b) => a.availLeft - b.availLeft);
      const i = screens.indexOf(sd.currentScreen);
      const place = (w, scr) => {
        if (!w || !scr) return;
        try { w.moveTo(scr.availLeft, scr.availTop); w.resizeTo(scr.availWidth, scr.availHeight); } catch (e) {}
      };
      place(wl, screens[i - 1]);
      place(wr, screens[i + 1]);
    }).catch(() => { /* permission denied — user drags windows + F11 */ });
  }
  return { wl, wr };
}
