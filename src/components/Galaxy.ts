/**
 * Galaxy — scène Three.js : galaxie spirale de particules, fond étoilé,
 * noyau lumineux et post-traitement (bloom).
 *
 * Les commandes (gestes ou souris) ne manipulent que des « consignes »
 * (expansion, vitesse de rotation, inclinaison, impulsion). La galaxie les
 * rejoint avec des ressorts amortis pour des animations toujours fluides.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector2,
  WebGLRenderer,
  type IUniform,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  backgroundVertexShader,
  dustFragmentShader,
  galaxyVertexShader,
  starFragmentShader,
} from '../shaders/galaxyShaders.ts';
import { clamp, damp } from '../utils/gestureUtils.ts';

export interface GalaxyOptions {
  particleCount: number;
  dustCount: number;
  backgroundCount: number;
  maxPixelRatio: number;
}

export interface QualitySettings {
  pixelRatio: number;
  /** Fraction des particules affichées (0..1). */
  particleFraction: number;
}

const RADIUS = 10;
const ARMS = 4;
const TWIST = 0.62;
const DEFAULT_TILT = 0.5;
const TILT_MIN = -0.85;
const TILT_MAX = 1.38;
const AUTO_SPIN = 0.07;
const INTRO_DURATION = 3.4;

/** Dégradé radial : noyau blanc rosé → rose → violet → bleu électrique → cyan. */
const GRADIENT: ReadonlyArray<[number, string]> = [
  [0.0, '#fff3fb'],
  [0.07, '#ffc2f0'],
  [0.2, '#ff4fd8'],
  [0.4, '#9b5cff'],
  [0.62, '#3d6bff'],
  [0.84, '#22d3ff'],
  [1.0, '#8af6ff'],
];
const ACCENTS = ['#ff4fd8', '#22e3ff', '#c9b8ff', '#ffffff'];
/** Couleurs successives des impulsions de pincement. */
const PULSE_COLORS = ['#22e3ff', '#ff3fd0', '#ffcf5a', '#5dffb5', '#8f6bff'];

const tmpA = new Color();
const tmpB = new Color();

function gradientAt(t: number, out: Color): Color {
  for (let i = 1; i < GRADIENT.length; i++) {
    if (t <= GRADIENT[i][0]) {
      const [t0, c0] = GRADIENT[i - 1];
      const [t1, c1] = GRADIENT[i];
      return out.set(c0).lerp(tmpB.set(c1), (t - t0) / (t1 - t0));
    }
  }
  return out.set(GRADIENT[GRADIENT.length - 1][1]);
}

