import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GestureController } from '../src/components/GestureController.ts';
import { FIST, OPEN_HAND, makeHand, pinchPose } from './handFixtures.ts';
import type { Landmark } from '../src/utils/gestureUtils.ts';

const FRAME = 1000 / 30;

/** Alimente le contrôleur avec `n` images et renvoie le temps final. */
function feed(c: GestureController, lm: Landmark[] | null, n: number, t0: number): number {
  let t = t0;
  for (let i = 0; i < n; i++) {
    t += FRAME;
    c.update(lm, t);
  }
  return t;
}

test('main ouverte puis poing : consignes d\'expansion +1 puis -1', () => {
  const c = new GestureController();
  let t = feed(c, makeHand(OPEN_HAND), 10, 0);
  assert.equal(c.state.gesture, 'open');
  assert.equal(c.state.expansionTarget, 1);
  t = feed(c, makeHand(FIST), 15, t);
  assert.equal(c.state.gesture, 'fist');
  assert.equal(c.state.expansionTarget, -1);
});

test('un geste isolé sur une seule image est ignoré (anti-scintillement)', () => {
  const c = new GestureController();
  let t = feed(c, makeHand(OPEN_HAND), 10, 0);
  t = feed(c, makeHand(FIST), 1, t);
  t = feed(c, makeHand(OPEN_HAND), 5, t);
  assert.equal(c.state.gesture, 'open');
});

test('le pincement ne se déclenche qu\'une seule fois tant que les doigts restent rapprochés', () => {
  const c = new GestureController();
  let count = 0;
  c.onPinch(() => count++);
  let t = feed(c, makeHand(OPEN_HAND), 10, 0);
  t = feed(c, makeHand(pinchPose()), 60, t); // 2 secondes de pincement maintenu
  assert.equal(count, 1);
  // Relâchement puis nouveau pincement après la temporisation : 2e impulsion.
  t = feed(c, makeHand(OPEN_HAND), 25, t);
  t = feed(c, makeHand(pinchPose()), 10, t);
  assert.equal(count, 2);
});

test('temporisation : un re-pincement trop rapide est ignoré', () => {
  const c = new GestureController({ pinchCooldownMs: 2000 });
  let count = 0;
  c.onPinch(() => count++);
  let t = feed(c, makeHand(pinchPose()), 5, 0);
  t = feed(c, makeHand(OPEN_HAND), 5, t);
  t = feed(c, makeHand(pinchPose()), 5, t);
  assert.equal(count, 1);
});

test('un poing ne déclenche jamais d\'impulsion', () => {
  const c = new GestureController();
  let count = 0;
  c.onPinch(() => count++);
  feed(c, makeHand(FIST, { jitter: 0.004 }), 90, 0);
  assert.equal(count, 0);
});

test('perte temporaire de détection : le geste est conservé', () => {
  const c = new GestureController({ lossGraceMs: 450 });
  let t = feed(c, makeHand(FIST), 10, 0);
  t = feed(c, null, 6, t); // 200 ms sans main
  assert.equal(c.state.tracking, 'lost');
  assert.equal(c.state.gesture, 'fist');
  t = feed(c, makeHand(FIST), 3, t);
  assert.equal(c.state.tracking, 'active');
  assert.equal(c.state.gesture, 'fist');
});

test('perte prolongée : retour à l\'état « aucune main »', () => {
  const c = new GestureController({ lossGraceMs: 450 });
  let t = feed(c, makeHand(OPEN_HAND), 10, 0);
  t = feed(c, null, 30, t); // 1 s sans main
  assert.equal(c.state.tracking, 'none');
  assert.equal(c.state.gesture, 'none');
  assert.equal(c.state.expansionTarget, 0);
});

test('mouvement horizontal : vitesse et direction détectées', () => {
  const c = new GestureController();
  let t = feed(c, makeHand(OPEN_HAND, { cx: 0.7 }), 10, 0);
  // La main se déplace vers la gauche de l'image = vers la droite de l'écran miroir.
  for (let i = 0; i < 12; i++) {
    t += FRAME;
    c.update(makeHand(OPEN_HAND, { cx: 0.7 - i * 0.03 }), t);
  }
  assert.ok(c.state.velocityX > 0.4, `vitesse ${c.state.velocityX}`);
  assert.equal(c.state.motion, 'right');
});

test('main immobile avec tremblements : aucune vitesse parasite', () => {
  const c = new GestureController();
  let t = 0;
  let maxV = 0;
  for (let i = 0; i < 90; i++) {
    t += FRAME;
    c.update(makeHand(OPEN_HAND, { jitter: 0.003, seed: i + 1 }), t);
    if (i > 10) maxV = Math.max(maxV, Math.abs(c.state.velocityX), Math.abs(c.state.velocityY));
  }
  assert.ok(maxV < 0.05, `vitesse parasite ${maxV}`);
  assert.equal(c.state.motion, null);
});

test('réacquisition à un autre endroit : pas de pic de vitesse', () => {
  const c = new GestureController();
  let t = feed(c, makeHand(OPEN_HAND, { cx: 0.2 }), 10, 0);
  t = feed(c, null, 40, t);
  t = feed(c, makeHand(OPEN_HAND, { cx: 0.8 }), 2, t);
  assert.equal(c.state.velocityX, 0);
});
