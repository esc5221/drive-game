// Quality tiers + runtime auto-downgrade ladder.
// Mobile aliasing fix lives here too: tiers with post-processing get an
// MSAA(4x) composer target; the low tier renders to the default framebuffer
// where native antialias:true applies.

export const TIERS = {
  ultra: { pr: 2.0, shadow: 2048, soft: true,  msaa: 4, bloom: true,  blur: true,
           trees: 1.00, mirror: 2, farScale: 1.0,  aniso: 8 },
  high:  { pr: 2.0, shadow: 1024, soft: false, msaa: 4, bloom: true,  blur: true,
           trees: 0.70, mirror: 3, farScale: 0.85, aniso: 4 },
  low:   { pr: 1.0, shadow: 0,    soft: false, msaa: 0, bloom: false, blur: false,
           trees: 0.40, mirror: 0, farScale: 0.60, aniso: 2 },
};

export function detectTier() {
  const saved = localStorage.getItem('ns-tier');
  if (saved && TIERS[saved]) return saved;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (!mobile) return 'ultra';
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  return (mem >= 6 && cores >= 8) ? 'high' : 'low';
}

// steps down one knob at a time until FPS recovers
export class AutoQuality {
  constructor(tierName, renderer, post, extraSteps = []) {
    this.renderer = renderer;
    this.post = post;
    this._frames = 0;
    this._t = 0;
    this._step = 0;
    this.done = tierName === 'low' || localStorage.getItem('ns-tier') != null;
    this.steps = [
      { label: 'Resolution 1.5x', run: () => this._setPr(1.5) },
      { label: 'Bloom/Blur OFF', run: () => post.setCheap() },
      { label: 'Resolution 1.0x', run: () => this._setPr(1.0) },
      ...extraSteps,
    ];
  }
  _setPr(pr) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, pr));
    this.post.resize(innerWidth, innerHeight);
  }
  tick(dt, notify) {
    if (this.done) return;
    this._t += dt;
    this._frames++;
    if (this._t < 5) return;
    const fps = this._frames / this._t;
    this._t = 0; this._frames = 0;
    if (fps >= 42) { this.done = true; return; }
    if (this._step >= this.steps.length) { this.done = true; return; }
    const s = this.steps[this._step++];
    s.run();
    notify(`Performance: ${s.label} (${fps | 0} fps)`);
  }
}
