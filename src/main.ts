/**
 * GESTURE GALAXY — point d'entrée.
 * Orchestre l'interface, la scène 3D, la détection de la main et les commandes.
 */
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/800.css';
import '@fontsource-variable/space-grotesk';
import './style.css';

import { Galaxy } from './components/Galaxy.ts';
import { GestureController, type GestureState } from './components/GestureController.ts';
import { HandTracker, toCameraError } from './components/HandTracker.ts';
import { Interface, type LoadingStep } from './components/Interface.ts';
import { MouseController } from './components/MouseController.ts';
import { SoundEngine } from './components/SoundEngine.ts';
import { TwoHandController } from './components/TwoHandController.ts';
import { clamp, deadZone, type Landmark } from './utils/gestureUtils.ts';
import {
  QualityMonitor,
  fullscreenSupported,
  isFullscreen,
  pickGalaxyOptions,
  toggleFullscreen,
  webglAvailable,
} from './utils/device.ts';

/** Vitesse de rotation (rad/s) pour un déplacement de la main d'une largeur d'écran par seconde. */
const ROTATION_GAIN = 3.4;
/** Course verticale de la main (fraction de la hauteur) pour passer du défaut à l'angle maximal. */
const TILT_RANGE = 0.3;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SOUND_PREF_KEY = 'gesture-galaxy:sound';
function readSoundPref(): boolean {
  try {
    return localStorage.getItem(SOUND_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}
function saveSoundPref(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_PREF_KEY, enabled ? 'on' : 'off');
  } catch {
    /* stockage indisponible : préférence non mémorisée */
  }
}

class App {
  private readonly ui: Interface;
  private readonly galaxy: Galaxy;
  private readonly tracker: HandTracker;
  private readonly gestures = new GestureController();
  private readonly twoHands = new TwoHandController();
  private readonly sound = new SoundEngine();
  private readonly mouse: MouseController;
  private readonly quality: QualityMonitor;

  private mode: 'none' | 'gesture' | 'mouse' = 'none';
  private starting = false;
  private lastFrame = performance.now();
  private rafId = 0;
  private disposed = false;
  /** Mode capture (débogage) : l'animation n'avance que sur demande. */
  private frozen = false;

