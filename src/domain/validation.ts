import { JobValidationError } from "./errors.js";
import { PRIORITIES, type NewJob, type Priority } from "./job.js";

const INPUT_FIELDS = new Set(["type", "priority", "payload"]);
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function validateJson(value: unknown, seen: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new JobValidationError("payload numbers must be finite");
    return;
  }
  if (typeof value !== "object") throw new JobValidationError("payload must contain only JSON values");
  if (seen.has(value)) throw new JobValidationError("payload must not contain cycles");
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) throw new JobValidationError(`payload field ${key} is not allowed`);
    validateJson(child, seen);
  }
  seen.delete(value);
}

export function validateNewJob(value: unknown, maxPayloadBytes: number): NewJob {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new JobValidationError("job body must be an object");
  }
  const input = value as Record<string, unknown>;
  const extra = Object.keys(input).find((key) => !INPUT_FIELDS.has(key));
  if (extra !== undefined) throw new JobValidationError(`unsupported job field: ${extra}`);
  if (typeof input.type !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(input.type)) {
    throw new JobValidationError("type must be a lower-case job name up to 64 characters");
  }
  if (typeof input.priority !== "string" || !PRIORITIES.includes(input.priority as Priority)) {
    throw new JobValidationError("priority must be critical, high, normal, or low");
  }
  if (input.payload === null || typeof input.payload !== "object" || Array.isArray(input.payload)) {
    throw new JobValidationError("payload must be a JSON object");
  }
  validateJson(input.payload, new Set());
  const bytes = Buffer.byteLength(JSON.stringify(input.payload), "utf8");
  if (bytes > maxPayloadBytes) {
    throw new JobValidationError(`payload exceeds ${maxPayloadBytes} bytes`);
  }
  return {
    type: input.type,
    priority: input.priority as Priority,
    payload: structuredClone(input.payload as Record<string, unknown>)
  };
}
