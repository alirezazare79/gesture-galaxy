/**
 * Interface — toute la manipulation du DOM : écrans d'accueil / chargement /
 * erreur, indicateurs de détection et de geste, boutons, notifications,
 * squelette de la main sur l'aperçu webcam et réticule à l'écran.
 */
import type { GestureState, MotionDirection } from './GestureController.ts';
import type { CameraErrorCode } from './HandTracker.ts';
import type { MouseAction } from './MouseController.ts';
import type { TwoHandState } from './TwoHandController.ts';
import type { GestureKind, Landmark } from '../utils/gestureUtils.ts';

export type AppState = 'welcome' | 'loading' | 'error' | 'running';
export type AppMode = 'none' | 'gesture' | 'mouse';
export type LoadingStep = 'camera' | 'runtime' | 'model' | 'scene' | 'galaxy' | 'gestures';

export interface InterfaceHandlers {
  onStart(): void;
  onMouseMode(): void;
  onRetry(): void;
  onToggleCamera(): void;
  onToggleEffects(): void;
  onToggleSound(): void;
  onReset(): void;
  onFullscreen(): void;
  onPulse(): void;
  onExpandToggle(): void;
  onContractToggle(): void;
}

interface GestureDisplay {
  icon: string;
  label: string;
  hint: string;
}

const GESTURE_TEXT: Record<GestureKind, GestureDisplay> = {
  none: { icon: '◌', label: 'Aucune main', hint: 'Placez votre main face à la caméra' },
  neutral: { icon: '🖐', label: 'Main détectée', hint: 'Ouvrez, fermez ou déplacez la main' },
  open: { icon: '✋', label: 'Main ouverte', hint: 'Expansion de la galaxie' },
  fist: { icon: '✊', label: 'Poing fermé', hint: 'Contraction vers le noyau' },
  pinch: { icon: '🤏', label: 'Pincement', hint: 'Impulsion lumineuse !' },
};

const MOTION_TEXT: Record<Exclude<MotionDirection, null>, GestureDisplay> = {
  left: { icon: '⟲', label: 'Rotation', hint: 'Vers la gauche' },
  right: { icon: '⟳', label: 'Rotation', hint: 'Vers la droite' },
  up: { icon: '⤒', label: 'Angle de vue', hint: 'Vue plongeante' },
  down: { icon: '⤓', label: 'Angle de vue', hint: 'Vue en contre-plongée' },
};

const MOUSE_TEXT: Record<MouseAction, GestureDisplay & { guide: string | null }> = {
  rotate: { icon: '⟳', label: 'Rotation', hint: 'Glisser horizontalement', guide: 'horizontal' },
  tilt: { icon: '⤒', label: 'Angle de vue', hint: 'Glisser verticalement', guide: 'vertical' },
  expand: { icon: '✋', label: 'Expansion', hint: 'Molette vers le haut / +', guide: 'open' },
  contract: { icon: '✊', label: 'Contraction', hint: 'Molette vers le bas / −', guide: 'fist' },
  neutral: { icon: '✦', label: 'Repos', hint: 'Taille normale', guide: null },
  pulse: { icon: '🤏', label: 'Impulsion', hint: 'Explosion lumineuse !', guide: 'pinch' },
  zoom: { icon: '🔍', label: 'Zoom', hint: 'Maj + molette', guide: 'two-hands' },
  roll: { icon: '🙌', label: 'Orientation', hint: 'Touches Q / D', guide: 'two-hands' },
};