/** Variable aléatoire gaussienne (Box-Muller), bornée à ±3σ. */
function gauss(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return clamp(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v), -3, 3);
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export class Galaxy {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;

  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(55, 1, 0.1, 500);
  private readonly galaxyGroup = new Group();
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;

  private readonly stars: Points;
  private readonly dust: Points;
  private readonly background: Points;
  private readonly coreSprite: Sprite;
  private readonly haloSprite: Sprite;
  private readonly coreTexture: CanvasTexture;

  private readonly uniforms: Record<string, IUniform>;
  private readonly bgUniforms: Record<string, IUniform>;
  private readonly particleCount: number;
  private readonly maxPixelRatio: number;

  // --- État dynamique ---
  private time = 0;
  private expansion = 0;
  private expansionVel = 0;
  private expansionTarget = 0;
  private rotation = 0;
  private spinVelocity = 0;
  private spinInput = 0;
  private tilt = DEFAULT_TILT;
  private tiltTarget = DEFAULT_TILT;
  private pulseAge = 10;
  private pulseCount = 0;
  private introTime = 0;
  private effects = true;
  private width = 1;
  private height = 1;
  private baseDistance = 17;
  private dolly = 1.35;
  private viewOffset = 0;
  private viewOffsetTarget = 0;
  private dollyTarget = 1.35;

  constructor(container: HTMLElement, options: GalaxyOptions) {
    this.particleCount = options.particleCount;
    this.maxPixelRatio = options.maxPixelRatio;

    this.renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x02010a, 1);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'galaxy-canvas';
    this.canvas.setAttribute('aria-label', 'Galaxie spirale interactive en 3D');
    this.canvas.setAttribute('role', 'img');
    container.appendChild(this.canvas);

    this.uniforms = {
      uTime: { value: 0 },
      uExpand: { value: 0 },
      uIntro: { value: 0 },
      uPulseAge: { value: 10 },
      uPulseAmp: { value: 0 },
      uColorShift: { value: 0 },
      uPulseColor: { value: new Color(PULSE_COLORS[0]) },
      uSize: { value: 62 },
      uPixelRatio: { value: 1 },
    };
    this.bgUniforms = { uTime: this.uniforms.uTime, uPixelRatio: this.uniforms.uPixelRatio };

    this.stars = new Points(this.buildStars(options.particleCount), this.makeMaterial(starFragmentShader, 1));
    this.dust = new Points(this.buildDust(options.dustCount), this.makeMaterial(dustFragmentShader, 0.15));
    this.stars.frustumCulled = false; // positions calculées dans le shader
    this.dust.frustumCulled = false;
    this.background = this.buildBackground(options.backgroundCount);

    this.coreTexture = this.buildGlowTexture();
    this.coreSprite = this.makeSprite('#ffe6f8', 1);
    this.haloSprite = this.makeSprite('#8a4dff', 0.32);

    this.galaxyGroup.add(this.dust, this.stars, this.haloSprite, this.coreSprite);
    this.galaxyGroup.rotation.x = 0;
    this.scene.add(this.background, this.galaxyGroup);

    // Post-traitement : bloom pour l'éclat lumineux.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.95, 0.55, 0.12);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.setQuality({ pixelRatio: Math.min(window.devicePixelRatio || 1, this.maxPixelRatio), particleFraction: 1 });
    this.resize();
  }

  // ------------------------------------------------------------------
  // Commandes publiques
  // ------------------------------------------------------------------

  /** Consigne d'expansion : +1 expansion maximale, -1 contraction maximale. */
  setExpansionTarget(v: number): void {
    this.expansionTarget = clamp(v, -1, 1);
  }

  getExpansionTarget(): number {
    return this.expansionTarget;
  }

  /** Vitesse de rotation demandée (rad/s), appliquée tant qu'elle est non nulle, avec inertie ensuite. */
  setSpinInput(radPerSec: number): void {
    this.spinInput = radPerSec;
  }

  /** Rotation directe (glisser-déposer à la souris). */
  rotateBy(delta: number): void {
    this.rotation += delta;
  }

  /** Lance la galaxie avec une vitesse donnée (inertie après un glisser). */
  fling(radPerSec: number): void {
    this.spinVelocity = clamp(radPerSec, -6, 6);
  }

  /** Inclinaison de la vue, normalisée : -1 (dessous) → 0 (défaut) → +1 (vue de dessus). */
  setTiltNormalized(n: number): void {
    const v = clamp(n, -1, 1);
    this.tiltTarget = v >= 0 ? DEFAULT_TILT + v * (TILT_MAX - DEFAULT_TILT) : DEFAULT_TILT + v * (DEFAULT_TILT - TILT_MIN);
  }

  tiltBy(delta: number): void {
    this.tiltTarget = clamp(this.tiltTarget + delta, TILT_MIN, TILT_MAX);
  }

  /** Déclenche une impulsion lumineuse avec explosion radiale et changement de couleur. */
  pulse(): void {
    this.pulseCount++;
    this.pulseAge = 0;
    this.uniforms.uPulseAmp.value = 1;
    (this.uniforms.uPulseColor.value as Color).set(PULSE_COLORS[(this.pulseCount - 1) % PULSE_COLORS.length]);
  }

  /** Remet la galaxie dans son état initial, avec une petite animation. */
  reset(): void {
    this.expansionTarget = 0;
    this.spinInput = 0;
    this.spinVelocity = 0;
    this.tiltTarget = DEFAULT_TILT;
    // Ramène la rotation à un tour près, pour un retour court et doux.
    const twoPi = Math.PI * 2;
    this.rotation = ((this.rotation % twoPi) + twoPi) % twoPi;
    if (this.rotation > Math.PI) this.rotation -= twoPi;
    this.resetRotation = true;
    this.uniforms.uColorShift.value = 0;
    this.pulseAge = 10;
    this.playIntro();
  }

  private resetRotation = false;

  /** Rejoue l'animation d'apparition. */
  playIntro(): void {
    this.introTime = 0;
  }

  /** Travelling de caméra animé (1 = normal, >1 = plus loin). */
  setDolly(v: number, immediate = false): void {
    this.dollyTarget = v;
    if (immediate) this.dolly = v;
  }

  /** Décale la galaxie horizontalement à l'écran (fraction de la largeur), avec animation. */
  setViewOffset(fraction: number, immediate = false): void {
    this.viewOffsetTarget = fraction;
    if (immediate) this.viewOffset = fraction;
  }

  setEffects(enabled: boolean): void {
    this.effects = enabled;
    this.dust.visible = enabled;
    this.haloSprite.visible = enabled;
  }

  get effectsEnabled(): boolean {
    return this.effects;
  }

  setQuality(q: QualitySettings): void {
    const pr = clamp(q.pixelRatio, 0.5, this.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.uniforms.uPixelRatio.value = pr;
    this.stars.geometry.setDrawRange(0, Math.floor(this.particleCount * clamp(q.particleFraction, 0.1, 1)));
    this.resize();
  }

  /** Informations de débogage / tests. */
  get debugState() {
    return {
      rotation: this.rotation,
      spinVelocity: this.spinVelocity,
      tilt: this.tilt,
      tiltTarget: this.tiltTarget,
      expansion: this.expansion,
      expansionTarget: this.expansionTarget,
      pulseCount: this.pulseCount,
      effects: this.effects,
      particles: this.stars.geometry.drawRange.count,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }

  // ------------------------------------------------------------------
  // Boucle
  // ------------------------------------------------------------------

  update(dt: number): void {
    const step = Math.min(dt, 0.05);
    this.time += step;
    const u = this.uniforms;

    // Expansion : ressort légèrement sous-amorti (petit rebond spectaculaire).
    const k = 10;
    const c = 4.6;
    this.expansionVel += ((this.expansionTarget - this.expansion) * k - this.expansionVel * c) * step;
    this.expansion = clamp(this.expansion + this.expansionVel * step, -1.15, 1.15);

    // Rotation : consigne directe pendant le geste, puis inertie qui s'amortit.
    if (Math.abs(this.spinInput) > 0.01) this.spinVelocity = damp(this.spinVelocity, this.spinInput, 6, step);
    else this.spinVelocity = damp(this.spinVelocity, 0, 0.9, step);
    if (this.resetRotation) {
      this.rotation = damp(this.rotation, 0, 3, step);
      if (Math.abs(this.rotation) < 0.002) this.resetRotation = false;
    } else {
      this.rotation += (AUTO_SPIN + this.spinVelocity) * step;
    }
    this.galaxyGroup.rotation.y = this.rotation;

    // Inclinaison lissée.
    this.tilt = damp(this.tilt, this.tiltTarget, 3.2, step);

    // Impulsion.
    this.pulseAge = Math.min(this.pulseAge + step, 10);
    const age = this.pulseAge;
    const flash = u.uPulseAmp.value * Math.exp(-age * 4);
    u.uColorShift.value = u.uPulseAmp.value * 0.85 * smoothstep(0, 0.12, age) * (1 - smoothstep(1.3, 3.2, age));

    // Apparition.
    this.introTime += step;
    const intro = easeOutCubic(this.introTime / INTRO_DURATION);

    u.uTime.value = this.time;
    u.uExpand.value = this.expansion;
    u.uIntro.value = intro;
    u.uPulseAge.value = age;

    // Noyau : plus lumineux pendant la contraction et lors des impulsions.
    const contraction = Math.max(-this.expansion, 0);
    const expand = Math.max(this.expansion, 0);
    const breath = 1 + Math.sin(this.time * 1.3) * 0.04;
    this.coreSprite.scale.setScalar((2.6 + contraction * 1.3 + flash * 3.5) * breath * (0.4 + 0.6 * intro));
    this.coreSprite.material.opacity = clamp(0.7 + contraction * 0.3 + flash * 0.8, 0, 1.6);
    this.haloSprite.scale.setScalar((15 + expand * 6 - contraction * 6) * (0.3 + 0.7 * intro));
    this.haloSprite.material.opacity = 0.22 + contraction * 0.15 + flash * 0.3;
    this.bloom.strength = 0.95 + contraction * 0.2 + flash * 0.35;

    // Caméra : orbite autour du centre + petite secousse lors des impulsions.
    this.dolly = damp(this.dolly, this.dollyTarget, 1.3, step);
    const dist = this.baseDistance * this.dolly * (1 + Math.sin(this.time * 0.25) * 0.012);
    const shake = flash * 0.22;
    this.camera.position.set(
      Math.sin(this.time * 53) * shake,
      Math.sin(this.tilt) * dist + Math.sin(this.time * 41) * shake,
      Math.cos(this.tilt) * dist,
    );
    this.camera.lookAt(0, 0, 0);
    this.viewOffset = damp(this.viewOffset, this.viewOffsetTarget, 2.2, step);
    if (Math.abs(this.viewOffset) > 0.0005) {
      this.camera.setViewOffset(this.width, this.height, -this.viewOffset * this.width, 0, this.width, this.height);
    } else if (this.camera.view?.enabled) {
      this.camera.clearViewOffset();
    }

    // Fond étoilé : très lente dérive pour la parallaxe.
    this.background.rotation.y = this.rotation * 0.08 + this.time * 0.004;
  }

  render(): void {
    if (this.effects) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    this.width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    this.height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
    const aspect = this.width / this.height;
    this.camera.aspect = aspect;
    // Recule la caméra sur les écrans étroits (portrait) pour garder la galaxie dans le cadre.
    this.baseDistance = Math.max(17, 9.5 / (Math.tan((this.camera.fov * Math.PI) / 360) * aspect));
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setSize(this.width, this.height);
  }

  /** Libère toutes les ressources WebGL. */
  dispose(): void {
    for (const p of [this.stars, this.dust, this.background]) {
      p.geometry.dispose();
      (p.material as ShaderMaterial).dispose();
    }
    this.coreSprite.material.dispose();
    this.haloSprite.material.dispose();
    this.coreTexture.dispose();
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ------------------------------------------------------------------
  // Construction
  // ------------------------------------------------------------------

  private makeMaterial(fragmentShader: string, pulseSizeGain: number): ShaderMaterial {
    return new ShaderMaterial({
      // Les uniforms communs sont partagés (mêmes objets) ; seul le gain d'impulsion est propre au matériau.
      uniforms: { ...this.uniforms, uPulseSizeGain: { value: pulseSizeGain } },
      vertexShader: galaxyVertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
  }

  /** Étoiles de la galaxie. L'ordre est aléatoire : tout préfixe (drawRange) reste représentatif. */
  private buildStars(count: number): BufferGeometry {
    const orbit = new Float32Array(count * 4);
    const delta = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const props = new Float32Array(count * 2);
    const color = new Color();

    for (let i = 0; i < count; i++) {
      const roll = Math.random();
      let r: number, theta: number, y: number;
      let dr = 0, dth = 0, dy = 0;
      let size: number, alpha: number;

      if (roll < 0.13) {
        // Bulbe central dense et brillant.
        r = 2.0 * Math.pow(Math.random(), 1.6);
        theta = Math.random() * Math.PI * 2;
        y = gauss() * 0.5 * (1 - r / 2.4);
        size = 0.6 + Math.random() * 0.9;
        alpha = 0.8 + Math.random() * 0.2;
        gradientAt((r / RADIUS) * 0.9, color);
      } else if (roll < 0.21) {
        // Étoiles de champ réparties dans le disque.
        r = RADIUS * 1.08 * Math.sqrt(Math.random());
        theta = Math.random() * Math.PI * 2;
        y = gauss() * 0.3;
        size = 0.35 + Math.random() * 0.6;
        alpha = 0.35 + Math.random() * 0.35;
        gradientAt(clamp(r / RADIUS + gauss() * 0.08), color);
      } else {
        // Étoiles des bras spiraux.
        const arm = i % ARMS;
        const spineR = 0.7 + (RADIUS - 0.7) * Math.pow(Math.random(), 1.1);
        const spineTheta = (arm / ARMS) * Math.PI * 2 + spineR * TWIST;
        const spread = 0.22 + 0.62 * (spineR / RADIUS);
        dr = gauss() * spread * 0.85;
        dth = (gauss() * spread * 1.1) / Math.max(spineR, 1);
        y = gauss() * (0.14 + 0.24 * (1 - spineR / RADIUS));
        dy = y * 0.7;
        r = Math.max(0.05, spineR + dr);
        theta = spineTheta + dth;
        const closeness = Math.exp(-(dr * dr) / (spread * spread)); // proche du cœur du bras = plus brillant
        size = 0.35 + Math.random() * 0.75 + closeness * 0.35;
        alpha = 0.45 + closeness * 0.4 + Math.random() * 0.15;
        gradientAt(clamp(spineR / RADIUS + gauss() * 0.05), color);
      }

      // Quelques étoiles d'accent (rose, cyan, blanc) pour la richesse visuelle.
      if (Math.random() < 0.1) {
        tmpA.set(ACCENTS[Math.floor(Math.random() * ACCENTS.length)]);
        color.lerp(tmpA, 0.6);
        size *= 1.25;
      }
      const brightness = 0.75 + Math.random() * 0.5;

      orbit.set([r, theta, y, Math.random()], i * 4);
      delta.set([dr, dth, dy], i * 3);
      colors.set([color.r * brightness, color.g * brightness, color.b * brightness], i * 3);
      props.set([size, alpha], i * 2);
    }

    const g = new BufferGeometry();
    g.setAttribute('aOrbit', new BufferAttribute(orbit, 4));
    g.setAttribute('aDelta', new BufferAttribute(delta, 3));
    g.setAttribute('aColor', new BufferAttribute(colors, 3));
    g.setAttribute('aProps', new BufferAttribute(props, 2));
    // Attribut "position" factice requis par Three.js (les positions réelles sont calculées dans le shader).
    g.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    return g;
  }

  /** Nuages de poussière / nébuleuses le long des bras. */
  private buildDust(count: number): BufferGeometry {
    const orbit = new Float32Array(count * 4);
    const delta = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const props = new Float32Array(count * 2);
    const palette = ['#ff4fd8', '#9b5cff', '#3d6bff', '#22d3ff', '#c04dff'];
    const color = new Color();
    for (let i = 0; i < count; i++) {
      const arm = i % ARMS;
      const spineR = 1.2 + (RADIUS - 1.5) * Math.pow(Math.random(), 0.9);
      const spread = 0.5 + 0.6 * (spineR / RADIUS);
      const dr = gauss() * spread * 0.7;
      const dth = (gauss() * spread) / spineR;
      const y = gauss() * 0.18;
      orbit.set([spineR + dr, (arm / ARMS) * Math.PI * 2 + spineR * TWIST + dth, y, Math.random()], i * 4);
      delta.set([dr, dth, y * 0.5], i * 3);
      gradientAt(spineR / RADIUS, color).lerp(tmpA.set(palette[i % palette.length]), 0.5);
      colors.set([color.r, color.g, color.b], i * 3);
      props.set([9 + Math.random() * 14, 0.035 + Math.random() * 0.05], i * 2);
    }
    const g = new BufferGeometry();
    g.setAttribute('aOrbit', new BufferAttribute(orbit, 4));
    g.setAttribute('aDelta', new BufferAttribute(delta, 3));
    g.setAttribute('aColor', new BufferAttribute(colors, 3));
    g.setAttribute('aProps', new BufferAttribute(props, 2));
    g.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    return g;
  }

  /** Fond étoilé lointain sur une sphère. */
  private buildBackground(count: number): Points {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const star = new Float32Array(count * 2);
    const palette = ['#ffffff', '#cdd8ff', '#ffd6f5', '#a8f3ff', '#d9c8ff'];
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const rad = 90 + Math.random() * 70;
      const s = Math.sqrt(1 - u * u);
      positions.set([s * Math.cos(phi) * rad, u * rad, s * Math.sin(phi) * rad], i * 3);
      tmpA.set(palette[i % palette.length]).multiplyScalar(0.35 + Math.random() * 0.55);
      colors.set([tmpA.r, tmpA.g, tmpA.b], i * 3);
      star.set([0.8 + Math.pow(Math.random(), 4) * 2.6, Math.random()], i * 2);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setAttribute('aColor', new BufferAttribute(colors, 3));
    g.setAttribute('aStar', new BufferAttribute(star, 2));
    const m = new ShaderMaterial({
      uniforms: this.bgUniforms,
      vertexShader: backgroundVertexShader,
      fragmentShader: starFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    return new Points(g, m);
  }

  private buildGlowTexture(): CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.12, 'rgba(255,255,255,0.75)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.22)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.04)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }

  private makeSprite(color: string, opacity: number): Sprite {
    const sprite = new Sprite(
      new SpriteMaterial({
        map: this.coreTexture,
        color: new Color(color),
        transparent: true,
        opacity,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    sprite.renderOrder = 2;
    return sprite;
  }
}
