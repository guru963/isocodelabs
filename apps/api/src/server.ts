import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";

const config = loadConfig();
const runtime = createRuntime(config);

// A long-running server does its background work on timers.
runtime.aiQueue.start();
runtime.notifier.start();
const server = runtime.app.listen(config.PORT, () => {
  console.log(`API listening on port ${config.PORT}`);
});

async function shutdown() {
  runtime.aiQueue.stop();
  runtime.notifier.stop();
  server.close();
  await runtime.close();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
