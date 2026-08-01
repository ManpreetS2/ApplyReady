import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { ensureDirectories, resetDb } from "../db/database.js";

ensureDirectories();
resetDb();

for (const kind of ["applications", "vault", "sources"]) {
  const dir = path.join(config.uploadsDir, kind);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of fs.readdirSync(dir)) {
    fs.unlinkSync(path.join(dir, file));
  }
}

console.log("Reset local database and upload directories.");
