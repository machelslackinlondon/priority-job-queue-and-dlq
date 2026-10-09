import type { FastifyInstance } from "fastify";
import { buildApp } from "./api/app.js";
import type { AppConfig } from "./config/config.js";
import { NonRetryableJobError, RetryableJobError } from "./domain/errors.js";
import { DlqReconciler } from "./dlq/DlqReconciler.js";
import { JobMetrics } from "./metrics/JobMetrics.js";
import { InMemoryJobBackend } from "./queue/InMemoryJobBackend.js";
import type { JobBackend } from "./queue/JobBackend.js";
import { RedisJobBackend } from "./queue/RedisJobBackend.js";
import { Scheduler } from "./retry/Scheduler.js";
import { WorkerPool } from "./workers/WorkerPool.js";
import { HandlerRegistry } from "./workers/handlers.js";

export interface Application {
  readonly app: FastifyInstance; readonly backend: JobBackend; readonly workers: WorkerPool;
  startWorkers(): void; close(): Promise<void>;
}

function handlers(): HandlerRegistry {
  const registry = new HandlerRegistry();
  registry.register("send-email", async () => undefined);
  registry.register("generate-report", async ({ job, signal }) => {
    const delay = Math.min(60_000, Number(job.payload.delayMs ?? 100));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(new RetryableJobError("ABORTED", "Report generation aborted")); }, { once: true });
    });
  });
  registry.register("dependency-outage", async () => { throw new RetryableJobError("DEPENDENCY_DOWN", "Simulated dependency outage"); });
  registry.register("permanent-failure", async () => { throw new NonRetryableJobError("INVALID_JOB", "Simulated permanent failure"); });
  return registry;
}

export async function createApplication(config: AppConfig): Promise<Application> {
  const backend: JobBackend = config.backend === "redis"
    ? new RedisJobBackend({ url: config.redisUrl, namespace: "priority-jobs", capacity: config.queueCapacity, maxAttempts: config.maxAttempts })
    : new InMemoryJobBackend({ capacity: config.queueCapacity, maxAttempts: config.maxAttempts });
  await backend.init();
  const metrics = new JobMetrics();
  const workers = new WorkerPool({
    backend, handlers: handlers(), concurrency: config.workerConcurrency, timeoutMs: config.jobTimeoutMs,
    leaseMs: config.leaseDurationMs, heartbeatMs: config.heartbeatIntervalMs, now: Date.now,
    retryPolicy: { baseMs: config.retryBaseDelayMs, maxMs: config.retryMaxDelayMs, jitterRatio: config.retryJitterRatio },
    metrics
  });
  const scheduler = new Scheduler(backend, { intervalMs: config.schedulerIntervalMs, batchSize: 100, retentionMs: config.terminalRetentionMs, now: Date.now });
  const reconciler = new DlqReconciler(backend, config.dlqReconcileIntervalMs, Date.now);
  const app = buildApp({ config, backend, metrics });
  return {
    app, backend, workers,
    startWorkers() { workers.start(); scheduler.start(); reconciler.start(); },
    async close() {
      workers.stopClaiming(); scheduler.stop(); reconciler.stop();
      await workers.drain(); await app.close(); await backend.close();
    }
  };
}
