import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { config } from "./config.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createApiRouter } from "./routes/api.js";

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function isAllowedOrigin(origin: string, req: express.Request): boolean {
  if (config.allowedOrigins.includes(origin)) return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  // Vite module scripts use crossorigin and send Origin even for same-origin loads.
  const requestHost = req.headers.host;
  if (requestHost && parsed.host === requestHost) {
    return true;
  }

  if (isLoopbackHostname(parsed.hostname)) {
    const originPort =
      parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    if (originPort === String(config.port)) return true;
    if (requestHost?.includes(":")) {
      const hostPort = requestHost.split(":").pop();
      if (hostPort && originPort === hostPort) return true;
    }
  }

  return false;
}

function shouldSkipRateLimit(): boolean {
  if (config.isTest && process.env.APPLYREADY_ENABLE_RATE_LIMIT !== "true") {
    return true;
  }
  // Local/E2E only. Never honor this bypass for hosted public-demo processes.
  if (process.env.APPLYREADY_DISABLE_RATE_LIMIT === "true") {
    if (config.publicDemoMode && process.env.APPLYREADY_E2E !== "true") {
      return false;
    }
    return true;
  }
  return false;
}

function rateLimitHandler(_req: express.Request, res: express.Response) {
  res.status(429).json({
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Please wait and try again.",
      nextSteps: ["Wait a minute, then retry the guided demo."],
    },
  });
}

export function createApp(db: Database.Database) {
  const app = express();
  app.disable("x-powered-by");

  if (config.trustProxy) {
    app.set("trust proxy", 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: config.publicDemoMode
        ? {
            useDefaults: true,
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
              fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
              imgSrc: ["'self'", "data:", "blob:"],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      // Allow the SPA's crossorigin module scripts to load from the same host.
      crossOriginResourcePolicy: { policy: "cross-origin" },
      referrerPolicy: { policy: "no-referrer" },
      frameguard: { action: "deny" },
    }),
  );

  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (!origin) {
      next();
      return;
    }
    if (isAllowedOrigin(origin, req)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE");
        res.setHeader(
          "Access-Control-Allow-Headers",
          req.get("access-control-request-headers") || "Content-Type",
        );
        res.status(204).end();
        return;
      }
      next();
      return;
    }
    // Never replace static assets with a JSON 403 — omit ACAO and let the browser enforce.
    if (!req.path.startsWith("/api")) {
      next();
      return;
    }
    next(new Error("Not allowed by CORS"));
  });

  app.use(express.json({ limit: "2mb" }));

  const generalLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    skip: (req) =>
      shouldSkipRateLimit() ||
      (req.method === "GET" &&
        (req.path === "/health" || req.path === "/config")),
  });

  const demoStartLimiter = rateLimit({
    windowMs: config.rateLimit.demoStartWindowMs,
    max: config.rateLimit.demoStartMax,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    skip: () => shouldSkipRateLimit(),
  });

  const demoMutationLimiter = rateLimit({
    windowMs: config.rateLimit.demoMutationWindowMs,
    max: config.rateLimit.demoMutationMax,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    skip: () => shouldSkipRateLimit(),
  });

  app.use("/api", generalLimiter);
  app.use("/api/demo/start", demoStartLimiter);
  app.use("/api/demo/:id/advance", demoMutationLimiter);
  app.use("/api/demo/:id/fix", demoMutationLimiter);
  app.use("/api/demo/:id/reset", demoMutationLimiter);

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
