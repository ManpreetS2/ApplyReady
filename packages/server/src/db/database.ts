import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "schema.sql");

let db: Database.Database | null = null;

export function ensureDirectories(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  fs.mkdirSync(path.join(config.uploadsDir, "applications"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(config.uploadsDir, "vault"), { recursive: true });
  fs.mkdirSync(path.join(config.uploadsDir, "sources"), { recursive: true });
}

export function getDb(dbPath = config.dbPath): Database.Database {
  if (db && !config.isTest) return db;
  ensureDirectories();
  const directory = path.dirname(dbPath);
  fs.mkdirSync(directory, { recursive: true });
  const instance = new Database(dbPath);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(schemaPath, "utf8");
  instance.exec(schema);
  if (!config.isTest) db = instance;
  return instance;
}

export function resetDb(dbPath = config.dbPath): Database.Database {
  if (db) {
    db.close();
    db = null;
  }
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const wal = `${dbPath}-wal`;
  const shm = `${dbPath}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
  return getDb(dbPath);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function withTransaction<T>(
  database: Database.Database,
  fn: () => T,
): T {
  const run = database.transaction(fn);
  return run();
}
