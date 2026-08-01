import { config } from "./config.js";
import { createApp } from "./app.js";
import { ensureDirectories, getDb } from "./db/database.js";

ensureDirectories();
const db = getDb();
const app = createApp(db);

app.listen(config.port, config.host, () => {
  console.log(
    `ApplyReady listening on http://${config.host}:${config.port}`,
  );
  console.log(`Data directory: ${config.dataDir}`);
  console.log(`Uploads directory: ${config.uploadsDir}`);
});
