import { InMemoryJobBackend } from "../../src/queue/InMemoryJobBackend.js";

describe("in-memory priority scheduling", () => {
  test("claims higher priorities first and preserves FIFO within a priority", async () => {
    const backend = new InMemoryJobBackend({ capacity: 10, maxAttempts: 3 });
    const submit = (type: string, priority: "critical" | "high" | "normal" | "low") =>
      backend.submit({ type, priority, payload: {} }, { now: 100 });
    await submit("low-1", "low");
    await submit("high-1", "high");
    await submit("high-2", "high");
    await submit("critical-1", "critical");

    const types: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const lease = await backend.claim({ workerId: `worker-${index}`, now: 200, leaseMs: 1000 });
      if (lease !== null) types.push(lease.job.type);
    }

    expect(types).toEqual(["critical-1", "high-1", "high-2", "low-1"]);
  });

  test("allows only one owner when workers compete for one job", async () => {
    const backend = new InMemoryJobBackend({ capacity: 1, maxAttempts: 3 });
    await backend.submit({ type: "send-email", priority: "normal", payload: {} }, { now: 100 });

    const claims = await Promise.all(Array.from({ length: 100 }, (_, index) =>
      backend.claim({ workerId: `worker-${index}`, now: 200, leaseMs: 1000 })));

    expect(claims.filter((lease) => lease !== null)).toHaveLength(1);
  });
});
