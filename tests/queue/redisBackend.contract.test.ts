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
});
