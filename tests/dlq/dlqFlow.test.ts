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

test("preserves a job for reconciliation when DLQ insertion fails", async () => {
  let failInsertion = true;
  const backend = new InMemoryJobBackend({
    capacity: 1, maxAttempts: 1,
    dlqWrite: () => { if (failInsertion) throw new Error("DLQ unavailable"); }
  });
  await backend.submit({ type: "bad", priority: "normal", payload: {} }, { now: 0 });
  const lease = await backend.claim({ workerId: "w", now: 1, leaseMs: 10 });
  const failure: FailureSummary = { code: "BAD", message: "bad", retryable: false, failedAt: 2 };

  expect(await backend.deadLetter({ jobId: lease!.job.id, token: lease!.token, now: 2, failure }))
    .toEqual({ applied: false, reason: "dlq_pending" });
  expect((await backend.get(lease!.job.id))?.state).toBe("dlq_pending");
  expect((await backend.stats()).outstanding).toBe(1);

  failInsertion = false;
  expect(await backend.reconcileDlq(3, 10)).toBe(1);
  expect((await backend.get(lease!.job.id))?.state).toBe("dead_lettered");
  expect((await backend.stats()).outstanding).toBe(0);
});
