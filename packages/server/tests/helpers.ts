import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { closeDb, getDb, resetDb } from "../src/db/database.js";
import { config } from "../src/config.js";

export function useTempDb() {
  let tmp = "";
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "applyready-"));
    config.dataDir = path.join(tmp, "data");
    config.uploadsDir = path.join(tmp, "uploads");
    config.dbPath = path.join(tmp, "data", "test.sqlite");
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.mkdirSync(config.uploadsDir, { recursive: true });
    resetDb(config.dbPath);
  });
  afterEach(() => {
    closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  return {
    db: () => getDb(config.dbPath),
    app: () => createApp(getDb(config.dbPath)),
  };
}
