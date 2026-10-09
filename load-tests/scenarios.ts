export const scenarios = {
  steady: { connections: 10, duration: 20, type: "send-email", priority: "normal" },
  burst: { connections: 100, duration: 10, type: "send-email", priority: "high" },
  overload: { connections: 250, duration: 20, type: "generate-report", priority: "normal", delayMs: 1000 },
  "slow-worker": { connections: 50, duration: 20, type: "generate-report", priority: "normal", delayMs: 5000 },
  "dependency-outage": { connections: 50, duration: 20, type: "dependency-outage", priority: "high" },
  "retry-storm": { connections: 150, duration: 20, type: "dependency-outage", priority: "critical" },
  "high-concurrency": { connections: 500, duration: 15, type: "send-email", priority: "normal" }
} as const;

export type ScenarioName = keyof typeof scenarios;
