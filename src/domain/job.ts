export const PRIORITIES = ["critical", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_WEIGHT: Readonly<Record<Priority, number>> = Object.freeze({
  critical: 4,
  high: 3,
  normal: 2,
  low: 1
});

export type JobState =
  | "queued"
  | "running"
  | "retry_scheduled"
  | "dlq_pending"
  | "completed"
  | "dead_lettered";

export interface FailureSummary {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly failedAt: number;
}

export interface LeaseRecord {
  readonly token: string;
  readonly workerId: string;
  readonly expiresAt: number;
}

export interface NewJob {
  readonly type: string;
  readonly priority: Priority;
  readonly payload: Record<string, unknown>;
}

export interface Job extends NewJob {
  readonly id: string;
  readonly state: JobState;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly availableAt?: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly lastFailure?: FailureSummary;
  readonly lease?: LeaseRecord;
}

export interface PublicJob extends Omit<Job, "lease"> {}

export interface JobLease {
  readonly job: Job;
  readonly token: string;
  readonly workerId: string;
  readonly expiresAt: number;
}

export interface SubmitResult {
  readonly job: Job;
  readonly deduplicated: boolean;
}

export function toPublicJob(job: Job): PublicJob {
  const { lease: _lease, ...publicJob } = job;
  return publicJob;
}
