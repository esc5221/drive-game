// Keyboard input with smoothing tuned for driving:
// fast attack, faster release, speed-aware steering handled in physics.
export class Input {
  constructor() {
    this.keys = new Set();
    this.steer = 0;        // -1..1 (left negative)
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.onKey = null;     // discrete key callback
    this.anyInput = false;

    addEventListener('keydown', e => {
      if (e.repeat) { e.preventDefault(); return; }
      this.keys.add(e.code);
      this.anyInput = true;
      if (this.onKey) this.onKey(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  down(...codes) { return codes.some(c => this.keys.has(c)); }

  update(dt, vehicle) {
    const left = this.down('ArrowLeft', 'KeyA');
    const right = this.down('ArrowRight', 'KeyD');
    let target = (right ? 1 : 0) - (left ? 1 : 0);

    // keyboard steering feel: attack rate drops with speed, release is quick,
    // and the lock eases off as the rear starts sliding.
    const v = Math.abs(vehicle.speed);
    const assist = 1 - Math.min(0.45, vehicle.slipRear * 0.55);
    if (target !== 0) target *= assist;

    const attack = 3.4 / (1 + v * 0.022);
    const release = 5.5;
    const rate = (Math.sign(target - this.steer) === Math.sign(this.steer) || this.steer === 0 || target !== 0)
      ? (Math.abs(target) > Math.abs(this.steer) ? attack : release)
      : release;
    const d = target - this.steer;
    const maxStep = rate * dt;
    this.steer += Math.abs(d) <= maxStep ? d : Math.sign(d) * maxStep;
    if (Math.abs(this.steer) < 0.001 && target === 0) this.steer = 0;

    const accel = this.down('ArrowUp', 'KeyW');
    const brake = this.down('ArrowDown', 'KeyS');
    this.throttle = step(this.throttle, accel ? 1 : 0, accel ? 3.5 : 8, dt);
    this.brake = step(this.brake, brake ? 1 : 0, brake ? 5.5 : 10, dt);
    this.handbrake = this.down('Space');
  }
}

function step(cur, target, rate, dt) {
  const d = target - cur, m = rate * dt;
  return Math.abs(d) <= m ? target : cur + Math.sign(d) * m;
}
