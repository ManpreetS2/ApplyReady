import { ensureDirectories, getDb } from "../db/database.js";
import { config } from "../config.js";

ensureDirectories();
getDb();
console.log(`Initialized database at ${config.dbPath}`);
console.log(`Uploads directory: ${config.uploadsDir}`);
