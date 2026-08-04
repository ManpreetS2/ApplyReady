#!/usr/bin/env node
/**
 * Production smoke verification for PUBLIC_DEMO_MODE.
 * Creates temp dirs, starts the compiled server, exercises the guided demo,
 * confirms restricted endpoints return 403, then cleans up.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = Number(process.env.VERIFY_PUBLIC_DEMO_PORT || 8799);
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "applyready-public-demo-"));
const dataDir = path.join(tmpRoot, "data");
const uploadsDir = path.join(tmpRoot, "uploads");
const dbPath = path.join(dataDir, "applyready.sqlite");
const serverEntry = path.join(root, "packages/server/dist/index.js");
const clientDist = path.join(root, "packages/client/dist");

function fail(message) {
  console.error(`[verify:public-demo] ${message}`);
  cleanup(1);
}

function cleanup(code = 0) {
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
  process.exit(code);
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            }
          : undefined,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { raw: text };
          }
          resolve({ status: res.statusCode || 0, body: json, text });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForHealth(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await request("GET", "/api/health");
      if (res.status === 200 && res.body?.ok) return res;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("Timed out waiting for /api/health");
}

if (!fs.existsSync(serverEntry) || !fs.existsSync(clientDist)) {
  fail("Missing production build. Run `npm run build` first.");
}

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

console.log(`[verify:public-demo] tmp=${tmpRoot}`);
console.log(`[verify:public-demo] port=${port}`);

const child = spawn(process.execPath, [serverEntry], {
  cwd: root,
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
    APPLYREADY_CLIENT_DIST: clientDist,
    PUBLIC_DEMO_MODE: "true",
    PUBLIC_DEMO_TTL_HOURS: "6",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
child.stdout.on("data", (d) => {
  serverLog += d.toString();
});
child.stderr.on("data", (d) => {
  serverLog += d.toString();
});

child.on("exit", (code) => {
  if (code && code !== 0) {
    console.error(serverLog);
  }
});

try {
  const health = await waitForHealth();
  if (health.body.mode !== "public-demo") {
    fail(`Expected mode public-demo, got ${health.body.mode}`);
  }
  if (health.body.storage) {
    fail("Health response exposed storage paths");
  }
  if (/\/Users\/|\/home\/|\\\\/.test(JSON.stringify(health.body))) {
    fail("Health response contained filesystem paths");
  }
  console.log("[verify:public-demo] health ok");

  const blocked = await request("POST", "/api/applications", {
    name: "Should Fail",
    organization: "Org",
    type: "scholarship",
  });
  if (blocked.status !== 403 || blocked.body?.error?.code !== "PUBLIC_DEMO_ONLY") {
    fail(`Expected PUBLIC_DEMO_ONLY for create application, got ${blocked.status}`);
  }

  const start = await request("POST", "/api/demo/start");
  if (start.status !== 201) {
    fail(`Demo start failed: ${start.status} ${start.text}`);
  }
  const id = start.body.application.id;
  console.log(`[verify:public-demo] demo id=${id}`);

  let current = start;
  for (let i = 0; i < 6; i += 1) {
    current = await request("POST", `/api/demo/${id}/fix`);
    if (current.status !== 200) {
      fail(`Demo fix step ${i + 1} failed: ${current.status} ${current.text}`);
    }
  }
  if (!current.body.done || current.body.analysis?.report?.status !== "ready") {
    fail(
      `Demo did not reach ready: done=${current.body.done} status=${current.body.analysis?.report?.status}`,
    );
  }
  console.log("[verify:public-demo] demo reached Ready to submit");

  const vault = await request("GET", "/api/vault");
  if (vault.status !== 403) fail(`Vault should be 403, got ${vault.status}`);

  const clear = await request("DELETE", "/api/settings/clear-all");
  if (clear.status !== 403) fail(`clear-all should be 403, got ${clear.status}`);

  if (/\/Users\/|APPLYREADY_DATA_DIR/.test(serverLog) && /Data directory:/.test(serverLog)) {
    // public demo should not print data directories on startup
    fail("Server logged local data directories in public demo mode");
  }

  console.log("[verify:public-demo] restricted endpoints blocked");
  console.log("[verify:public-demo] PASS");
  cleanup(0);
} catch (error) {
  console.error(serverLog);
  fail(error instanceof Error ? error.message : String(error));
}
