#!/usr/bin/env node
/**
 * Smoke-test a running ApplyReady public-demo instance by BASE_URL.
 * Used by GitHub Actions against a Docker container.
 *
 * Usage:
 *   APPLYREADY_SMOKE_BASE_URL=http://127.0.0.1:8787 node scripts/ci-public-demo-smoke.mjs
 */
import http from "node:http";
import https from "node:https";

const baseUrl = (process.env.APPLYREADY_SMOKE_BASE_URL || "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);
const PATH_LEAK =
  /(?:\/(?:Users|home|var\/folders|private|opt|mnt|root|app\/packages)\/|[A-Za-z]:\\|APPLYREADY_(?:DATA|UPLOADS|DB)_DIR|applyready\.sqlite)/i;

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlPath, `${baseUrl}/`);
    const lib = target.protocol === "https:" ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = lib.request(
      target,
      {
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

function fail(message) {
  console.error(`[ci-public-demo-smoke] FAIL: ${message}`);
  process.exit(1);
}

function assertNoPaths(label, value) {
  const serialized = JSON.stringify(value);
  if (PATH_LEAK.test(serialized)) {
    fail(`${label} leaked filesystem/path details: ${serialized.slice(0, 300)}`);
  }
}

async function waitForHealth(timeoutMs = 90_000) {
  const start = Date.now();
  let lastError = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await request("GET", "/api/health");
      if (res.status === 200 && res.body?.ok) return res;
      lastError = `status=${res.status} body=${res.text}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  fail(`Timed out waiting for /api/health (${lastError})`);
}

const health = await waitForHealth();
if (health.body.mode !== "public-demo") {
  fail(`Expected mode public-demo, got ${JSON.stringify(health.body.mode)}`);
}
if (health.body.storage) {
  fail("Health response included storage paths");
}
assertNoPaths("health", health.body);
console.log("[ci-public-demo-smoke] health ok");

const create = await request("POST", "/api/applications", {
  name: "Should Fail",
  organization: "Org",
  type: "scholarship",
});
if (create.status !== 403 || create.body?.error?.code !== "PUBLIC_DEMO_ONLY") {
  fail(`create application expected PUBLIC_DEMO_ONLY, got ${create.status} ${create.text}`);
}

const start = await request("POST", "/api/demo/start");
if (start.status !== 201) {
  fail(`demo start failed: ${start.status} ${start.text}`);
}
const id = start.body.application?.id;
if (!id || typeof id !== "string") fail("demo start missing application id");
console.log("[ci-public-demo-smoke] demo started");

// URL ingestion requires an application id in the path; still must be blocked.
const urlIngest = await request("POST", `/api/applications/${id}/sources/url`, {
  url: "https://example.com",
});
if (urlIngest.status !== 403 || urlIngest.body?.error?.code !== "PUBLIC_DEMO_ONLY") {
  fail(`url ingest expected PUBLIC_DEMO_ONLY, got ${urlIngest.status} ${urlIngest.text}`);
}

const vault = await request("GET", "/api/vault");
if (vault.status !== 403 || vault.body?.error?.code !== "PUBLIC_DEMO_ONLY") {
  fail(`vault expected PUBLIC_DEMO_ONLY, got ${vault.status} ${vault.text}`);
}

const list = await request("GET", "/api/applications");
if (list.status !== 403 || list.body?.error?.code !== "PUBLIC_DEMO_ONLY") {
  fail(`list applications expected PUBLIC_DEMO_ONLY, got ${list.status} ${list.text}`);
}

const analyze = await request("POST", `/api/applications/${id}/analyze`);
if (analyze.status !== 403 || analyze.body?.error?.code !== "PUBLIC_DEMO_ONLY") {
  fail(`analyze expected PUBLIC_DEMO_ONLY, got ${analyze.status} ${analyze.text}`);
}

const clear = await request("DELETE", "/api/settings/clear-all");
if (clear.status !== 403 || clear.body?.error?.code !== "PUBLIC_DEMO_ONLY") {
  fail(`clear-all expected PUBLIC_DEMO_ONLY, got ${clear.status} ${clear.text}`);
}

let current = start;
for (let i = 0; i < 6; i += 1) {
  current = await request("POST", `/api/demo/${id}/fix`);
  if (current.status !== 200) {
    fail(`demo fix step ${i + 1} failed: ${current.status} ${current.text}`);
  }
}
if (!current.body.done || current.body.analysis?.report?.status !== "ready") {
  fail(
    `demo did not reach ready: done=${current.body.done} status=${current.body.analysis?.report?.status}`,
  );
}
assertNoPaths("demo completion", current.body);
console.log("[ci-public-demo-smoke] demo reached Ready to submit");
console.log("[ci-public-demo-smoke] PASS");
