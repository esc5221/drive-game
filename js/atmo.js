// Atmosphere: physical Sky shader, sun/hemisphere lighting, PMREM environment
// reflections, fog — with time-of-day presets (N key).
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const PRESETS = [
  {
    name: '정오 (Clear Noon)',
    elev: 52, azim: 165, turbidity: 4, rayleigh: 2.2, mieG: 0.75, mieCoeff: 0.004,
    sunColor: 0xfff4e0, sunInt: 2.9, hemiInt: 0.9,
    fogColor: 0xc4d4e2, fogNear: 480, fogFar: 3000, exposure: 0.78, skyGain: 0.26,
  },
  {
    name: '아침 안개 (Eifel Morning)',
    elev: 19, azim: 105, turbidity: 7, rayleigh: 2.2, mieG: 0.8, mieCoeff: 0.009,
    sunColor: 0xffe8c8, sunInt: 2.3, hemiInt: 0.75,
    fogColor: 0xc9d1d3, fogNear: 170, fogFar: 1250, exposure: 0.72, skyGain: 0.32,
  },
  {
    name: '석양 (Sunset)',
    elev: 10, azim: 256, turbidity: 6.5, rayleigh: 3.0, mieG: 0.85, mieCoeff: 0.012,
    sunColor: 0xffb070, sunInt: 2.5, hemiInt: 0.62,
    fogColor: 0xd6b48e, fogNear: 280, fogFar: 1700, exposure: 0.62, skyGain: 0.65,
  },
];

export class Atmosphere {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.idx = 0;

    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    // inject a brightness gain so the (very HDR) sky can be tamed without
    // darkening the whole scene's exposure
    const mat = this.sky.material;
    mat.uniforms.skyGain = { value: 0.3 };
    mat.fragmentShader = mat.fragmentShader
      .replace('uniform float mieDirectionalG;', 'uniform float mieDirectionalG;\nuniform float skyGain;')
      .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * skyGain, 1.0 );');
    mat.needsUpdate = true;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 40;
    this.sun.shadow.camera.far = 900;
    const sc = 110;
    this.sun.shadow.camera.left = -sc; this.sun.shadow.camera.right = sc;
    this.sun.shadow.camera.top = sc; this.sun.shadow.camera.bottom = -sc;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.4;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xcfe3f5, 0x46583a, 0.7);
    scene.add(this.hemi);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this._envScene = new THREE.Scene();
    this.sunDir = new THREE.Vector3();
    this.apply(0);
  }

  cycle() {
    this.apply((this.idx + 1) % PRESETS.length);
    return PRESETS[this.idx].name;
  }

  apply(i) {
    this.idx = i;
    const p = PRESETS[i];
    const u = this.sky.material.uniforms;
    u.turbidity.value = p.turbidity;
    u.rayleigh.value = p.rayleigh;
    u.mieCoefficient.value = p.mieCoeff;
    u.mieDirectionalG.value = p.mieG;
    u.skyGain.value = p.skyGain != null ? p.skyGain : 0.3;
    const phi = THREE.MathUtils.degToRad(90 - p.elev);
    const theta = THREE.MathUtils.degToRad(p.azim);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);

    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunInt;
    this.hemi.intensity = p.hemiInt;
    this.hemi.color.set(p.fogColor).lerp(new THREE.Color(0xffffff), 0.4);

    this.scene.fog = new THREE.Fog(p.fogColor, p.fogNear, p.fogFar);
    this.renderer.toneMappingExposure = p.exposure;

    // environment map from the sky alone (reflections on paint/rails)
    const prevParent = this.sky.parent;
    this._envScene.add(this.sky);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this._envScene, 0.04);
    this.scene.environment = this.envRT.texture;
    prevParent.add(this.sky);
  }

  // sun follows the car so the shadow box stays useful
  follow(target) {
    this.sun.position.copy(target).addScaledVector(this.sunDir, 500);
    this.sun.target.position.copy(target);
  }
}
