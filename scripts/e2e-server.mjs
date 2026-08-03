#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const portArg = process.argv.indexOf("--port");
const port = Number(
  (portArg >= 0 && process.argv[portArg + 1]) ||
    process.env.PORT ||
    8791,
);

const tmpRoot =
  process.env.APPLYREADY_E2E_TMP ||
  fs.mkdtempSync(path.join(os.tmpdir(), "applyready-e2e-"));
const dataDir = process.env.APPLYREADY_DATA_DIR || path.join(tmpRoot, "data");
const uploadsDir =
  process.env.APPLYREADY_UPLOADS_DIR || path.join(tmpRoot, "uploads");
const dbPath =
  process.env.APPLYREADY_DB_PATH || path.join(dataDir, "e2e.sqlite");
const clientDist =
  process.env.APPLYREADY_CLIENT_DIST ||
  path.join(root, "packages/client/dist");
const serverEntry = path.join(root, "packages/server/dist/index.js");

if (!fs.existsSync(serverEntry)) {
  console.error("Missing server build. Run `npm run build` first.");
  process.exit(1);
}
if (!fs.existsSync(clientDist)) {
  console.error("Missing client build. Run `npm run build` first.");
  process.exit(1);
}

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(path.join(uploadsDir, "applications"), { recursive: true });
fs.mkdirSync(path.join(uploadsDir, "vault"), { recursive: true });
fs.mkdirSync(path.join(uploadsDir, "sources"), { recursive: true });

console.log(`[e2e-server] port=${port}`);
console.log(`[e2e-server] tmp=${tmpRoot}`);
console.log(`[e2e-server] db=${dbPath}`);
console.log(`[e2e-server] uploads=${uploadsDir}`);

const child = spawn(process.execPath, [serverEntry], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    NODE_ENV: "production",
    APPLYREADY_DATA_DIR: dataDir,
    APPLYREADY_UPLOADS_DIR: uploadsDir,
    APPLYREADY_DB_PATH: dbPath,
    APPLYREADY_CLIENT_DIST: clientDist,
  },
  stdio: "inherit",
});

function shutdown(code = 0) {
  if (!child.killed) child.kill("SIGTERM");
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
child.on("exit", (code) => process.exit(code ?? 0));
