import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "../config/config.js";
import type { JobApiBackend } from "../queue/JobBackend.js";
import type { JobMetrics } from "../metrics/JobMetrics.js";
import { registerJobRoutes } from "./routes/jobs.js";

export interface BuildAppOptions {
  readonly config: AppConfig;
  readonly backend?: JobApiBackend;
  readonly now?: () => number;
  readonly metrics?: JobMetrics;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    bodyLimit: options.config.maxBodyBytes,
    logger: options.config.nodeEnv === "test" ? false : true
  });

  app.get("/health", async (_request, reply) => {
    if (options.backend === undefined) return { live: true, ready: true, backend: options.config.backend };
    const [health, stats] = await Promise.all([options.backend.health(), options.backend.stats()]);
    const body = {
      live: true, ready: health.healthy, backend: options.config.backend, durable: health.durable,
      queueDepth: stats.outstanding, queueCapacity: stats.capacity,
      queueUtilisation: stats.capacity === 0 ? 1 : stats.outstanding / stats.capacity,
      ...(health.details === undefined ? {} : { reasons: [health.details] })
    };
    return reply.code(health.healthy ? 200 : 503).send(body);
  });

  if (options.metrics !== undefined) {
    app.get("/metrics", async (_request, reply) => {
      reply.header("Content-Type", options.metrics!.contentType);
      return reply.send(await options.metrics!.exposition());
    });
  }

  if (options.backend !== undefined) {
    registerJobRoutes(app, {
      backend: options.backend,
      maxPayloadBytes: options.config.maxPayloadBytes,
      now: options.now ?? Date.now,
      ...(options.metrics === undefined ? {} : { metrics: options.metrics })
    });
  }

  return app;
}
