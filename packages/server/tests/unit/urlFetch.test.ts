import { describe, expect, it } from "vitest";
import { assertSafePublicUrl } from "../../src/services/urlFetch.js";

describe("url fetch security", () => {
  it("blocks localhost", async () => {
    await expect(assertSafePublicUrl("http://localhost/admin")).rejects.toMatchObject({
      code: "BLOCKED_HOST",
    });
  });

  it("blocks private IP", async () => {
    await expect(assertSafePublicUrl("http://127.0.0.1/secret")).rejects.toMatchObject({
      code: "PRIVATE_IP",
    });
  });

  it("blocks embedded credentials", async () => {
    await expect(
      assertSafePublicUrl("https://user:pass@example.com/path"),
    ).rejects.toMatchObject({ code: "EMBEDDED_CREDENTIALS" });
  });

  it("rejects non-http protocols", async () => {
    await expect(assertSafePublicUrl("file:///etc/passwd")).rejects.toMatchObject({
      code: "UNSUPPORTED_PROTOCOL",
    });
  });

  it("blocks redirect targets that resolve to private addresses", async () => {
    await expect(
      assertSafePublicUrl("http://127.0.0.1/secret"),
    ).rejects.toMatchObject({ code: "PRIVATE_IP" });
  });
});
