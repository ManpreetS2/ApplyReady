import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { config } from "./config.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createApiRouter } from "./routes/api.js";

export function createApp(db: Database.Database) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "2mb" }));

  app.use("/api", createApiRouter(db));

  const clientDist = config.clientDist;
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(clientDist, "index.html"), (err) => {
        if (err) next();
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
