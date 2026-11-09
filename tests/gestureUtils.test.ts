import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OneEuroFilter,
  classifyGesture,
  computeHandFeatures,
  deadZone,
  damp,
} from '../src/utils/gestureUtils.ts';
import { FIST, OPEN_HAND, POINTING, RELAXED_HAND, THUMB_UP, fistThumbOnIndexTip, makeHand, pinchPose } from './handFixtures.ts';

const features = (spec: Parameters<typeof makeHand>[0], opts = {}) => {
  const f = computeHandFeatures(makeHand(spec, opts));
  assert.ok(f, 'features attendues');
  return f;
};

test('main ouverte : ouverture élevée et classée « open »', () => {
  const f = features(OPEN_HAND);
  assert.ok(f.openness > 0.85, `ouverture ${f.openness}`);
  assert.equal(classifyGesture(f), 'open');
});

test('poing : ouverture faible et classé « fist »', () => {
  const f = features(FIST);
  assert.ok(f.openness < 0.2, `ouverture ${f.openness}`);
  assert.equal(classifyGesture(f), 'fist');
});

test('index pointé : pas un poing (constaté sur une vraie photo analysée par MediaPipe)', () => {
  const f = features(POINTING);
  assert.ok(f.openness < 0.36, 'ouverture faible');
  assert.equal(classifyGesture(f), 'neutral');
});

test('pouce levé, autres doigts repliés : considéré comme un poing', () => {
  assert.equal(classifyGesture(features(THUMB_UP)), 'fist');
});

test('main détendue : ni ouverte ni fermée', () => {
  assert.equal(classifyGesture(features(RELAXED_HAND)), 'neutral');
});

test('pincement (autres doigts tendus) : classé « pinch »', () => {
  const f = features(pinchPose());
  assert.ok(f.pinchDistance < 0.24, `distance ${f.pinchDistance}`);
  assert.equal(classifyGesture(f), 'pinch');
});

test('pincement (autres doigts repliés) : toujours « pinch » et non « fist »', () => {
  assert.equal(classifyGesture(features(pinchPose(0.04, true))), 'pinch');
});

test('poing avec le pouce sur l\'index replié : reste un « fist », pas un pincement', () => {
  const f = features(fistThumbOnIndexTip());
  assert.ok(f.pinchDistance < 0.24, 'le pouce touche bien l\'index');
  assert.equal(classifyGesture(f), 'fist');
});

test('pouce et index écartés : pas de pincement', () => {
  assert.notEqual(classifyGesture(features(pinchPose(0.45))), 'pinch');
});

test('hystérésis : un pincement en cours tient jusqu\'au seuil de sortie', () => {
  const f = features(pinchPose(0.3));
  assert.notEqual(classifyGesture(f, 'neutral'), 'pinch');
  assert.equal(classifyGesture(f, 'pinch'), 'pinch');
});

test('invariance à la taille et à la position de la main', () => {
  for (const opts of [{ size: 0.1, cx: 0.2 }, { size: 0.32, cx: 0.75, cy: 0.6 }]) {
    assert.equal(classifyGesture(features(OPEN_HAND, opts)), 'open');
    assert.equal(classifyGesture(features(FIST, opts)), 'fist');
    assert.equal(classifyGesture(features(pinchPose(), opts)), 'pinch');
  }
});

test('position de la paume en miroir', () => {
  const left = features(OPEN_HAND, { cx: 0.2 });
  assert.ok(left.palmX > 0.7, 'une main à gauche de l\'image apparaît à droite de l\'écran miroir');
});

test('données invalides : null', () => {
  assert.equal(computeHandFeatures([]), null);
});

test('OneEuroFilter lisse le bruit et suit les mouvements', () => {
  const f = new OneEuroFilter(1.4, 2.5);
  let maxDev = 0;
  for (let i = 0; i < 120; i++) {
    const noisy = 0.5 + (i % 2 ? 0.01 : -0.01);
    const out = f.filter(noisy, 1 / 30);
    if (i > 10) maxDev = Math.max(maxDev, Math.abs(out - 0.5));
  }
  assert.ok(maxDev < 0.006, `bruit résiduel ${maxDev}`);
  let v = 0;
  for (let i = 0; i < 30; i++) v = f.filter(0.9, 1 / 30);
  assert.ok(Math.abs(v - 0.9) < 0.01, 'rejoint la nouvelle position en moins d\'une seconde');
});

test('deadZone et damp', () => {
  assert.equal(deadZone(0.05, 0.1), 0);
  assert.ok(Math.abs(deadZone(0.3, 0.1) - 0.2) < 1e-9);
  assert.ok(Math.abs(deadZone(-0.3, 0.1) + 0.2) < 1e-9);
  assert.ok(damp(0, 1, 10, 1) > 0.99);
});
