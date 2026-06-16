// Rain: instanced camera-facing streak quads driven by a shader. Each drop is
// a soft tapered streak; its on-screen length & rake come from the rain's
// velocity RELATIVE to the camera, projected into view space — so standing
// still gives short near-vertical drops and speed rakes them into long streaks.
// Three depth "layers" (near bold / far faint) break the uniform-line look.
import * as THREE from 'three';

function streakTexture() {
  const W = 64, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) {
    const ty = y / (H - 1);
    const taper = Math.min(1, Math.min(ty, 1 - ty) / 0.26);   // fade top & bottom
    for (let x = 0; x < W; x++) {
      const tx = (x / (W - 1) - 0.5) * 2;
      const across = Math.exp(-tx * tx * 2.2);                 // soft gaussian width
      const noise = 0.88 + 0.12 * Math.sin(y * 0.55) * Math.cos(x * 1.1);
      const a = Math.max(0, across * taper * noise);
      const o = (y * W + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

const VERT = `
attribute vec3 iLocal;
attribute vec4 iSeed;
attribute float iLayer;
uniform float uTime, uFall, uExposure;
uniform vec3 uCam, uBoxHalf, uRelVel;
uniform vec2 uRes;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv;
  float spd = uFall * (0.85 + 0.3 * iSeed.w);
  float ly = fract(iLocal.y - uTime * spd / (uBoxHalf.y * 2.0));
  vec3 world = uCam + (vec3(iLocal.x, ly, iLocal.z) - 0.5) * (uBoxHalf * 2.0);
  vec4 cv = modelViewMatrix * vec4(world, 1.0);
  vec4 a = projectionMatrix * cv;
  // streak direction = rain velocity (view space) projected to the screen plane.
  // Using view-space xy directly is robust (no perspective-divide blowups).
  float expo = uExposure * (0.6 + 0.8 * iSeed.x);
  float speed = length(uRelVel);
  float depth = max(-cv.z, 0.6);
  float widthPx = mix(7.0, 1.6, iLayer) * (0.75 + 0.5 * iSeed.y);
  float lenMin = mix(26.0, 5.0, iLayer), lenMax = mix(120.0, 18.0, iLayer);
  float lenPx = clamp(speed * expo / depth * uRes.y * 0.5, lenMin, lenMax);
  // screen-aligned vertical streak, tilted by the lateral component of the
  // camera-relative rain velocity (so it rakes when moving/cross-wind).
  float tilt = clamp(uRelVel.x / 26.0, -0.9, 0.9);
  vec2 pxToNdc = 2.0 / uRes;
  vec2 corner = position.xy;                       // plane verts span -0.5..0.5
  vec2 off = vec2(corner.x * widthPx + corner.y * lenPx * tilt, corner.y * lenPx);
  gl_Position = a;
  gl_Position.xy += off * pxToNdc * a.w;
  vAlpha = mix(0.72, 0.18, iLayer) * (0.55 + 0.45 * iSeed.z);
}
`;

const FRAG = `
uniform sampler2D uTex;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying float vAlpha;
void main() {
  float a = texture2D(uTex, vUv).a * vAlpha * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export class Rain {
  constructor(scene, renderer, total = 5000) {
    this.renderer = renderer;
    this._t = 0;
    this.fall = 24;
    this.boxHalf = new THREE.Vector3(36, 26, 36);

    const nNear = Math.floor(total * 0.12), nMid = Math.floor(total * 0.36);
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    const iLocal = new Float32Array(total * 3), iSeed = new Float32Array(total * 4), iLayer = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      iLocal[i * 3] = Math.random(); iLocal[i * 3 + 1] = Math.random(); iLocal[i * 3 + 2] = Math.random();
      iSeed[i * 4] = Math.random(); iSeed[i * 4 + 1] = Math.random(); iSeed[i * 4 + 2] = Math.random(); iSeed[i * 4 + 3] = Math.random();
      iLayer[i] = i < nNear ? 0.0 : i < nNear + nMid ? 0.5 : 1.0;
    }
    geo.setAttribute('iLocal', new THREE.InstancedBufferAttribute(iLocal, 3));
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(iSeed, 4));
    geo.setAttribute('iLayer', new THREE.InstancedBufferAttribute(iLayer, 1));
    geo.instanceCount = total;

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uFall: { value: this.fall }, uExposure: { value: 0.06 },
        uCam: { value: new THREE.Vector3() }, uBoxHalf: { value: this.boxHalf },
        uRelVel: { value: new THREE.Vector3(0, -this.fall, 0) }, uRes: { value: new THREE.Vector2(1, 1) },
        uTex: { value: streakTexture() }, uColor: { value: new THREE.Color(0xccd6e0) }, uOpacity: { value: 1 },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this._m3 = new THREE.Matrix3();
    this._rel = new THREE.Vector3();
    this._sz = new THREE.Vector2();
  }

  setActive(on) { this.mesh.visible = on; }

  update(dt, camera, vel) {
    if (!this.mesh.visible) return;
    if (dt > 0.05) dt = 0.05;
    this._t += dt;
    const u = this.mat.uniforms;
    u.uTime.value = this._t;
    u.uCam.value.copy(camera.position);
    // rain velocity relative to the camera, rotated into view space
    this._rel.set(0, -this.fall, 0).sub(vel);
    this._m3.setFromMatrix4(camera.matrixWorldInverse);
    this._rel.applyMatrix3(this._m3);
    u.uRelVel.value.copy(this._rel);
    this.renderer.getSize(this._sz);
    const pr = this.renderer.getPixelRatio();
    u.uRes.value.set(this._sz.x * pr, this._sz.y * pr);
  }
}
