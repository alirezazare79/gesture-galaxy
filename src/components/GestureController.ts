/**
 * GestureController — transforme le flux brut de points de repère en gestes
 * stables et en commandes continues (rotation, inclinaison, expansion).
 *
 * Indépendant du DOM et de Three.js : il est testé unitairement (tests/).
 *
 * Stabilité :
 *  - lissage One Euro de la position de la paume (anti-tremblement) ;
 *  - zone morte sur la vitesse (tolérance aux petites variations) ;
 *  - hystérésis + confirmation sur plusieurs images avant de changer de geste ;
 *  - pincement déclenché une seule fois par pincement, avec temporisation ;
 *  - période de grâce lors des pertes de détection temporaires.
 */
import {
  OneEuroFilter,
  classifyGesture,
  computeHandFeatures,
  damp,
  deadZone,
  DEFAULT_THRESHOLDS,
  type ClassifierThresholds,
  type GestureKind,
  type Landmark,
} from '../utils/gestureUtils.ts';

export type TrackingStatus = 'none' | 'active' | 'lost';
export type MotionDirection = 'left' | 'right' | 'up' | 'down' | null;

export interface GestureState {
  tracking: TrackingStatus;
  gesture: GestureKind;
  /** Ouverture lissée de la main (0..1). */
  openness: number;
  /** Position lissée de la paume, coordonnées écran 0..1 (miroir appliqué). */
  palmX: number;
  palmY: number;
  /** Vitesse lissée de la paume en largeurs d'écran/seconde, zone morte appliquée. */
  velocityX: number;
  velocityY: number;
  /** Direction du mouvement dominant (pour l'affichage). */
  motion: MotionDirection;
  /** Distance pouce/index normalisée (pour l'affichage). */
  pinchDistance: number;
  /** Consigne d'expansion : +1 main ouverte, -1 poing, 0 repos. */
  expansionTarget: number;
}

export interface GestureControllerOptions {
  /** Durée pendant laquelle une main perdue est considérée comme toujours présente (ms). */
  lossGraceMs: number;
  /** Temps minimal entre deux impulsions de pincement (ms). */
  pinchCooldownMs: number;
  /** Nombre d'images consécutives pour valider un nouveau geste. */
  confirmFrames: number;
  /** Nombre d'images consécutives pour valider un pincement (plus réactif). */
  pinchConfirmFrames: number;
  /** Zone morte de vitesse (largeurs d'écran/seconde). */
  velocityDeadZone: number;
  /** Seuil de vitesse pour afficher un mouvement directionnel. */
  motionLabelThreshold: number;
  thresholds: ClassifierThresholds;
}

export const DEFAULT_CONTROLLER_OPTIONS: GestureControllerOptions = {
  lossGraceMs: 450,
  pinchCooldownMs: 700,
  confirmFrames: 3,
  pinchConfirmFrames: 2,
  velocityDeadZone: 0.12,
  motionLabelThreshold: 0.45,
  thresholds: DEFAULT_THRESHOLDS,
};

type PinchListener = (x: number, y: number) => void;
type GestureListener = (gesture: GestureKind, previous: GestureKind) => void;

const createIdleState = (): GestureState => ({
  tracking: 'none',
  gesture: 'none',
  openness: 0.5,
  palmX: 0.5,
  palmY: 0.5,
  velocityX: 0,
  velocityY: 0,
  motion: null,
  pinchDistance: 1,
  expansionTarget: 0,
});

export class GestureController {
  readonly options: GestureControllerOptions;
  readonly state: GestureState = createIdleState();

  private readonly filterX = new OneEuroFilter(1.4, 2.5, 1.0);
  private readonly filterY = new OneEuroFilter(1.4, 2.5, 1.0);
  private lastTime: number | null = null;
  private lastSeen = -Infinity;
  private prevPalmX = 0.5;
  private prevPalmY = 0.5;
  /** Images à ignorer pour la vitesse après une réacquisition (évite les sauts). */
  private settleFrames = 0;
  private candidate: GestureKind = 'none';
  private candidateCount = 0;
  private pinchArmed = true;
  private lastPinchTime = -Infinity;
  private motionHoldUntil = 0;

  private readonly pinchListeners = new Set<PinchListener>();
  private readonly gestureListeners = new Set<GestureListener>();

  constructor(options: Partial<GestureControllerOptions> = {}) {
    this.options = { ...DEFAULT_CONTROLLER_OPTIONS, ...options };
  }

  /** Abonnement à l'événement « pincement » (déclenché une fois par pincement). */
  onPinch(listener: PinchListener): () => void {
    this.pinchListeners.add(listener);
    return () => this.pinchListeners.delete(listener);
  }

  /** Abonnement aux changements de geste stable. */
  onGestureChange(listener: GestureListener): () => void {
    this.gestureListeners.add(listener);
    return () => this.gestureListeners.delete(listener);
  }

