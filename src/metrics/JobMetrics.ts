import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "@prometheus-io/client";
import type { Priority } from "../domain/job.js";
import type { BackendStats } from "../queue/JobBackend.js";

export class JobMetrics {
  readonly registry = new Registry();
  private readonly receivedCounter = new Counter({ name: "job_queue_jobs_received_total", help: "Jobs received", labelNames: ["job_type", "priority"] as const, registers: [this.registry] });
  private readonly completedCounter = new Counter({ name: "job_queue_jobs_completed_total", help: "Jobs completed", labelNames: ["job_type"] as const, registers: [this.registry] });
  private readonly failedCounter = new Counter({ name: "job_queue_jobs_failed_total", help: "Handler failures", labelNames: ["job_type", "reason"] as const, registers: [this.registry] });
  private readonly retriedCounter = new Counter({ name: "job_queue_jobs_retried_total", help: "Jobs scheduled for retry", labelNames: ["job_type"] as const, registers: [this.registry] });
  private readonly deadCounter = new Counter({ name: "job_queue_jobs_dead_lettered_total", help: "Jobs moved to DLQ", labelNames: ["job_type"] as const, registers: [this.registry] });
  private readonly rejectedCounter = new Counter({ name: "job_queue_jobs_rejected_total", help: "Submissions rejected", labelNames: ["reason"] as const, registers: [this.registry] });
  private readonly depthGauge = new Gauge({ name: "job_queue_depth", help: "Outstanding jobs", registers: [this.registry] });
  private readonly activeGauge = new Gauge({ name: "job_queue_active_workers", help: "Active workers", registers: [this.registry] });
  private readonly utilisationGauge = new Gauge({ name: "job_queue_utilisation_ratio", help: "Queue utilisation", registers: [this.registry] });
  private readonly processing = new Histogram({ name: "job_queue_processing_duration_seconds", help: "Handler duration", labelNames: ["job_type"] as const, buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 30], registers: [this.registry] });
  private readonly latency = new Histogram({ name: "job_queue_job_latency_seconds", help: "End-to-end job latency", labelNames: ["job_type"] as const, buckets: [0.01, 0.1, 0.5, 1, 5, 30, 300], registers: [this.registry] });

  constructor() { collectDefaultMetrics({ register: this.registry, prefix: "job_queue_process_" }); }
  received(type: string, priority: Priority): void { this.receivedCounter.inc({ job_type: type, priority }); }
  completed(type: string, processingSeconds: number, latencySeconds: number): void {
    this.completedCounter.inc({ job_type: type }); this.processing.observe({ job_type: type }, processingSeconds); this.latency.observe({ job_type: type }, latencySeconds);
  }
  failed(type: string, reason: string): void { this.failedCounter.inc({ job_type: type, reason }); }
  retried(type: string): void { this.retriedCounter.inc({ job_type: type }); }
  deadLettered(type: string): void { this.deadCounter.inc({ job_type: type }); }
  rejected(reason: string): void { this.rejectedCounter.inc({ reason }); }
  setQueue(stats: BackendStats, activeWorkers: number): void {
    this.depthGauge.set(stats.outstanding); this.activeGauge.set(activeWorkers);
    this.utilisationGauge.set(stats.capacity === 0 ? 1 : stats.outstanding / stats.capacity);
  }
  exposition(): Promise<string> { return this.registry.metrics(); }
  get contentType(): string { return this.registry.contentType; }
}
