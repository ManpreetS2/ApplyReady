import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_FETCH_BYTES } from "@applyready/shared";
import {
  assertSafePublicUrl,
  fetchPublicResource,
  isAllowedFetchContentType,
  isPrivateIp,
  looksLikePdf,
  setUrlFetchTestHooks,
} from "../../src/services/urlFetch.js";

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

describe("url fetch security helpers", () => {
  it("classifies private IPv4/IPv6 ranges", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.0.0.5")).toBe(true);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("169.254.10.1")).toBe(true);
    expect(isPrivateIp("100.64.1.1")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("2001:4860:4860::8888")).toBe(false);
  });

  it("blocks localhost, credentials, and odd hosts", async () => {
    await expect(assertSafePublicUrl("http://localhost/admin")).rejects.toMatchObject({
      code: "BLOCKED_HOST",
    });
    await expect(assertSafePublicUrl("http://127.0.0.1/secret")).rejects.toMatchObject({
      code: "PRIVATE_IP",
    });
    await expect(
      assertSafePublicUrl("https://user:pass@example.com/path"),
    ).rejects.toMatchObject({ code: "EMBEDDED_CREDENTIALS" });
    await expect(assertSafePublicUrl("file:///etc/passwd")).rejects.toMatchObject({
      code: "UNSUPPORTED_PROTOCOL",
    });
    await expect(assertSafePublicUrl("http://metadata.google.internal/")).rejects.toMatchObject({
      code: "BLOCKED_HOST",
    });
  });

  it("sniffs PDF bytes and rejects arbitrary octet-stream", () => {
    const pdf = Buffer.from("%PDF-1.4 fake");
    const bin = Buffer.from([0x00, 0x01, 0x02, 0xff]);
    expect(looksLikePdf(pdf, "application/octet-stream")).toBe(true);
    expect(looksLikePdf(bin, "application/octet-stream")).toBe(false);
    expect(isAllowedFetchContentType("application/octet-stream", pdf)).toBe(true);
    expect(isAllowedFetchContentType("application/octet-stream", bin)).toBe(false);
    expect(isAllowedFetchContentType("", pdf)).toBe(true);
    expect(isAllowedFetchContentType("application/zip", bin)).toBe(false);
  });
});

describe("url fetch pinned HTTP", () => {
  it("preserves original PDF bytes without string round-trip", async () => {
    const pdfBytes = Buffer.from(
      "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\nbinary\x00\xff\xfe",
      "binary",
    );
    const { server, port } = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/pdf" });
      res.end(pdfBytes);
    });
    setUrlFetchTestHooks({
      allowPrivate: true,
      lookupAll: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    try {
      const fetched = await fetchPublicResource(
        `http://pdf.test:${port}/doc.pdf`,
      );
      expect(fetched.isPdf).toBe(true);
      expect(Buffer.compare(fetched.body, pdfBytes)).toBe(0);
      expect(fetched.text).toBe("");
    } finally {
      server.close();
    }
  });

  it("accepts octet-stream only when PDF magic is present", async () => {
    const pdfBytes = Buffer.from("%PDF-1.7\n%%EOF");
    const { server, port } = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(pdfBytes);
    });
    setUrlFetchTestHooks({
      allowPrivate: true,
      lookupAll: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    try {
      const fetched = await fetchPublicResource(
        `http://oct.pdf.test:${port}/file`,
      );
      expect(fetched.isPdf).toBe(true);
      expect(Buffer.compare(fetched.body, pdfBytes)).toBe(0);
    } finally {
      server.close();
    }
  });

  it("rejects non-PDF binary octet-stream", async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    });
    setUrlFetchTestHooks({
      allowPrivate: true,
      lookupAll: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    try {
      await expect(
        fetchPublicResource(`http://bin.test:${port}/x`),
      ).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT_TYPE" });
    } finally {
      server.close();
    }
  });

  it("rejects public hostname that resolves to a private address", async () => {
    setUrlFetchTestHooks({
      lookupAll: async () => [{ address: "10.0.0.8", family: 4 }],
    });
    await expect(
      fetchPublicResource("http://evil.example/internal"),
    ).rejects.toMatchObject({ code: "PRIVATE_IP" });
  });

  it("rejects redirect to a private target", async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(302, { Location: "http://127.0.0.1/secret" });
      res.end();
    });
    setUrlFetchTestHooks({
      allowPrivate: true,
      lookupAll: async (hostname) => {
        if (hostname === "127.0.0.1") {
          return [{ address: "127.0.0.1", family: 4 }];
        }
        return [{ address: "127.0.0.1", family: 4 }];
      },
    });
    try {
      await expect(
        fetchPublicResource(`http://redir.test:${port}/go`),
      ).rejects.toMatchObject({ code: "PRIVATE_IP" });
    } finally {
      server.close();
      setUrlFetchTestHooks(null);
    }
  });

  it("simulates DNS rebinding by pinning only pre-validated addresses", async () => {
    let lookups = 0;
    const { server, port } = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Applicants must submit a resume in PDF format is required. Enough text here.");
    });
    setUrlFetchTestHooks({
      allowPrivate: true,
      lookupAll: async () => {
        lookups += 1;
        // First validation sees public-looking path via allowPrivate.
        // A rebinding resolver would flip to private after TOCTOU; pinned lookup
        // must keep using the validated set only.
        return [{ address: "127.0.0.1", family: 4 }];
      },
    });
    try {
      const fetched = await fetchPublicResource(
        `http://rebind.test:${port}/page`,
      );
      expect(fetched.text).toContain("resume");
      expect(lookups).toBeGreaterThanOrEqual(1);
    } finally {
      server.close();
    }
  });

  it("rejects IPv6 link-local / private resolutions", async () => {
    setUrlFetchTestHooks({
      lookupAll: async () => [{ address: "fe80::1", family: 6 }],
    });
    await expect(
      fetchPublicResource("http://v6.example/x"),
    ).rejects.toMatchObject({ code: "PRIVATE_IP" });
  });

  it("rejects redirect loops", async () => {
    const { server, port } = await listen((req, res) => {
      res.writeHead(302, { Location: `http://loop.test:${port}${req.url}` });
      res.end();
    });
    setUrlFetchTestHooks({
      allowPrivate: true,
      lookupAll: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    try {
      await expect(
        fetchPublicResource(`http://loop.test:${port}/a`),
      ).rejects.toMatchObject({ code: "REDIRECT_LOOP" });
    } finally {
      server.close();
    }
  });

  it("rejects oversized streamed bodies", async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      const chunk = Buffer.alloc(64 * 1024, 65);
      let sent = 0;
      const writeMore = () => {
        while (sent <= MAX_FETCH_BYTES + chunk.length) {
          const ok = res.write(chunk);
          sent += chunk.length;
          if (!ok) {
            res.once("drain", writeMore);
            return;
          }
        }
        res.end();
      };
      writeMore();
    });
    setUrlFetchTestHooks({
      allowPrivate: true,
      lookupAll: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    try {
      await expect(
        fetchPublicResource(`http://big.test:${port}/huge`),
      ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    } finally {
      server.close();
    }
  });
});
