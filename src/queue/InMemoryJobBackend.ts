import { randomUUID } from "node:crypto";
import { QueueCapacityError } from "../domain/errors.js";
import { PRIORITY_WEIGHT, type FailureSummary, type Job, type JobLease, type NewJob, type SubmitResult } from "../domain/job.js";
import type { BackendHealth, BackendStats, LeaseMutation, TransitionResult } from "./JobBackend.js";
import { BinaryHeap } from "./BinaryHeap.js";

export interface InMemoryJobBackendOptions {
  readonly capacity: number;
  readonly maxAttempts: number;
  readonly dlqWrite?: (job: Job) => void;
}

export class InMemoryJobBackend {
  private readonly jobs = new Map<string, Job>();
  private readonly idempotency = new Map<string, string>();
  private readonly ready = new BinaryHeap<{ jobId: string; weight: number; sequence: number }>(
    (left, right) => left.weight > right.weight || (left.weight === right.weight && left.sequence < right.sequence)
  );
  private readonly delayed = new BinaryHeap<{ jobId: string; availableAt: number; sequence: number }>(
    (left, right) => left.availableAt < right.availableAt ||
      (left.availableAt === right.availableAt && left.sequence < right.sequence)
  );
  private outstanding = 0;
  private sequence = 0;

  constructor(private readonly options: InMemoryJobBackendOptions) {}

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async submit(input: NewJob, context: { now: number; idempotencyKey?: string }): Promise<SubmitResult> {
    if (context.idempotencyKey !== undefined) {
      const key = context.idempotencyKey.trim();
      if (key.length === 0 || Buffer.byteLength(key) > 200) throw new Error("Invalid Idempotency-Key");
      const existingId = this.idempotency.get(key);
      const existing = existingId === undefined ? undefined : this.jobs.get(existingId);
      if (existing !== undefined) return { job: existing, deduplicated: true };
    }
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
    if (context.idempotencyKey !== undefined) this.idempotency.set(context.idempotencyKey.trim(), job.id);
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

  async retry(input: LeaseMutation & {
    now: number;
    availableAt: number;
    failure: FailureSummary;
  }): Promise<TransitionResult> {
    const current = this.jobs.get(input.jobId);
    if (current === undefined) return { applied: false, reason: "not_found" };
    if (current.state !== "running") return { applied: false, reason: "invalid_state" };
    if (current.lease?.token !== input.token) return { applied: false, reason: "stale_lease" };
    const { lease: _lease, ...withoutLease } = current;
    const delayed: Job = Object.freeze({
      ...withoutLease,
      state: "retry_scheduled",
      availableAt: input.availableAt,
      updatedAt: input.now,
      lastFailure: input.failure
    });
    this.jobs.set(delayed.id, delayed);
    this.delayed.push({ jobId: delayed.id, availableAt: input.availableAt, sequence: this.sequence++ });
    return { applied: true };
  }

  async promoteDue(now: number, limit: number): Promise<number> {
    let promoted = 0;
    while (promoted < limit) {
      const next = this.delayed.peek();
      if (next === undefined || next.availableAt > now) break;
      this.delayed.pop();
      const current = this.jobs.get(next.jobId);
      if (current?.state !== "retry_scheduled" || current.availableAt !== next.availableAt) continue;
      const { availableAt: _availableAt, ...withoutAvailableAt } = current;
      const queued: Job = Object.freeze({ ...withoutAvailableAt, state: "queued", updatedAt: now });
      this.jobs.set(queued.id, queued);
      this.ready.push({ jobId: queued.id, weight: PRIORITY_WEIGHT[queued.priority], sequence: this.sequence++ });
      promoted += 1;
    }
    return promoted;
  }

  async deadLetter(input: LeaseMutation & { now: number; failure: FailureSummary }): Promise<TransitionResult> {
    const current = this.jobs.get(input.jobId);
    if (current === undefined) return { applied: false, reason: "not_found" };
    if (current.state === "dead_lettered" || current.state === "completed") {
      return { applied: false, reason: "already_terminal" };
    }
    if (current.state !== "running") return { applied: false, reason: "invalid_state" };
    if (current.lease?.token !== input.token) return { applied: false, reason: "stale_lease" };
    const { lease: _lease, ...withoutLease } = current;
    const deadLettered: Job = Object.freeze({
      ...withoutLease,
      state: "dead_lettered",
      completedAt: input.now,
      updatedAt: input.now,
      lastFailure: input.failure
    });
    try {
      this.options.dlqWrite?.(deadLettered);
    } catch {
      this.jobs.set(current.id, Object.freeze({
        ...withoutLease,
        state: "dlq_pending",
        updatedAt: input.now,
        lastFailure: input.failure
      }));
      return { applied: false, reason: "dlq_pending" };
    }
    this.jobs.set(current.id, deadLettered);
    this.outstanding -= 1;
    return { applied: true };
  }

  async recoverExpired(now: number, limit: number): Promise<number> {
    let recovered = 0;
    for (const current of this.jobs.values()) {
      if (recovered >= limit) break;
      if (current.state !== "running" || current.lease === undefined || current.lease.expiresAt > now) continue;
      const { lease: _lease, ...withoutLease } = current;
      const queued: Job = Object.freeze({ ...withoutLease, state: "queued", updatedAt: now });
      this.jobs.set(queued.id, queued);
      this.ready.push({ jobId: queued.id, weight: PRIORITY_WEIGHT[queued.priority], sequence: this.sequence++ });
      recovered += 1;
    }
    return recovered;
  }

  async reconcileDlq(now: number, limit: number): Promise<number> {
    let reconciled = 0;
    for (const current of this.jobs.values()) {
      if (reconciled >= limit) break;
      if (current.state !== "dlq_pending") continue;
      const deadLettered: Job = Object.freeze({
        ...current, state: "dead_lettered", completedAt: now, updatedAt: now
      });
      try {
        this.options.dlqWrite?.(deadLettered);
      } catch {
        continue;
      }
      this.jobs.set(current.id, deadLettered);
      this.outstanding -= 1;
      reconciled += 1;
    }
    return reconciled;
  }

  async purgeTerminal(now: number, retentionMs: number): Promise<number> {
    let purged = 0;
    for (const [id, job] of this.jobs) {
      if ((job.state === "completed" || job.state === "dead_lettered") && now - job.updatedAt >= retentionMs) {
        this.jobs.delete(id);
        for (const [key, mappedId] of this.idempotency) if (mappedId === id) this.idempotency.delete(key);
        purged += 1;
      }
    }
    return purged;
  }

  async stats(): Promise<BackendStats> {
    let queued = 0;
    let running = 0;
    let delayed = 0;
    let dlqPending = 0;
    for (const job of this.jobs.values()) {
      if (job.state === "queued") queued += 1;
      if (job.state === "running") running += 1;
      if (job.state === "retry_scheduled") delayed += 1;
      if (job.state === "dlq_pending") dlqPending += 1;
    }
    return {
      outstanding: this.outstanding,
      queued,
      delayed,
      running,
      dlqPending,
      capacity: this.options.capacity
    };
  }

  async health(): Promise<BackendHealth> {
    return { healthy: true, durable: false };
  }
}
