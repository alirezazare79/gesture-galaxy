/**
 * Test de bout en bout (navigateur réel) de GESTURE GALAXY.
 *
 * Prérequis : Playwright + Chromium (npm i -D playwright && npx playwright install chromium)
 * Usage :
 *   BASE_PATH=/gesture-galaxy/ npm run build
 *   BASE_PATH=/gesture-galaxy/ npm run test:e2e
 *
 * Ce test utilise une caméra SIMULÉE par Chromium (mire animée) : il vérifie le
 * chargement de MediaPipe et du modèle, mais pas la détection d'une vraie main.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';
import { mkdirSync } from 'node:fs';
import { FIST, OPEN_HAND, makeHand, pinchPose } from '../tests/handFixtures.ts';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright est requis : npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const PORT = 4317;
const BASE = process.env.BASE_PATH || '/';
const ORIGIN = `http://localhost:${PORT}`;
const URL_ROOT = `${ORIGIN}${BASE.startsWith('/') ? BASE : '/'}`;
const SHOTS = process.env.SHOTS_DIR || 'test-results';
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? '  ✔' : '  ✘'} ${label}`);
  if (!cond) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
});
server.stderr.on('data', (d) => process.stderr.write(d));
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('Le serveur de prévisualisation ne démarre pas')), 20000);
  server.stdout.on('data', (d) => d.toString().includes(String(PORT)) && (clearTimeout(t), resolve()));
});

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

/** Ouvre une page en collectant les erreurs console et les requêtes en échec. */
async function open(context, url = `${URL_ROOT}?debug`) {
  const page = await context.newPage();
  const errors = [];
  const failed = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  page.on('requestfailed', (r) => failed.push(`FAILED ${r.url()} ${r.failure()?.errorText}`));
  await page.goto(url, { waitUntil: 'load' });
  return { page, errors, failed };
}

const gg = (page, expr) => page.evaluate(`window.__GG__.${expr}`);

