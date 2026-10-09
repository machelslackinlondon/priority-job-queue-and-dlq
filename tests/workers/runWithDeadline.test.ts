import { runWithDeadline } from "../../src/workers/runWithDeadline.js";

describe("runWithDeadline", () => {
  test("aborts work that exceeds its deadline", async () => {
    jest.useFakeTimers();
    let observedAbort = false;
    const execution = runWithDeadline(async (signal) => {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => {
        observedAbort = signal.aborted;
        resolve();
      }));
    }, 100);
    const assertion = expect(execution).rejects.toMatchObject({ code: "JOB_TIMEOUT" });

    await jest.advanceTimersByTimeAsync(100);

    await assertion;
    expect(observedAbort).toBe(true);
    jest.useRealTimers();
  });
});
