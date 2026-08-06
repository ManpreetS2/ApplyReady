import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = Number(process.env.APPLYREADY_PUBLIC_DEMO_E2E_PORT || 8792);
const tmpRoot =
  process.env.APPLYREADY_PUBLIC_DEMO_E2E_TMP ||
  fs.mkdtempSync(path.join(os.tmpdir(), "applyready-public-demo-e2e-"));
const dataDir = path.join(tmpRoot, "data");
const uploadsDir = path.join(tmpRoot, "uploads");
const dbPath = path.join(dataDir, "e2e.sqlite");

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

process.env.APPLYREADY_PUBLIC_DEMO_E2E_TMP = tmpRoot;
process.env.APPLYREADY_DATA_DIR = dataDir;
process.env.APPLYREADY_UPLOADS_DIR = uploadsDir;
process.env.APPLYREADY_DB_PATH = dbPath;
process.env.PUBLIC_DEMO_MODE = "true";

export default defineConfig({
  testDir: "./e2e-public-demo",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-public-demo" }]],
  outputDir: "test-results-public-demo",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 20_000,
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
      testMatch: /public-demo\.spec\.ts/,
      grep: /mobile viewport|keyboard navigation/,
    },
  ],
  webServer: {
    command: `node scripts/e2e-server.mjs --port ${port}`,
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      PUBLIC_DEMO_MODE: "true",
      PUBLIC_DEMO_TTL_HOURS: "6",
      APPLYREADY_DATA_DIR: dataDir,
      APPLYREADY_UPLOADS_DIR: uploadsDir,
      APPLYREADY_DB_PATH: dbPath,
      APPLYREADY_PUBLIC_DEMO_E2E_TMP: tmpRoot,
      APPLYREADY_DISABLE_RATE_LIMIT: "true",
      APPLYREADY_E2E: "true",
    },
  },
});
