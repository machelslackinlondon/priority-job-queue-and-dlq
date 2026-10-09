import { loadConfig } from "../../src/config/config.js";

describe("loadConfig", () => {
  test("rejects zero worker concurrency because it would stop all consumption", () => {
    expect(() => loadConfig({ WORKER_CONCURRENCY: "0" })).toThrow("WORKER_CONCURRENCY");
  });

  test("rejects a heartbeat interval that cannot renew before lease expiry", () => {
    expect(() => loadConfig({
      HEARTBEAT_INTERVAL_MS: "1000",
      LEASE_DURATION_MS: "1000"
    })).toThrow("HEARTBEAT_INTERVAL_MS");
  });
});
