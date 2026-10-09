import { RedisJobBackend } from "../../src/queue/RedisJobBackend.js";

const redisUrl = process.env.REDIS_TEST_URL;
const integration = redisUrl === undefined ? describe.skip : describe;

integration("RedisJobBackend contract", () => {
  let backend: RedisJobBackend;

  beforeEach(async () => {
    backend = new RedisJobBackend({
      url: redisUrl!, namespace: `test:${crypto.randomUUID()}`, capacity: 2, maxAttempts: 3
    });
    await backend.init();
  });
  afterEach(async () => backend.close());

  test("atomically claims one owner and fences acknowledgement", async () => {
    const submitted = await backend.submit({ type: "email", priority: "high", payload: {} }, { now: 1 });
    const claims = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      backend.claim({ workerId: `w${index}`, now: 2, leaseMs: 100 })));
    const owners = claims.filter((claim) => claim !== null);
    expect(owners).toHaveLength(1);
    expect(await backend.complete({
      jobId: submitted.job.id, token: "stale", now: 3
    })).toEqual({ applied: false, reason: "stale_lease" });
  });

  test("promotes one delayed retry once under scheduler contention", async () => {
    await backend.submit({ type: "email", priority: "high", payload: {} }, { now: 1 });
    const lease = await backend.claim({ workerId: "w", now: 2, leaseMs: 100 });
    await backend.retry({
      jobId: lease!.job.id, token: lease!.token, now: 3, availableAt: 10,
      failure: { code: "DOWN", message: "down", retryable: true, failedAt: 3 }
    });
    const promoted = await Promise.all(Array.from({ length: 20 }, () => backend.promoteDue(10, 10)));
    expect(promoted.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect((await backend.stats()).queued).toBe(1);
  });
});