try {
  // -------------------------------------------------------------------------
  console.log(`\n▶ Chargement de la page (${URL_ROOT})`);
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const { page, errors, failed } = await open(ctx);
    check((await page.title()).includes('GESTURE GALAXY'), 'titre de la page');
    check(await page.locator('#welcome-panel').isVisible(), "écran d'accueil visible");
    check(await page.getByText("Et si vous pouviez contrôler l'univers du bout des doigts").isVisible(), "phrase d'accroche");
    check(await page.getByRole('button', { name: "Commencer l'expérience" }).isVisible(), 'bouton « Commencer l’expérience »');
    check((await page.locator('canvas.galaxy-canvas').count()) === 1, 'canvas WebGL créé');
    const css = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    check(css.includes('Space Grotesk'), 'feuille de style chargée');
    await wait(3800);
    await page.screenshot({ path: `${SHOTS}/01-accueil.png` });
    const g = await gg(page, 'galaxy()');
    check(g.particles >= 15000, `particules affichées : ${g.particles}`);
    check(failed.length === 0, `aucune ressource en échec ${failed.join(', ')}`);
    check(errors.length === 0, `aucune erreur console ${errors.join(' | ')}`);
    await ctx.close();
  }

  // -------------------------------------------------------------------------
  console.log('\n▶ Mode souris');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const { page, errors } = await open(ctx);
    await page.getByRole('button', { name: 'Continuer sans caméra (mode souris)' }).click();
    await wait(400);
    check((await gg(page, 'mode()')) === 'mouse', 'mode souris actif');
    check((await page.locator('#app').getAttribute('data-state')) === 'running', 'scène affichée');

    const r0 = (await gg(page, 'galaxy()')).rotation;
    await page.mouse.move(600, 450);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(600 + i * 25, 450 + i * 6);
    await page.mouse.up();
    await wait(200);
    const g1 = await gg(page, 'galaxy()');
    check(Math.abs(g1.rotation - r0) > 0.3, `glisser horizontal → rotation (${(g1.rotation - r0).toFixed(2)} rad)`);
    check(g1.tiltTarget > 0.55, `glisser vers le bas → vue plongeante (${g1.tiltTarget.toFixed(2)})`);

    await page.mouse.move(700, 400);
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
    await wait(150);
    check((await gg(page, 'galaxy()')).expansionTarget > 0.4, 'molette vers le haut → expansion');
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 100);
    await wait(150);
    check((await gg(page, 'galaxy()')).expansionTarget === -1, 'molette vers le bas → contraction');

    const p0 = (await gg(page, 'galaxy()')).pulseCount;
    await page.mouse.click(720, 420);
    await wait(100);
    check((await gg(page, 'galaxy()')).pulseCount === p0 + 1, 'clic → impulsion');
    await page.keyboard.press('Space');
    check((await gg(page, 'galaxy()')).pulseCount === p0 + 2, 'touche Espace → impulsion');

    await page.getByRole('button', { name: /Expansion/ }).click();
    check((await gg(page, 'galaxy()')).expansionTarget === 1, 'bouton Expansion');
    await page.getByRole('button', { name: /Impulsion/ }).click();
    check((await gg(page, 'galaxy()')).pulseCount === p0 + 3, 'bouton Impulsion (sans impulsion parasite sur la scène)');
    await wait(450);
    await page.screenshot({ path: `${SHOTS}/02-impulsion.png` });

    await page.getByRole('button', { name: 'Effets : activés' }).click();
    check((await gg(page, 'galaxy()')).effects === false, 'bouton effets → désactivés');
    check((await page.locator('#btn-effects').getAttribute('aria-pressed')) === 'false', 'état du bouton effets');
    await page.keyboard.press('e');
    check((await gg(page, 'galaxy()')).effects === true, 'touche E → effets réactivés');

    await page.getByRole('button', { name: 'Réinitialiser la galaxie' }).click();
    await wait(1500);
    const g2 = await gg(page, 'galaxy()');
    check(g2.expansionTarget === 0 && Math.abs(g2.tiltTarget - 0.5) < 1e-6, 'réinitialisation');
    check(await page.getByText('Galaxie réinitialisée').isVisible(), 'notification de réinitialisation');

    check(await page.locator('#btn-fullscreen').isVisible(), 'bouton plein écran présent');
    await page.getByRole('button', { name: 'Plein écran' }).click();
    await wait(300);
    const fs = await page.evaluate(() => !!document.fullscreenElement);
    check(fs, 'plein écran activé');
    if (fs) {
      check(await page.getByRole('button', { name: 'Quitter le plein écran' }).isVisible(), 'libellé « Quitter le plein écran »');
      await page.evaluate(() => document.exitFullscreen());
    }
    check(errors.length === 0, `aucune erreur console ${errors.join(' | ')}`);
    await ctx.close();
  }

  // -------------------------------------------------------------------------
  console.log('\n▶ Chaîne gestuelle complète (points de repère simulés → galaxie)');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page } = await open(ctx);
    await page.getByRole('button', { name: 'Continuer sans caméra (mode souris)' }).click();
    const feed = async (lm, n, extra = {}) => {
      let s;
      for (let i = 0; i < n; i++) {
        const hand = typeof lm === 'function' ? lm(i) : lm;
        s = await page.evaluate(([h, t]) => window.__GG__.simulateHand(h, t), [hand, (extra.t0 ?? 0) + i * 33]);
      }
      return s;
    };
    let t = 100000;
    let s = await feed(makeHand(OPEN_HAND), 10, { t0: t });
    t += 400;
    check(s.gesture === 'open', 'main ouverte reconnue');
    check((await gg(page, 'galaxy()')).expansionTarget === 1, 'main ouverte → expansion');
    check((await page.locator('#gesture-label').textContent()) === 'Main ouverte', 'indicateur « Main ouverte »');
    check((await page.locator('#hand-status').textContent()) === 'Main détectée', 'indicateur « Main détectée »');
    s = await feed(makeHand(FIST), 10, { t0: t });
    t += 400;
    check(s.gesture === 'fist' && (await gg(page, 'galaxy()')).expansionTarget === -1, 'poing → contraction');
    const p0 = (await gg(page, 'galaxy()')).pulseCount;
    await feed(makeHand(OPEN_HAND), 6, { t0: t });
    t += 300;
    await feed(makeHand(pinchPose()), 30, { t0: t });
    t += 1100;
    check((await gg(page, 'galaxy()')).pulseCount === p0 + 1, 'pincement maintenu → une seule impulsion');
    s = await feed((i) => makeHand(OPEN_HAND, { cx: 0.75 - i * 0.035 }), 12, { t0: t });
    t += 500;
    check((await gg(page, 'galaxy()')).spinVelocity > 0.3, 'mouvement horizontal → rotation');
    s = await feed((i) => makeHand(OPEN_HAND, { cy: 0.85 - i * 0.04 }), 14, { t0: t });
    t += 600;
    check((await gg(page, 'galaxy()')).tiltTarget > 0.9, 'main vers le haut → vue plongeante');
    await page.screenshot({ path: `${SHOTS}/03-geste-simule.png` });
    s = await feed(null, 40, { t0: t });
    check(s.tracking === 'none' && (await page.locator('#hand-status').textContent()) === 'Recherche de la main…', 'main perdue → retour à l’attente');
    await ctx.close();
  }

  // -------------------------------------------------------------------------
  console.log('\n▶ Deux mains, son et zoom');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const { page, errors } = await open(ctx);
    await page.getByRole('button', { name: 'Continuer sans caméra (mode souris)' }).click();
    await wait(300);
    const snd = await gg(page, 'sound()');
    check(snd.started && snd.enabled, 'son démarré après le clic');

    const pair = (gap, tilt = 0) => [
      makeHand(OPEN_HAND, { cx: 0.5 - gap / 2, cy: 0.7 - tilt / 2, size: 0.12 }),
      makeHand(OPEN_HAND, { cx: 0.5 + gap / 2, cy: 0.7 + tilt / 2, size: 0.12 }),
    ];
    let t = 200000;
    const feed2 = async (fn, n) => {
      let r;
      for (let i = 0; i < n; i++, t += 33) r = await page.evaluate(([h, tt]) => window.__GG__.simulateHands(h, tt), [fn(i), t]);
      return r;
    };
    const d0 = (await gg(page, 'galaxy()')).dolly;
    let r = await feed2(() => pair(0.3), 5);
    check(r.twoHands.active, 'deux mains détectées → mode deux mains');
    check((await page.locator('#hand-status').textContent()) === 'Deux mains détectées', 'indicateur « Deux mains détectées »');
    await feed2((i) => pair(0.3 + Math.min(i, 12) * 0.025), 30);
    const g1 = await gg(page, 'galaxy()');
    check(g1.dolly < d0 * 0.7, `écarter les mains → zoom avant (${d0.toFixed(2)} → ${g1.dolly.toFixed(2)})`);
    await feed2(() => pair(0.6, -0.25), 30);
    const g2 = await gg(page, 'galaxy()');
    check(g2.roll < -0.2, `tourner les mains → orientation (${g2.roll.toFixed(2)} rad)`);
    await page.evaluate(() => window.__GG__.step(1 / 30, 60));
    await page.screenshot({ path: `${SHOTS}/08-deux-mains.png` });
    r = await feed2(() => [makeHand(OPEN_HAND)], 25);
    check(!r.twoHands.active && r.gesture.gesture === 'open', 'retour à une main → gestes classiques');

    const audio = await page.evaluate(() => window.__GG__.audioSelfTest());
    check(audio.rest > 0.001, `nappe sonore audible au repos (RMS ${audio.rest.toFixed(4)})`);
    check(audio.contraction > audio.rest * 1.3, `contraction → grondement plus fort (RMS ${audio.contraction.toFixed(4)})`);
    check(audio.explosion > audio.rest * 2, `pincement → explosion sonore (RMS ${audio.explosion.toFixed(4)})`);

    await page.getByRole('button', { name: 'Son : activé' }).click();
    check((await gg(page, 'sound()')).enabled === false, 'bouton son → coupé');
    await page.keyboard.press('m');
    check((await gg(page, 'sound()')).enabled === true, 'touche M → son réactivé');

    await page.getByRole('button', { name: 'Réinitialiser la galaxie' }).click();
    await page.mouse.move(640, 400);
    const z0 = (await gg(page, 'galaxy()')).dolly;
    await page.keyboard.down('Shift');
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
    await page.keyboard.up('Shift');
    check((await gg(page, 'galaxy()')).dolly < z0, 'Maj + molette → zoom avant');
    await page.keyboard.press('q');
    check((await gg(page, 'galaxy()')).roll > 0, 'touche Q → orientation');
    check(errors.length === 0, `aucune erreur console ${errors.join(' | ')}`);
    await ctx.close();
  }

  // -------------------------------------------------------------------------
  console.log('\n▶ Caméra simulée + MediaPipe');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera'] });
    const { page, errors, failed } = await open(ctx);
    await page.getByRole('button', { name: "Commencer l'expérience" }).click();
    await page.waitForFunction(() => ['running', 'error'].includes(document.getElementById('app').dataset.state), null, { timeout: 90000 });
    const state = await page.locator('#app').getAttribute('data-state');
    check(state === 'running', `démarrage complet (état : ${state})`);
    const tr = await gg(page, 'tracker()');
    check(tr.camera && tr.model, `webcam active et modèle chargé (délégué : ${tr.delegate})`);
    check((await page.locator('#steps li[data-status="done"]').count()) === 6, 'les 6 étapes de chargement sont validées');
    await wait(1500);
    check(['Recherche de la main…', 'Main détectée'].includes(await page.locator('#hand-status').textContent()), 'indicateur de détection actif');
    await page.screenshot({ path: `${SHOTS}/04-camera-simulee.png` });
    await page.getByRole('button', { name: 'Désactiver la caméra' }).click();
    await wait(300);
    check((await gg(page, 'tracker()')).camera === false && (await gg(page, 'mode()')) === 'mouse', 'désactivation de la caméra → mode souris');
    check(failed.length === 0, `ressources MediaPipe chargées ${failed.join(', ')}`);
    check(errors.length === 0, `aucune erreur console ${errors.join(' | ')}`);
    await ctx.close();
  }

  // -------------------------------------------------------------------------
  console.log('\n▶ Webcam refusée / indisponible');
  const scenarios = [
    ['NotAllowedError', 'Accès à la caméra refusé'],
    ['NotFoundError', 'Aucune caméra détectée'],
    ['NotReadableError', 'Caméra indisponible'],
    ['NO_MEDIA_DEVICES', 'Navigateur non compatible'],
  ];
  for (const [name, title] of scenarios) {
    const ctx = await browser.newContext();
    await ctx.addInitScript((errName) => {
      window.__denyCamera = true;
      if (errName === 'NO_MEDIA_DEVICES') {
        Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
        return;
      }
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) =>
        window.__denyCamera ? Promise.reject(new DOMException('Simulé', errName)) : original(c);
    }, name);
    const { page } = await open(ctx);
    await page.getByRole('button', { name: "Commencer l'expérience" }).click();
    await page.locator('#error-panel').waitFor({ state: 'visible', timeout: 10000 });
    check((await page.locator('#error-title').textContent()) === title, `${name} → « ${title} »`);
    if (name === 'NotAllowedError') {
      await page.screenshot({ path: `${SHOTS}/05-camera-refusee.png` });
      // L'utilisateur autorise ensuite la caméra puis clique sur « Réessayer ».
      await page.evaluate(() => (window.__denyCamera = false));
      await ctx.grantPermissions(['camera']);
      await page.getByRole('button', { name: 'Réessayer' }).click();
      await page.waitForFunction(() => ['running', 'error'].includes(document.getElementById('app').dataset.state) && document.getElementById('app').dataset.state !== 'loading', null, { timeout: 90000 });
      check((await page.locator('#app').getAttribute('data-state')) === 'running', 'Réessayer après autorisation → démarrage');
    } else {
      await page.getByRole('button', { name: 'Continuer avec la souris' }).click();
      check((await gg(page, 'mode()')) === 'mouse', '→ « Continuer avec la souris » fonctionne');
    }
    await ctx.close();
  }

  // -------------------------------------------------------------------------
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  if (lan) {
    console.log(`\n▶ Contexte non sécurisé (http://${lan.address})`);
    const ctx = await browser.newContext();
    const { page } = await open(ctx, `http://${lan.address}:${PORT}${BASE}`);
    check((await page.evaluate(() => window.isSecureContext)) === false, 'page en HTTP non sécurisé');
    await page.getByRole('button', { name: "Commencer l'expérience" }).click();
    await page.locator('#error-panel').waitFor({ state: 'visible', timeout: 10000 });
    check((await page.locator('#error-title').textContent()) === 'Connexion non sécurisée', 'message HTTPS requis');
    await ctx.close();
  }

  // -------------------------------------------------------------------------
  console.log('\n▶ Affichage mobile (390×844)');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const { page, errors } = await open(ctx);
    await wait(2500);
    await page.screenshot({ path: `${SHOTS}/06-mobile-accueil.png` });
    check(await page.getByRole('button', { name: "Commencer l'expérience" }).isVisible(), 'bouton principal visible');
    await page.getByRole('button', { name: 'Continuer sans caméra (mode souris)' }).click();
    await wait(1200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!overflow, 'pas de défilement horizontal');
    for (const id of ['btn-camera', 'btn-effects', 'btn-reset', 'btn-pulse', 'cam-card']) {
      const box = await page.locator(`#${id}`).boundingBox();
      check(!!box && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844, `#${id} dans l'écran`);
    }
    const p0 = (await gg(page, 'galaxy()')).pulseCount;
    await page.touchscreen.tap(195, 420);
    await wait(100);
    check((await gg(page, 'galaxy()')).pulseCount === p0 + 1, 'tap → impulsion');
    await page.screenshot({ path: `${SHOTS}/07-mobile-scene.png` });
    check(errors.length === 0, `aucune erreur console ${errors.join(' | ')}`);
    await ctx.close();
  }
} catch (err) {
  failures++;
  console.error('\n✘ Exception :', err);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n✘ ${failures} vérification(s) en échec` : '\n✔ Toutes les vérifications sont passées');
process.exit(failures ? 1 : 0);
