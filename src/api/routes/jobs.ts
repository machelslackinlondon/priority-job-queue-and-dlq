import type { FastifyInstance } from "fastify";
import { BackendUnavailableError, JobValidationError, QueueCapacityError } from "../../domain/errors.js";
import { toPublicJob } from "../../domain/job.js";
import { validateNewJob } from "../../domain/validation.js";
import type { JobApiBackend } from "../../queue/JobBackend.js";
import type { JobMetrics } from "../../metrics/JobMetrics.js";
import { errorResponse } from "../errorResponse.js";

export interface JobRouteOptions {
  readonly backend: JobApiBackend;
  readonly maxPayloadBytes: number;
  readonly now: () => number;
  readonly metrics?: JobMetrics;
}

export function registerJobRoutes(app: FastifyInstance, options: JobRouteOptions): void {
  app.post("/jobs", async (request, reply) => {
    try {
      const input = validateNewJob(request.body, options.maxPayloadBytes);
      options.metrics?.received(input.type, input.priority);
      const idempotencyHeader = request.headers["idempotency-key"];
      const idempotencyKey = Array.isArray(idempotencyHeader) ? idempotencyHeader[0] : idempotencyHeader;
      const context = idempotencyKey === undefined
        ? { now: options.now() }
        : { now: options.now(), idempotencyKey };
      const result = await options.backend.submit(input, context);
      options.metrics?.setQueue(await options.backend.stats(), 0);
      reply.header("Location", `/jobs/${result.job.id}`);
      return reply.code(result.deduplicated ? 200 : 202).send({
        id: result.job.id,
        state: result.job.state,
        deduplicated: result.deduplicated,
        statusUrl: `/jobs/${result.job.id}`
      });
    } catch (error) {
      if (error instanceof JobValidationError) {
        return reply.code(400).send(errorResponse(error.code, error.message));
      }
      if (error instanceof QueueCapacityError) {
        options.metrics?.rejected("capacity");
        reply.header("Retry-After", "1");
        return reply.code(429).send(errorResponse(error.code, error.message));
      }
      if (error instanceof BackendUnavailableError) {
        return reply.code(503).send(errorResponse(error.code, error.message));
      }
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/jobs/:id", async (request, reply) => {
    const job = await options.backend.get(request.params.id);
    if (job === undefined) {
      return reply.code(404).send(errorResponse("JOB_NOT_FOUND", "Job not found"));
    }
    return reply.send(toPublicJob(job));
  });
}
