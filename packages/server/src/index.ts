import { config } from "./config.js";
import { createApp } from "./app.js";
import { ensureDirectories, getDb, closeDb } from "./db/database.js";
import { cleanupStaleDemoApplications } from "./services/demo/cleanup.js";

ensureDirectories();
const db = getDb();
const app = createApp(db);

const server = app.listen(config.port, config.host, () => {
  console.log(
    `ApplyReady listening on http://${config.host}:${config.port}`,
  );
  if (config.publicDemoMode) {
    console.log("Mode: public-demo (uploads and vault disabled)");
  } else {
    console.log(`Data directory: ${config.dataDir}`);
    console.log(`Uploads directory: ${config.uploadsDir}`);
  }
});

let cleanupTimer: NodeJS.Timeout | null = null;
if (config.publicDemoCleanupIntervalMs > 0) {
  cleanupTimer = setInterval(() => {
    try {
      cleanupStaleDemoApplications(db);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`[applyready] scheduled demo cleanup failed: ${message}`);
    }
  }, config.publicDemoCleanupIntervalMs);
  cleanupTimer.unref?.();
}

function shutdown(signal: string) {
  console.log(`[applyready] shutting down (${signal})`);
  if (cleanupTimer) clearInterval(cleanupTimer);
  server.close(() => {
    try {
      closeDb();
    } catch {
      // ignore
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
