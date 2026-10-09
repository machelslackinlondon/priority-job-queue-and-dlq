import { QueueCapacityError } from "../../src/domain/errors.js";
import { InMemoryJobBackend } from "../../src/queue/InMemoryJobBackend.js";

test("concurrent admission never exceeds the configured capacity", async () => {
  const backend = new InMemoryJobBackend({ capacity: 25, maxAttempts: 3 });
  const settled = await Promise.allSettled(Array.from({ length: 200 }, (_, index) =>
    backend.submit({ type: `job-${index}`, priority: "normal", payload: {} }, { now: index })));
  expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(25);
  const rejected = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  expect(rejected).toHaveLength(175);
  expect(rejected.every((result) => result.reason instanceof QueueCapacityError)).toBe(true);
  expect((await backend.stats()).outstanding).toBe(25);
});
