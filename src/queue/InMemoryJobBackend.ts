import { randomUUID } from "node:crypto";
import { QueueCapacityError } from "../domain/errors.js";
import type { Job, NewJob, SubmitResult } from "../domain/job.js";
import type { BackendHealth, BackendStats } from "./JobBackend.js";

export interface InMemoryJobBackendOptions {
  readonly capacity: number;
  readonly maxAttempts: number;
}

export class InMemoryJobBackend {
  private readonly jobs = new Map<string, Job>();
  private outstanding = 0;

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
    this.outstanding += 1;
    return { job, deduplicated: false };
  }

  async get(id: string): Promise<Job | undefined> {
    return this.jobs.get(id);
  }

  async stats(): Promise<BackendStats> {
    return {
      outstanding: this.outstanding,
      queued: this.outstanding,
      delayed: 0,
      running: 0,
      dlqPending: 0,
      capacity: this.options.capacity
    };
  }

  async health(): Promise<BackendHealth> {
    return { healthy: true, durable: false };
  }
}
