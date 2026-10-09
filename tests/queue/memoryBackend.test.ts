import { QueueCapacityError } from "../../src/domain/errors.js";
import { InMemoryJobBackend } from "../../src/queue/InMemoryJobBackend.js";

describe("InMemoryJobBackend admission", () => {
  test("stores a submitted job for constant-time lookup", async () => {
    const backend = new InMemoryJobBackend({ capacity: 2, maxAttempts: 3 });

    const result = await backend.submit({
      type: "send-email",
      priority: "high",
      payload: { to: "a@b.test" }
    }, { now: 100 });

    expect(result.deduplicated).toBe(false);
    expect(await backend.get(result.job.id)).toMatchObject({
      state: "queued",
      attempts: 0,
      maxAttempts: 3
    });
  });

  test("rejects admission once outstanding work reaches capacity", async () => {
    const backend = new InMemoryJobBackend({ capacity: 1, maxAttempts: 3 });
    const input = { type: "send-email", priority: "normal" as const, payload: {} };
    await backend.submit(input, { now: 100 });

    await expect(backend.submit(input, { now: 101 })).rejects.toBeInstanceOf(QueueCapacityError);
  });
});
