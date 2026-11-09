/**
 * Télécharge le modèle MediaPipe Hand Landmarker (Apache 2.0, publié par Google)
 * dans public/models/ pour qu'il soit servi par le site lui-même.
 * Le modèle n'est téléchargé qu'une seule fois (ignoré s'il existe déjà).
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'public/models/hand_landmarker.task');

if (existsSync(target) && statSync(target).size > 1_000_000) {
  console.log('✔ Modèle MediaPipe déjà présent : public/models/hand_landmarker.task');
  process.exit(0);
}

console.log('↓ Téléchargement du modèle MediaPipe Hand Landmarker…');
try {
  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  console.log(`✔ Modèle enregistré (${(buffer.length / 1e6).toFixed(1)} Mo) : public/models/hand_landmarker.task`);
} catch (error) {
  console.warn(`⚠ Téléchargement impossible (${error.message}).`);
  console.warn("  L'application chargera alors le modèle directement depuis les serveurs de Google.");
  // On ne bloque pas le build : un repli vers l'URL officielle existe dans HandTracker.ts.
}
