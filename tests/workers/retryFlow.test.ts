import { NonRetryableJobError, RetryableJobError } from "../../src/domain/errors.js";
import { InMemoryJobBackend } from "../../src/queue/InMemoryJobBackend.js";
import { WorkerPool } from "../../src/workers/WorkerPool.js";
import { HandlerRegistry } from "../../src/workers/handlers.js";

function poolFor(backend: InMemoryJobBackend, handlers: HandlerRegistry): WorkerPool {
  return new WorkerPool({
    backend, handlers, concurrency: 1, timeoutMs: 1000, leaseMs: 5000, heartbeatMs: 1000,
    now: () => 10, retryPolicy: { baseMs: 100, maxMs: 1000, jitterRatio: 0 }, random: () => 0.5
  });
}

test("schedules retryable failures instead of retrying immediately", async () => {
  const backend = new InMemoryJobBackend({ capacity: 1, maxAttempts: 3 });
  const submitted = await backend.submit({ type: "outage", priority: "normal", payload: {} }, { now: 0 });
  const handlers = new HandlerRegistry();
  handlers.register("outage", async () => { throw new RetryableJobError("DOWN", "dependency down"); });
  await expect(poolFor(backend, handlers).runOne("w")).resolves.toBe(true);
  expect(await backend.get(submitted.job.id)).toMatchObject({ state: "retry_scheduled", availableAt: 110 });
});

test("dead-letters a non-retryable failure", async () => {
  const backend = new InMemoryJobBackend({ capacity: 1, maxAttempts: 3 });
  const submitted = await backend.submit({ type: "invalid", priority: "normal", payload: {} }, { now: 0 });
  const handlers = new HandlerRegistry();
  handlers.register("invalid", async () => { throw new NonRetryableJobError("INVALID", "bad input"); });
  await expect(poolFor(backend, handlers).runOne("w")).resolves.toBe(true);
  expect((await backend.get(submitted.job.id))?.state).toBe("dead_lettered");
});

test("dead-letters an unregistered job type instead of abandoning its lease", async () => {
  const backend = new InMemoryJobBackend({ capacity: 1, maxAttempts: 3 });
  const submitted = await backend.submit({ type: "missing", priority: "normal", payload: {} }, { now: 0 });
  const handlers = new HandlerRegistry();
  await expect(poolFor(backend, handlers).runOne("w")).resolves.toBe(true);
  expect(await backend.get(submitted.job.id)).toMatchObject({
    state: "dead_lettered", lastFailure: { code: "UNKNOWN_JOB_TYPE", retryable: false }
  });
});
