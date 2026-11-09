import { waitUntil } from "@vercel/functions";
import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";

/**
 * The API as one Vercel Function. There are no timers here, because a function only runs while
 * it answers a request: AI work finishes under waitUntil, and a scheduler calls /api/tasks/run
 * for anything left over and for the reminders.
 */
// Only /tmp is writable in a function, so an UPLOAD_DIR copied from a local .env is ignored here.
const config = loadConfig({ ...process.env, UPLOAD_DIR: "/tmp/uploads" });
if (!config.BLOB_STORE_ID && !config.BLOB_READ_WRITE_TOKEN) {
  console.warn("No Blob store is connected: photos and voice notes are lost when the function restarts");
}
if (!config.CRON_SECRET) console.warn("CRON_SECRET is not set: reminders and AI retries will not run");

const { app } = createRuntime(config, waitUntil);

export default app;
