import { randomUUID } from "node:crypto";
import { QueueCapacityError } from "../domain/errors.js";
import { PRIORITY_WEIGHT, type Job, type JobLease, type NewJob, type SubmitResult } from "../domain/job.js";
import type { BackendHealth, BackendStats, LeaseMutation, TransitionResult } from "./JobBackend.js";
import { BinaryHeap } from "./BinaryHeap.js";

export interface InMemoryJobBackendOptions {
  readonly capacity: number;
  readonly maxAttempts: number;
}

export class InMemoryJobBackend {
  private readonly jobs = new Map<string, Job>();
  private readonly ready = new BinaryHeap<{ jobId: string; weight: number; sequence: number }>(
    (left, right) => left.weight > right.weight || (left.weight === right.weight && left.sequence < right.sequence)
  );
  private outstanding = 0;
  private sequence = 0;

  constructor(private readonly options: InMemoryJobBackendOptions) {}

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async submit(input: NewJob, context: { now: number; idempotencyKey?: string }): Promise<SubmitResult> {
    if (this.outstanding >= this.options.capacity) throw new QueueCapacityError();
    const job: Job = Object.freeze({
      ...input,
      payload: structuredClone(input.payload),
      id: randomUUID(),
      state: "queued",
      attempts: 0,
      maxAttempts: this.options.maxAttempts,
      createdAt: context.now,
      updatedAt: context.now
    });
    this.jobs.set(job.id, job);
    this.ready.push({ jobId: job.id, weight: PRIORITY_WEIGHT[job.priority], sequence: this.sequence++ });
    this.outstanding += 1;
    return { job, deduplicated: false };
  }

  async get(id: string): Promise<Job | undefined> {
    return this.jobs.get(id);
  }

  async claim(input: { workerId: string; now: number; leaseMs: number }): Promise<JobLease | null> {
    while (this.ready.size > 0) {
      const entry = this.ready.pop();
      if (entry === undefined) return null;
      const current = this.jobs.get(entry.jobId);
      if (current === undefined || current.state !== "queued") continue;
      const token = randomUUID();
      const lease = Object.freeze({ token, workerId: input.workerId, expiresAt: input.now + input.leaseMs });
      const running: Job = Object.freeze({
        ...current,
        state: "running",
        attempts: current.attempts + 1,
        startedAt: input.now,
        updatedAt: input.now,
        lease
      });
      this.jobs.set(running.id, running);
      return { job: running, token, workerId: input.workerId, expiresAt: lease.expiresAt };
    }
    return null;
  }

  async renew(input: LeaseMutation & { now: number; leaseMs: number }): Promise<boolean> {
    const current = this.jobs.get(input.jobId);
    if (current?.state !== "running" || current.lease?.token !== input.token) return false;
    this.jobs.set(current.id, Object.freeze({
      ...current,
      updatedAt: input.now,
      lease: Object.freeze({ ...current.lease, expiresAt: input.now + input.leaseMs })
    }));
    return true;
  }

  async complete(input: LeaseMutation & { now: number }): Promise<TransitionResult> {
    const current = this.jobs.get(input.jobId);
    if (current === undefined) return { applied: false, reason: "not_found" };
    if (current.state === "completed" || current.state === "dead_lettered") {
      return { applied: false, reason: "already_terminal" };
    }
    if (current.state !== "running") return { applied: false, reason: "invalid_state" };
    if (current.lease?.token !== input.token) return { applied: false, reason: "stale_lease" };
    const { lease: _lease, ...withoutLease } = current;
    this.jobs.set(current.id, Object.freeze({
      ...withoutLease,
      state: "completed",
      completedAt: input.now,
      updatedAt: input.now
    }));
    this.outstanding -= 1;
    return { applied: true };
  }

  async stats(): Promise<BackendStats> {
    let queued = 0;
    let running = 0;
    for (const job of this.jobs.values()) {
      if (job.state === "queued") queued += 1;
      if (job.state === "running") running += 1;
    }
    return {
      outstanding: this.outstanding,
      queued,
      delayed: 0,
      running,
      dlqPending: 0,
      capacity: this.options.capacity
    };
  }

  async health(): Promise<BackendHealth> {
    return { healthy: true, durable: false };
  }
}
