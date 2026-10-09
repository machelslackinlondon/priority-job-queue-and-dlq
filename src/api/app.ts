import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "../config/config.js";
import type { JobApiBackend } from "../queue/JobBackend.js";
import { registerJobRoutes } from "./routes/jobs.js";

export interface BuildAppOptions {
  readonly config: AppConfig;
  readonly backend?: JobApiBackend;
  readonly now?: () => number;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    bodyLimit: options.config.maxBodyBytes,
    logger: options.config.nodeEnv === "test" ? false : true
  });

  app.get("/health", async () => ({
    live: true,
    ready: true,
    backend: options.config.backend
  }));

  if (options.backend !== undefined) {
    registerJobRoutes(app, {
      backend: options.backend,
      maxPayloadBytes: options.config.maxPayloadBytes,
      now: options.now ?? Date.now
    });
  }

  return app;
}
