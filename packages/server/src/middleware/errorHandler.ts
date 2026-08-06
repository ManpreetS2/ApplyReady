import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { config } from "../config.js";
import { AppError, isAppError } from "../utils/errors.js";

const ABS_PATH =
  /(?:\/(?:Users|home|var|tmp|private|opt|mnt|root)\/[^\s"']+|[A-Za-z]:\\[^\s"']+)/g;

function sanitizePublicText(value: string): string {
  if (!config.publicDemoMode && !config.isProduction) return value;
  return value.replace(ABS_PATH, "[redacted-path]");
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // CORS rejection from the origin callback
  if (err instanceof Error && err.message === "Not allowed by CORS") {
    res.status(403).json({
      error: {
        code: "CORS_DENIED",
        message: "Origin not allowed.",
        nextSteps: ["Use the hosted demo from its own origin."],
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    const exposeDetails = !config.publicDemoMode && !config.isProduction;
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        ...(exposeDetails ? { details: err.flatten() } : {}),
        nextSteps: ["Check the highlighted fields and try again."],
      },
    });
    return;
  }

  if (isAppError(err)) {
    const payload = err.toJSON();
    payload.error.message = sanitizePublicText(payload.error.message);
    res.status(err.status).json(payload);
    return;
  }

  const message = err instanceof Error ? err.message : "Unexpected server error";
  // Avoid logging full document contents; message only. Never log stack in public demo.
  console.error("[applyready]", sanitizePublicText(message));
  if (!config.isProduction && !config.publicDemoMode && err instanceof Error && err.stack) {
    console.error(err.stack);
  }

  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong while processing your request.",
      nextSteps: [
        "Retry the action.",
        config.publicDemoMode
          ? "If the problem continues, start a new guided demo."
          : "If the problem continues, restart the local server.",
      ],
    },
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "The requested resource was not found.",
      nextSteps: [
        config.publicDemoMode
          ? "Return to the guided demo."
          : "Check the URL or return to the dashboard.",
      ],
    },
  });
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function requireApp(repos: { getApplication: (id: string) => unknown }, id: string) {
  const app = repos.getApplication(id);
  if (!app) {
    throw new AppError("NOT_FOUND", "Application not found.", 404, [
      "Return to the dashboard and select a valid application.",
    ]);
  }
  return app;
}
