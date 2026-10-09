import { buildApp } from "../../src/api/app.js";
import { loadConfig } from "../../src/config/config.js";
import { JobMetrics } from "../../src/metrics/JobMetrics.js";
import { InMemoryJobBackend } from "../../src/queue/InMemoryJobBackend.js";

test("exposes metrics and detailed backend-aware health", async () => {
  const backend = new InMemoryJobBackend({ capacity: 10, maxAttempts: 3 });
  const metrics = new JobMetrics();
  const app = buildApp({ config: loadConfig({ NODE_ENV: "test" }), backend, metrics });
  const health = await app.inject({ method: "GET", url: "/health" });
  const exposition = await app.inject({ method: "GET", url: "/metrics" });
  expect(health.json()).toMatchObject({ live: true, ready: true, durable: false, queueCapacity: 10 });
  expect(exposition.statusCode).toBe(200);
  expect(exposition.headers["content-type"]).toContain("text/plain");
  await app.close();
});
