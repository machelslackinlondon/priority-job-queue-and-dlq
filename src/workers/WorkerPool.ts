import { NonRetryableJobError, RetryableJobError } from "../domain/errors.js";
import type { FailureSummary } from "../domain/job.js";
import type { JobBackend } from "../queue/JobBackend.js";
import { calculateBackoff, type RetryPolicy } from "../retry/backoff.js";
import type { HandlerRegistry } from "./handlers.js";
import { runWithDeadline } from "./runWithDeadline.js";

export interface WorkerPoolOptions {
  readonly backend: Pick<JobBackend, "claim" | "renew" | "complete" | "retry" | "deadLetter">;
  readonly handlers: HandlerRegistry;
  readonly concurrency: number;
  readonly timeoutMs: number;
  readonly leaseMs: number;
  readonly heartbeatMs: number;
  readonly now: () => number;
  readonly retryPolicy?: RetryPolicy;
  readonly random?: () => number;
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
      const handler = this.options.handlers.get(lease.job.type);
      if (handler === undefined) throw new NonRetryableJobError("UNKNOWN_JOB_TYPE", `No handler for ${lease.job.type}`);
      try {
        await runWithDeadline((signal) => handler({ job: lease.job, signal }), this.options.timeoutMs);
        await this.options.backend.complete({ jobId: lease.job.id, token: lease.token, now: this.options.now() });
      } catch (error) {
        const now = this.options.now();
        const retryable = !(error instanceof NonRetryableJobError);
        const code = error instanceof RetryableJobError || error instanceof NonRetryableJobError
          ? error.code
          : "UNHANDLED_JOB_ERROR";
        const failure: FailureSummary = {
          code,
          message: error instanceof Error ? error.message : "Unknown job failure",
          retryable,
          failedAt: now
        };
        if (retryable && lease.job.attempts < lease.job.maxAttempts) {
          const delay = calculateBackoff(
            lease.job.attempts - 1,
            this.options.retryPolicy ?? { baseMs: 500, maxMs: 30_000, jitterRatio: 0.2 },
            this.options.random ?? Math.random
          );
          await this.options.backend.retry({
            jobId: lease.job.id, token: lease.token, now, availableAt: now + delay, failure
          });
        } else {
          await this.options.backend.deadLetter({ jobId: lease.job.id, token: lease.token, now, failure });
        }
      }
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
