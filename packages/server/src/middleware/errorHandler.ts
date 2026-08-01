import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError, isAppError } from "../utils/errors.js";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: err.flatten(),
        nextSteps: ["Check the highlighted fields and try again."],
      },
    });
    return;
  }

  if (isAppError(err)) {
    res.status(err.status).json(err.toJSON());
    return;
  }

  const message = err instanceof Error ? err.message : "Unexpected server error";
  // Avoid logging full document contents; message only.
  console.error("[applyready]", message);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong while processing your request.",
      nextSteps: [
        "Retry the action.",
        "If the problem continues, restart the local server.",
      ],
    },
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "The requested resource was not found.",
      nextSteps: ["Check the URL or return to the dashboard."],
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
