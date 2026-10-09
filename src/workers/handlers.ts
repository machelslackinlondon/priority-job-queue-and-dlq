import type { Job } from "../domain/job.js";

export interface JobHandlerContext {
  readonly job: Job;
  readonly signal: AbortSignal;
}

export type JobHandler = (context: JobHandlerContext) => Promise<void>;

export class HandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(type: string, handler: JobHandler): void {
    if (this.handlers.has(type)) throw new Error(`Handler already registered for ${type}`);
    this.handlers.set(type, handler);
  }

  get(type: string): JobHandler | undefined {
    return this.handlers.get(type);
  }
}
