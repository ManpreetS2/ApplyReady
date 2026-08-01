import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "127.0.0.1",
  repoRoot,
  dataDir: process.env.APPLYREADY_DATA_DIR ?? path.join(repoRoot, "data"),
  uploadsDir:
    process.env.APPLYREADY_UPLOADS_DIR ?? path.join(repoRoot, "uploads"),
  dbPath:
    process.env.APPLYREADY_DB_PATH ??
    path.join(repoRoot, "data", "applyready.sqlite"),
  clientDist:
    process.env.APPLYREADY_CLIENT_DIST ??
    path.join(repoRoot, "packages/client/dist"),
  isTest: process.env.NODE_ENV === "test" || process.env.VITEST === "true",
};
