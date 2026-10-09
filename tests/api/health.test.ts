import { buildApp } from "../../src/api/app.js";
import { loadConfig } from "../../src/config/config.js";

describe("GET /health", () => {
  test("reports a ready in-memory service", async () => {
    const app = buildApp({ config: loadConfig({ NODE_ENV: "test" }) });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      live: true,
      ready: true,
      backend: "memory"
    });
    await app.close();
  });
});
