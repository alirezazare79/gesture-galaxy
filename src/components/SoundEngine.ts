/**
 * SoundEngine — ambiance sonore réactive, entièrement synthétisée (Web Audio API).
 * Aucun fichier audio : tous les sons sont générés à partir d'oscillateurs et de bruit.
 *
 *  - Nappe spatiale permanente (accord grave, filtre qui « respire »).
 *  - Contraction : grondement sub-grave qui s'intensifie.
 *  - Expansion : scintillement aigu et nappe plus lumineuse.
 *  - Rotation : souffle dont la hauteur suit la vitesse.
 *  - Impulsion : boum grave + déflagration filtrée + accord cristallin, avec réverbération.
 */
import { clamp } from '../utils/gestureUtils.ts';

export interface SoundState {
  /** -1 (contraction) .. +1 (expansion). */
  expansion: number;
  /** Vitesse de rotation (rad/s). */
  spin: number;
}

/** Accords des impulsions (fréquences en Hz), synchronisés avec les couleurs successives. */
const PULSE_CHORDS: ReadonlyArray<ReadonlyArray<number>> = [
  [523.25, 659.25, 987.77],
  [587.33, 739.99, 1108.73],
  [440.0, 659.25, 880.0],
  [493.88, 622.25, 987.77],
  [392.0, 587.33, 783.99],
];

export class SoundEngine {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly sources: AudioScheduledSourceNode[] = [];

  // Paramètres modulés en continu.
  private droneFilter: BiquadFilterNode | null = null;
  private rumbleGain: GainNode | null = null;
  private shimmerGain: GainNode | null = null;
  private whooshGain: GainNode | null = null;
  private whooshFilter: BiquadFilterNode | null = null;

  private pulseCount = 0;
  private enabled = true;
  private readonly volume: number;

  constructor(volume = 0.7) {
    this.volume = volume;
  }

