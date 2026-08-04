import type { NextFunction, Request, Response } from "express";
import type { Application } from "@applyready/shared";
import { config } from "../config.js";
import { AppError } from "../utils/errors.js";

export class PublicDemoOnlyError extends AppError {
  constructor(
    message = "This action is disabled in the public portfolio demo.",
  ) {
    super("PUBLIC_DEMO_ONLY", message, 403, [
      "Use the guided Future Engineers Scholarship demo.",
      "Run ApplyReady locally for the full application.",
    ]);
    this.name = "PublicDemoOnlyError";
  }
}

export function assertNotPublicDemo(action?: string): void {
  if (config.publicDemoMode) {
    throw new PublicDemoOnlyError(
      action
        ? `${action} is disabled in the public portfolio demo.`
        : undefined,
    );
  }
}

export function requirePublicDemoApplication(app: Application | null | undefined): Application {
  if (!app) {
    throw new AppError("NOT_FOUND", "Application not found.", 404, [
      "Start a new guided demo from the landing page.",
    ]);
  }
  if (!app.isDemo) {
    throw new PublicDemoOnlyError(
      "Only guided demo applications are available in the public portfolio demo.",
    );
  }
  return app;
}

type RouteRule = {
  method: string;
  pattern: RegExp;
  /** When true, the handler must still verify isDemo for :id routes. */
  demoScoped?: boolean;
};

/** Minimum API surface for the recruiter guided-demo browser flow. */
export const PUBLIC_DEMO_ALLOWED_ROUTES: RouteRule[] = [
  { method: "GET", pattern: /^\/health\/?$/ },
  { method: "GET", pattern: /^\/config\/?$/ },
  { method: "GET", pattern: /^\/demo\/steps\/?$/ },
  { method: "POST", pattern: /^\/demo\/start\/?$/ },
  { method: "POST", pattern: /^\/demo\/[^/]+\/advance\/?$/ },
  { method: "POST", pattern: /^\/demo\/[^/]+\/fix\/?$/ },
  { method: "POST", pattern: /^\/demo\/[^/]+\/reset\/?$/ },
  { method: "GET", pattern: /^\/applications\/[^/]+\/?$/, demoScoped: true },
  {
    method: "GET",
    pattern: /^\/applications\/[^/]+\/export\/?$/,
    demoScoped: true,
  },
  { method: "GET", pattern: /^\/settings\/storage\/?$/ },
];

export function isPublicDemoAllowedRoute(method: string, apiPath: string): boolean {
  const normalized = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
  return PUBLIC_DEMO_ALLOWED_ROUTES.some(
    (rule) =>
      rule.method === method.toUpperCase() && rule.pattern.test(normalized),
  );
}

/**
 * Rejects any API request outside the public-demo allowlist.
 * Mount under `/api` so `req.path` is relative to the API router.
 */
export function publicDemoGuard(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!config.publicDemoMode) {
    next();
    return;
  }
  if (isPublicDemoAllowedRoute(req.method, req.path)) {
    next();
    return;
  }
  next(new PublicDemoOnlyError());
}
