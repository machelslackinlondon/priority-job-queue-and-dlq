import { createApplication } from "./application.js";
import { loadConfig } from "./config/config.js";

const config = loadConfig();
const application = await createApplication(config);
application.startWorkers();
await application.app.listen({ host: config.host, port: config.port });

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), config.shutdownGraceMs);
  deadline.unref();
  await application.close();
  clearTimeout(deadline);
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
