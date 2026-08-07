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

function columnNames(
  instance: Database.Database,
  table: string,
): Set<string> {
  const rows = instance
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

/** Additive migrations for existing local SQLite databases. */
export function migrateSchema(instance: Database.Database): void {
  const requirementCols = columnNames(instance, "requirements");
  if (!requirementCols.has("certainty")) {
    instance.exec(
      `ALTER TABLE requirements ADD COLUMN certainty TEXT NOT NULL DEFAULT 'required'`,
    );
    instance.exec(
      `UPDATE requirements SET certainty = CASE WHEN required = 0 THEN 'optional' ELSE 'required' END`,
    );
  }

  const profileCols = columnNames(instance, "applicant_profiles");
  if (!profileCols.has("currently_enrolled")) {
    instance.exec(
      `ALTER TABLE applicant_profiles ADD COLUMN currently_enrolled INTEGER`,
    );
  }

  // Triggers are idempotent via IF NOT EXISTS in schema.sql; re-exec is safe.
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
  migrateSchema(instance);
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
