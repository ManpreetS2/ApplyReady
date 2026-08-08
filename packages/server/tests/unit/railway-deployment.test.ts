import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import { config } from "../../src/config.js";
import {
  rateLimitClientKey,
  resolveClientIp,
} from "../../src/http/clientKey.js";
import { isAllowedOrigin } from "../../src/http/corsOrigin.js";
import { useTempDb } from "../helpers.js";

const ctx = useTempDb({ publicDemoMode: true });

function fakeReq(partial: {
  headers?: Record<string, string | undefined>;
  ip?: string;
  protocol?: string;
  secure?: boolean;
  remoteAddress?: string;
}): Request {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(partial.headers || {})) {
    if (v !== undefined) headers[k.toLowerCase()] = v;
  }
  return {
    headers,
    ip: partial.ip,
    protocol: partial.protocol ?? "http",
    secure: partial.secure ?? false,
    socket: { remoteAddress: partial.remoteAddress },
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

afterEach(() => {
  config.trustProxy = false;
  config.allowedOrigins = [];
  config.isProduction = false;
  delete process.env.APPLYREADY_ENABLE_RATE_LIMIT;
});

describe("railway deployment — rate-limit client key", () => {
  it("prefers a valid X-Real-IP when trustProxy is enabled", () => {
    config.trustProxy = true;
    const req = fakeReq({
      headers: { "x-real-ip": "203.0.113.10" },
      ip: "10.0.0.1",
      remoteAddress: "10.0.0.1",
    });
    expect(resolveClientIp(req)).toBe("203.0.113.10");
    expect(rateLimitClientKey(req)).toBe(ipKeyGenerator("203.0.113.10"));
  });

  it("ignores X-Real-IP when trustProxy is disabled", () => {
    config.trustProxy = false;
    const req = fakeReq({
      headers: { "x-real-ip": "203.0.113.10" },
      ip: "127.0.0.1",
    });
    expect(resolveClientIp(req)).toBe("127.0.0.1");
  });

  it("falls back when X-Real-IP is malformed", () => {
    config.trustProxy = true;
    const req = fakeReq({
      headers: { "x-real-ip": "not-an-ip, also-bad" },
      ip: "198.51.100.20",
    });
    expect(resolveClientIp(req)).toBe("198.51.100.20");
    expect(rateLimitClientKey(req)).toBe(ipKeyGenerator("198.51.100.20"));
  });

  it("normalizes IPv6 through ipKeyGenerator", () => {
    config.trustProxy = true;
    const ip = "2001:db8:abcd::1";
    const req = fakeReq({
      headers: { "x-real-ip": ip },
    });
    expect(resolveClientIp(req)).toBe(ip);
    expect(rateLimitClientKey(req)).toBe(ipKeyGenerator(ip));
  });

  it("does not use unvalidated header strings as keys", () => {
    config.trustProxy = true;
    const req = fakeReq({
      headers: { "x-real-ip": "evil-header-value" },
      ip: undefined,
      remoteAddress: undefined,
    });
    expect(resolveClientIp(req)).toBeNull();
    expect(rateLimitClientKey(req)).toBe("unidentified");
    expect(rateLimitClientKey(req)).not.toContain("evil");
  });

  it("separate Railway visitor IPs get separate rate-limit buckets", async () => {
    config.trustProxy = true;
    process.env.APPLYREADY_ENABLE_RATE_LIMIT = "true";
    const previous = { ...config.rateLimit };
    config.rateLimit.max = 2;
    config.rateLimit.windowMs = 60_000;
    const app = ctx.app();

    await request(app)
      .get("/api/demo/steps")
      .set("X-Real-IP", "203.0.113.1")
      .expect(200);
    await request(app)
      .get("/api/demo/steps")
      .set("X-Real-IP", "203.0.113.1")
      .expect(200);
    await request(app)
      .get("/api/demo/steps")
      .set("X-Real-IP", "203.0.113.1")
      .expect(429);

    // Different visitor still allowed.
    await request(app)
      .get("/api/demo/steps")
      .set("X-Real-IP", "203.0.113.2")
      .expect(200);

    // Health/config remain exempt.
    await request(app)
      .get("/api/health")
      .set("X-Real-IP", "203.0.113.1")
      .expect(200);
    await request(app)
      .get("/api/config")
      .set("X-Real-IP", "203.0.113.1")
      .expect(200);

    Object.assign(config.rateLimit, previous);
  });
});

describe("railway deployment — proxy-aware CORS", () => {
  it("allows Origin matching forwarded host/proto", () => {
    config.trustProxy = true;
    const req = fakeReq({
      headers: {
        host: "localhost:8787",
        "x-forwarded-host": "example.up.railway.app",
        "x-forwarded-proto": "https",
      },
      protocol: "http",
    });
    expect(
      isAllowedOrigin("https://example.up.railway.app", req),
    ).toBe(true);
  });

  it("denies evil Origin even with valid forwarded host", () => {
    config.trustProxy = true;
    const req = fakeReq({
      headers: {
        host: "localhost:8787",
        "x-forwarded-host": "example.up.railway.app",
        "x-forwarded-proto": "https",
      },
    });
    expect(isAllowedOrigin("https://evil.example", req)).toBe(false);
  });

  it("uses left-most forwarded host only", () => {
    config.trustProxy = true;
    const req = fakeReq({
      headers: {
        "x-forwarded-host": "example.up.railway.app, spoofed.example",
        "x-forwarded-proto": "https, http",
      },
    });
    expect(
      isAllowedOrigin("https://example.up.railway.app", req),
    ).toBe(true);
    expect(isAllowedOrigin("https://spoofed.example", req)).toBe(false);
  });

  it("keeps local Host-only same-origin behavior without trustProxy", () => {
    config.trustProxy = false;
    const req = fakeReq({
      headers: { host: "demo.example" },
      protocol: "http",
    });
    expect(isAllowedOrigin("https://demo.example", req)).toBe(true);
    expect(isAllowedOrigin("https://evil.example", req)).toBe(false);
  });

  it("enforces proxy-aware CORS on API requests", async () => {
    config.trustProxy = true;
    config.allowedOrigins = [];
    const app = ctx.app();

    const allowed = await request(app)
      .get("/api/health")
      .set("Origin", "https://example.up.railway.app")
      .set("X-Forwarded-Host", "example.up.railway.app")
      .set("X-Forwarded-Proto", "https")
      .expect(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "https://example.up.railway.app",
    );

    const denied = await request(app)
      .get("/api/health")
      .set("Origin", "https://evil.example")
      .set("X-Forwarded-Host", "example.up.railway.app")
      .set("X-Forwarded-Proto", "https")
      .expect(403);
    expect(denied.body.error?.code).toBe("CORS_DENIED");
  });
});
