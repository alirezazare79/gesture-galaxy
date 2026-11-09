/**
 * Fonctions pures d'analyse de la main (aucune dépendance au DOM).
 * Elles transforment les 21 points de repère MediaPipe en grandeurs
 * exploitables : ouverture de la main, distance de pincement, centre de la paume…
 *
 * Indices MediaPipe :
 *  0 poignet · 1-4 pouce · 5-8 index · 9-12 majeur · 13-16 annulaire · 17-20 auriculaire
 *  (pour chaque doigt : MCP, PIP, DIP, extrémité)
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type GestureKind = 'none' | 'neutral' | 'open' | 'fist' | 'pinch';

export interface HandFeatures {
  /** Taille de référence de la main (poignet → base du majeur), indépendante de la distance à la caméra. */
  scale: number;
  /** Centre de la paume, coordonnées écran normalisées 0..1, déjà en miroir (gauche = gauche de l'utilisateur). */
  palmX: number;
  palmY: number;
  /** Extension de chaque doigt, 0 (replié) → 1 (tendu). Ordre : pouce, index, majeur, annulaire, auriculaire. */
  extension: [number, number, number, number, number];
  /** Ouverture globale de la main, 0 (poing) → 1 (main grande ouverte). */
  openness: number;
  /** Distance pouce ↔ index, normalisée par la taille de la main. */
  pinchDistance: number;
  /** Distance extrémité de l'index ↔ centre de la paume, normalisée. Faible dans un poing. */
  indexReach: number;
}

export interface ClassifierThresholds {
  openEnter: number;
  openExit: number;
  fistEnter: number;
  fistExit: number;
  pinchEnter: number;
  pinchExit: number;
  /** Extension maximale tolérée pour un doigt long dans un poing. */
  fistMaxFinger: number;
  /** L'index doit rester éloigné de la paume pour qu'un rapprochement pouce/index soit un pincement (et non un poing). */
  pinchMinIndexReach: number;
}

export const DEFAULT_THRESHOLDS: ClassifierThresholds = {
  openEnter: 0.7,
  openExit: 0.58,
  fistEnter: 0.26,
  fistExit: 0.36,
  fistMaxFinger: 0.6,
  pinchEnter: 0.24,
  pinchExit: 0.4,
  pinchMinIndexReach: 0.78,
};

