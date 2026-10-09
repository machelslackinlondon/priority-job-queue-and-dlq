import type { JobBackend } from "../queue/JobBackend.js";

export class Scheduler {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly backend: Pick<JobBackend, "promoteDue" | "recoverExpired" | "purgeTerminal">,
    private readonly options: { intervalMs: number; batchSize: number; retentionMs: number; now: () => number }
  ) {}

  async tick(): Promise<void> {
    const now = this.options.now();
    await this.backend.promoteDue(now, this.options.batchSize);
    await this.backend.recoverExpired(now, this.options.batchSize);
    await this.backend.purgeTerminal(now, this.options.retentionMs);
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}
