import { buildApp } from "../../src/api/app.js";
import { loadConfig } from "../../src/config/config.js";
import { InMemoryJobBackend } from "../../src/queue/InMemoryJobBackend.js";

describe("job routes", () => {
  test("accepts a valid job and retrieves its status", async () => {
    const config = loadConfig({ NODE_ENV: "test", QUEUE_CAPACITY: "2" });
    const backend = new InMemoryJobBackend({ capacity: 2, maxAttempts: 3 });
    const app = buildApp({ config, backend, now: () => 100 });

    const submitted = await app.inject({
      method: "POST",
      url: "/jobs",
      payload: { type: "send-email", priority: "high", payload: { to: "a@b.test" } }
    });

    expect(submitted.statusCode).toBe(202);
    expect(submitted.headers.location).toMatch(/^\/jobs\//);
    const body = submitted.json();
    const fetched = await app.inject({ method: "GET", url: `/jobs/${body.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({ id: body.id, state: "queued" });
    await app.close();
  });

  test("returns 429 with retry guidance when the queue is full", async () => {
    const config = loadConfig({ NODE_ENV: "test", QUEUE_CAPACITY: "1" });
    const backend = new InMemoryJobBackend({ capacity: 1, maxAttempts: 3 });
    const app = buildApp({ config, backend, now: () => 100 });
    const request = { type: "send-email", priority: "normal", payload: {} };
    await app.inject({ method: "POST", url: "/jobs", payload: request });

    const response = await app.inject({ method: "POST", url: "/jobs", payload: request });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("1");
    expect(response.json()).toEqual({
      error: { code: "QUEUE_CAPACITY_EXCEEDED", message: "The job queue is at capacity" }
    });
    await app.close();
  });

  test("rejects malformed jobs and returns 404 for unknown IDs", async () => {
    const config = loadConfig({ NODE_ENV: "test" });
    const backend = new InMemoryJobBackend({ capacity: 2, maxAttempts: 3 });
    const app = buildApp({ config, backend });

    const malformed = await app.inject({
      method: "POST", url: "/jobs", payload: { type: "x", priority: "urgent", payload: {} }
    });
    const missing = await app.inject({ method: "GET", url: "/jobs/missing" });

    expect(malformed.statusCode).toBe(400);
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
