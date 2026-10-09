import { createHash, randomUUID } from "node:crypto";
import { createClient } from "redis";
import { BackendUnavailableError, QueueCapacityError } from "../domain/errors.js";
import { PRIORITIES, type FailureSummary, type Job, type JobLease, type NewJob, type SubmitResult } from "../domain/job.js";
import type { BackendHealth, BackendStats, JobBackend, LeaseMutation, TransitionResult } from "./JobBackend.js";
import { CLAIM_SCRIPT, COMPLETE_SCRIPT, DEAD_LETTER_SCRIPT, PROMOTE_SCRIPT, RECOVER_SCRIPT, RENEW_SCRIPT, RETRY_SCRIPT, SUBMIT_SCRIPT, transitionResult } from "./redis/scripts.js";

type Client = ReturnType<typeof createClient>;

export interface RedisJobBackendOptions {
  readonly url: string; readonly namespace: string; readonly capacity: number; readonly maxAttempts: number;
}

export class RedisJobBackend implements JobBackend {
  private readonly client: Client;
  private connectionError: string | undefined;

  constructor(private readonly options: RedisJobBackendOptions) {
    this.client = createClient({ url: options.url });
    this.client.on("error", (error: Error) => { this.connectionError = error.message; });
    this.client.on("ready", () => { this.connectionError = undefined; });
  }

  private key(suffix: string): string { return `${this.options.namespace}:${suffix}`; }
  private jobKey(id: string): string { return this.key(`job:${id}`); }
  private idemKey(value?: string): string {
    return this.key(`idem:${value === undefined ? "none" : createHash("sha256").update(value).digest("hex")}`);
  }
  private async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    if (!this.client.isReady) throw new BackendUnavailableError(this.connectionError);
    return this.client.eval(script, { keys, arguments: args });
  }

  async init(): Promise<void> { if (!this.client.isOpen) await this.client.connect(); }
  async close(): Promise<void> { if (this.client.isOpen) await this.client.quit(); }

  async submit(input: NewJob, context: { now: number; idempotencyKey?: string }): Promise<SubmitResult> {
    const id = randomUUID();
    const job: Job = { ...input, id, state: "queued", attempts: 0, maxAttempts: this.options.maxAttempts, createdAt: context.now, updatedAt: context.now };
    const reply = await this.eval(SUBMIT_SCRIPT,
      [this.key("outstanding"), this.jobKey(id), this.idemKey(context.idempotencyKey), this.key(`ready:${input.priority}`)],
      [String(this.options.capacity), JSON.stringify(job), id, context.idempotencyKey === undefined ? "0" : "1"]
    ) as string[];
    if (reply[0] === "FULL") throw new QueueCapacityError();
    if (reply[0] === "DUPLICATE") {
      const existing = await this.get(reply[1]!);
      if (existing === undefined) throw new BackendUnavailableError("Idempotency mapping points to a missing job");
      return { job: existing, deduplicated: true };
    }
    return { job, deduplicated: false };
  }

  async get(id: string): Promise<Job | undefined> {
    if (!this.client.isReady) throw new BackendUnavailableError(this.connectionError);
    const raw = await this.client.get(this.jobKey(id));
    return raw === null ? undefined : JSON.parse(raw) as Job;
  }

  async claim(input: { workerId: string; now: number; leaseMs: number }): Promise<JobLease | null> {
    const token = randomUUID(); const expiresAt = input.now + input.leaseMs;
    const reply = await this.eval(CLAIM_SCRIPT,
      [...PRIORITIES.map((priority) => this.key(`ready:${priority}`)), this.key("leases")],
      [this.key("job:"), String(input.now), token, input.workerId, String(expiresAt)]
    ) as string[] | null;
    if (reply === null) return null;
    return { job: JSON.parse(reply[1]!) as Job, token, workerId: input.workerId, expiresAt };
  }

  async renew(input: LeaseMutation & { now: number; leaseMs: number }): Promise<boolean> {
    return await this.eval(RENEW_SCRIPT, [this.jobKey(input.jobId), this.key("leases")],
      [input.token, String(input.now + input.leaseMs), String(input.now), input.jobId]) === 1;
  }
  async complete(input: LeaseMutation & { now: number }): Promise<TransitionResult> {
    return transitionResult(await this.eval(COMPLETE_SCRIPT,
      [this.jobKey(input.jobId), this.key("leases"), this.key("outstanding")], [input.token, String(input.now), input.jobId]));
  }
  async retry(input: LeaseMutation & { now: number; availableAt: number; failure: FailureSummary }): Promise<TransitionResult> {
    return transitionResult(await this.eval(RETRY_SCRIPT,
      [this.jobKey(input.jobId), this.key("leases"), this.key("delayed")],
      [input.token, String(input.availableAt), String(input.now), JSON.stringify(input.failure), input.jobId]));
  }
  async deadLetter(input: LeaseMutation & { now: number; failure: FailureSummary }): Promise<TransitionResult> {
    return transitionResult(await this.eval(DEAD_LETTER_SCRIPT,
      [this.jobKey(input.jobId), this.key("leases"), this.key("dlq"), this.key("outstanding")],
      [input.token, String(input.now), JSON.stringify(input.failure), input.jobId]));
  }

  async promoteDue(now: number, limit: number): Promise<number> {
    return Number(await this.eval(PROMOTE_SCRIPT,
      [this.key("delayed"), ...PRIORITIES.map((priority) => this.key(`ready:${priority}`))],
      [this.key("job:"), String(now), String(limit)]));
  }
  async recoverExpired(now: number, limit: number): Promise<number> {
    return Number(await this.eval(RECOVER_SCRIPT,
      [this.key("leases"), ...PRIORITIES.map((priority) => this.key(`ready:${priority}`))],
      [this.key("job:"), String(now), String(limit)]));
  }
  async reconcileDlq(): Promise<number> { return 0; }
  async purgeTerminal(): Promise<number> { return 0; }
  async stats(): Promise<BackendStats> {
    const [outstanding, delayed, running, ...ready] = await Promise.all([
      this.client.get(this.key("outstanding")), this.client.zCard(this.key("delayed")), this.client.zCard(this.key("leases")),
      ...PRIORITIES.map((priority) => this.client.lLen(this.key(`ready:${priority}`)))
    ]);
    return { outstanding: Number(outstanding ?? 0), queued: ready.reduce((sum, value) => sum + value, 0), delayed, running, dlqPending: 0, capacity: this.options.capacity };
  }
  async health(): Promise<BackendHealth> { return { healthy: this.client.isReady, durable: true, ...(this.connectionError === undefined ? {} : { details: this.connectionError }) }; }
}
