import { buildApp } from "../../src/api/app.js";
import { loadConfig } from "../../src/config/config.js";
import { InMemoryJobBackend } from "../../src/queue/InMemoryJobBackend.js";

test("concurrent-safe idempotency is visible through the HTTP contract", async () => {
  const config = loadConfig({ NODE_ENV: "test", QUEUE_CAPACITY: "1" });
  const backend = new InMemoryJobBackend({ capacity: 1, maxAttempts: 3 });
  const app = buildApp({ config, backend, now: () => 1 });
  const request = {
    method: "POST" as const, url: "/jobs", headers: { "idempotency-key": "request-1" },
    payload: { type: "send-email", priority: "normal", payload: {} }
  };
  const [first, duplicate] = await Promise.all([app.inject(request), app.inject(request)]);
  expect([first.statusCode, duplicate.statusCode].sort()).toEqual([200, 202]);
  expect(first.json().id).toBe(duplicate.json().id);
  expect((await backend.stats()).outstanding).toBe(1);
  await app.close();
});
