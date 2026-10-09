import { InMemoryJobBackend } from "../../src/queue/InMemoryJobBackend.js";
import { HandlerRegistry } from "../../src/workers/handlers.js";
import { WorkerPool } from "../../src/workers/WorkerPool.js";

describe("WorkerPool", () => {
  test("completes a successfully handled job", async () => {
    const backend = new InMemoryJobBackend({ capacity: 2, maxAttempts: 3 });
    const submitted = await backend.submit({ type: "ok", priority: "normal", payload: {} }, { now: 1 });
    const handlers = new HandlerRegistry();
    handlers.register("ok", async () => undefined);
    const pool = new WorkerPool({
      backend, handlers, concurrency: 1, timeoutMs: 1000, leaseMs: 5000, heartbeatMs: 1000, now: () => 10
    });

    await pool.runUntilIdle();

    expect(await backend.get(submitted.job.id)).toMatchObject({ state: "completed", attempts: 1 });
  });

  test("never runs more handlers than configured concurrency", async () => {
    const backend = new InMemoryJobBackend({ capacity: 10, maxAttempts: 3 });
    for (let index = 0; index < 6; index += 1) {
      await backend.submit({ type: "held", priority: "normal", payload: { index } }, { now: index });
    }
    let active = 0;
    let maximum = 0;
    const handlers = new HandlerRegistry();
    handlers.register("held", async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });
    const pool = new WorkerPool({
      backend, handlers, concurrency: 2, timeoutMs: 1000, leaseMs: 5000, heartbeatMs: 1000, now: Date.now
    });

    await pool.runUntilIdle();

    expect(maximum).toBe(2);
    expect(pool.activeCount).toBe(0);
  });
});
