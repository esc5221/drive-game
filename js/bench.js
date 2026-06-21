// Graphics benchmark (CDP-driven). When ns-bench=1, the game auto-drives the
// racing line deterministically and measures per-frame GPU time (WebGL2 timer
// query) + frame time, exposing rolling stats on window.__bench. An external
// playwright script (connected over CDP) sets each gfx config via localStorage,
// reloads, waits, and reads window.__bench — so fps's 60 Hz vsync ceiling no
// longer hides option cost (GPU ms is measured directly).
import * as THREE from 'three';

export const BENCH = (() => { try { return localStorage.getItem('ns-bench') === '1'; } catch (e) { return false; } })();

// ---- deterministic auto-drive (pure-pursuit the racing line) --------------
const _fwd = new THREE.Vector3();
export function autoDrive(v, track, raceLine) {
  const n = track.n, step = track.step, off = raceLine.offsets;
  const i = ((Math.floor(v.trackS / step) % n) + n) % n;
  const la = Math.max(6, Math.floor(18 / step));
  const j = (i + la) % n;
  const tx = track.px[j] + track.rx[j] * off[j];
  const tz = track.pz[j] + track.rz[j] * off[j];
  _fwd.set(0, 0, -1).applyQuaternion(v.quat);
  const dx = tx - v.pos.x, dz = tz - v.pos.z, dl = Math.hypot(dx, dz) || 1;
  const cross = _fwd.x * (dz / dl) - _fwd.z * (dx / dl);
  v.ctrl.steer = THREE.MathUtils.clamp(cross * 2.4, -1, 1);
  const targetKmh = (raceLine.vAllowed[i] || 60) * 3.6;
  v.ctrl.throttle = v.speedKmh < targetKmh * 0.92 ? 1 : 0;
  v.ctrl.brake = v.speedKmh > targetKmh * 1.06 ? 0.45 : 0;
  v.ctrl.handbrake = false;
}

// ---- WebGL2 GPU timer query (measures GPU ms per frame, vsync-independent) -
let gl = null, ext = null, pending = [];
let gpuSum = 0, gpuCount = 0;
const ftArr = [];

export function initGpuTimer(renderer) {
  try {
    gl = renderer.getContext();
    ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  } catch (e) { ext = null; }
}
export function gpuBegin() {
  if (!ext) return null;
  const q = gl.createQuery();
  gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
  return q;
}
export function gpuEnd(q) {
  if (!ext || !q) return;
  gl.endQuery(ext.TIME_ELAPSED_EXT);
  pending.push(q);
  while (pending.length) {
    const o = pending[0];
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { pending.shift(); gl.deleteQuery(o); continue; }
    if (!gl.getQueryParameter(o, gl.QUERY_RESULT_AVAILABLE)) break;
    gpuSum += gl.getQueryParameter(o, gl.QUERY_RESULT) / 1e6;   // ns → ms
    gpuCount++;
    pending.shift(); gl.deleteQuery(o);
  }
}

// ---- per-frame sample + rolling stats on window.__bench -------------------
export function benchReset() { gpuSum = 0; gpuCount = 0; ftArr.length = 0; }
export function benchFrame(dtSec) {
  ftArr.push(dtSec * 1000);
  const a = ftArr.slice().sort((x, y) => x - y), m = a.length || 1;
  const avg = a.reduce((s, x) => s + x, 0) / m;
  const p99 = a[Math.min(m - 1, Math.floor(m * 0.99))] || avg;
  window.__bench = {
    frames: m,
    avgMs: +avg.toFixed(2), p99Ms: +p99.toFixed(2),
    avgFps: +(1000 / avg).toFixed(1), low1Fps: +(1000 / p99).toFixed(1),
    gpuMs: gpuCount ? +(gpuSum / gpuCount).toFixed(3) : null,
    gpuSupported: !!ext,
  };
}
