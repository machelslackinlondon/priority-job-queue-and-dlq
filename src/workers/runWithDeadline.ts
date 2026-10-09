import { RetryableJobError } from "../domain/errors.js";

export async function runWithDeadline(
  operation: (signal: AbortSignal) => Promise<void>,
  timeoutMs: number
): Promise<void> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const operationPromise = operation(controller.signal);
  operationPromise.catch(() => undefined);
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new RetryableJobError("JOB_TIMEOUT", `Job exceeded ${timeoutMs}ms deadline`));
      controller.abort();
    }, timeoutMs);
  });
  try {
    await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
