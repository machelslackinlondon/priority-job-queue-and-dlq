import { InMemoryJobBackend } from "../../src/queue/InMemoryJobBackend.js";

test("a stale worker cannot acknowledge a reclaimed job", async () => {
  const backend = new InMemoryJobBackend({ capacity: 1, maxAttempts: 3 });
  await backend.submit({ type: "send-email", priority: "normal", payload: {} }, { now: 0 });
  const oldLease = await backend.claim({ workerId: "old", now: 1, leaseMs: 10 });
  expect(await backend.recoverExpired(11, 10)).toBe(1);
  const newLease = await backend.claim({ workerId: "new", now: 12, leaseMs: 10 });
  expect(newLease?.token).not.toBe(oldLease?.token);
  await expect(backend.complete({ jobId: oldLease!.job.id, token: oldLease!.token, now: 13 }))
    .resolves.toEqual({ applied: false, reason: "stale_lease" });
});