const ERROR_TEXT: Record<CameraErrorCode | 'webgl', { title: string; message: string; help: string }> = {
  denied: {
    title: 'Accès à la caméra refusé',
    message: "Vous avez refusé l'accès à la webcam, ou il est bloqué par le navigateur.",
    help: "Cliquez sur l'icône de cadenas (ou de caméra) dans la barre d'adresse, autorisez la caméra pour ce site, puis cliquez sur « Réessayer ». Vous pouvez aussi explorer la galaxie avec la souris.",
  },
  'not-found': {
    title: 'Aucune caméra détectée',
    message: "Aucune webcam n'a été trouvée sur cet appareil.",
    help: 'Branchez une webcam puis réessayez, ou continuez avec la souris, le clavier ou le tactile.',
  },
  'in-use': {
    title: 'Caméra indisponible',
    message: 'La webcam est peut-être déjà utilisée par une autre application (visioconférence, autre onglet…).',
    help: "Fermez l'application qui utilise la caméra, puis cliquez sur « Réessayer ».",
  },
  insecure: {
    title: 'Connexion non sécurisée',
    message: "Les navigateurs n'autorisent la webcam que sur une page sécurisée (HTTPS) ou en local (localhost).",
    help: "Ouvrez la version publiée en HTTPS, ou lancez le projet avec « npm run dev » puis ouvrez l'adresse localhost.",
  },
  unsupported: {
    title: 'Navigateur non compatible',
    message: "Votre navigateur ne permet pas d'accéder à la webcam.",
    help: 'Essayez une version récente de Chrome, Edge, Firefox ou Safari, ou continuez avec la souris.',
  },
  model: {
    title: 'Modèle de détection indisponible',
    message: 'Le modèle de reconnaissance des mains n’a pas pu être chargé.',
    help: 'Vérifiez votre connexion Internet puis réessayez. La galaxie reste utilisable avec la souris.',
  },
  unknown: {
    title: 'Impossible de démarrer la caméra',
    message: "Une erreur inattendue s'est produite lors de l'activation de la webcam.",
    help: 'Réessayez, ou continuez avec la souris.',
  },
  webgl: {
    title: 'WebGL indisponible',
    message: "Votre navigateur ou votre carte graphique ne permet pas d'afficher la scène 3D.",
    help: "Activez l'accélération matérielle dans les paramètres du navigateur, ou essayez un autre navigateur.",
  },
};

const HAND_CONNECTIONS: ReadonlyArray<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const GESTURE_COLORS: Record<GestureKind, string> = {
  none: '#c9b8ff',
  neutral: '#c9b8ff',
  open: '#22e3ff',
  fist: '#ff4fd8',
  pinch: '#ffcf5a',
};

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Élément #${id} introuvable`);
  return el as T;
}

export class Interface {
  readonly app = $<HTMLDivElement>('app');
  readonly sceneContainer = $<HTMLDivElement>('scene');
  readonly video = $<HTMLVideoElement>('webcam');

  private readonly overlay = $<HTMLCanvasElement>('landmarks');
  private readonly overlayCtx = this.overlay.getContext('2d');
  private readonly welcomePanel = $<HTMLDivElement>('welcome-panel');
  private readonly loader = $<HTMLDivElement>('loader');
  private readonly errorPanel = $<HTMLDivElement>('error-panel');
  private readonly handDot = $<HTMLSpanElement>('hand-dot');
  private readonly handStatus = $<HTMLSpanElement>('hand-status');
  private readonly chip = $<HTMLDivElement>('gesture-chip');
  private readonly chipIcon = $<HTMLSpanElement>('gesture-icon');
  private readonly chipLabel = $<HTMLSpanElement>('gesture-label');
  private readonly chipHint = $<HTMLSpanElement>('gesture-hint');
  private readonly reticle = $<HTMLDivElement>('reticle');
  private readonly toast = $<HTMLDivElement>('toast');
  private readonly btnCamera = $<HTMLButtonElement>('btn-camera');
  private readonly btnEffects = $<HTMLButtonElement>('btn-effects');
  private readonly btnSound = $<HTMLButtonElement>('btn-sound');
  private readonly btnFullscreen = $<HTMLButtonElement>('btn-fullscreen');
  private readonly btnExpand = $<HTMLButtonElement>('btn-expand');
  private readonly btnContract = $<HTMLButtonElement>('btn-contract');
  private readonly guideItems = Array.from(document.querySelectorAll<HTMLLIElement>('#guide-list li'));

  private toastTimer = 0;
  private lastChipKey = '';
  private mouseActionUntil = 0;

