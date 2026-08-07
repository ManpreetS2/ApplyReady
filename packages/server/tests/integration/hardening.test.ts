import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config.js";
import { Repositories } from "../../src/db/repositories.js";
import { startGuidedDemo } from "../../src/services/demo/demo.js";
import { cleanupStaleDemoApplications } from "../../src/services/demo/cleanup.js";
import { ingestUploadedSource } from "../../src/services/requirements/ingest.js";
import {
  buildDemoResumePdf,
  DEMO_REQUIREMENTS_TEXT,
} from "../../src/services/demo/content.js";
import { useTempDb } from "../helpers.js";

const ctx = useTempDb();

describe("cross-application integrity", () => {
  it("blocks assigning a document from another application", async () => {
    const app = ctx.app();
    const a = await request(app)
      .post("/api/applications")
      .send({ name: "A", organization: "Org", type: "scholarship" })
      .expect(201);
    const b = await request(app)
      .post("/api/applications")
      .send({ name: "B", organization: "Org", type: "scholarship" })
      .expect(201);

    const aId = a.body.application.id as string;
    const bId = b.body.application.id as string;

    const reqs = await request(app)
      .post(`/api/applications/${aId}/sources/text`)
      .send({ text: "A resume in PDF format is required.", sourceName: "t" })
      .expect(201);
    const requirementId = reqs.body.requirements.find(
      (r: { category: string }) => r.category === "resume",
    ).id as string;

    const upload = await request(app)
      .post(`/api/applications/${bId}/documents`)
      .attach("file", await buildDemoResumePdf(false), "resume.pdf")
      .expect(201);
    const documentId = upload.body.document.id as string;

    const blocked = await request(app)
      .post(`/api/requirements/${requirementId}/assign-document`)
      .send({ documentId })
      .expect(409);
    expect(blocked.body.error.code).toBe("CROSS_APPLICATION_DOCUMENT");
  });

  it("blocks cross-application requirement merges and self-merge", async () => {
    const app = ctx.app();
    const a = await request(app)
      .post("/api/applications")
      .send({ name: "A", organization: "Org", type: "scholarship" })
      .expect(201);
    const b = await request(app)
      .post("/api/applications")
      .send({ name: "B", organization: "Org", type: "scholarship" })
      .expect(201);
    const aId = a.body.application.id as string;
    const bId = b.body.application.id as string;

    const aReqs = await request(app)
      .post(`/api/applications/${aId}/sources/text`)
      .send({ text: "A resume in PDF format is required.", sourceName: "t" })
      .expect(201);
    const bReqs = await request(app)
      .post(`/api/applications/${bId}/sources/text`)
      .send({ text: "A resume in PDF format is required.", sourceName: "t" })
      .expect(201);

    const keepId = aReqs.body.requirements[0].id as string;
    const mergeId = bReqs.body.requirements[0].id as string;

    const cross = await request(app)
      .post(`/api/applications/${aId}/requirements/merge`)
      .send({ keepId, mergeId })
      .expect(409);
    expect(cross.body.error.code).toBe("CROSS_APPLICATION_MERGE");

    const self = await request(app)
      .post(`/api/applications/${aId}/requirements/merge`)
      .send({ keepId, mergeId: keepId })
      .expect(400);
    expect(self.body.error.code).toBe("INVALID_MERGE");
  });
});

describe("source upload cleanup", () => {
  it("does not persist uploaded requirement sources to disk", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "Src",
      organization: "Org",
      type: "scholarship",
    });
    const before = fs.existsSync(path.join(config.uploadsDir, "sources"))
      ? fs.readdirSync(path.join(config.uploadsDir, "sources"))
      : [];
    await ingestUploadedSource(
      db,
      app.id,
      Buffer.from(
        "Applicants must submit a resume in PDF format. Extra text for parsing length.",
      ),
      "requirements.txt",
      "text/plain",
    );
    const after = fs.existsSync(path.join(config.uploadsDir, "sources"))
      ? fs.readdirSync(path.join(config.uploadsDir, "sources"))
      : [];
    expect(after).toEqual(before);
  });

  it("leaves no source file after failed parsing", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "Fail",
      organization: "Org",
      type: "scholarship",
    });
    const before = fs.existsSync(path.join(config.uploadsDir, "sources"))
      ? fs.readdirSync(path.join(config.uploadsDir, "sources"))
      : [];
    await expect(
      ingestUploadedSource(
        db,
        app.id,
        Buffer.from("not-a-pdf"),
        "broken.pdf",
        "application/pdf",
      ),
    ).rejects.toBeTruthy();
    const after = fs.existsSync(path.join(config.uploadsDir, "sources"))
      ? fs.readdirSync(path.join(config.uploadsDir, "sources"))
      : [];
    expect(after).toEqual(before);
  });

  it("deleting an application leaves no orphaned source uploads", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "Del",
      organization: "Org",
      type: "scholarship",
    });
    await ingestUploadedSource(
      db,
      app.id,
      Buffer.from(DEMO_REQUIREMENTS_TEXT),
      "requirements.txt",
      "text/plain",
    );
    repos.deleteApplication(app.id);
    const sourcesDir = path.join(config.uploadsDir, "sources");
    const leftover = fs.existsSync(sourcesDir)
      ? fs.readdirSync(sourcesDir)
      : [];
    expect(leftover).toEqual([]);
  });
});

describe("public demo capacity", () => {
  it("enforces an active demo ceiling after cleanup", async () => {
    config.publicDemoMode = true;
    config.publicDemoMaxActiveDemos = 1;
    config.publicDemoTtlHours = 6;
    const db = ctx.db();

    await startGuidedDemo(db);
    await expect(startGuidedDemo(db)).rejects.toMatchObject({
      code: "DEMO_CAPACITY_REACHED",
      status: 503,
    });
  });

  it("allows a new demo after stale cleanup without deleting active demos", async () => {
    config.publicDemoMode = true;
    config.publicDemoMaxActiveDemos = 1;
    config.publicDemoTtlHours = 1;
    const db = ctx.db();
    const repos = new Repositories(db);

    const first = await startGuidedDemo(db);
    const firstId = first.application!.id;

    // Make the first demo stale.
    db.prepare(
      "UPDATE applications SET updated_at=? WHERE id=?",
    ).run(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), firstId);

    cleanupStaleDemoApplications(db);
    expect(repos.getApplication(firstId)).toBeNull();

    const second = await startGuidedDemo(db);
    expect(second.application?.id).toBeTruthy();
    expect(second.application?.id).not.toBe(firstId);
  });

  it("never deletes an active demo merely to create capacity", async () => {
    config.publicDemoMode = true;
    config.publicDemoMaxActiveDemos = 1;
    const db = ctx.db();
    const repos = new Repositories(db);
    const first = await startGuidedDemo(db);
    const firstId = first.application!.id;

    await expect(startGuidedDemo(db)).rejects.toMatchObject({
      code: "DEMO_CAPACITY_REACHED",
    });
    expect(repos.getApplication(firstId)?.isDemo).toBe(true);
  });
});
