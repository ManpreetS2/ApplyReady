import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

function envFlag(name: string, defaultValue = false): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function envNumber(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

const defaultDevOrigins = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:8787",
  "http://localhost:8787",
];

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
  isTest,
  isProduction,
  /** Hosted portfolio demo: guided demo only. */
  publicDemoMode: envFlag("PUBLIC_DEMO_MODE"),
  /** Hours before unused demo applications are eligible for cleanup. */
  publicDemoTtlHours: envNumber("PUBLIC_DEMO_TTL_HOURS", 6),
  /** Interval for background stale-demo cleanup (0 disables). */
  publicDemoCleanupIntervalMs: envNumber(
    "PUBLIC_DEMO_CLEANUP_INTERVAL_MS",
    isTest ? 0 : 15 * 60 * 1000,
  ),
  trustProxy: envFlag("TRUST_PROXY", isProduction),
  allowedOrigins: [
    ...parseOrigins(process.env.CORS_ORIGINS),
    ...(isProduction || envFlag("PUBLIC_DEMO_MODE") ? [] : defaultDevOrigins),
  ],
  rateLimit: {
    windowMs: envNumber("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
    max: envNumber("RATE_LIMIT_MAX", 100),
    demoStartWindowMs: envNumber(
      "DEMO_START_RATE_LIMIT_WINDOW_MS",
      60 * 60 * 1000,
    ),
    demoStartMax: envNumber("DEMO_START_RATE_LIMIT_MAX", 10),
    demoMutationWindowMs: envNumber(
      "DEMO_MUTATION_RATE_LIMIT_WINDOW_MS",
      15 * 60 * 1000,
    ),
    demoMutationMax: envNumber("DEMO_MUTATION_RATE_LIMIT_MAX", 120),
  },
};

export type AppConfig = typeof config;