  constructor(ui: Interface) {
    this.ui = ui;
    this.galaxy = new Galaxy(ui.sceneContainer, pickGalaxyOptions());
    this.tracker = new HandTracker(ui.video);
    this.tracker.onCameraEnded = () => {
      if (this.mode !== 'gesture') return;
      this.ui.notify("La caméra s'est arrêtée : passage en mode souris.", 4000);
      this.startMouseMode();
    };

    this.quality = new QualityMonitor((q, level) => {
      this.galaxy.setQuality(q);
      console.info(`[GESTURE GALAXY] Qualité adaptée (niveau ${level}) :`, q);
    });

    // Pincement : impulsion lumineuse (une seule fois par pincement, géré par le contrôleur).
    this.gestures.onPinch(() => this.firePulse());

    this.mouse = new MouseController(ui.sceneContainer, this.galaxy, (action) => {
      if (action === 'pulse') this.sound.explosion();
      if (this.mode === 'none' && this.ui.state !== 'welcome') return;
      if (this.mode === 'mouse') this.ui.showMouseAction(action);
      this.ui.setMouseExpansionButtons(this.galaxy.getExpansionTarget());
    });

    this.bindGlobalEvents();
    this.updateWelcomeLayout(true);
    this.ui.setEffectsButton(true);
    this.sound.setEnabled(readSoundPref());
    this.ui.setSoundButton(this.sound.isEnabled);
    this.ui.setFullscreenButton(false, fullscreenSupported());
    this.rafId = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------
  // Démarrage
  // ------------------------------------------------------------------

  /** Sur grand écran, l'accueil est à gauche : la galaxie se décale à droite pour rester visible. */
  private updateWelcomeLayout(immediate = false): void {
    const wide = window.matchMedia('(min-width: 1100px) and (min-aspect-ratio: 13/10)').matches;
    const overlay = this.ui.state !== 'running';
    this.galaxy.setViewOffset(overlay && wide ? 0.2 : 0, immediate);
  }

  /** Séquence de démarrage : webcam → MediaPipe → modèle → scène → galaxie → gestes. */
  async startGestureMode(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    this.sound.start(); // doit suivre directement le clic de l'utilisateur
    const ui = this.ui;
    ui.resetLoadingSteps();
    ui.setState('loading');
    let current: LoadingStep = 'camera';
    const step = (s: LoadingStep) => {
      ui.setStep(current, 'done');
      current = s;
      ui.setStep(s, 'active');
    };

    try {
      ui.setStep('camera', 'active');
      await this.tracker.startCamera();

      step('runtime');
      await this.tracker.loadModel((p) => {
        if (p === 'runtime') step('model');
      });

      step('scene');
      this.galaxy.resize();
      await wait(180);

      step('galaxy');
      this.galaxy.setDolly(1);
      await wait(180);

      step('gestures');
      this.gestures.reset();
      this.mode = 'gesture';
      ui.setMode('gesture');
      await wait(320);
      ui.setStep('gestures', 'done');
      await wait(250);

      ui.setState('running');
      this.updateWelcomeLayout();
      this.firePulse();
      ui.notify('Montrez votre main à la caméra ✋ — ou les deux 🙌', 3800);
    } catch (err) {
      const error = toCameraError(err);
      ui.setStep(current, 'error');
      this.tracker.stopCamera();
      this.mode = 'none';
      ui.setMode('none');
      await wait(400);
      ui.showError(error.code, error.message);
      this.updateWelcomeLayout();
    } finally {
      this.starting = false;
    }
  }

  /** Mode alternatif : souris, tactile et clavier. */
  startMouseMode(): void {
    this.sound.start();
    this.tracker.stopCamera();
    this.gestures.reset();
    this.twoHands.reset();
    this.galaxy.setSpinInput(0);
    const fromOverlay = this.ui.state !== 'running';
    this.mode = 'mouse';
    this.ui.setMode('mouse');
    this.ui.setState('running');
    this.updateWelcomeLayout();
    this.galaxy.setDolly(1);
    this.ui.setMouseExpansionButtons(this.galaxy.getExpansionTarget());
    if (fromOverlay) {
      this.firePulse();
      this.ui.notify('Mode souris : glissez, faites défiler, cliquez', 3500);
    }
  }

  toggleCamera(): void {
    if (this.mode === 'gesture') {
      this.startMouseMode();
      this.ui.notify('Caméra désactivée', 2200);
    } else {
      void this.startGestureMode();
    }
  }

  // ------------------------------------------------------------------
  // Commandes
  // ------------------------------------------------------------------

  reset(): void {
    this.galaxy.reset();
    this.quality.reset();
    this.galaxy.setQuality(this.quality.settings());
    this.ui.setMouseExpansionButtons(0);
    this.ui.notify('Galaxie réinitialisée', 1800);
  }

  toggleEffects(): void {
    const enabled = !this.galaxy.effectsEnabled;
    this.galaxy.setEffects(enabled);
    this.ui.setEffectsButton(enabled);
    this.ui.notify(enabled ? 'Effets visuels activés' : 'Effets visuels désactivés', 1800);
  }

  async toggleFullscreen(): Promise<void> {
    try {
      await toggleFullscreen(document.documentElement);
    } catch {
      this.ui.notify("Le plein écran n'est pas disponible ici.", 2500);
    }
  }

  pulse(): void {
    this.firePulse();
    this.ui.showMouseAction('pulse');
  }

  /** Impulsion lumineuse + explosion sonore. */
  private firePulse(): void {
    this.galaxy.pulse();
    this.sound.explosion();
  }

  toggleSound(): void {
    const enabled = !this.sound.isEnabled;
    this.sound.setEnabled(enabled);
    if (enabled) this.sound.start();
    saveSoundPref(enabled);
    this.ui.setSoundButton(enabled);
    this.ui.notify(enabled ? 'Son activé 🔊' : 'Son coupé', 1600);
  }

  toggleExpansion(direction: 1 | -1): void {
    const current = this.galaxy.getExpansionTarget();
    const next = Math.sign(current) === direction ? 0 : direction;
    this.galaxy.setExpansionTarget(next);
    this.ui.setMouseExpansionButtons(next);
    this.ui.showMouseAction(next > 0 ? 'expand' : next < 0 ? 'contract' : 'neutral');
  }

  // ------------------------------------------------------------------
  // Gestes → galaxie
  // ------------------------------------------------------------------

  private wasTracking = false;
  private wasTwoHands = false;

  /**
   * Traite une observation (réelle ou simulée) : 0, 1 ou 2 mains.
   * Deux mains → zoom et rotation ; une main → les cinq gestes principaux.
   */
  processHands(hands: ReadonlyArray<ReadonlyArray<Landmark>>, now: number, aspect: number): GestureState {
    const two = this.twoHands.update(hands, now, aspect, this.galaxy.getDollyTarget(), this.galaxy.getRollTarget());
    if (two.active) {
      if (!this.wasTwoHands) {
        this.galaxy.setSpinInput(0);
        this.ui.notify('🙌 Deux mains : écartez pour zoomer, tournez pour orienter', 2600);
      }
      this.wasTwoHands = true;
      this.galaxy.setDolly(two.zoom);
      this.galaxy.setRoll(two.roll);
      this.ui.updateTwoHands(two);
      this.ui.drawHands(hands, 'neutral');
      return this.gestures.state;
    }
    if (this.wasTwoHands) {
      // Retour à une main : nouvelle référence de position, sans à-coup.
      this.wasTwoHands = false;
      this.gestures.resync();
    }
    return this.processHand(hands[0] ?? null, now, aspect);
  }

  /** Traite une observation d'une seule main (réelle ou simulée). */
  processHand(landmarks: ReadonlyArray<Landmark> | null, now: number, aspect: number): GestureState {
    const s = this.gestures.update(landmarks, now, aspect);
    const tracking = s.tracking !== 'none';
    if (tracking) {
      this.galaxy.setExpansionTarget(s.expansionTarget);
      this.galaxy.setSpinInput(s.velocityX * ROTATION_GAIN);
      if (s.tracking === 'active') {
        // Main haute → vue plongeante ; main basse → contre-plongée. Petite zone morte au centre.
        this.galaxy.setTiltNormalized(clamp(deadZone(0.5 - s.palmY, 0.04) / TILT_RANGE, -1, 1));
      }
    } else if (this.wasTracking) {
      // Main partie : retour progressif à l'état de repos (la rotation garde son inertie).
      this.galaxy.setExpansionTarget(0);
      this.galaxy.setSpinInput(0);
    }
    this.wasTracking = tracking;
    this.ui.updateGesture(s);
    this.ui.drawHands(landmarks ? [landmarks] : [], s.gesture);
    return s;
  }

  // ------------------------------------------------------------------
  // Boucle d'animation
  // ------------------------------------------------------------------

  private loop = (now: number) => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;

    if (this.frozen) return;

    if (this.mode === 'gesture') {
      const result = this.tracker.detect(now);
      if (result) this.processHands(result.hands, now, result.aspect);
    } else if (this.mode === 'mouse') {
      this.ui.tickMouseMode(now);
    }

    this.galaxy.update(dt);
    this.galaxy.render();
    this.sound.update(this.galaxy.audioState);
    this.quality.sample(dt);
  };