  constructor(handlers: InterfaceHandlers) {
    $('btn-start').addEventListener('click', handlers.onStart);
    $('btn-mouse').addEventListener('click', handlers.onMouseMode);
    $('btn-error-mouse').addEventListener('click', handlers.onMouseMode);
    $('btn-retry').addEventListener('click', handlers.onRetry);
    this.btnCamera.addEventListener('click', handlers.onToggleCamera);
    this.btnEffects.addEventListener('click', handlers.onToggleEffects);
    this.btnSound.addEventListener('click', handlers.onToggleSound);
    $('btn-reset').addEventListener('click', handlers.onReset);
    this.btnFullscreen.addEventListener('click', handlers.onFullscreen);
    $('btn-pulse').addEventListener('click', handlers.onPulse);
    this.btnExpand.addEventListener('click', handlers.onExpandToggle);
    this.btnContract.addEventListener('click', handlers.onContractToggle);

    const guideToggle = $<HTMLButtonElement>('guide-toggle');
    const guideList = $<HTMLUListElement>('guide-list');
    guideToggle.addEventListener('click', () => {
      const expanded = guideToggle.getAttribute('aria-expanded') !== 'true';
      guideToggle.setAttribute('aria-expanded', String(expanded));
      guideList.hidden = !expanded;
    });

    // Empêche les clics sur l'interface d'atteindre la scène (pas d'impulsion involontaire).
    for (const el of document.querySelectorAll<HTMLElement>('.hud, .overlay')) {
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
  }

  // ------------------------------------------------------------------
  // États globaux
  // ------------------------------------------------------------------

  setState(state: AppState): void {
    this.app.dataset.state = state;
    this.welcomePanel.hidden = state !== 'welcome';
    this.loader.hidden = state !== 'loading';
    this.errorPanel.hidden = state !== 'error';
  }

  get state(): AppState {
    return this.app.dataset.state as AppState;
  }

  setMode(mode: AppMode): void {
    this.app.dataset.mode = mode;
    const label = this.btnCamera.querySelector('.btn__label');
    if (label) label.textContent = mode === 'gesture' ? 'Désactiver la caméra' : 'Activer la caméra';
    this.btnCamera.setAttribute('aria-pressed', String(mode === 'gesture'));
    if (mode === 'mouse') {
      this.setHandStatus('mouse');
      this.showChip({ icon: '🖱', label: 'Mode souris', hint: 'Glissez, faites défiler, cliquez' }, 'mouse');
      this.updateReticle(null);
      this.clearLandmarks();
    } else if (mode === 'gesture') {
      this.setHandStatus('searching');
    }
  }

  resetLoadingSteps(): void {
    for (const li of this.loader.querySelectorAll<HTMLLIElement>('li')) delete li.dataset.status;
  }

  setStep(step: LoadingStep, status: 'active' | 'done' | 'error'): void {
    const li = this.loader.querySelector<HTMLLIElement>(`li[data-step="${step}"]`);
    if (li) li.dataset.status = status;
  }

  showError(code: CameraErrorCode | 'webgl', detail?: string): void {
    const t = ERROR_TEXT[code];
    $('error-title').textContent = t.title;
    $('error-message').textContent = t.message;
    $('error-help').textContent = t.help;
    $('btn-retry').hidden = code === 'webgl';
    $('btn-error-mouse').hidden = code === 'webgl';
    if (detail) console.warn(`[GESTURE GALAXY] ${t.title} :`, detail);
    this.setState('error');
  }

  // ------------------------------------------------------------------
  // Boutons
  // ------------------------------------------------------------------

  setEffectsButton(enabled: boolean): void {
    this.btnEffects.setAttribute('aria-pressed', String(enabled));
    const label = this.btnEffects.querySelector('.btn__label');
    if (label) label.textContent = enabled ? 'Effets : activés' : 'Effets : désactivés';
  }

  setSoundButton(enabled: boolean): void {
    this.btnSound.setAttribute('aria-pressed', String(enabled));
    const label = this.btnSound.querySelector('.btn__label');
    if (label) label.textContent = enabled ? 'Son : activé' : 'Son : coupé';
    this.btnSound.classList.toggle('is-muted', !enabled);
  }

  setFullscreenButton(active: boolean, supported: boolean): void {
    this.btnFullscreen.hidden = !supported;
    const label = this.btnFullscreen.querySelector('.btn__label');
    if (label) label.textContent = active ? 'Quitter le plein écran' : 'Plein écran';
  }

  setMouseExpansionButtons(target: number): void {
    this.btnExpand.setAttribute('aria-pressed', String(target > 0.01));
    this.btnContract.setAttribute('aria-pressed', String(target < -0.01));
  }

  notify(message: string, duration = 2800): void {
    this.toast.textContent = message;
    this.toast.classList.add('is-visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('is-visible'), duration);
  }

  // ------------------------------------------------------------------
  // Indicateurs
  // ------------------------------------------------------------------

  setHandStatus(status: 'off' | 'searching' | 'active' | 'lost' | 'mouse' | 'two'): void {
    if (this.handDot.dataset.status === status) return;
    this.handDot.dataset.status = status;
    this.handStatus.textContent = {
      off: 'Caméra inactive',
      searching: 'Recherche de la main…',
      active: 'Main détectée',
      two: 'Deux mains détectées',
      lost: 'Main perdue, reprise…',
      mouse: 'Mode souris actif',
    }[status];
  }

  /** Met à jour les indicateurs à partir de l'état gestuel (appelé à chaque analyse). */
  updateGesture(s: GestureState): void {
    this.setHandStatus(s.tracking === 'active' ? 'active' : s.tracking === 'lost' ? 'lost' : 'searching');
    const display = s.motion && s.gesture !== 'pinch' ? MOTION_TEXT[s.motion] : GESTURE_TEXT[s.gesture];
    this.showChip(display, s.gesture);

    let guide: string | null = null;
    if (s.gesture === 'pinch') guide = 'pinch';
    else if (s.motion === 'left' || s.motion === 'right') guide = 'horizontal';
    else if (s.motion === 'up' || s.motion === 'down') guide = 'vertical';
    else if (s.gesture === 'open' || s.gesture === 'fist') guide = s.gesture;
    this.highlightGuide(guide);
    this.updateReticle(s);
  }

  /** Indicateurs pendant le geste à deux mains. */
  updateTwoHands(t: TwoHandState): void {
    this.setHandStatus('two');
    const zoomPct = Math.round((1 / t.zoom) * 100);
    const deg = Math.round((-t.roll * 180) / Math.PI);
    this.showChip({ icon: '🙌', label: 'Deux mains', hint: `Zoom ${zoomPct} % · rotation ${deg}°` }, 'two');
    this.highlightGuide('two-hands');
    this.reticle.classList.remove('is-visible', 'is-lost');
  }

  /** Retour visuel pour les actions souris / clavier. */
  showMouseAction(action: MouseAction): void {
    const t = MOUSE_TEXT[action];
    this.showChip(t, action === 'pulse' ? 'pinch' : action === 'expand' ? 'open' : action === 'contract' ? 'fist' : 'neutral');
    this.highlightGuide(t.guide);
    this.mouseActionUntil = performance.now() + 1400;
  }

  /** Revient à l'affichage par défaut du mode souris après une action. */
  tickMouseMode(now: number): void {
    if (this.mouseActionUntil && now > this.mouseActionUntil) {
      this.mouseActionUntil = 0;
      this.showChip({ icon: '🖱', label: 'Mode souris', hint: 'Glissez, faites défiler, cliquez' }, 'mouse');
      this.highlightGuide(null);
    }
  }

  private showChip(d: GestureDisplay, gesture: string): void {
    const key = `${d.icon}|${d.label}|${d.hint}|${gesture}`;
    if (key === this.lastChipKey) return;
    const iconChanged = this.chipIcon.textContent !== d.icon;
    this.lastChipKey = key;
    this.chip.dataset.gesture = gesture;
    this.chipIcon.textContent = d.icon;
    this.chipLabel.textContent = d.label;
    this.chipHint.textContent = d.hint;
    if (iconChanged) {
      this.chip.classList.remove('is-bump');
      void this.chip.offsetWidth; // relance l'animation
      this.chip.classList.add('is-bump');
    }
  }

  private highlightGuide(name: string | null): void {
    for (const li of this.guideItems) li.classList.toggle('is-active', li.dataset.gesture === name);
  }

  /** Réticule lumineux qui suit la main sur la scène. */
  updateReticle(s: GestureState | null): void {
    const el = this.reticle;
    if (!s || s.tracking === 'none') {
      el.classList.remove('is-visible', 'is-lost');
      return;
    }
    el.classList.add('is-visible');
    el.classList.toggle('is-lost', s.tracking === 'lost');
    el.dataset.gesture = s.gesture;
    const x = s.palmX * this.app.clientWidth;
    const y = s.palmY * this.app.clientHeight;
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    const scale = s.gesture === 'pinch' ? 0.45 : 0.55 + s.openness * 0.7;
    el.style.setProperty('--reticle-scale', scale.toFixed(3));
  }

  // ------------------------------------------------------------------
  // Squelette de la main sur l'aperçu webcam
  // ------------------------------------------------------------------

  drawHands(hands: ReadonlyArray<ReadonlyArray<Landmark>>, gesture: GestureKind): void {
    const ctx = this.overlayCtx;
    if (!ctx) return;
    const c = this.overlay;
    const w = c.clientWidth, h = c.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (hands.length === 0) return;

    // Correspondance avec object-fit: cover de la vidéo.
    const vw = this.video.videoWidth || 640, vh = this.video.videoHeight || 480;
    const s = Math.max(w / vw, h / vh);
    const ox = (w - vw * s) / 2, oy = (h - vh * s) / 2;
    const px = (p: Landmark) => ox + p.x * vw * s;
    const py = (p: Landmark) => oy + p.y * vh * s;

    const color = GESTURE_COLORS[gesture];
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    for (const landmarks of hands) {
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo(px(landmarks[a]), py(landmarks[a]));
        ctx.lineTo(px(landmarks[b]), py(landmarks[b]));
      }
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < landmarks.length; i++) {
        const tip = i === 4 || i === 8;
        ctx.beginPath();
        ctx.arc(px(landmarks[i]), py(landmarks[i]), tip ? 3.6 : 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
  }

  clearLandmarks(): void {
    this.drawHands([], 'none');
  }
}
