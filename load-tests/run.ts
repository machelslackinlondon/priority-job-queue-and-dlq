import autocannon from "autocannon";
import { scenarios, type ScenarioName } from "./scenarios.js";

const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((pairs, value, index, all) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1] ?? "true"]);
  return pairs;
}, []));
const name = (args.scenario ?? "steady") as ScenarioName;
const scenario = scenarios[name];
if (scenario === undefined) throw new Error(`Unknown scenario: ${name}`);
const baseUrl = args.url ?? "http://127.0.0.1:3000";
const samples: Array<{ at: number; metrics: string }> = [];
const sampler = setInterval(async () => {
  try { samples.push({ at: Date.now(), metrics: await (await fetch(`${baseUrl}/metrics`)).text() }); } catch { /* reported by autocannon */ }
}, 1000);

const result = await autocannon({
  url: `${baseUrl}/jobs`, method: "POST", connections: scenario.connections, duration: scenario.duration,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: scenario.type, priority: scenario.priority, payload: "delayMs" in scenario ? { delayMs: scenario.delayMs } : {} })
});
clearInterval(sampler);
process.stdout.write(`${JSON.stringify({ scenario: name, requests: result.requests, latency: result.latency, throughput: result.throughput, errors: result.errors, non2xx: result.non2xx, metricSamples: samples.length }, null, 2)}\n`);
