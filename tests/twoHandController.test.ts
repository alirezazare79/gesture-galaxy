import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TwoHandController } from '../src/components/TwoHandController.ts';
import { OPEN_HAND, makeHand } from './handFixtures.ts';
import type { Landmark } from '../src/utils/gestureUtils.ts';

const FRAME = 1000 / 30;

/** Deux mains ouvertes, centrées sur (0.5, cy), écartées de `gap` et inclinées de `tilt` (dy entre les mains). */
function pair(gap: number, tilt = 0, cy = 0.72): Landmark[][] {
  return [
    makeHand(OPEN_HAND, { cx: 0.5 - gap / 2, cy: cy - tilt / 2, size: 0.12 }),
    makeHand(OPEN_HAND, { cx: 0.5 + gap / 2, cy: cy + tilt / 2, size: 0.12 }),
  ];
}

function run(c: TwoHandController, frames: (i: number) => Landmark[][], n: number, t0 = 0, zoom = 1, roll = 0) {
  let t = t0;
  for (let i = 0; i < n; i++) {
    t += FRAME;
    c.update(frames(i), t, 4 / 3, zoom, roll);
  }
  return t;
}

test('une seule main : le geste à deux mains reste inactif', () => {
  const c = new TwoHandController();
  run(c, () => [makeHand(OPEN_HAND)], 10);
  assert.equal(c.state.active, false);
});

test('deux mains immobiles : activation sans saut de zoom ni de rotation', () => {
  const c = new TwoHandController();
  run(c, () => pair(0.4), 15, 0, 1.2, 0.3);
  assert.equal(c.state.active, true);
  assert.ok(Math.abs(c.state.zoom - 1.2) < 1e-6);
  assert.ok(Math.abs(c.state.roll - 0.3) < 1e-6);
});

test('écarter les mains : zoom avant (caméra plus proche)', () => {
  const c = new TwoHandController();
  let t = run(c, () => pair(0.3), 5);
  t = run(c, (i) => pair(0.3 + Math.min(i, 15) * 0.02), 40, t);
  assert.ok(c.state.zoom < 0.6, `zoom ${c.state.zoom}`);
});

test('rapprocher les mains : zoom arrière, borné', () => {
  const c = new TwoHandController();
  let t = run(c, () => pair(0.6), 5);
  t = run(c, () => pair(0.15), 40, t);
  assert.ok(c.state.zoom > 1.5 && c.state.zoom <= 1.9, `zoom ${c.state.zoom}`);
});

test('tourner les mains comme un volant : rotation de la galaxie', () => {
  const c = new TwoHandController();
  let t = run(c, () => pair(0.4), 5);
  // Image en miroir : la main à gauche de l'image est à droite à l'écran.
  // Main droite (à l'écran) plus basse que la gauche = rotation horaire.
  t = run(c, () => pair(0.4, -0.2), 40, t);
  assert.ok(c.state.roll < -0.3, `roll ${c.state.roll}`);
});

test('perte brève d\'une main : geste conservé ; perte longue : désactivé', () => {
  const c = new TwoHandController({ lossGraceMs: 400 });
  let t = run(c, () => pair(0.4), 6);
  t = run(c, () => [makeHand(OPEN_HAND)], 6, t); // 200 ms
  assert.equal(c.state.active, true);
  t = run(c, () => [], 20, t); // +660 ms
  assert.equal(c.state.active, false);
});

test('micro-tremblements : pas de rotation parasite', () => {
  const c = new TwoHandController();
  let t = run(c, () => pair(0.4), 5);
  t = run(c, (i) => pair(0.4, (i % 2 ? 1 : -1) * 0.006), 40, t);
  assert.equal(c.state.roll, 0);
});
