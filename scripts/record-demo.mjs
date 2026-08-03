#!/usr/bin/env node
/**
 * Attempt to record a short guided-demo video with Playwright.
 * Output: docs/demo/applyready-guided-demo.webm
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "docs/demo");
const port = 8793;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "applyready-demo-"));
const videoDir = path.join(tmp, "video");

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(videoDir, { recursive: true });
fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
fs.mkdirSync(path.join(tmp, "uploads"), { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy");
}

const server = spawn(
  process.execPath,
  [path.join(root, "scripts/e2e-server.mjs"), "--port", String(port)],
  {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      APPLYREADY_DATA_DIR: path.join(tmp, "data"),
      APPLYREADY_UPLOADS_DIR: path.join(tmp, "uploads"),
      APPLYREADY_DB_PATH: path.join(tmp, "data", "demo.sqlite"),
      APPLYREADY_E2E_TMP: tmp,
    },
    stdio: "inherit",
  },
);

let blocker = null;
try {
  await waitHealth();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  await page.goto(`http://127.0.0.1:${port}/`);
  await sleep(800);
  await page.goto(`http://127.0.0.1:${port}/dashboard`);
  await sleep(700);
  await page.goto(`http://127.0.0.1:${port}/demo`);
  await page.getByRole("button", { name: "Start guided demo" }).click();
  await expectReadyOrNot(page);
  await sleep(1000);
  for (let i = 0; i < 6; i += 1) {
    const fix = page.getByRole("button", { name: "Apply suggested fix" });
    if (await fix.isEnabled()) {
      await fix.click();
      await sleep(1200);
    } else {
      break;
    }
  }
  await page.getByText(/Ready to submit/i).first().waitFor({ timeout: 60_000 });
  await sleep(1500);
  await page.getByRole("link", { name: "View evidence" }).click();
  await sleep(1200);

  await context.close();
  await browser.close();

  const videos = fs.readdirSync(videoDir).filter((f) => f.endsWith(".webm"));
  if (!videos.length) {
    blocker = "Playwright did not produce a .webm file in the recording directory.";
  } else {
    const source = path.join(videoDir, videos[0]);
    const target = path.join(outDir, "applyready-guided-demo.webm");
    fs.copyFileSync(source, target);
    const stats = fs.statSync(target);
    if (stats.size < 10_000) {
      blocker = `Generated video was unexpectedly small (${stats.size} bytes).`;
    } else {
      console.log(`Demo video written to ${target} (${stats.size} bytes)`);
    }
  }
} catch (error) {
  blocker = error instanceof Error ? error.message : String(error);
  console.error("Demo recording failed:", blocker);
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  fs.rmSync(tmp, { recursive: true, force: true });
  if (blocker) {
    fs.writeFileSync(
      path.join(outDir, "RECORDING_BLOCKER.txt"),
      `Guided demo recording blocker:\n${blocker}\n`,
    );
  }
}

async function expectReadyOrNot(page) {
  await page.getByText(/Not ready|Ready to submit/i).first().waitFor({ timeout: 60_000 });
}
