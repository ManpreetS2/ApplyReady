import net from "node:net";
import type { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import { config } from "../config.js";

/** Take the left-most forwarded value; ignore empties. */
export function firstForwardedValue(
  raw: string | undefined | null,
): string | undefined {
  if (!raw) return undefined;
  const first = raw.split(",")[0]?.trim();
  return first || undefined;
}

/**
 * Resolve the client IP for rate limiting.
 *
 * In trusted proxy mode (Railway), prefer a valid `X-Real-IP`. Never trust
 * that header when `trustProxy` is off. Fall back to Express `req.ip` /
 * socket address. Only net.isIP-validated addresses are returned.
 */
export function resolveClientIp(req: Request): string | null {
  const candidates: string[] = [];

  if (config.trustProxy) {
    const realIp = firstForwardedValue(req.get("x-real-ip"));
    if (realIp) candidates.push(realIp);
  }

  if (req.ip) candidates.push(req.ip);
  const remote = req.socket?.remoteAddress;
  if (remote) candidates.push(remote);

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    // Express may give IPv4-mapped forms; net.isIP accepts them.
    if (net.isIP(trimmed)) return trimmed;
  }
  return null;
}

/**
 * Shared rate-limit key for general, demo-start, and demo-mutation limiters.
 * Valid IPs always go through express-rate-limit's `ipKeyGenerator` so IPv6
 * clients share a stable subnet bucket. Unvalidated header strings are never
 * used as keys.
 */
export function rateLimitClientKey(req: Request): string {
  const ip = resolveClientIp(req);
  if (ip) return ipKeyGenerator(ip);
  return "unidentified";
}
