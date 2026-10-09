import type { JobBackend } from "../queue/JobBackend.js";

export class DlqReconciler {
  private timer: NodeJS.Timeout | undefined;
  constructor(private readonly backend: Pick<JobBackend, "reconcileDlq">, private readonly intervalMs: number, private readonly now: () => number) {}
  tick(): Promise<number> { return this.backend.reconcileDlq(this.now(), 100); }
  start(): void { if (this.timer === undefined) this.timer = setInterval(() => void this.tick(), this.intervalMs); }
  stop(): void { if (this.timer !== undefined) clearInterval(this.timer); this.timer = undefined; }
}
