import type Database from "better-sqlite3";
import { config } from "../../config.js";
import { Repositories } from "../../db/repositories.js";
import { deleteFileQuietly, resolveUploadPath } from "../../utils/files.js";

export type CleanupResult = {
  deleted: number;
  failed: number;
};

/**
 * Deletes demo applications whose updatedAt is older than the configured TTL.
 * Never deletes non-demo applications. Failures are logged and skipped.
 */
export function cleanupStaleDemoApplications(
  db: Database.Database,
  now = new Date(),
): CleanupResult {
  const repos = new Repositories(db);
  const ttlMs = Math.max(1, config.publicDemoTtlHours) * 60 * 60 * 1000;
  const cutoffIso = new Date(now.getTime() - ttlMs).toISOString();
  const stale = repos.listStaleDemoApplications(cutoffIso);

  let deleted = 0;
  let failed = 0;

  for (const app of stale) {
    try {
      const docs = repos.deleteApplication(app.id);
      for (const doc of docs) {
        deleteFileQuietly(resolveUploadPath("applications", doc.storedFilename));
      }
      deleted += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(
        `[applyready] stale demo cleanup failed for ${app.id}: ${message}`,
      );
    }
  }

  if (deleted > 0 || failed > 0) {
    console.info(
      `[applyready] stale demo cleanup: deleted=${deleted} failed=${failed} cutoff=${cutoffIso}`,
    );
  }

  return { deleted, failed };
}
