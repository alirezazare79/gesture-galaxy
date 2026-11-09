import { defineConfig, type Plugin } from 'vite';
import { createReadStream, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Chemin de base public.
 * - En local : './' (chemins relatifs, fonctionne partout).
 * - Sur GitHub Pages : le workflow fournit BASE_PATH (ex. '/gesture-galaxy/'),
 *   calculé automatiquement à partir du nom du dépôt ou du domaine personnalisé.
 */
const base = process.env.BASE_PATH && process.env.BASE_PATH.trim() !== '' ? process.env.BASE_PATH : './';

/** Fichiers WebAssembly de MediaPipe servis localement (aucun CDN requis). */
const WASM_DIR = resolve(ROOT, 'node_modules/@mediapipe/tasks-vision/wasm');
const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

/**
 * Petit plugin : sert les fichiers WASM de MediaPipe en développement
 * et les copie dans dist/mediapipe/wasm lors du build.
 */
function mediapipeWasm(): Plugin {
  return {
    name: 'gesture-galaxy:mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        const match = url.match(/\/mediapipe\/wasm\/([\w.-]+)$/);
        if (!match || !WASM_FILES.includes(match[1])) return next();
        const file = resolve(WASM_DIR, match[1]);
        if (!existsSync(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const name of WASM_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `mediapipe/wasm/${name}`,
          source: readFileSync(resolve(WASM_DIR, name)),
        });
      }
    },
  };
}

export default defineConfig({
  base,
  plugins: [mediapipeWasm()],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    assetsInlineLimit: 0,
  },
  server: { host: true },
  preview: { host: true },
});
