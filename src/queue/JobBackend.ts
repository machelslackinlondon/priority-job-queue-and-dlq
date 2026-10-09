import type { FailureSummary, Job, JobLease, NewJob, SubmitResult } from "../domain/job.js";

export interface LeaseMutation {
  readonly jobId: string;
  readonly token: string;
}

export interface TransitionResult {
  readonly applied: boolean;
  readonly reason?: "stale_lease" | "invalid_state" | "already_terminal" | "not_found" | "dlq_pending";
}

export interface BackendStats {
  readonly outstanding: number;
  readonly queued: number;
  readonly delayed: number;
  readonly running: number;
  readonly dlqPending: number;
  readonly capacity: number;
}

export interface BackendHealth {
  readonly healthy: boolean;
  readonly durable: boolean;
  readonly details?: string;
}

export interface JobBackend {
  init(): Promise<void>;
  close(): Promise<void>;
  submit(input: NewJob, context: { now: number; idempotencyKey?: string }): Promise<SubmitResult>;
  get(id: string): Promise<Job | undefined>;
  claim(input: { workerId: string; now: number; leaseMs: number }): Promise<JobLease | null>;
  renew(input: LeaseMutation & { now: number; leaseMs: number }): Promise<boolean>;
  complete(input: LeaseMutation & { now: number }): Promise<TransitionResult>;
  retry(input: LeaseMutation & { now: number; availableAt: number; failure: FailureSummary }): Promise<TransitionResult>;
  deadLetter(input: LeaseMutation & { now: number; failure: FailureSummary }): Promise<TransitionResult>;
  promoteDue(now: number, limit: number): Promise<number>;
  recoverExpired(now: number, limit: number): Promise<number>;
  reconcileDlq(now: number, limit: number): Promise<number>;
  stats(): Promise<BackendStats>;
  health(): Promise<BackendHealth>;
  purgeTerminal(now: number, retentionMs: number): Promise<number>;
}

export type JobApiBackend = Pick<JobBackend, "submit" | "get" | "health" | "stats">;
