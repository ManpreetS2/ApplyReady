import request from "supertest";
import { describe, expect, it } from "vitest";
import { useTempDb } from "../helpers.js";
import { DEMO_SUGGESTED } from "../../src/services/demo/content.js";

const ctx = useTempDb();

async function start(app: ReturnType<typeof ctx.app>) {
  const started = await request(app).post("/api/demo/start").expect(201);
  return started.body.application.id as string;
}

async function fixSuggested(app: ReturnType<typeof ctx.app>, id: string) {
  return request(app)
    .post(`/api/demo/${id}/fix`)
    .send({ mode: "suggested" })
    .expect(200);
}

async function advanceTo(app: ReturnType<typeof ctx.app>, id: string, step: number) {
  for (let i = 0; i < 8; i += 1) {
    const detail = await request(app).get(`/api/applications/${id}`).expect(200);
    const current = detail.body.application.demoStep as number;
    if (current >= step) return;
    await fixSuggested(app, id);
  }
  const detail = await request(app).get(`/api/applications/${id}`).expect(200);
  expect(detail.body.application.demoStep).toBe(step);
}

describe("interactive guided demo", () => {
  it("rejects forward step skips while allowing rewind and no-op", async () => {
    const app = ctx.app();
    const id = await start(app);

    const skip = await request(app)
      .post(`/api/demo/${id}/step`)
      .send({ step: 6 })
      .expect(409);
    expect(skip.body.error.code).toBe("DEMO_FORWARD_SKIP_NOT_ALLOWED");

    await advanceTo(app, id, 2);
    const skipMid = await request(app)
      .post(`/api/demo/${id}/step`)
      .send({ step: 4 })
      .expect(409);
    expect(skipMid.body.error.code).toBe("DEMO_FORWARD_SKIP_NOT_ALLOWED");

    const rewind = await request(app)
      .post(`/api/demo/${id}/step`)
      .send({ step: 1 })
      .expect(200);
    expect(rewind.body.application.demoStep).toBe(1);

    const noop = await request(app)
      .post(`/api/demo/${id}/step`)
      .send({ step: 1 })
      .expect(200);
    expect(noop.body.application.demoStep).toBe(1);
  });

  it("keeps step 5 pre-finalization and finalizes only at step 6", async () => {
    const app = ctx.app();
    const id = await start(app);
    await advanceTo(app, id, 5);

    const at5 = await request(app).get(`/api/applications/${id}`).expect(200);
    expect(at5.body.application.demoStep).toBe(5);
    expect(at5.body.application.readinessStatus).not.toBe("ready");
    const packet = (at5.body.documents as Array<{ category: string; originalFilename: string }>).find(
      (d) => d.category === "combined_packet",
    );
    expect(packet?.originalFilename).toBe(DEMO_SUGGESTED.filename);

    const preview5 = await request(app).get(`/api/demo/${id}/fix-preview`).expect(200);
    expect(preview5.body.preview.kind).toBe("finalize");
    expect(preview5.body.preview.step).toBe(5);

    const to6 = await fixSuggested(app, id);
    expect(to6.body.application.demoStep).toBe(6);
    expect(to6.body.analysis.report.status).toBe("ready");
    expect(to6.body.done).toBe(true);

    const rewind5 = await request(app)
      .post(`/api/demo/${id}/step`)
      .send({ step: 5 })
      .expect(200);
    expect(rewind5.body.application.demoStep).toBe(5);
    expect(rewind5.body.analysis.report.status).not.toBe("ready");
    expect(rewind5.body.done).toBe(false);
  });

  it("returns live recommendation preview and advances on suggested org", async () => {
    const app = ctx.app();
    const id = await start(app);
    await advanceTo(app, id, 2);

    const preview = await request(app).get(`/api/demo/${id}/fix-preview`).expect(200);
    expect(preview.body.preview.field).toBe("organization");
    expect(preview.body.preview.currentValue).toBe(DEMO_SUGGESTED.badOrganization);
    expect(preview.body.preview.suggestedValue).toBe(DEMO_SUGGESTED.organization);

    const applied = await fixSuggested(app, id);
    expect(applied.body.application.demoStep).toBe(3);
    expect(applied.body.appliedFix.resolved).toBe(true);
  });

  it("processes wrong custom organization without advancing and updates preview", async () => {
    const app = ctx.app();
    const id = await start(app);
    await advanceTo(app, id, 2);

    const custom = await request(app)
      .post(`/api/demo/${id}/fix`)
      .send({ mode: "custom", value: "Stanford Scholarship" })
      .expect(200);

    expect(custom.body.application.demoStep).toBe(2);
    expect(custom.body.advanced).toBe(false);
    expect(custom.body.appliedFix).toMatchObject({
      mode: "custom",
      field: "organization",
      requestedValue: "Stanford Scholarship",
      extractedValue: "Stanford Scholarship",
      resolved: false,
    });

    const preview = await request(app).get(`/api/demo/${id}/fix-preview`).expect(200);
    expect(preview.body.preview.currentValue).toBe("Stanford Scholarship");
    expect(preview.body.preview.suggestedValue).toBe(DEMO_SUGGESTED.organization);
  });

  it("advances when custom organization matches the guided target", async () => {
    const app = ctx.app();
    const id = await start(app);
    await advanceTo(app, id, 2);

    const custom = await request(app)
      .post(`/api/demo/${id}/fix`)
      .send({ mode: "custom", value: DEMO_SUGGESTED.organization })
      .expect(200);

    expect(custom.body.application.demoStep).toBe(3);
    expect(custom.body.advanced).toBe(true);
    expect(custom.body.appliedFix.resolved).toBe(true);
    expect(custom.body.appliedFix.extractedValue).toBe(DEMO_SUGGESTED.organization);
  });

  it("extracts custom resume email through the real pipeline", async () => {
    const app = ctx.app();
    const id = await start(app);
    await advanceTo(app, id, 3);

    const custom = await request(app)
      .post(`/api/demo/${id}/fix`)
      .send({ mode: "custom", value: "visitor@example.com" })
      .expect(200);

    expect(custom.body.application.demoStep).toBe(3);
    expect(custom.body.advanced).toBe(false);
    expect(custom.body.appliedFix.extractedValue).toBe("visitor@example.com");
    expect(custom.body.appliedFix.resolved).toBe(false);

    const detail = await request(app).get(`/api/applications/${id}`).expect(200);
    const activity = detail.body.activity as Array<{
      metadata?: Record<string, unknown> | null;
    }>;
    const demoEdit = activity.find((e) => e.metadata?.demoEdit === true);
    expect(demoEdit?.metadata).toMatchObject({
      demoEdit: true,
      mode: "custom",
      field: "email",
      resolved: false,
    });
    expect(demoEdit?.metadata).not.toHaveProperty("requestedValue");
    expect(demoEdit?.metadata).not.toHaveProperty("extractedValue");
  });

  it("keeps invalid custom email as document current value without fabricating extraction", async () => {
    const app = ctx.app();
    const id = await start(app);
    await advanceTo(app, id, 3);

    const custom = await request(app)
      .post(`/api/demo/${id}/fix`)
      .send({ mode: "custom", value: "not-an-email" })
      .expect(200);

    expect(custom.body.application.demoStep).toBe(3);
    expect(custom.body.advanced).toBe(false);
    expect(custom.body.appliedFix.requestedValue).toBe("not-an-email");
    expect(custom.body.appliedFix.extractedValue).toBeNull();
    expect(custom.body.appliedFix.resolved).toBe(false);

    const detail = await request(app).get(`/api/applications/${id}`).expect(200);
    const resume = (
      detail.body.documents as Array<{ category: string; id: string }>
    ).find((d) => d.category === "resume");
    expect(resume).toBeTruthy();
    // Document text is not always exposed on detail; re-check via preview.
    const preview = await request(app).get(`/api/demo/${id}/fix-preview`).expect(200);
    expect(preview.body.preview.currentValue).toBe("not-an-email");
    expect(preview.body.preview.extractedValue).toBeNull();
    expect(preview.body.preview.suggestedValue).toBe(DEMO_SUGGESTED.email);
    expect(preview.body.preview.currentValue).not.toBe(DEMO_SUGGESTED.badEmail);
  });

  it("requires guidedConditionSatisfied for suggested fixes and every step 0-5 advances", async () => {
    const app = ctx.app();
    const id = await start(app);
    for (let step = 0; step < 6; step += 1) {
      const before = await request(app).get(`/api/applications/${id}`).expect(200);
      expect(before.body.application.demoStep).toBe(step);
      const fixed = await fixSuggested(app, id);
      expect(fixed.body.advanced).toBe(true);
      expect(fixed.body.appliedFix.resolved).toBe(true);
      expect(fixed.body.application.demoStep).toBe(step + 1);
    }
    expect(
      (await request(app).get(`/api/applications/${id}`).expect(200)).body.application
        .readinessStatus,
    ).toBe("ready");
  });

  it("does not advance suggested fix when guided condition is forced unmet", async () => {
    const { setDemoFixTestHooks } = await import("../../src/services/demo/demo.js");
    const app = ctx.app();
    const id = await start(app);
    setDemoFixTestHooks({ forceUnresolvedFor: id });
    try {
      const fixed = await request(app)
        .post(`/api/demo/${id}/fix`)
        .send({ mode: "suggested" })
        .expect(200);
      expect(fixed.body.advanced).toBe(false);
      expect(fixed.body.appliedFix.resolved).toBe(false);
      expect(fixed.body.application.demoStep).toBe(0);
    } finally {
      setDemoFixTestHooks(null);
    }
  });

  it("keeps step on wrong custom filename and rejects path traversal", async () => {
    const app = ctx.app();
    const id = await start(app);
    await advanceTo(app, id, 4);

    const wrong = await request(app)
      .post(`/api/demo/${id}/fix`)
      .send({ mode: "custom", value: "Wrong_Name_2026.pdf" })
      .expect(200);
    expect(wrong.body.application.demoStep).toBe(4);
    expect(wrong.body.advanced).toBe(false);
    expect(wrong.body.appliedFix.extractedValue).toBe("Wrong_Name_2026.pdf");

    const before = await request(app).get(`/api/applications/${id}`).expect(200);
    const beforePacket = (
      before.body.documents as Array<{ category: string; id: string; originalFilename: string }>
    ).find((d) => d.category === "combined_packet")!;

    await request(app)
      .post(`/api/demo/${id}/fix`)
      .send({ mode: "custom", value: "../evil.pdf" })
      .expect(400);

    const after = await request(app).get(`/api/applications/${id}`).expect(200);
    const afterPacket = (
      after.body.documents as Array<{ category: string; id: string; originalFilename: string }>
    ).find((d) => d.category === "combined_packet")!;
    expect(afterPacket.id).toBe(beforePacket.id);
    expect(afterPacket.originalFilename).toBe("Wrong_Name_2026.pdf");
    expect(after.body.application.demoStep).toBe(4);
  });

  it("shows transcript preview without an upload picker surface", async () => {
    const app = ctx.app();
    const id = await start(app);
    const preview = await request(app).get(`/api/demo/${id}/fix-preview`).expect(200);
    expect(preview.body.preview.kind).toBe("add_document");
    expect(preview.body.preview.suggestedValue).toBe(DEMO_SUGGESTED.transcriptFilename);
    expect(preview.body.preview.editable).toBe(false);
  });

  it("rewinds discard later custom edits and restores canonical earlier state", async () => {
    const app = ctx.app();
    const id = await start(app);
    await advanceTo(app, id, 2);

    await request(app)
      .post(`/api/demo/${id}/fix`)
      .send({ mode: "custom", value: "Stanford Scholarship" })
      .expect(200);

    const previewCustom = await request(app).get(`/api/demo/${id}/fix-preview`).expect(200);
    expect(previewCustom.body.preview.currentValue).toBe("Stanford Scholarship");

    await request(app).post(`/api/demo/${id}/step`).send({ step: 1 }).expect(200);
    await fixSuggested(app, id);

    const preview = await request(app).get(`/api/demo/${id}/fix-preview`).expect(200);
    expect(preview.body.application ?? preview.body.preview.step).toBeDefined();
    expect(preview.body.preview.step).toBe(2);
    expect(preview.body.preview.currentValue).toBe(DEMO_SUGGESTED.badOrganization);
  });

  it("isolates custom edits between two demo visitors", async () => {
    const app = ctx.app();
    const idA = await start(app);
    const idB = await start(app);
    await advanceTo(app, idA, 2);
    await advanceTo(app, idB, 2);

    await request(app)
      .post(`/api/demo/${idA}/fix`)
      .send({ mode: "custom", value: "Stanford Scholarship" })
      .expect(200);

    const previewB = await request(app).get(`/api/demo/${idB}/fix-preview`).expect(200);
    expect(previewB.body.preview.currentValue).toBe(DEMO_SUGGESTED.badOrganization);

    const detailA = await request(app).get(`/api/applications/${idA}`).expect(200);
    const detailB = await request(app).get(`/api/applications/${idB}`).expect(200);
    expect(detailA.body.application.demoStep).toBe(2);
    expect(detailB.body.application.demoStep).toBe(2);
    expect(detailA.body.application.id).not.toBe(detailB.body.application.id);
  });

  it("keeps local-mode /advance available for compatibility", async () => {
    const app = ctx.app();
    const id = await start(app);
    const advanced = await request(app).post(`/api/demo/${id}/advance`).expect(200);
    expect(advanced.body.application.demoStep).toBe(1);
  });
});
