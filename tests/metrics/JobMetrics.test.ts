import { JobMetrics } from "../../src/metrics/JobMetrics.js";

test("exports low-cardinality queue and lifecycle metrics", async () => {
  const metrics = new JobMetrics();
  metrics.received("send-email", "high");
  metrics.completed("send-email", 0.25, 0.5);
  metrics.setQueue({ outstanding: 2, queued: 1, delayed: 0, running: 1, dlqPending: 0, capacity: 10 }, 1);
  const text = await metrics.exposition();
  expect(text).toContain("job_queue_jobs_received_total");
  expect(text).toContain("job_queue_depth 2");
  expect(text).not.toContain("job-id");
});
