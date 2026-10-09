import { InMemoryJobBackend } from "../../src/queue/InMemoryJobBackend.js";

test("concurrent duplicate submissions consume one capacity slot", async () => {
  const backend = new InMemoryJobBackend({ capacity: 1, maxAttempts: 3 });
  const input = { type: "send-email", priority: "normal" as const, payload: {} };
  const results = await Promise.all(Array.from({ length: 100 }, () =>
    backend.submit(input, { now: 1, idempotencyKey: "same-request" })));
  expect(new Set(results.map((result) => result.job.id)).size).toBe(1);
  expect(results.filter((result) => !result.deduplicated)).toHaveLength(1);
  expect((await backend.stats()).outstanding).toBe(1);
});