  // ------------------------------------------------------------------
  // Événements globaux et nettoyage
  // ------------------------------------------------------------------

  private bindGlobalEvents(): void {
    const resize = () => {
      this.galaxy.resize();
      this.updateWelcomeLayout();
    };
    new ResizeObserver(resize).observe(this.ui.sceneContainer);
    window.addEventListener('orientationchange', resize);

    const onFs = () => this.ui.setFullscreenButton(isFullscreen(), fullscreenSupported());
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);

    window.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')) return;
      if (this.ui.state !== 'running') return;
      const key = e.key.toLowerCase();
      if (key === 'r') this.reset();
      else if (key === 'f') void this.toggleFullscreen();
      else if (key === 'e') this.toggleEffects();
      else if (key === 'm') this.toggleSound();
    });

    // Coupe le son quand l'onglet est en arrière-plan.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.sound.suspend();
      else void this.sound.resume();
    });

    this.galaxy.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.ui.notify('Contexte graphique perdu, restauration en cours…', 4000);
    });

    // Libère la caméra et les ressources GPU quand la page est fermée.
    window.addEventListener('pagehide', (e) => {
      if (!e.persisted) this.dispose();
      else this.tracker.stopCamera();
    });
  }

  /** Expose quelques commandes pour les tests automatisés (?debug dans l'URL). */
  debugApi() {
    return {
      galaxy: () => this.galaxy.debugState,
      gesture: () => ({ ...this.gestures.state }),
      mode: () => this.mode,
      quality: () => ({ level: this.quality.level, fps: this.quality.fps }),
      tracker: () => ({ camera: this.tracker.cameraActive, model: this.tracker.modelReady, delegate: this.tracker.delegate }),
      simulateHand: (landmarks: Landmark[] | null, time = performance.now(), aspect = 4 / 3) => {
        this.processHands(landmarks ? [landmarks] : [], time, aspect);
        return { ...this.gestures.state };
      },
      simulateHands: (hands: Landmark[][], time = performance.now(), aspect = 4 / 3) => {
        this.processHands(hands, time, aspect);
        return { gesture: { ...this.gestures.state }, twoHands: { ...this.twoHands.state } };
      },
      sound: () => ({ started: this.sound.started, enabled: this.sound.isEnabled }),
      /** Capture image par image : fige l'animation, puis la fait avancer pas à pas. */
      freeze: (on: boolean) => {
        this.frozen = on;
      },
      step: (dt = 1 / 30, frames = 1) => {
        for (let i = 0; i < frames; i++) this.galaxy.update(dt);
        this.galaxy.render();
      },
      /** Rendu audio hors ligne : mesure le niveau sonore au repos, en contraction et lors d'une explosion. */
      audioSelfTest: async () => {
        const rms = async (setup: (e: SoundEngine) => void) => {
          const ctx = new OfflineAudioContext(1, 44100 * 2, 44100);
          const e = new SoundEngine();
          e.attach(ctx, ctx.destination, 0.01);
          setup(e);
          const data = (await ctx.startRendering()).getChannelData(0);
          // Fenêtre 0,1 s → 0,8 s : là où l'explosion est la plus forte.
          let sum = 0;
          for (let i = 4410; i < 35280; i++) sum += data[i] * data[i];
          return Math.sqrt(sum / (35280 - 4410));
        };
        return {
          rest: await rms((e) => e.update({ expansion: 0, spin: 0 })),
          contraction: await rms((e) => e.update({ expansion: -1, spin: 0 })),
          explosion: await rms((e) => {
            e.update({ expansion: 0, spin: 0 });
            e.explosion();
          }),
        };
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.mouse.dispose();
    this.tracker.dispose();
    this.sound.dispose();
    this.galaxy.dispose();
  }
}

// ----------------------------------------------------------------------
// Initialisation
// ----------------------------------------------------------------------

let app: App | null = null;

const ui = new Interface({
  onStart: () => void app?.startGestureMode(),
  onRetry: () => void app?.startGestureMode(),
  onMouseMode: () => app?.startMouseMode(),
  onToggleCamera: () => app?.toggleCamera(),
  onToggleEffects: () => app?.toggleEffects(),
  onToggleSound: () => app?.toggleSound(),
  onReset: () => app?.reset(),
  onFullscreen: () => void app?.toggleFullscreen(),
  onPulse: () => app?.pulse(),
  onExpandToggle: () => app?.toggleExpansion(1),
  onContractToggle: () => app?.toggleExpansion(-1),
});

if (!webglAvailable()) {
  ui.showError('webgl');
} else {
  try {
    app = new App(ui);
    if (new URLSearchParams(window.location.search).has('debug')) {
      (window as unknown as { __GG__: unknown }).__GG__ = app.debugApi();
    }
  } catch (err) {
    ui.showError('webgl', String(err));
  }
}
