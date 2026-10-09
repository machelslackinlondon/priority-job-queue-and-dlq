import { NonRetryableJobError, RetryableJobError } from "../domain/errors.js";
import type { FailureSummary } from "../domain/job.js";
import type { JobBackend } from "../queue/JobBackend.js";
import { calculateBackoff, type RetryPolicy } from "../retry/backoff.js";
import type { JobMetrics } from "../metrics/JobMetrics.js";
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
  readonly metrics?: JobMetrics;
}

export class WorkerPool {
  private active = 0;
  private accepting = false;
  private loops: Promise<void>[] = [];

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
    const processingStartedAt = this.options.now();
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
        const completedAt = this.options.now();
        this.options.metrics?.completed(lease.job.type, (completedAt - processingStartedAt) / 1000, (completedAt - lease.job.createdAt) / 1000);
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
        this.options.metrics?.failed(lease.job.type, code);
        if (retryable && lease.job.attempts < lease.job.maxAttempts) {
          const delay = calculateBackoff(
            lease.job.attempts - 1,
            this.options.retryPolicy ?? { baseMs: 500, maxMs: 30_000, jitterRatio: 0.2 },
            this.options.random ?? Math.random
          );
          await this.options.backend.retry({
            jobId: lease.job.id, token: lease.token, now, availableAt: now + delay, failure
          });
          this.options.metrics?.retried(lease.job.type);
        } else {
          await this.options.backend.deadLetter({ jobId: lease.job.id, token: lease.token, now, failure });
          this.options.metrics?.deadLettered(lease.job.type);
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

  start(pollMs = 25): void {
    if (this.accepting) return;
    this.accepting = true;
    this.loops = Array.from({ length: this.options.concurrency }, (_, index) => this.loop(`worker-${index}`, pollMs));
  }

  stopClaiming(): void { this.accepting = false; }

  async drain(): Promise<void> { await Promise.all(this.loops); }

  private async loop(workerId: string, pollMs: number): Promise<void> {
    while (this.accepting) {
      const worked = await this.runOne(workerId);
      if (!worked) await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}