const FINGER_CHAINS: ReadonlyArray<readonly [number, number, number, number]> = [
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

export const clamp = (v: number, min = 0, max = 1): number => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Normalise v de l'intervalle [a, b] vers [0, 1] (bornée). */
export const remap01 = (v: number, a: number, b: number): number => clamp((v - a) / (b - a));

/**
 * Amortissement indépendant de la fréquence d'images :
 * rapproche `current` de `target` avec une vitesse `lambda` (1/s).
 */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/**
 * Distance 3D entre deux points de repère.
 * `aspect` (largeur/hauteur de l'image) corrige l'étirement des coordonnées normalisées.
 */
export function distance(a: Landmark, b: Landmark, aspect = 1): number {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  const dz = (a.z - b.z) * aspect;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Cosinus de l'angle entre deux segments (1 = alignés, -1 = opposés). */
function segmentAlignment(a0: Landmark, a1: Landmark, b0: Landmark, b1: Landmark, aspect: number): number {
  const ux = (a1.x - a0.x) * aspect, uy = a1.y - a0.y, uz = (a1.z - a0.z) * aspect;
  const vx = (b1.x - b0.x) * aspect, vy = b1.y - b0.y, vz = (b1.z - b0.z) * aspect;
  const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz);
  if (lu < 1e-6 || lv < 1e-6) return 0;
  return (ux * vx + uy * vy + uz * vz) / (lu * lv);
}

/**
 * Extrait les caractéristiques d'une main à partir de ses 21 points.
 * Retourne null si les données sont incomplètes ou dégénérées.
 */
export function computeHandFeatures(lm: ReadonlyArray<Landmark>, aspect = 4 / 3): HandFeatures | null {
  if (!lm || lm.length < 21) return null;
  const wrist = lm[0];
  const scale = distance(wrist, lm[9], aspect);
  if (!(scale > 1e-4)) return null;

  // Centre de la paume : moyenne du poignet et des 4 articulations de base (stable, poing ou main ouverte).
  const palmIdx = [0, 5, 9, 13, 17];
  let px = 0, py = 0, pz = 0;
  for (const i of palmIdx) {
    px += lm[i].x;
    py += lm[i].y;
    pz += lm[i].z;
  }
  const palm: Landmark = { x: px / 5, y: py / 5, z: pz / 5 };

  // Doigts longs : combinaison de la "portée" (extrémité loin du poignet) et de la rectitude du doigt.
  const ext: number[] = [];
  for (const [mcp, pip, dip, tip] of FINGER_CHAINS) {
    const reach = distance(wrist, lm[tip], aspect) / Math.max(distance(wrist, lm[mcp], aspect), 1e-6);
    const reachScore = remap01(reach, 1.15, 1.8);
    const straight = segmentAlignment(lm[mcp], lm[pip], lm[dip], lm[tip], aspect);
    const straightScore = remap01(straight, 0.1, 0.9);
    ext.push(clamp(reachScore * 0.6 + straightScore * 0.4));
  }

  // Pouce : écarté lorsque son extrémité est loin de la base de l'auriculaire.
  const thumbSpread = distance(lm[4], lm[17], aspect) / scale;
  const thumbExt = remap01(thumbSpread, 0.85, 1.4);

  const openness = clamp(thumbExt * 0.12 + (ext[0] + ext[1] + ext[2] + ext[3]) * 0.22);

  return {
    scale,
    palmX: 1 - palm.x, // miroir : l'image affichée est retournée horizontalement
    palmY: palm.y,
    extension: [thumbExt, ext[0], ext[1], ext[2], ext[3]],
    openness,
    pinchDistance: distance(lm[4], lm[8], aspect) / scale,
    indexReach: distance(lm[8], palm, aspect) / scale,
  };
}

/**
 * Classe une posture de main pour une image donnée.
 * `previous` (le geste stable précédent) permet une hystérésis : il faut franchir
 * un seuil plus exigeant pour entrer dans un geste que pour y rester.
 */
export function classifyGesture(
  f: HandFeatures,
  previous: GestureKind = 'none',
  t: ClassifierThresholds = DEFAULT_THRESHOLDS,
): GestureKind {
  // 1. Pincement : pouce et index proches ET index non replié dans la paume.
  //    Dans un poing, le pouce touche souvent l'index, mais l'index est collé à la paume.
  const pinchLimit = previous === 'pinch' ? t.pinchExit : t.pinchEnter;
  if (f.pinchDistance < pinchLimit && f.indexReach > t.pinchMinIndexReach) return 'pinch';

  // 2. Main ouverte / poing avec hystérésis.
  const openLimit = previous === 'open' ? t.openExit : t.openEnter;
  if (f.openness >= openLimit) return 'open';
  // Un poing exige qu'aucun doigt long ne reste tendu (sinon : index pointé, signe « V »…).
  const fistLimit = previous === 'fist' ? t.fistExit : t.fistEnter;
  const longestFinger = Math.max(f.extension[1], f.extension[2], f.extension[3], f.extension[4]);
  if (f.openness <= fistLimit && longestFinger < t.fistMaxFinger) return 'fist';

  return 'neutral';
}

/**
 * Filtre « One Euro » (Casiez et al., 2012) : lisse fortement les petits
 * tremblements quand la main est immobile, tout en restant réactif lors des
 * mouvements rapides. Idéal pour le suivi de la main.
 */
export class OneEuroFilter {
  minCutoff: number;
  beta: number;
  dCutoff: number;
  private x: number | null = null;
  private dx = 0;

  constructor(minCutoff = 1.2, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, dt: number): number {
    if (this.x === null || !(dt > 0)) {
      this.x = value;
      this.dx = 0;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    this.dx = lerp(this.dx, rawDx, OneEuroFilter.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x = lerp(this.x, value, OneEuroFilter.alpha(cutoff, dt));
    return this.x;
  }

  /** Vitesse filtrée (unités/seconde). */
  get velocity(): number {
    return this.dx;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}

/** Applique une zone morte : ignore les petites valeurs et retire le seuil des grandes (pas de saut). */
export function deadZone(v: number, threshold: number): number {
  const a = Math.abs(v);
  return a <= threshold ? 0 : Math.sign(v) * (a - threshold);
}
