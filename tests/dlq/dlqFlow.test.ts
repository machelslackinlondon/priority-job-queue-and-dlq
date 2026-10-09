import type { FailureSummary } from "../../src/domain/job.js";
import { InMemoryJobBackend } from "../../src/queue/InMemoryJobBackend.js";

test("dead-lettering releases capacity once", async () => {
  const backend = new InMemoryJobBackend({ capacity: 1, maxAttempts: 1 });
  await backend.submit({ type: "bad", priority: "normal", payload: {} }, { now: 0 });
  const lease = await backend.claim({ workerId: "w", now: 1, leaseMs: 10 });
  const failure: FailureSummary = { code: "BAD", message: "bad", retryable: false, failedAt: 2 };
  expect(await backend.deadLetter({ jobId: lease!.job.id, token: lease!.token, now: 2, failure }))
    .toEqual({ applied: true });
  expect((await backend.stats()).outstanding).toBe(0);
  expect((await backend.get(lease!.job.id))?.state).toBe("dead_lettered");
});
