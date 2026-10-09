export interface RetryPolicy {
  readonly baseMs: number;
  readonly maxMs: number;
  readonly jitterRatio: number;
}

export function calculateBackoff(retryNumber: number, policy: RetryPolicy, random: () => number): number {
  const exponent = Math.min(Math.max(0, retryNumber), 52);
  const base = Math.min(policy.maxMs, policy.baseMs * 2 ** exponent);
  const spread = base * policy.jitterRatio;
  const jittered = base - spread + 2 * spread * Math.min(1, Math.max(0, random()));
  return Math.max(0, Math.round(jittered));
}
