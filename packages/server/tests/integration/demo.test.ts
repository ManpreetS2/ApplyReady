import request from "supertest";
import { describe, expect, it } from "vitest";
import { useTempDb } from "../helpers.js";

const ctx = useTempDb();

describe("guided demo", () => {
  it("starts not ready, advances through fixes, ends ready, and resets", async () => {
    const app = ctx.app();
    const started = await request(app).post("/api/demo/start").expect(201);
    const id = started.body.application.id as string;

    expect(started.body.analysis.report.status).toBe("not_ready");
    const initialCodes = new Set(
      started.body.analysis.issues.map((i: { code: string }) => i.code),
    );
    expect(initialCodes.has("MISSING_DOCUMENT")).toBe(true);

    let current = started;
    for (let i = 0; i < 6; i += 1) {
      current = await request(app).post(`/api/demo/${id}/fix`).expect(200);
    }

    expect(current.body.done).toBe(true);
    expect(current.body.analysis.report.status).toBe("ready");
    expect(
      current.body.analysis.issues.filter(
        (i: { status: string; severity: string }) =>
          i.status === "open" && i.severity === "blocking",
      ).length,
    ).toBe(0);

    const reset = await request(app).post(`/api/demo/${id}/reset`).expect(200);
    expect(reset.body.application.isDemo).toBe(true);
    expect(reset.body.analysis.report.status).toBe("not_ready");
  });
});
