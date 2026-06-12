// Post-processing: bloom + speed-scaled radial blur + vignette.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const SpeedShader = {
  uniforms: {
    tDiffuse: { value: null },
    uBlur: { value: 0 },        // 0..1 radial blur strength
    uVignette: { value: 0.32 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uBlur;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec2 center = vec2(0.5, 0.46);          // slightly below mid: road focus
      vec2 dir = vUv - center;
      float dist = length(dir);
      // radial blur: samples pulled toward center, strength grows at edges
      float amt = uBlur * smoothstep(0.12, 0.75, dist) * 0.045;
      vec4 c = texture2D(tDiffuse, vUv);
      if (amt > 0.0005) {
        vec4 acc = c;
        for (int i = 1; i <= 5; i++) {
          float f = float(i) / 5.0;
          acc += texture2D(tDiffuse, vUv - dir * amt * f * 6.0);
        }
        c = acc / 6.0;
      }
      // vignette
      float vig = 1.0 - uVignette * smoothstep(0.42, 0.95, dist);
      gl_FragColor = vec4(c.rgb * vig, c.a);
    }
  `,
};

export class Post {
  constructor(renderer, scene, camera, opts = { bloom: true, blur: true }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = opts.bloom || opts.blur;
    this.bloom = null;
    this.speed = null;
    if (!this.enabled) return;            // low tier: plain forward render
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    if (opts.bloom) {
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.55, 0.86);
      this.composer.addPass(this.bloom);
    }
    if (opts.blur) {
      this.speed = new ShaderPass(SpeedShader);
      this.composer.addPass(this.speed);
    }
    this.composer.addPass(new OutputPass());
  }

  setSpeed(kmh) {
    if (!this.speed) return;
    // blur fades in from 120 km/h, full at 260
    const t = THREE.MathUtils.clamp((kmh - 120) / 140, 0, 1);
    this.speed.uniforms.uBlur.value = t * t;
  }

  setCheap() {                            // runtime auto-downgrade
    if (this.bloom) this.bloom.enabled = false;
    if (this.speed) this.speed.enabled = false;
  }

  render() {
    if (this.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
  resize(w, h) { if (this.enabled) this.composer.setSize(w, h); }
}
