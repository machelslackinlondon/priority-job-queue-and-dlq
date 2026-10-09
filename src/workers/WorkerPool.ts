import { NonRetryableJobError } from "../domain/errors.js";
import type { JobBackend } from "../queue/JobBackend.js";
import type { HandlerRegistry } from "./handlers.js";
import { runWithDeadline } from "./runWithDeadline.js";

export interface WorkerPoolOptions {
  readonly backend: Pick<JobBackend, "claim" | "renew" | "complete">;
  readonly handlers: HandlerRegistry;
  readonly concurrency: number;
  readonly timeoutMs: number;
  readonly leaseMs: number;
  readonly heartbeatMs: number;
  readonly now: () => number;
}

export class WorkerPool {
  private active = 0;

  constructor(private readonly options: WorkerPoolOptions) {}

  get activeCount(): number {
    return this.active;
  }

  async runOne(workerId: string): Promise<boolean> {
    const lease = await this.options.backend.claim({
      workerId,
      now: this.options.now(),
      leaseMs: this.options.leaseMs
    });
    if (lease === null) return false;
    const handler = this.options.handlers.get(lease.job.type);
    if (handler === undefined) throw new NonRetryableJobError("UNKNOWN_JOB_TYPE", `No handler for ${lease.job.type}`);
    this.active += 1;
    const heartbeat = setInterval(() => {
      void this.options.backend.renew({
        jobId: lease.job.id,
        token: lease.token,
        now: this.options.now(),
        leaseMs: this.options.leaseMs
      });
    }, this.options.heartbeatMs);
    try {
      await runWithDeadline((signal) => handler({ job: lease.job, signal }), this.options.timeoutMs);
      await this.options.backend.complete({ jobId: lease.job.id, token: lease.token, now: this.options.now() });
      return true;
    } finally {
      clearInterval(heartbeat);
      this.active -= 1;
    }
  }

  async runUntilIdle(): Promise<void> {
    await Promise.all(Array.from({ length: this.options.concurrency }, async (_, index) => {
      while (await this.runOne(`worker-${index}`)) {
        // Continue until the ready queue is drained.
      }
    }));
  }
}
