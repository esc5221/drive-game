// Quality tiers: desktop runs everything; mobile scales pixel ratio, shadows,
// post-processing, forest density, fog distance and mirror rate.
// Auto-downgrades once if measured FPS stays low.

export const TIERS = {
  ultra: { pr: 2.0, shadow: 2048, bloom: true,  blur: true,  trees: 1.00, mirror: 2, farScale: 1.0 },
  high:  { pr: 1.5, shadow: 1024, bloom: true,  blur: true,  trees: 0.70, mirror: 3, farScale: 0.85 },
  low:   { pr: 1.0, shadow: 0,    bloom: false, blur: false, trees: 0.40, mirror: 0, farScale: 0.60 },
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

// runtime knobs that don't need a scene rebuild
export class AutoQuality {
  constructor(tierName, renderer, post) {
    this.tier = tierName;
    this.renderer = renderer;
    this.post = post;
    this._frames = 0;
    this._t = 0;
    this._settled = false;
  }
  tick(dt, onDowngrade) {
    if (this._settled || this.tier === 'low') return;
    this._t += dt;
    this._frames++;
    if (this._t >= 6) {
      const fps = this._frames / this._t;
      if (fps < 40) {
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
        if (this.post) this.post.setCheap();
        onDowngrade(fps | 0);
      }
      this._settled = true;
    }
  }
}
