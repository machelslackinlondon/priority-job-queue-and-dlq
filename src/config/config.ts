export type BackendKind = "memory" | "redis";

export interface AppConfig {
  readonly nodeEnv: string;
  readonly host: string;
  readonly port: number;
  readonly backend: BackendKind;
  readonly redisUrl: string;
  readonly maxBodyBytes: number;
  readonly maxPayloadBytes: number;
  readonly queueCapacity: number;
  readonly workerConcurrency: number;
  readonly jobTimeoutMs: number;
  readonly leaseDurationMs: number;
  readonly heartbeatIntervalMs: number;
  readonly maxAttempts: number;
  readonly retryBaseDelayMs: number;
  readonly retryMaxDelayMs: number;
  readonly retryJitterRatio: number;
  readonly schedulerIntervalMs: number;
  readonly dlqReconcileIntervalMs: number;
  readonly shutdownGraceMs: number;
  readonly terminalRetentionMs: number;
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function ratio(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const backend = env.JOB_BACKEND ?? "memory";
  if (backend !== "memory" && backend !== "redis") {
    throw new Error("JOB_BACKEND must be memory or redis");
  }

  const leaseDurationMs = integer(env, "LEASE_DURATION_MS", 60_000, 100, 3_600_000);
  const heartbeatIntervalMs = integer(env, "HEARTBEAT_INTERVAL_MS", 20_000, 10, 3_599_999);
  if (heartbeatIntervalMs >= leaseDurationMs) {
    throw new Error("HEARTBEAT_INTERVAL_MS must be shorter than LEASE_DURATION_MS");
  }
  const retryBaseDelayMs = integer(env, "RETRY_BASE_DELAY_MS", 500, 1, 3_600_000);
  const retryMaxDelayMs = integer(env, "RETRY_MAX_DELAY_MS", 30_000, 1, 86_400_000);
  if (retryBaseDelayMs > retryMaxDelayMs) {
    throw new Error("RETRY_BASE_DELAY_MS must not exceed RETRY_MAX_DELAY_MS");
  }

  return Object.freeze({
    nodeEnv: env.NODE_ENV ?? "development",
    host: env.HOST ?? "0.0.0.0",
    port: integer(env, "PORT", 3000, 1, 65_535),
    backend,
    redisUrl: env.REDIS_URL ?? "redis://127.0.0.1:6379",
    maxBodyBytes: integer(env, "MAX_BODY_BYTES", 1_048_576, 1_024, 16_777_216),
    maxPayloadBytes: integer(env, "MAX_PAYLOAD_BYTES", 262_144, 1, 8_388_608),
    queueCapacity: integer(env, "QUEUE_CAPACITY", 10_000, 1, 10_000_000),
    workerConcurrency: integer(env, "WORKER_CONCURRENCY", 8, 1, 1_000),
    jobTimeoutMs: integer(env, "JOB_TIMEOUT_MS", 30_000, 1, 86_400_000),
    leaseDurationMs,
    heartbeatIntervalMs,
    maxAttempts: integer(env, "MAX_ATTEMPTS", 5, 1, 100),
    retryBaseDelayMs,
    retryMaxDelayMs,
    retryJitterRatio: ratio(env, "RETRY_JITTER_RATIO", 0.2),
    schedulerIntervalMs: integer(env, "SCHEDULER_INTERVAL_MS", 100, 10, 60_000),
    dlqReconcileIntervalMs: integer(env, "DLQ_RECONCILE_INTERVAL_MS", 1_000, 10, 60_000),
    shutdownGraceMs: integer(env, "SHUTDOWN_GRACE_MS", 30_000, 100, 300_000),
    terminalRetentionMs: integer(env, "TERMINAL_RETENTION_MS", 86_400_000, 1_000, 2_592_000_000)
  });
}
