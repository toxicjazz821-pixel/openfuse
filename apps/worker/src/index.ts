import { existsSync } from "node:fs";
import { createWorkerServer } from "./server.ts";

const token = process.env.WORKER_TOKEN ?? "";
const defaultDataDir = ".openfuse/browser-profiles";
// Legacy name, kept so existing installs keep working.
const legacyDataDir = ".openmuse/browser-profiles";
const worker = await createWorkerServer({
  token,
  dataDir:
    process.env.WORKER_DATA_DIR ??
    (!existsSync(defaultDataDir) && existsSync(legacyDataDir) ? legacyDataDir : defaultDataDir),
  maxSessions: 3,
  idleTimeoutMs: 30 * 60_000,
});
const workerPort = Number(process.env.PORT ?? "8790");
worker.server.listen(workerPort, process.env.WORKER_HOST ?? "127.0.0.1", () => {
  console.log(`OpenFuse browser worker listening on port ${workerPort}`);
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 30_000);
  deadline.unref();
  await worker.close();
  process.exit(0);
}
process.on("SIGTERM", () => {
  void stop();
});
process.on("SIGINT", () => {
  void stop();
});
