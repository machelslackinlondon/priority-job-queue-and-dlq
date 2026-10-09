import type { FailureSummary } from "../../src/domain/job.js";
import { InMemoryJobBackend } from "../../src/queue/InMemoryJobBackend.js";

describe("delayed retries", () => {
  test("does not claim a retry before it is due", async () => {
    const backend = new InMemoryJobBackend({ capacity: 1, maxAttempts: 3 });
    await backend.submit({ type: "send-email", priority: "high", payload: {} }, { now: 0 });
    const lease = await backend.claim({ workerId: "w1", now: 1, leaseMs: 1000 });
    const failure: FailureSummary = { code: "DOWN", message: "down", retryable: true, failedAt: 2 };
    await backend.retry({ jobId: lease!.job.id, token: lease!.token, now: 2, availableAt: 100, failure });

    expect(await backend.claim({ workerId: "w2", now: 99, leaseMs: 1000 })).toBeNull();
    expect(await backend.promoteDue(99, 10)).toBe(0);
    expect(await backend.promoteDue(100, 10)).toBe(1);
    expect((await backend.claim({ workerId: "w2", now: 100, leaseMs: 1000 }))?.job.attempts).toBe(2);
  });
});
