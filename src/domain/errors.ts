export class JobValidationError extends Error {
  readonly code = "JOB_VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "JobValidationError";
  }
}

export class QueueCapacityError extends Error {
  readonly code = "QUEUE_CAPACITY_EXCEEDED";

  constructor() {
    super("The job queue is at capacity");
    this.name = "QueueCapacityError";
  }
}

export class BackendUnavailableError extends Error {
  readonly code = "BACKEND_UNAVAILABLE";

  constructor(message = "The job backend is unavailable") {
    super(message);
    this.name = "BackendUnavailableError";
  }
}

export class RetryableJobError extends Error {
  readonly retryable = true;

  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RetryableJobError";
  }
}

export class NonRetryableJobError extends Error {
  readonly retryable = false;

  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "NonRetryableJobError";
  }
}
