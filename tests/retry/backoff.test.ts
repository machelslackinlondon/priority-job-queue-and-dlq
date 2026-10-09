import { calculateBackoff } from "../../src/retry/backoff.js";

describe("calculateBackoff", () => {
  const policy = { baseMs: 100, maxMs: 1000, jitterRatio: 0.25 };

  test("caps exponential growth before it can amplify an outage", () => {
    expect(calculateBackoff(0, { ...policy, jitterRatio: 0 }, () => 0.5)).toBe(100);
    expect(calculateBackoff(4, { ...policy, jitterRatio: 0 }, () => 0.5)).toBe(1000);
    expect(calculateBackoff(1000, { ...policy, jitterRatio: 0 }, () => 0.5)).toBe(1000);
  });

  test("spreads retries symmetrically within the configured jitter range", () => {
    expect(calculateBackoff(2, policy, () => 0)).toBe(300);
    expect(calculateBackoff(2, policy, () => 1)).toBe(500);
  });
});
