/**
 * Détection des capacités de l'appareil et adaptation automatique de la qualité.
 */
import type { GalaxyOptions, QualitySettings } from '../components/Galaxy.ts';

/** Vérifie que WebGL est disponible. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const ok = !!gl;
    (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

/** Choisit un nombre de particules adapté à l'appareil (surcharge possible : ?particles=20000). */
export function pickGalaxyOptions(): GalaxyOptions {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const cores = navigator.hardwareConcurrency ?? 4;
  let particleCount = coarse ? 14000 : cores <= 4 ? 20000 : 28000;
  const override = Number(new URLSearchParams(window.location.search).get('particles'));
  if (Number.isFinite(override) && override > 0) particleCount = Math.min(Math.max(Math.round(override), 2000), 80000);
  return {
    particleCount,
    dustCount: coarse ? 600 : 1300,
    backgroundCount: coarse ? 1500 : 2600,
    maxPixelRatio: coarse ? 1.5 : 2,
  };
}

/** Niveaux de qualité successifs, du plus beau au plus léger. */
const LEVELS: ReadonlyArray<{ prScale: number; prCap: number; particleFraction: number }> = [
  { prScale: 1, prCap: 2, particleFraction: 1 },
  { prScale: 1, prCap: 1.5, particleFraction: 1 },
  { prScale: 1, prCap: 1.1, particleFraction: 0.8 },
  { prScale: 0.85, prCap: 0.9, particleFraction: 0.6 },
  { prScale: 0.7, prCap: 0.75, particleFraction: 0.45 },
];

/**
 * Surveille la fluidité et réduit progressivement la résolution puis le nombre
 * de particules si l'ordinateur n'arrive pas à suivre.
 */
export class QualityMonitor {
  level = 0;
  fps = 60;
  private elapsed = 0;
  private frames = 0;
  private warmup = 2.5; // secondes ignorées au démarrage (compilation des shaders…)
  private readonly apply: (q: QualitySettings, level: number) => void;
  private readonly minFps: number;

  constructor(apply: (q: QualitySettings, level: number) => void, minFps = 40) {
    this.apply = apply;
    this.minFps = minFps;
  }

  /** Désactive l'adaptation (paramètre d'URL ?quality=max, utile pour les captures). */
  enabled = new URLSearchParams(window.location.search).get('quality') !== 'max';

  /** À appeler à chaque image avec la durée de l'image en secondes. */
  sample(dt: number): void {
    if (!this.enabled || dt <= 0 || dt > 0.25) return; // onglet en arrière-plan, pause…
    if (this.warmup > 0) {
      this.warmup -= dt;
      return;
    }
    this.elapsed += dt;
    this.frames++;
    if (this.elapsed < 2) return;
    this.fps = this.frames / this.elapsed;
    this.elapsed = 0;
    this.frames = 0;
    if (this.fps < this.minFps && this.level < LEVELS.length - 1) {
      this.level++;
      this.apply(this.settings(), this.level);
      this.warmup = 1; // laisse le temps à la nouvelle configuration de se stabiliser
    }
  }

  settings(): QualitySettings {
    const l = LEVELS[this.level];
    const dpr = window.devicePixelRatio || 1;
    return { pixelRatio: Math.min(dpr * l.prScale, l.prCap), particleFraction: l.particleFraction };
  }

  reset(): void {
    this.level = 0;
    this.warmup = 2.5;
    this.elapsed = 0;
    this.frames = 0;
  }
}

/* ---------- Plein écran (avec préfixes Safari) ---------- */

type FsDocument = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> | void; webkitFullscreenEnabled?: boolean };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export const fullscreenSupported = (): boolean => {
  const d = document as FsDocument;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
};

export const isFullscreen = (): boolean => {
  const d = document as FsDocument;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
};

export async function toggleFullscreen(el: HTMLElement): Promise<void> {
  const d = document as FsDocument;
  const e = el as FsElement;
  if (isFullscreen()) {
    await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.());
  } else {
    await (e.requestFullscreen ? e.requestFullscreen() : e.webkitRequestFullscreen?.());
  }
}
