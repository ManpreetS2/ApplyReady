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

  if (!requirementCols.has("applicability")) {
    instance.exec(
      `ALTER TABLE requirements ADD COLUMN applicability TEXT NOT NULL DEFAULT 'applicable'`,
    );
    // Existing conditional requirements start unknown until the applicant decides.
    instance.exec(
      `UPDATE requirements SET applicability = 'unknown' WHERE conditional = 1`,
    );
  }

  const profileCols = columnNames(instance, "applicant_profiles");
  if (!profileCols.has("currently_enrolled")) {
    instance.exec(
      `ALTER TABLE applicant_profiles ADD COLUMN currently_enrolled INTEGER`,
    );
  }

  if (!profileCols.has("confirmed_fields")) {
    instance.exec(
      `ALTER TABLE applicant_profiles ADD COLUMN confirmed_fields TEXT NOT NULL DEFAULT '[]'`,
    );
    // Migrate only currently populated values when the legacy global flag is set.
    // Empty/null future fields are intentionally left unconfirmed.
    const rows = instance
      .prepare(
        `SELECT id, full_legal_name, email, phone, school, major, gpa,
                expected_graduation_date, target_organization, currently_enrolled,
                user_confirmed
         FROM applicant_profiles`,
      )
      .all() as Array<Record<string, unknown>>;
    const update = instance.prepare(
      `UPDATE applicant_profiles SET confirmed_fields=? WHERE id=?`,
    );
    for (const row of rows) {
      if (!row.user_confirmed) continue;
      const fields: string[] = [];
      if (row.full_legal_name) fields.push("fullLegalName");
      if (row.email) fields.push("email");
      if (row.phone) fields.push("phone");
      if (row.school) fields.push("school");
      if (row.major) fields.push("major");
      if (row.gpa) fields.push("gpa");
      if (row.expected_graduation_date) fields.push("expectedGraduationDate");
      if (row.target_organization) fields.push("targetOrganization");
      if (row.currently_enrolled != null) fields.push("currentlyEnrolled");
      update.run(JSON.stringify(fields), row.id);
    }
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
