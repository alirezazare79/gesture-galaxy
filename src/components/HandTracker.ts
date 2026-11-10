/**
 * HandTracker — gère la webcam et le modèle MediaPipe Hand Landmarker.
 *
 * Confidentialité : les images de la webcam sont analysées localement, dans le
 * navigateur (WebAssembly + WebGL). Aucune image n'est envoyée sur le réseau.
 * Seuls les fichiers du modèle et du moteur WASM sont téléchargés au démarrage.
 */
import type { HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { Landmark } from '../utils/gestureUtils.ts';

const BASE = import.meta.env.BASE_URL;
const WASM_PATH = `${BASE}mediapipe/wasm`;
const LOCAL_MODEL = `${BASE}models/hand_landmarker.task`;
/** Repli si le modèle local est absent : fichier officiel publié par Google. */
const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/** Erreur typée pour afficher un message adapté à l'utilisateur. */
export class CameraError extends Error {
  readonly code: CameraErrorCode;
  constructor(code: CameraErrorCode, message: string) {
    super(message);
    this.name = 'CameraError';
    this.code = code;
  }
}

export type CameraErrorCode = 'denied' | 'not-found' | 'in-use' | 'insecure' | 'unsupported' | 'model' | 'unknown';

/** Traduit une erreur de getUserMedia / MediaPipe en code exploitable. */
export function toCameraError(err: unknown): CameraError {
  if (err instanceof CameraError) return err;
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? String(err);
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return new CameraError('denied', message);
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new CameraError('not-found', message);
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new CameraError('in-use', message);
    case 'SecurityError':
      return new CameraError('insecure', message);
    default:
      return new CameraError('unknown', message);
  }
}

export interface DetectionResult {
  /** Mains détectées (0, 1 ou 2), 21 points chacune. */
  hands: Landmark[][];
  /** Rapport largeur/hauteur de la vidéo. */
  aspect: number;
  timestamp: number;
}

export class HandTracker {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private landmarker: HandLandmarker | null = null;
  private lastVideoTime = -1;
  private lastDetection = 0;
  /** Intervalle minimal entre deux analyses (ms) : limite la charge CPU/GPU. */
  minInterval = 1000 / 30;
  /** Délégué effectivement utilisé (GPU ou CPU). */
  delegate: 'GPU' | 'CPU' | null = null;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  get cameraActive(): boolean {
    return !!this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live');
  }

  get modelReady(): boolean {
    return this.landmarker !== null;
  }

  /** Demande l'accès à la webcam et démarre la vidéo. */
  async startCamera(): Promise<void> {
    if (!window.isSecureContext) {
      throw new CameraError('insecure', 'Contexte non sécurisé (HTTPS requis).');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError('unsupported', 'getUserMedia indisponible.');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 60 },
        },
      });
    } catch (err) {
      throw toCameraError(err);
    }
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await new Promise<void>((resolve) => {
      if (this.video.readyState >= 2) return resolve();
      this.video.addEventListener('loadeddata', () => resolve(), { once: true });
    });
    await this.video.play().catch(() => undefined);
    // Si l'utilisateur débranche la caméra ou révoque l'autorisation.
    for (const track of this.stream.getVideoTracks()) {
      track.addEventListener('ended', () => this.onCameraEnded?.());
    }
  }

  /** Appelé si le flux vidéo s'interrompt (caméra débranchée, autorisation révoquée…). */
  onCameraEnded: (() => void) | null = null;

  /** Charge le moteur WASM puis le modèle de détection (GPU si possible, sinon CPU). */
  async loadModel(onProgress?: (step: 'runtime' | 'model') => void): Promise<void> {
    if (this.landmarker) return;
    let fileset;
    let HandLandmarkerClass: typeof HandLandmarker;
    try {
      // Chargement à la demande : la bibliothèque n'est téléchargée qu'à l'activation de la caméra.
      const vision = await import('@mediapipe/tasks-vision');
      HandLandmarkerClass = vision.HandLandmarker;
      fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
    } catch (err) {
      throw new CameraError('model', `Moteur MediaPipe introuvable : ${(err as Error).message}`);
    }
    onProgress?.('runtime');

    // Modèle servi par le site lui-même, avec repli sur le fichier officiel ; GPU si possible, sinon CPU.
    let lastError: unknown = null;
    attempts: for (const modelAssetPath of [LOCAL_MODEL, REMOTE_MODEL]) {
      for (const delegate of ['GPU', 'CPU'] as const) {
        try {
          this.landmarker = await HandLandmarkerClass.createFromOptions(fileset, {
            baseOptions: { modelAssetPath, delegate },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence: 0.55,
            minTrackingConfidence: 0.5,
          });
          this.delegate = delegate;
          break attempts;
        } catch (err) {
          lastError = err;
        }
      }
    }
    if (!this.landmarker) {
      throw new CameraError('model', `Chargement du modèle impossible : ${(lastError as Error)?.message ?? ''}`);
    }
    onProgress?.('model');
  }

  /**
   * Analyse l'image courante de la vidéo si nécessaire.
   * Retourne null si aucune nouvelle analyse n'a été faite (image identique ou trop tôt).
   */
  detect(now: number): DetectionResult | null {
    const v = this.video;
    if (!this.landmarker || !this.cameraActive || v.readyState < 2 || v.videoWidth === 0) return null;
    if (now - this.lastDetection < this.minInterval) return null;
    if (v.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = v.currentTime;
    this.lastDetection = now;

    let result: HandLandmarkerResult;
    try {
      result = this.landmarker.detectForVideo(v, now);
    } catch (err) {
      console.warn('[HandTracker] Analyse impossible pour cette image :', err);
      return null;
    }
    return {
      hands: (result.landmarks ?? []).filter((h) => h.length === 21),
      aspect: v.videoWidth / Math.max(v.videoHeight, 1),
      timestamp: now,
    };
  }

  /** Arrête la webcam (le modèle reste en mémoire pour un redémarrage rapide). */
  stopCamera(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
    }
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.lastVideoTime = -1;
  }

  /** Libère la webcam et le modèle. */
  dispose(): void {
    this.stopCamera();
    this.landmarker?.close();
    this.landmarker = null;
  }
}
