import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach } from "vitest";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { setUrlFetchTestHooks } from "../../src/services/urlFetch.js";
import { useTempDb } from "../helpers.js";

const ctx = useTempDb();

function listen(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port });
    });
  });
}

afterEach(() => {
  setUrlFetchTestHooks(null);
});

describe("POST /api/applications/preview-url", () => {
  it("returns title, description, and text from a public page", async () => {
    const html = `<html><head><title>Future Engineers Scholarship</title></head><body><p>${"Apply for the scholarship today. ".repeat(
      30,
    )}</p></body></html>`;
    const { server, port } = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    });
    setUrlFetchTestHooks({
      allowPrivate: true,
      lookupAll: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    try {
      const app = ctx.app();
      const res = await request(app)
        .post("/api/applications/preview-url")
        .send({ url: `http://example.test:${port}/scholarship` })
        .expect(200);
      expect(res.body.title).toBe("Future Engineers Scholarship");
      expect(res.body.description.length).toBeLessThanOrEqual(300);
      expect(res.body.text).toContain("Apply for the scholarship");
    } finally {
      server.close();
    }
  });

  it("rejects blocked hosts with the standard error shape", async () => {
    const app = ctx.app();
    const res = await request(app)
      .post("/api/applications/preview-url")
      .send({ url: "http://localhost/admin" })
      .expect(400);
    expect(res.body.error.code).toBe("BLOCKED_HOST");
  });

  it("rejects invalid URLs", async () => {
    const app = ctx.app();
    const res = await request(app)
      .post("/api/applications/preview-url")
      .send({ url: "not-a-url" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
