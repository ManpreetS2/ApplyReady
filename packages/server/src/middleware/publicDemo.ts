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

/**
 * Normalize an API-relative path for allowlist checks.
 * Rejects null bytes and resolves `.` / `..` segments after decoding.
 */
export function normalizePublicDemoPath(apiPath: string): string | null {
  if (!apiPath) return "/";
  if (apiPath.includes("\0") || apiPath.includes("%00")) return null;

  let decoded = apiPath;
  try {
    // Decode once; refuse paths that still look percent-encoded with traversal.
    decoded = decodeURIComponent(apiPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;

  const input = decoded.startsWith("/") ? decoded : `/${decoded}`;
  const parts: string[] = [];
  for (const segment of input.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return `/${parts.join("/")}`;
}

export function isPublicDemoAllowedRoute(method: string, apiPath: string): boolean {
  const normalized = normalizePublicDemoPath(apiPath);
  if (!normalized) return false;
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
  // Prefer Express-normalized path; also strip any leftover query fragment.
  const rawPath = (req.path || "/").split("?")[0] || "/";
  if (isPublicDemoAllowedRoute(req.method, rawPath)) {
    next();
    return;
  }
  next(new PublicDemoOnlyError());
}