  get started(): boolean {
    return this.ctx !== null;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Démarre l'audio. Doit être appelé à la suite d'une action de l'utilisateur
   * (clic), sinon le navigateur bloque la lecture.
   */
  start(): void {
    if (this.ctx) {
      void this.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // navigateur sans Web Audio : l'expérience continue en silence
    try {
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.attach(ctx, ctx.destination);
      void ctx.resume();
    } catch (err) {
      console.warn('[SoundEngine] Audio indisponible :', err);
    }
  }

  /** Construit le graphe audio sur un contexte donné (temps réel ou hors ligne pour les tests). */
  attach(ctx: BaseAudioContext, destination: AudioNode, fadeInSeconds = 2.5): void {
    this.ctx = ctx;
    const now = ctx.currentTime;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(this.enabled ? this.volume : 0, now + Math.max(fadeInSeconds, 0.01)); // fondu d'entrée
    this.master.connect(compressor).connect(destination);

    this.noise = this.makeNoise(ctx, 2);

    // Réverbération « spatiale » générée (réponse impulsionnelle de bruit décroissant).
    const reverb = ctx.createConvolver();
    reverb.buffer = this.makeImpulse(ctx, 3.2);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.45;
    this.reverbSend.connect(reverb).connect(this.master);

    // --- Nappe : accord grave (la, mi) légèrement désaccordé ---
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 420;
    this.droneFilter.Q.value = 0.7;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.065;
    this.droneFilter.connect(droneGain);
    droneGain.connect(this.master);
    droneGain.connect(this.reverbSend);
    for (const [freq, type, gain, detune] of [
      [55, 'sine', 0.7, 0],
      [55, 'triangle', 0.35, 7],
      [82.41, 'sine', 0.35, -5],
      [110, 'sine', 0.15, 3],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(this.droneFilter);
      this.startSource(o);
    }
    // Le filtre « respire » lentement.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 140;
    lfo.connect(lfoDepth).connect(this.droneFilter.frequency);
    this.startSource(lfo);

    // --- Grondement de contraction : sub-grave + bruit très filtré ---
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumbleGain.connect(this.master);
    const sub = ctx.createOscillator();
    sub.frequency.value = 36;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.8;
    sub.connect(subGain).connect(this.rumbleGain);
    this.startSource(sub);
    const rumbleNoise = this.loopNoise(ctx);
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 110;
    rumbleNoise.connect(rumbleFilter).connect(this.rumbleGain);

    // --- Scintillement d'expansion : bruit aigu + harmoniques ---
    this.shimmerGain = ctx.createGain();
    this.shimmerGain.gain.value = 0;
    this.shimmerGain.connect(this.master);
    this.shimmerGain.connect(this.reverbSend);
    const shimmerNoise = this.loopNoise(ctx);
    const shimmerFilter = ctx.createBiquadFilter();
    shimmerFilter.type = 'bandpass';
    shimmerFilter.frequency.value = 5200;
    shimmerFilter.Q.value = 1.2;
    const shimmerNoiseGain = ctx.createGain();
    shimmerNoiseGain.gain.value = 0.25;
    shimmerNoise.connect(shimmerFilter).connect(shimmerNoiseGain).connect(this.shimmerGain);
    for (const f of [659.25, 987.77, 1318.5]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.12;
      o.connect(g).connect(this.shimmerGain);
      this.startSource(o);
    }

    // --- Souffle de rotation ---
    this.whooshGain = ctx.createGain();
    this.whooshGain.gain.value = 0;
    this.whooshFilter = ctx.createBiquadFilter();
    this.whooshFilter.type = 'bandpass';
    this.whooshFilter.frequency.value = 500;
    this.whooshFilter.Q.value = 0.9;
    this.loopNoise(ctx).connect(this.whooshFilter).connect(this.whooshGain).connect(this.master);
  }

  /** Met à jour les paramètres continus (appelé à chaque image). */
  update(state: SoundState): void {
    const ctx = this.ctx;
    if (!ctx || !this.droneFilter || !this.rumbleGain || !this.shimmerGain || !this.whooshGain || !this.whooshFilter) return;
    const t = ctx.currentTime;
    const contraction = clamp(-state.expansion);
    const expansion = clamp(state.expansion);
    const spin = Math.abs(state.spin);

    this.droneFilter.frequency.setTargetAtTime(420 + expansion * 900 - contraction * 220, t, 0.25);
    this.rumbleGain.gain.setTargetAtTime(contraction * contraction * 0.32, t, 0.2);
    this.shimmerGain.gain.setTargetAtTime(expansion * 0.035, t, 0.3);
    const whoosh = clamp((spin - 0.12) / 3);
    this.whooshGain.gain.setTargetAtTime(whoosh * 0.11, t, 0.12);
    this.whooshFilter.frequency.setTargetAtTime(380 + whoosh * 1600, t, 0.15);
  }

  /** Explosion sonore synchronisée avec l'impulsion lumineuse. */
  explosion(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.reverbSend || !this.noise) return;
    const t = ctx.currentTime + 0.01;
    const chord = PULSE_CHORDS[this.pulseCount++ % PULSE_CHORDS.length];

    // Boum grave avec chute de hauteur.
    const boom = ctx.createOscillator();
    boom.frequency.setValueAtTime(150, t);
    boom.frequency.exponentialRampToValueAtTime(36, t + 0.7);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.0001, t);
    boomGain.gain.exponentialRampToValueAtTime(0.85, t + 0.02);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    boom.connect(boomGain).connect(this.master);
    boom.start(t);
    boom.stop(t + 1.4);

    // Déflagration : bruit dont le filtre se referme.
    const burst = ctx.createBufferSource();
    burst.buffer = this.noise;
    const burstFilter = ctx.createBiquadFilter();
    burstFilter.type = 'lowpass';
    burstFilter.frequency.setValueAtTime(9000, t);
    burstFilter.frequency.exponentialRampToValueAtTime(250, t + 1.5);
    const burstGain = ctx.createGain();
    burstGain.gain.setValueAtTime(0.0001, t);
    burstGain.gain.exponentialRampToValueAtTime(0.45, t + 0.015);
    burstGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    burst.connect(burstFilter).connect(burstGain);
    burstGain.connect(this.master);
    burstGain.connect(this.reverbSend);
    burst.start(t);
    burst.stop(t + 1.8);

    // Accord cristallin qui résonne dans l'espace.
    chord.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = (i - 1) * 4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.04 + i * 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      o.connect(g);
      g.connect(this.master!);
      g.connect(this.reverbSend!);
      o.start(t);
      o.stop(t + 2.9);
    });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(enabled ? this.volume : 0, ctx.currentTime, 0.15);
    if (enabled) void this.resume();
  }

  async suspend(): Promise<void> {
    if (this.ctx instanceof AudioContext && this.ctx.state === 'running') await this.ctx.suspend();
  }

  async resume(): Promise<void> {
    if (this.ctx instanceof AudioContext && this.ctx.state === 'suspended' && this.enabled) await this.ctx.resume();
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* déjà arrêtée */
      }
    }
    this.sources.length = 0;
    if (this.ctx instanceof AudioContext) void this.ctx.close();
    this.ctx = null;
  }

  // ------------------------------------------------------------------

  private startSource(s: AudioScheduledSourceNode): void {
    s.start();
    this.sources.push(s);
  }

  private loopNoise(ctx: BaseAudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.startSource(src);
    return src;
  }

  private makeNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.6);
    }
    return buffer;
  }
}
