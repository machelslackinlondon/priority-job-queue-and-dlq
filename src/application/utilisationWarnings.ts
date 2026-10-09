const THRESHOLDS = [0.7, 0.85, 0.95] as const;

export class UtilisationWarningMonitor {
  private readonly armed = new Set<number>(THRESHOLDS);

  constructor(private readonly warn: (threshold: number, utilisation: number) => void) {}

  observe(depth: number, capacity: number): void {
    const utilisation = capacity <= 0 ? 1 : depth / capacity;
    for (const threshold of THRESHOLDS) {
      if (utilisation < threshold) this.armed.add(threshold);
      if (utilisation >= threshold && this.armed.delete(threshold)) this.warn(threshold, utilisation);
    }
  }
}
