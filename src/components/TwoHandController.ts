/**
 * TwoHandController — gestes à deux mains.
 *
 *  - Écarter / rapprocher les mains : zoom avant / arrière.
 *  - Faire tourner les mains comme un volant : rotation de la galaxie dans le plan de l'écran.
 *
 * Le contrôle est relatif : au moment où les deux mains apparaissent, la position
 * courante sert de référence, ce qui évite tout saut de la caméra.
 */
import { OneEuroFilter, clamp, computeHandFeatures, type Landmark } from '../utils/gestureUtils.ts';

export interface TwoHandState {
  active: boolean;
  /** Facteur de distance de la caméra (1 = normal, < 1 = plus près). */
  zoom: number;
  /** Rotation dans le plan de l'écran (radians). */
  roll: number;
  /** Écartement relatif des mains depuis le début du geste (1 = inchangé). */
  spread: number;
  /** Centre des deux paumes (coordonnées écran 0..1, miroir appliqué). */
  centerX: number;
  centerY: number;
}

export interface TwoHandOptions {
  /** Durée pendant laquelle le geste est conservé si une main disparaît (ms). */
  lossGraceMs: number;
  /** Images consécutives à deux mains avant d'activer le geste. */
  confirmFrames: number;
  zoomMin: number;
  zoomMax: number;
  /** Variation d'angle ignorée (radians) pour éviter les micro-rotations. */
  angleDeadZone: number;
}

export const DEFAULT_TWO_HAND_OPTIONS: TwoHandOptions = {
  lossGraceMs: 400,
  confirmFrames: 2,
  zoomMin: 0.45,
  zoomMax: 1.9,
  angleDeadZone: 0.04,
};

/** Ramène un angle dans ]-π, π]. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class TwoHandController {
  readonly options: TwoHandOptions;
  readonly state: TwoHandState = { active: false, zoom: 1, roll: 0, spread: 1, centerX: 0.5, centerY: 0.5 };

  private readonly filterDist = new OneEuroFilter(1.2, 1.5);
  private readonly filterAngle = new OneEuroFilter(1.2, 1.5);
  private seenFrames = 0;
  private lastSeen = -Infinity;
  private lastTime: number | null = null;
  private refDist = 1;
  private refAngle = 0;
  private refZoom = 1;
  private refRoll = 0;
  private prevAngle = 0;
  private unwrapped = 0;

  constructor(options: Partial<TwoHandOptions> = {}) {
    this.options = { ...DEFAULT_TWO_HAND_OPTIONS, ...options };
  }

  /**
   * @param hands mains détectées (0, 1 ou 2).
   * @param currentZoom / currentRoll valeurs actuelles de la galaxie, servant de référence à l'activation.
   */
  update(
    hands: ReadonlyArray<ReadonlyArray<Landmark>>,
    timeMs: number,
    aspect: number,
    currentZoom: number,
    currentRoll: number,
  ): TwoHandState {
    const dt = this.lastTime === null ? 1 / 30 : clamp((timeMs - this.lastTime) / 1000, 0.001, 0.25);
    this.lastTime = timeMs;
    const s = this.state;

    const palms = hands
      .slice(0, 2)
      .map((h) => computeHandFeatures(h, aspect))
      .filter((f): f is NonNullable<typeof f> => f !== null)
      .sort((a, b) => a.palmX - b.palmX);

    if (palms.length < 2) {
      this.seenFrames = 0;
      if (s.active && timeMs - this.lastSeen > this.options.lossGraceMs) this.deactivate();
      return s;
    }

    this.seenFrames++;
    this.lastSeen = timeMs;
    const [left, right] = palms;
    const dx = (right.palmX - left.palmX) * aspect;
    const dy = right.palmY - left.palmY;
    const rawDist = Math.hypot(dx, dy);
    const rawAngle = Math.atan2(dy, dx);
    s.centerX = (left.palmX + right.palmX) / 2;
    s.centerY = (left.palmY + right.palmY) / 2;

    if (!s.active) {
      if (this.seenFrames < this.options.confirmFrames) return s;
      // Activation : la pose actuelle devient la référence.
      s.active = true;
      this.filterDist.reset();
      this.filterAngle.reset();
      this.refDist = Math.max(rawDist, 1e-3);
      this.prevAngle = rawAngle;
      this.unwrapped = rawAngle;
      this.refAngle = rawAngle;
      this.refZoom = currentZoom;
      this.refRoll = currentRoll;
    }

    // Angle « déroulé » pour rester continu même au-delà de ±180°.
    this.unwrapped += wrap(rawAngle - this.prevAngle);
    this.prevAngle = rawAngle;

    const dist = this.filterDist.filter(rawDist, dt);
    const angle = this.filterAngle.filter(this.unwrapped, dt);

    s.spread = dist / this.refDist;
    // Mains qui s'écartent → caméra qui se rapproche.
    s.zoom = clamp(this.refZoom / s.spread, this.options.zoomMin, this.options.zoomMax);
    const delta = angle - this.refAngle;
    const effective = Math.abs(delta) <= this.options.angleDeadZone ? 0 : delta - Math.sign(delta) * this.options.angleDeadZone;
    // Rotation des mains dans le sens horaire (à l'écran) → galaxie dans le sens horaire.
    s.roll = this.refRoll - effective;
    return s;
  }

  reset(): void {
    this.deactivate();
    this.lastTime = null;
  }

  private deactivate(): void {
    this.state.active = false;
    this.state.spread = 1;
    this.seenFrames = 0;
  }
}