  /**
   * Met à jour l'état avec une nouvelle observation.
   * @param landmarks 21 points MediaPipe, ou null si aucune main n'est détectée.
   * @param timeMs horodatage en millisecondes (performance.now()).
   * @param aspect rapport largeur/hauteur de l'image vidéo.
   */
  update(landmarks: ReadonlyArray<Landmark> | null, timeMs: number, aspect = 4 / 3): GestureState {
    const dt = this.lastTime === null ? 1 / 30 : Math.min(Math.max((timeMs - this.lastTime) / 1000, 0.001), 0.25);
    this.lastTime = timeMs;
    const s = this.state;
    const features = landmarks ? computeHandFeatures(landmarks, aspect) : null;

    if (features) {
      if (s.tracking === 'none') {
        // Réacquisition après une longue absence : on repart de zéro pour éviter les sauts.
        this.filterX.reset();
        this.filterY.reset();
        this.settleFrames = 3;
      }
      s.tracking = 'active';
      this.lastSeen = timeMs;

      // Position lissée.
      s.palmX = this.filterX.filter(features.palmX, dt);
      s.palmY = this.filterY.filter(features.palmY, dt);

      // Vitesse : dérivée de la position lissée, puis lissage + zone morte.
      let vx = 0, vy = 0;
      if (this.settleFrames > 0) {
        this.settleFrames--;
      } else {
        vx = deadZone((s.palmX - this.prevPalmX) / dt, this.options.velocityDeadZone);
        vy = deadZone((s.palmY - this.prevPalmY) / dt, this.options.velocityDeadZone);
      }
      this.prevPalmX = s.palmX;
      this.prevPalmY = s.palmY;
      s.velocityX = damp(s.velocityX, vx, 12, dt);
      s.velocityY = damp(s.velocityY, vy, 12, dt);

      s.openness = damp(s.openness, features.openness, 18, dt);
      s.pinchDistance = features.pinchDistance;

      // Classification sur les données de l'image + ouverture légèrement lissée.
      const raw = classifyGesture({ ...features, openness: s.openness }, s.gesture, this.options.thresholds);
      this.confirm(raw, timeMs);
    } else {
      const since = timeMs - this.lastSeen;
      // Les vitesses s'amortissent progressivement dans tous les cas.
      s.velocityX = damp(s.velocityX, 0, 6, dt);
      s.velocityY = damp(s.velocityY, 0, 6, dt);
      if (s.tracking !== 'none' && since <= this.options.lossGraceMs) {
        // Perte temporaire : on conserve le geste en cours.
        s.tracking = 'lost';
      } else if (s.tracking !== 'none') {
        this.resetTracking();
      }
    }

    this.updateMotionLabel(timeMs);
    s.expansionTarget = this.expansionFor(s.gesture, s.expansionTarget);
    return s;
  }

  /**
   * À appeler après une interruption (geste à deux mains) : la prochaine position
   * sert de nouvelle référence, sans pic de vitesse.
   */
  resync(): void {
    this.filterX.reset();
    this.filterY.reset();
    this.settleFrames = 3;
    this.state.velocityX = 0;
    this.state.velocityY = 0;
  }

  /** Remet le contrôleur dans son état initial (aucune main). */
  reset(): void {
    this.resetTracking();
    this.lastTime = null;
    this.lastPinchTime = -Infinity;
  }

  private resetTracking(): void {
    const previous = this.state.gesture;
    Object.assign(this.state, createIdleState(), { palmX: this.state.palmX, palmY: this.state.palmY });
    this.filterX.reset();
    this.filterY.reset();
    this.candidate = 'none';
    this.candidateCount = 0;
    this.pinchArmed = true;
    this.motionHoldUntil = 0;
    if (previous !== 'none') this.emitGesture('none', previous);
  }

  /** Valide un geste seulement s'il est observé sur plusieurs images consécutives. */
  private confirm(raw: GestureKind, timeMs: number): void {
    if (raw === this.candidate) this.candidateCount++;
    else {
      this.candidate = raw;
      this.candidateCount = 1;
    }
    const needed = raw === 'pinch' ? this.options.pinchConfirmFrames : this.options.confirmFrames;
    const s = this.state;
    if (this.candidateCount < needed || raw === s.gesture) return;

    const previous = s.gesture;
    s.gesture = raw;
    if (raw === 'pinch') {
      if (this.pinchArmed && timeMs - this.lastPinchTime >= this.options.pinchCooldownMs) {
        this.lastPinchTime = timeMs;
        for (const l of this.pinchListeners) l(s.palmX, s.palmY);
      }
      // Désarmé jusqu'au relâchement : un seul déclenchement par pincement.
      this.pinchArmed = false;
    } else {
      this.pinchArmed = true;
    }
    this.emitGesture(raw, previous);
  }

  private emitGesture(gesture: GestureKind, previous: GestureKind): void {
    for (const l of this.gestureListeners) l(gesture, previous);
  }

  private expansionFor(gesture: GestureKind, current: number): number {
    switch (gesture) {
      case 'open':
        return 1;
      case 'fist':
        return -1;
      case 'pinch':
        return current; // le pincement ne modifie pas l'expansion en cours
      default:
        return 0;
    }
  }

  private updateMotionLabel(timeMs: number): void {
    const s = this.state;
    const ax = Math.abs(s.velocityX), ay = Math.abs(s.velocityY);
    const th = this.options.motionLabelThreshold;
    let dir: MotionDirection = null;
    if (s.tracking !== 'none' && Math.max(ax, ay) > th) {
      dir = ax >= ay ? (s.velocityX > 0 ? 'right' : 'left') : s.velocityY > 0 ? 'down' : 'up';
    }
    if (dir) {
      s.motion = dir;
      this.motionHoldUntil = timeMs + 300;
    } else if (timeMs > this.motionHoldUntil) {
      s.motion = null;
    }
  }
}
