/**
 * MouseController — mode alternatif sans caméra (souris, tactile et clavier).
 *
 *  - Glisser horizontalement : rotation (avec inertie)
 *  - Glisser verticalement   : angle de vue
 *  - Molette                 : expansion / contraction
 *  - Maj + molette (ou pincement sur pavé tactile) : zoom
 *  - Clic (ou tap)           : impulsion lumineuse
 *  - Clavier : ← → rotation · ↑ ↓ angle · + / − expansion · Q / D orientation · Espace impulsion
 */
import type { Galaxy } from './Galaxy.ts';
import { clamp } from '../utils/gestureUtils.ts';

export type MouseAction = 'rotate' | 'tilt' | 'expand' | 'contract' | 'neutral' | 'pulse' | 'zoom' | 'roll';

const DRAG_THRESHOLD = 6; // px avant de considérer un glisser (sinon c'est un clic)

export class MouseController {
  private readonly target: HTMLElement;
  private readonly galaxy: Galaxy;
  private readonly onAction: (action: MouseAction) => void;
  private readonly abort = new AbortController();

  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private lastT = 0;
  private velocity = 0;
  private dragging = false;

  constructor(target: HTMLElement, galaxy: Galaxy, onAction: (action: MouseAction) => void) {
    this.target = target;
    this.galaxy = galaxy;
    this.onAction = onAction;
    const opts = { signal: this.abort.signal };
    target.addEventListener('pointerdown', this.onDown, opts);
    window.addEventListener('pointermove', this.onMove, opts);
    window.addEventListener('pointerup', this.onUp, opts);
    window.addEventListener('pointercancel', this.onUp, opts);
    target.addEventListener('wheel', this.onWheel, { ...opts, passive: false });
    window.addEventListener('keydown', this.onKey, opts);
  }

  /** Modifie la consigne d'expansion par pas (molette, clavier, boutons). */
  stepExpansion(delta: number): void {
    const v = clamp(Math.round((this.galaxy.getExpansionTarget() + delta) * 100) / 100, -1, 1);
    this.galaxy.setExpansionTarget(v);
    this.onAction(v > 0.01 ? 'expand' : v < -0.01 ? 'contract' : 'neutral');
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.startX = this.lastX = e.clientX;
    this.startY = this.lastY = e.clientY;
    this.lastT = performance.now();
    this.velocity = 0;
    this.dragging = false;
    this.galaxy.fling(0);
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    if (!this.dragging && Math.hypot(e.clientX - this.startX, e.clientY - this.startY) > DRAG_THRESHOLD) {
      this.dragging = true;
      this.target.classList.add('is-dragging');
    }
    if (!this.dragging) return;
    const now = performance.now();
    const dt = Math.max((now - this.lastT) / 1000, 1 / 240);
    const w = Math.max(this.target.clientWidth, 1);
    const rot = (dx / w) * Math.PI * 1.6;
    this.galaxy.rotateBy(rot);
    this.velocity = this.velocity * 0.6 + (rot / dt) * 0.4;
    this.galaxy.tiltBy((dy / Math.max(this.target.clientHeight, 1)) * 2.2);
    this.onAction(Math.abs(dx) >= Math.abs(dy) ? 'rotate' : 'tilt');
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastT = now;
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.target.classList.remove('is-dragging');
    if (this.dragging) {
      // Inertie seulement si le pointeur bougeait encore au moment du relâchement.
      const idle = performance.now() - this.lastT > 80;
      this.galaxy.fling(idle ? 0 : this.velocity);
    } else if (e.type === 'pointerup') {
      this.galaxy.pulse();
      this.onAction('pulse');
    }
    this.dragging = false;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.shiftKey || e.ctrlKey) {
      // Zoom (certains navigateurs convertissent Maj + molette en défilement horizontal).
      const delta = (e.deltaY || e.deltaX) * unit;
      const factor = Math.exp(clamp(delta / 600, -0.3, 0.3));
      this.galaxy.setDolly(clamp(this.galaxy.getDollyTarget() * factor, 0.45, 1.9));
      this.onAction('zoom');
      return;
    }
    // Un cran de molette (≈100 px) = un quart de la course d'expansion.
    this.stepExpansion(clamp((-e.deltaY * unit) / 400, -0.34, 0.34));
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const el = e.target as HTMLElement | null;
    const interactive = !!el?.closest('button, input, textarea, select, a, [contenteditable]');
    switch (e.key) {
      case 'ArrowLeft':
        this.galaxy.fling(-1.6);
        this.onAction('rotate');
        break;
      case 'ArrowRight':
        this.galaxy.fling(1.6);
        this.onAction('rotate');
        break;
      case 'ArrowUp':
        this.galaxy.tiltBy(0.18);
        this.onAction('tilt');
        break;
      case 'ArrowDown':
        this.galaxy.tiltBy(-0.18);
        this.onAction('tilt');
        break;
      case '+':
      case '=':
        this.stepExpansion(0.5);
        break;
      case '-':
      case '_':
        this.stepExpansion(-0.5);
        break;
      case 'q':
      case 'Q':
        this.galaxy.setRoll(this.galaxy.getRollTarget() + 0.2);
        this.onAction('roll');
        break;
      case 'd':
      case 'D':
        this.galaxy.setRoll(this.galaxy.getRollTarget() - 0.2);
        this.onAction('roll');
        break;
      case ' ':
        if (interactive) return; // laisse l'espace activer les boutons
        this.galaxy.pulse();
        this.onAction('pulse');
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  dispose(): void {
    this.abort.abort();
  }
}
