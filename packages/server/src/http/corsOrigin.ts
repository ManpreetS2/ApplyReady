import type { Request } from "express";
import { config } from "../config.js";
import { firstForwardedValue } from "./clientKey.js";

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/**
 * Public host/protocol as seen by the visitor.
 * When trustProxy is on, prefer Railway's X-Forwarded-Host / X-Forwarded-Proto
 * (left-most value only). Otherwise use Host + req.protocol.
 */
export function effectivePublicOrigin(req: Request): {
  protocol: string;
  host: string;
} | null {
  let host: string | undefined;
  let protocol: string | undefined;

  if (config.trustProxy) {
    host =
      firstForwardedValue(req.get("x-forwarded-host")) ||
      (typeof req.headers.host === "string" ? req.headers.host : undefined);
    protocol = firstForwardedValue(req.get("x-forwarded-proto"))?.toLowerCase();
  } else {
    host =
      typeof req.headers.host === "string" ? req.headers.host : undefined;
  }

  if (!host) return null;

  if (!protocol) {
    protocol = (req.protocol || (req.secure ? "https" : "http")).toLowerCase();
  }
  protocol = protocol.replace(/:$/, "");
  if (protocol !== "http" && protocol !== "https") return null;

  return { protocol, host };
}

/** Same-origin / allowlist check used by the CORS middleware. */
export function isAllowedOrigin(origin: string, req: Request): boolean {
  if (config.allowedOrigins.includes(origin)) return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  const effective = effectivePublicOrigin(req);
  if (effective) {
    if (config.trustProxy) {
      const originProtocol = parsed.protocol.replace(":", "").toLowerCase();
      if (
        originProtocol === effective.protocol &&
        parsed.host === effective.host
      ) {
        return true;
      }
    } else if (parsed.host === effective.host) {
      // Local / non-proxy: preserve prior Host-only same-origin match used by
      // SPA module scripts (protocol may differ between tooling and Host).
      return true;
    }
  }

  // Local loopback SPA / Vite ports during development.
  if (isLoopbackHostname(parsed.hostname)) {
    const originPort =
      parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    if (originPort === String(config.port)) return true;
    const requestHost =
      typeof req.headers.host === "string" ? req.headers.host : undefined;
    if (requestHost?.includes(":")) {
      const hostPort = requestHost.split(":").pop();
      if (hostPort && originPort === hostPort) return true;
    }
  }

  return false;
}
