import type { AccelSample, BreathAnalysisFrame, BreathAnalyzer } from "./analyzer";

export type BreathSourceKind = "polar" | "polar-lynphan" | "phone";

export interface BreathSourceDescriptor {
  kind: BreathSourceKind;
  label: string;
  /** Phones tagged as the breath-responsible device. */
  breathResponsible?: boolean;
}

/**
 * Source router: keeps track of attached sources (polar/phone) and
 * exposes the currently active source based on user preference and
 * availability.
 *
 * Routing rules (honoring the "polar default" requirement):
 * - The *preferred* source is used when it is attached and satisfies
 *   responsibility requirements.
 * - If the preferred source is unavailable, a phone tagged as
 *   `breathResponsible` becomes the fallback.
 * - Switching the active source resets the analyzer so the new
 *   calibration starts from scratch.
 */
export class BreathSourceManager {
  private readonly sources = new Map<BreathSourceKind, BreathSourceDescriptor>();
  private preferred: BreathSourceKind = "polar";
  private activeKind: BreathSourceKind | null = null;
  private readonly activeListeners = new Set<
    (active: BreathSourceKind | null) => void
  >();
  private readonly frameListeners = new Set<
    (frame: BreathAnalysisFrame) => void
  >();

  constructor(readonly analyzer: BreathAnalyzer) {
    analyzer.onFrame((f) => {
      for (const l of [...this.frameListeners]) l(f);
    });
  }

  attach(descriptor: BreathSourceDescriptor): void {
    this.sources.set(descriptor.kind, descriptor);
    this.recompute();
  }

  detach(kind: BreathSourceKind): void {
    this.sources.delete(kind);
    this.recompute();
  }

  /** Set the preferred breath-detection protocol (user selector). */
  setPreferred(kind: BreathSourceKind): void {
    if (this.preferred === kind) return;
    this.preferred = kind;
    this.recompute();
  }

  get preferredSource(): BreathSourceKind {
    return this.preferred;
  }

  get activeSource(): BreathSourceKind | null {
    return this.activeKind;
  }

  get activeLabel(): string | null {
    return this.sources.get(this.activeKind!)?.label ?? null;
  }

  /**
   * Route a sample from `kind` into the analyzer.
   * Returns the current frame if the source is active, `null` otherwise.
   */
  ingest(
    sample: AccelSample,
    kind: BreathSourceKind,
  ): BreathAnalysisFrame | null {
    if (kind !== this.activeKind) return null;
    return this.analyzer.ingest(sample);
  }

  reset(): void {
    this.analyzer.reset();
  }

  onActiveChange(
    listener: (active: BreathSourceKind | null) => void,
  ): () => void {
    this.activeListeners.add(listener);
    return () => {
      this.activeListeners.delete(listener);
    };
  }

  onFrame(listener: (frame: BreathAnalysisFrame) => void): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  private recompute(): void {
    const polarLynphan = this.sources.get("polar-lynphan");
    const phone = this.sources.get("phone");
    const phoneOk = phone?.breathResponsible === true;
    let next: BreathSourceKind | null = null;

    if (phoneOk && this.preferred === "phone") next = "phone";
    else if (polarLynphan && this.preferred === "polar-lynphan") next = "polar-lynphan";
    else if (polarLynphan) next = "polar-lynphan";
    else if (phoneOk) next = "phone";

    if (next !== this.activeKind) {
      this.activeKind = next;
      this.analyzer.reset();
      for (const l of [...this.activeListeners]) l(next);
    }
  }
}
