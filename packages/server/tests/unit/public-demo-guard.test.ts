import { describe, expect, it } from "vitest";
import {
  isPublicDemoAllowedRoute,
  normalizePublicDemoPath,
} from "../../src/middleware/publicDemo.js";

describe("public demo path normalization", () => {
  it("normalizes duplicate slashes and trailing segments", () => {
    expect(normalizePublicDemoPath("//health")).toBe("/health");
    expect(normalizePublicDemoPath("/health/")).toBe("/health");
    expect(normalizePublicDemoPath("health")).toBe("/health");
  });

  it("rejects traversal that escapes the root", () => {
    expect(normalizePublicDemoPath("/../vault")).toBeNull();
    expect(normalizePublicDemoPath("/applications/../vault")).toBe("/vault");
    expect(normalizePublicDemoPath("/demo/start/../../vault")).toBe("/vault");
  });

  it("rejects null bytes and bad encoding", () => {
    expect(normalizePublicDemoPath("/health%00")).toBeNull();
    expect(normalizePublicDemoPath("/hea%lth")).toBeNull();
  });

  it("allowlists only the guided-demo surface", () => {
    expect(isPublicDemoAllowedRoute("GET", "/health")).toBe(true);
    expect(isPublicDemoAllowedRoute("POST", "/demo/start")).toBe(true);
    expect(isPublicDemoAllowedRoute("GET", "/vault")).toBe(false);
    expect(isPublicDemoAllowedRoute("POST", "/applications")).toBe(false);
    expect(isPublicDemoAllowedRoute("DELETE", "/settings/clear-all")).toBe(false);
    expect(isPublicDemoAllowedRoute("PATCH", "/applications/abc")).toBe(false);
    expect(isPublicDemoAllowedRoute("GET", "/applications/abc/requirements")).toBe(
      false,
    );
    expect(isPublicDemoAllowedRoute("HEAD", "/health")).toBe(false);
    expect(
      isPublicDemoAllowedRoute("POST", "/demo/start/../../applications"),
    ).toBe(false);
    expect(isPublicDemoAllowedRoute("GET", "/applications/../vault")).toBe(false);
  });
});
