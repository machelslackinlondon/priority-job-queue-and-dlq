import { createApplication } from "../../src/application.js";
import { loadConfig } from "../../src/config/config.js";

test("composition root wires the default in-memory backend into the API", async () => {
  const application = await createApplication(loadConfig({ NODE_ENV: "test", WORKER_CONCURRENCY: "1" }));
  const response = await application.app.inject({
    method: "POST", url: "/jobs", payload: { type: "send-email", priority: "normal", payload: { to: "a@b.test" } }
  });
  expect(response.statusCode).toBe(202);
  await application.close();
});
