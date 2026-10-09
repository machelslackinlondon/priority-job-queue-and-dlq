import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "../config/config.js";

export interface BuildAppOptions {
  readonly config: AppConfig;
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

  return app;
}
