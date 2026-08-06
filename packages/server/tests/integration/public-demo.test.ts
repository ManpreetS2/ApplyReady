import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTempDb } from "../helpers.js";
import { config } from "../../src/config.js";
import { Repositories } from "../../src/db/repositories.js";
import { cleanupStaleDemoApplications } from "../../src/services/demo/cleanup.js";
import { startGuidedDemo, advanceGuidedDemo } from "../../src/services/demo/demo.js";

const ctx = useTempDb({ publicDemoMode: true });

function expectPublicDemoOnly(body: { error?: { code?: string; message?: string } }) {
  expect(body.error?.code).toBe("PUBLIC_DEMO_ONLY");
  expect(body.error?.message).toMatch(/public portfolio demo/i);
}

describe("public demo mode security and concurrency", () => {
  beforeEach(() => {
    config.publicDemoMode = true;
    config.publicDemoTtlHours = 6;
    config.allowedOrigins = ["http://127.0.0.1:8787"];
  });

  afterEach(() => {
    config.publicDemoMode = false;
    config.isProduction = false;
    delete process.env.APPLYREADY_ENABLE_RATE_LIMIT;
  });

  it("health response does not reveal paths in public demo mode", async () => {
    const res = await request(ctx.app()).get("/api/health").expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mode).toBe("public-demo");
    expect(res.body.storage).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/\/Users\/|\/tmp\/|\\\\/);
  });

  it("blocks normal application creation and listing", async () => {
    const app = ctx.app();
    const create = await request(app)
      .post("/api/applications")
      .send({
        name: "Real App",
        organization: "Org",
        type: "scholarship",
      })
      .expect(403);
    expectPublicDemoOnly(create.body);

    const list = await request(app).get("/api/applications").expect(403);
    expectPublicDemoOnly(list.body);
  });

  it("blocks arbitrary URL ingestion and every upload endpoint", async () => {
    const app = ctx.app();
    const started = await request(app).post("/api/demo/start").expect(201);
    const id = started.body.application.id as string;

    const url = await request(app)
      .post(`/api/applications/${id}/sources/url`)
      .send({ url: "https://example.com" })
      .expect(403);
    expectPublicDemoOnly(url.body);

    const text = await request(app)
      .post(`/api/applications/${id}/sources/text`)
      .send({ text: "paste", sourceName: "x" })
      .expect(403);
    expectPublicDemoOnly(text.body);

    const sourceUpload = await request(app)
      .post(`/api/applications/${id}/sources/upload`)
      .attach("file", Buffer.from("hello"), "req.txt")
      .expect(403);
    expectPublicDemoOnly(sourceUpload.body);

    const docUpload = await request(app)
      .post(`/api/applications/${id}/documents`)
      .attach("file", Buffer.from("%PDF-1.4"), "doc.pdf")
      .expect(403);
    expectPublicDemoOnly(docUpload.body);

    const vaultUpload = await request(app)
      .post("/api/vault")
      .field("category", "resume")
      .attach("file", Buffer.from("%PDF-1.4"), "vault.pdf")
      .expect(403);
    expectPublicDemoOnly(vaultUpload.body);
  });

  it("blocks vault operations and global clear-all", async () => {
    const app = ctx.app();
    expectPublicDemoOnly((await request(app).get("/api/vault").expect(403)).body);
    expectPublicDemoOnly(
      (await request(app).delete("/api/settings/clear-all").expect(403)).body,
    );
  });

  it("storage endpoint omits paths and config is available", async () => {
    const app = ctx.app();
    const storage = await request(app).get("/api/settings/storage").expect(200);
    expect(storage.body.publicDemoMode).toBe(true);
    expect(storage.body.dataDir).toBeUndefined();
    expect(storage.body.uploadsDir).toBeUndefined();
    expect(storage.body.dbPath).toBeUndefined();
    expect(JSON.stringify(storage.body)).not.toMatch(/\/Users\/|\/tmp\/|\\\\/);

    const cfg = await request(app).get("/api/config").expect(200);
    expect(cfg.body.publicDemoMode).toBe(true);
    expect(cfg.body.mode).toBe("public-demo");
  });

  it("blocks reads and mutations for non-demo applications", async () => {
    config.publicDemoMode = false;
    const localApp = ctx.app();
    const created = await request(localApp)
      .post("/api/applications")
      .send({
        name: "Non Demo",
        organization: "Org",
        type: "scholarship",
      })
      .expect(201);
    const nonDemoId = created.body.application.id as string;

    config.publicDemoMode = true;
    const publicApp = ctx.app();
    const read = await request(publicApp)
      .get(`/api/applications/${nonDemoId}`)
      .expect(403);
    expectPublicDemoOnly(read.body);

    const exportRes = await request(publicApp)
      .get(`/api/applications/${nonDemoId}/export`)
      .expect(403);
    expectPublicDemoOnly(exportRes.body);

    const advance = await request(publicApp)
      .post(`/api/demo/${nonDemoId}/advance`)
      .expect(400);
    expect(advance.body.error?.code).toBe("NOT_DEMO");
  });

  it("allows guided-demo endpoints and reaches ready", async () => {
    const app = ctx.app();
    const started = await request(app).post("/api/demo/start").expect(201);
    const id = started.body.application.id as string;
    expect(started.body.application.isDemo).toBe(true);
    expect(started.body.analysis.report.status).toBe("not_ready");

    let current = started;
    for (let i = 0; i < 6; i += 1) {
      current = await request(app).post(`/api/demo/${id}/fix`).expect(200);
    }
    expect(current.body.done).toBe(true);
    expect(current.body.analysis.report.status).toBe("ready");

    await request(app).get(`/api/applications/${id}`).expect(200);
    await request(app).get(`/api/applications/${id}/export`).expect(200);
    await request(app).get("/api/demo/steps").expect(200);
  });

  it("two demo starts create different applications and stay isolated", async () => {
    const app = ctx.app();
    const a = await request(app).post("/api/demo/start").expect(201);
    const b = await request(app).post("/api/demo/start").expect(201);
    const idA = a.body.application.id as string;
    const idB = b.body.application.id as string;
    expect(idA).not.toBe(idB);

    await request(app).post(`/api/demo/${idA}/fix`).expect(200);
    const detailA = await request(app).get(`/api/applications/${idA}`).expect(200);
    const detailB = await request(app).get(`/api/applications/${idB}`).expect(200);
    expect(detailA.body.application.demoStep).toBe(1);
    expect(detailB.body.application.demoStep).toBe(0);

    let lastA = detailA;
    for (let i = 0; i < 5; i += 1) {
      lastA = await request(app).post(`/api/demo/${idA}/fix`).expect(200);
    }
    let lastB = b;
    for (let i = 0; i < 6; i += 1) {
      lastB = await request(app).post(`/api/demo/${idB}/fix`).expect(200);
    }

    expect(lastA.body.done).toBe(true);
    expect(lastA.body.analysis.report.status).toBe("ready");
    expect(lastB.body.done).toBe(true);
    expect(lastB.body.analysis.report.status).toBe("ready");

    const checkB = await request(app).get(`/api/applications/${idB}`).expect(200);
    expect(checkB.body.application.demoStep).toBe(6);
    const checkA = await request(app).get(`/api/applications/${idA}`).expect(200);
    expect(checkA.body.application.demoStep).toBe(6);
  });

  it("stale cleanup deletes only expired demos and never normal apps", async () => {
    config.publicDemoMode = false;
    const db = ctx.db();
    const repos = new Repositories(db);

    const normal = repos.createApplication({
      name: "Keep Me",
      organization: "Org",
      type: "scholarship",
      isDemo: false,
    });

    const freshDemo = await startGuidedDemo(db);
    const staleDemo = await startGuidedDemo(db);
    const freshId = freshDemo.application!.id;
    const staleId = staleDemo.application!.id;

    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    const boundaryKeep = new Date(
      Date.now() - 6 * 60 * 60 * 1000 + 60_000,
    ).toISOString();

    repos.setApplicationTimestamps(staleId, {
      createdAt: sevenHoursAgo,
      updatedAt: sevenHoursAgo,
    });
    repos.setApplicationTimestamps(freshId, {
      createdAt: boundaryKeep,
      updatedAt: boundaryKeep,
    });
    repos.setApplicationTimestamps(normal.id, {
      createdAt: sevenHoursAgo,
      updatedAt: sevenHoursAgo,
    });

    config.publicDemoTtlHours = 6;
    const result = cleanupStaleDemoApplications(db);
    expect(result.deleted).toBe(1);
    expect(repos.getApplication(staleId)).toBeNull();
    expect(repos.getApplication(freshId)).not.toBeNull();
    expect(repos.getApplication(normal.id)).not.toBeNull();
  });

  it("error responses contain no absolute filesystem paths", async () => {
    const app = ctx.app();
    const res = await request(app).post("/api/applications").send({}).expect(403);
    expect(JSON.stringify(res.body)).not.toMatch(/\/Users\/|\/home\/|\\\\[A-Za-z]/);
  });

  it("production CORS behavior does not allow arbitrary origins", async () => {
    config.isProduction = true;
    config.allowedOrigins = ["http://127.0.0.1:8787"];
    const app = ctx.app();
    const denied = await request(app)
      .get("/api/health")
      .set("Origin", "https://evil.example")
      .expect(403);
    expect(denied.body.error?.code).toBe("CORS_DENIED");

    const allowedListed = await request(app)
      .get("/api/health")
      .set("Origin", "http://127.0.0.1:8787")
      .expect(200);
    expect(allowedListed.body.ok).toBe(true);

    // Same-origin style Origin matching Host is allowed for SPA module scripts.
    const sameHost = await request(app)
      .get("/api/health")
      .set("Host", "demo.example")
      .set("Origin", "https://demo.example")
      .expect(200);
    expect(sameHost.body.ok).toBe(true);
    config.isProduction = false;
  });

  it("rate limiting returns a structured response", async () => {
    process.env.APPLYREADY_ENABLE_RATE_LIMIT = "true";
    const previous = { ...config.rateLimit };
    config.rateLimit.max = 3;
    config.rateLimit.windowMs = 60_000;
    const app = ctx.app();

    await request(app).get("/api/health").expect(200);
    await request(app).get("/api/health").expect(200);
    await request(app).get("/api/health").expect(200);
    const limited = await request(app).get("/api/health").expect(429);
    expect(limited.body.error?.code).toBe("RATE_LIMITED");

    Object.assign(config.rateLimit, previous);
  });

  it("starting a demo does not delete another active demo", async () => {
    const db = ctx.db();
    const first = await startGuidedDemo(db);
    const firstId = first.application!.id;
    await advanceGuidedDemo(db, firstId);
    const second = await startGuidedDemo(db);
    expect(second.application!.id).not.toBe(firstId);
    const repos = new Repositories(db);
    expect(repos.getApplication(firstId)?.demoStep).toBe(1);
  });

  it("rejects alternate methods, encoded traversal, and nested restricted paths", async () => {
    const app = ctx.app();
    const started = await request(app).post("/api/demo/start").expect(201);
    const id = started.body.application.id as string;

    for (const method of ["put", "patch", "delete"] as const) {
      const res = await request(app)[method](`/api/applications/${id}`).expect(403);
      expectPublicDemoOnly(res.body);
    }

    expectPublicDemoOnly(
      (await request(app).get(`/api/applications/${id}/requirements`).expect(403))
        .body,
    );
    expectPublicDemoOnly(
      (await request(app).get(`/api/applications/${id}/documents`).expect(403))
        .body,
    );
    expectPublicDemoOnly(
      (await request(app).post(`/api/applications/${id}/analyze`).expect(403)).body,
    );
    expectPublicDemoOnly(
      (await request(app).get("/api/applications/%2e%2e/vault").expect(403)).body,
    );
    expectPublicDemoOnly(
      (await request(app).post("/api/demo/start/../../vault").expect(403)).body,
    );
    expectPublicDemoOnly(
      (await request(app).get("/api/vault?x=/demo/start").expect(403)).body,
    );

    const missing = await request(app)
      .post("/api/demo/00000000-0000-4000-8000-000000000000/advance")
      .expect(404);
    expect(missing.body.error?.code).toBe("NOT_FOUND");
    expect(JSON.stringify(missing.body)).not.toMatch(/\/Users\/|\/home\/|\\\\/);
  });

  it("public export omits storage filenames", async () => {
    const app = ctx.app();
    const started = await request(app).post("/api/demo/start").expect(201);
    const id = started.body.application.id as string;
    const exported = await request(app)
      .get(`/api/applications/${id}/export`)
      .expect(200);
    expect(exported.body.documents?.length).toBeGreaterThan(0);
    for (const doc of exported.body.documents) {
      expect(doc.storedFilename).toBeUndefined();
      expect(doc.originalFilename).toBeTruthy();
    }
    expect(JSON.stringify(exported.body)).not.toMatch(/\/Users\/|\/tmp\/|\\\\/);
  });

  it("does not expose Zod flatten details in public demo mode", async () => {
    config.publicDemoMode = false;
    const local = ctx.app();
    // Switch after app creation so the request hits public mode error handler config.
    config.publicDemoMode = true;
    config.isProduction = true;
    const app = ctx.app();
    // Allowed route with invalid body still goes through Zod on local-only routes;
    // use a blocked route that never reaches Zod — instead hit demo start with huge
    // invalid content-type JSON on an allowed mutating path that has no body schema.
    // Validate production path sanitization via a deliberately invalid local create
    // while public mode is on (guard blocks before Zod):
    const blocked = await request(app).post("/api/applications").send({}).expect(403);
    expect(blocked.body.error?.details).toBeUndefined();

    config.publicDemoMode = false;
    config.isProduction = true;
    const validation = await request(local)
      .post("/api/applications")
      .send({})
      .expect(400);
    expect(validation.body.error?.code).toBe("VALIDATION_ERROR");
    expect(validation.body.error?.details).toBeUndefined();
    config.isProduction = false;
  });

  it("cleanup is a no-op when no demos exist and ignores already-deleted ids", async () => {
    const db = ctx.db();
    const empty = cleanupStaleDemoApplications(db);
    expect(empty.deleted).toBe(0);
    expect(empty.failed).toBe(0);

    const demo = await startGuidedDemo(db);
    const id = demo.application!.id;
    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    const repos = new Repositories(db);
    repos.setApplicationTimestamps(id, {
      createdAt: sevenHoursAgo,
      updatedAt: sevenHoursAgo,
    });
    repos.deleteApplication(id);
    const result = cleanupStaleDemoApplications(db);
    expect(result.deleted).toBe(0);
  });

  it("demo start rate limit is enforced separately from general traffic", async () => {
    process.env.APPLYREADY_ENABLE_RATE_LIMIT = "true";
    const previous = { ...config.rateLimit };
    config.rateLimit.max = 1000;
    config.rateLimit.windowMs = 60_000;
    config.rateLimit.demoStartMax = 2;
    config.rateLimit.demoStartWindowMs = 60_000;
    const app = ctx.app();

    await request(app).post("/api/demo/start").expect(201);
    await request(app).post("/api/demo/start").expect(201);
    const limited = await request(app).post("/api/demo/start").expect(429);
    expect(limited.body.error?.code).toBe("RATE_LIMITED");
    expect(JSON.stringify(limited.body)).not.toMatch(/\/Users\/|stack|at Object/);

    Object.assign(config.rateLimit, previous);
  });
});

describe("local mode storage disclosure", () => {
  const local = useTempDb({ publicDemoMode: false });

  it("local mode still exposes intended storage information", async () => {
    config.publicDemoMode = false;
    const res = await request(local.app()).get("/api/health").expect(200);
    expect(res.body.mode).toBe("local");
    expect(res.body.storage.dataDir).toBeTruthy();
    expect(res.body.storage.uploadsDir).toBeTruthy();
    expect(res.body.storage.dbPath).toBeTruthy();

    const storage = await request(local.app()).get("/api/settings/storage").expect(200);
    expect(storage.body.dataDir).toBeTruthy();
  });
});
