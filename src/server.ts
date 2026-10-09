import { buildApp } from "./api/app.js";
import { loadConfig } from "./config/config.js";

const config = loadConfig();
const app = buildApp({ config });

await app.listen({ host: config.host, port: config.port });
