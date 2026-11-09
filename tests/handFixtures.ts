/**
 * Générateur de mains synthétiques (21 points au format MediaPipe) pour les tests.
 * Les doigts sont modélisés comme des chaînes de phalanges dont on contrôle la flexion.
 */
import type { Landmark } from '../src/utils/gestureUtils.ts';

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: V3): V3 => mul(a, 1 / Math.hypot(...a));
const deg = (d: number) => (d * Math.PI) / 180;

// Repère "main" : unité = distance poignet → base du majeur, y vers le haut de l'image = négatif.
const MCP: V3[] = [[-0.35, -0.95, 0], [0, -1, 0], [0.3, -0.93, 0], [0.55, -0.8, 0]];
const PHALANGES = [[0.45, 0.27, 0.22], [0.5, 0.3, 0.24], [0.46, 0.28, 0.22], [0.36, 0.21, 0.2]];
const PALM_NORMAL: V3 = [0, 0, -1]; // les doigts se replient vers la caméra

export interface PoseSpec {
  /** Flexion (degrés) de chaque articulation [MCP, PIP, DIP] pour index, majeur, annulaire, auriculaire. */
  fingers: [number, number, number][];
  /** Position de l'extrémité du pouce (repère main), ou 'open' pour un pouce écarté. */
  thumbTip: V3 | 'open';
}

function finger(i: number, curl: [number, number, number]): V3[] {
  const d = norm(MCP[i]);
  const pts: V3[] = [MCP[i]];
  let angle = 0;
  let p = MCP[i];
  for (let k = 0; k < 3; k++) {
    angle += deg(curl[k]);
    const dir = add(mul(d, Math.cos(angle)), mul(PALM_NORMAL, Math.sin(angle)));
    p = add(p, mul(dir, PHALANGES[i][k]));
    pts.push(p);
  }
  return pts;
}

/** Construit les 21 points en coordonnées image normalisées. */
export function makeHand(
  spec: PoseSpec,
  opts: { cx?: number; cy?: number; size?: number; aspect?: number; jitter?: number; seed?: number } = {},
): Landmark[] {
  const { cx = 0.5, cy = 0.72, size = 0.2, aspect = 4 / 3, jitter = 0 } = opts;
  let seed = opts.seed ?? 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;

  const thumbBase: V3 = [-0.3, -0.25, 0];
  const thumbMcp: V3 = [-0.55, -0.45, -0.05];
  let thumbIp: V3, thumbTip: V3;
  if (spec.thumbTip === 'open') {
    const dir = norm([-0.75, -0.65, -0.05]);
    thumbIp = add(thumbMcp, mul(dir, 0.3));
    thumbTip = add(thumbIp, mul(dir, 0.27));
  } else {
    thumbTip = spec.thumbTip;
    thumbIp = add(mul(thumbMcp, 0.45), mul(thumbTip, 0.55));
  }

  const pts: V3[] = [[0, 0, 0], thumbBase, thumbMcp, thumbIp, thumbTip];
  for (let i = 0; i < 4; i++) pts.push(...finger(i, spec.fingers[i]));

  return pts.map(([x, y, z]) => ({
    x: cx + (x * size) / aspect + rand() * jitter,
    y: cy + y * size + rand() * jitter,
    z: (z * size) / aspect,
  }));
}

const STRAIGHT: [number, number, number] = [0, 0, 0];
const CURLED: [number, number, number] = [80, 100, 70];

export const OPEN_HAND: PoseSpec = { fingers: [STRAIGHT, STRAIGHT, STRAIGHT, STRAIGHT], thumbTip: 'open' };

export const RELAXED_HAND: PoseSpec = {
  fingers: [[30, 45, 20], [35, 50, 25], [40, 50, 25], [45, 50, 25]],
  thumbTip: [-0.55, -0.7, -0.15],
};

/** Poing : pouce replié par-dessus l'index et le majeur. */
export const FIST: PoseSpec = { fingers: [CURLED, CURLED, CURLED, CURLED], thumbTip: [-0.12, -0.72, -0.4] };

/** Index tendu, pouce qui vient toucher l'extrémité de l'index ; autres doigts tendus (signe « OK »). */
export function pinchPose(gap = 0.04, othersCurled = false): PoseSpec {
  const indexCurl: [number, number, number] = [35, 40, 20];
  const tip = finger(0, indexCurl)[3];
  const others = othersCurled ? CURLED : STRAIGHT;
  return { fingers: [indexCurl, others, others, others], thumbTip: add(tip, [-gap, gap * 0.3, 0]) };
}

/** Poing dans lequel le pouce touche l'extrémité repliée de l'index (cas piège). */
export function fistThumbOnIndexTip(): PoseSpec {
  const tip = finger(0, CURLED)[3];
  return { fingers: [CURLED, CURLED, CURLED, CURLED], thumbTip: add(tip, [-0.03, 0, -0.02]) };
}

/** Index pointé vers le haut, autres doigts repliés. */
export const POINTING: PoseSpec = { fingers: [STRAIGHT, CURLED, CURLED, CURLED], thumbTip: [-0.12, -0.72, -0.4] };

/** Pouce levé, quatre doigts repliés. */
export const THUMB_UP: PoseSpec = { fingers: [CURLED, CURLED, CURLED, CURLED], thumbTip: 'open' };
