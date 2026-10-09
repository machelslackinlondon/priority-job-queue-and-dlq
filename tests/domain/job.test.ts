import { toPublicJob, type Job } from "../../src/domain/job.js";

describe("toPublicJob", () => {
  test("does not expose internal lease ownership or failure stacks", () => {
    const job: Job = {
      id: "job-1",
      type: "send-email",
      payload: { to: "a@b.test" },
      priority: "normal",
      state: "running",
      attempts: 1,
      maxAttempts: 3,
      createdAt: 100,
      updatedAt: 200,
      lastFailure: {
        code: "DEPENDENCY_DOWN",
        message: "mail service unavailable",
        retryable: true,
        failedAt: 180
      },
      lease: {
        token: "secret-token",
        workerId: "worker-1",
        expiresAt: 300
      }
    };

    const publicJob = toPublicJob(job);

    expect(publicJob).not.toHaveProperty("lease");
    expect(JSON.stringify(publicJob)).not.toContain("secret-token");
    expect(publicJob.lastFailure).toEqual({
      code: "DEPENDENCY_DOWN",
      message: "mail service unavailable",
      retryable: true,
      failedAt: 180
    });
  });
});
