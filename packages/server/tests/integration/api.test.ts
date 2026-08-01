import request from "supertest";
import { describe, expect, it } from "vitest";
import { useTempDb } from "../helpers.js";
import {
  buildDemoEssayPdf,
  buildDemoRecommendationPdf,
  buildDemoResumePdf,
  buildImageOnlyPdf,
  DEMO_REQUIREMENTS_TEXT,
} from "../../src/services/demo/content.js";
import http from "node:http";
import { AddressInfo } from "node:net";

const ctx = useTempDb();

describe("API lifecycle", () => {
  it("creates application, extracts requirements, uploads docs, analyzes", async () => {
    const app = ctx.app();
    const created = await request(app)
      .post("/api/applications")
      .send({
        name: "Test Scholarship",
        organization: "Future Engineers Foundation",
        type: "scholarship",
        deadline: "2026-10-15",
      })
      .expect(201);

    const id = created.body.application.id as string;

    const sources = await request(app)
      .post(`/api/applications/${id}/sources/text`)
      .send({ text: DEMO_REQUIREMENTS_TEXT, sourceName: "pasted" })
      .expect(201);

    expect(sources.body.requirements.length).toBeGreaterThan(3);

    const reqId = sources.body.requirements[0].id as string;
    await request(app)
      .patch(`/api/requirements/${reqId}`)
      .send({ title: "Updated Resume Requirement", userConfirmed: true })
      .expect(200);

    await request(app)
      .post(`/api/applications/${id}/documents`)
      .attach("file", await buildDemoResumePdf(true), "resume.pdf")
      .expect(201);

    await request(app)
      .post(`/api/applications/${id}/documents`)
      .attach("file", await buildDemoEssayPdf(true), "essay.pdf")
      .expect(201);

    await request(app)
      .post(`/api/applications/${id}/documents`)
      .attach("file", await buildDemoRecommendationPdf(true), "rec.pdf")
      .expect(201);

    const analysis = await request(app)
      .post(`/api/applications/${id}/analyze`)
      .expect(200);

    expect(analysis.body.report.status).not.toBe("ready");
    expect(
      analysis.body.issues.some((i: { code: string }) =>
        ["MISSING_DOCUMENT", "WORD_LIMIT_MAX", "ORGANIZATION_REFERENCE"].includes(
          i.code,
        ),
      ),
    ).toBe(true);

    const matches = analysis.body.matches as Array<{ id: string; status: string }>;
    if (matches[0]) {
      await request(app)
        .patch(`/api/document-matches/${matches[0].id}`)
        .send({ status: "confirmed", userConfirmed: true })
        .expect(200);
    }

    const detail = await request(app).get(`/api/applications/${id}`).expect(200);
    expect(detail.body.documents.length).toBe(3);

    await request(app)
      .delete(`/api/documents/${detail.body.documents[0].id}`)
      .expect(200);

    await request(app).delete(`/api/applications/${id}`).expect(200);
    await request(app).get(`/api/applications/${id}`).expect(404);
  });

  it("blocks localhost URL fetch", async () => {
    const app = ctx.app();
    const created = await request(app)
      .post("/api/applications")
      .send({
        name: "URL Test",
        organization: "Org",
        type: "scholarship",
      })
      .expect(201);
    const id = created.body.application.id;
    const res = await request(app)
      .post(`/api/applications/${id}/sources/url`)
      .send({ url: "http://127.0.0.1/requirements" })
      .expect(400);
    expect(res.body.error.code).toMatch(/PRIVATE_IP|BLOCKED_HOST/);
  });

  it("rejects path traversal style filenames and invalid mime", async () => {
    const app = ctx.app();
    const created = await request(app)
      .post("/api/applications")
      .send({
        name: "File Test",
        organization: "Org",
        type: "college",
      })
      .expect(201);
    const id = created.body.application.id;
    const res = await request(app)
      .post(`/api/applications/${id}/documents`)
      .attach("file", Buffer.from("hello"), {
        filename: "../evil.txt",
        contentType: "application/zip",
      });
    expect(res.status).toBe(400);
  });

  it("warns on image-only PDF upload", async () => {
    const app = ctx.app();
    const created = await request(app)
      .post("/api/applications")
      .send({
        name: "Scan Test",
        organization: "Org",
        type: "internship",
      })
      .expect(201);
    const id = created.body.application.id;
    const uploaded = await request(app)
      .post(`/api/applications/${id}/documents`)
      .attach("file", await buildImageOnlyPdf(), "scan.pdf")
      .expect(201);
    expect(uploaded.body.document.parseStatus).toBe("low_text");
  });

  it("fetches from a local test HTTP server with public hostname simulation blocked for private", async () => {
    // Positive path using pasted text already covered; ensure oversized fetch rejected via content-length style isn't needed.
    // Spin a tiny server and ensure non-private loopback still blocked by IP rules when using 127.0.0.1
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("Resume is required. Transcript is required.");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const app = ctx.app();
    const created = await request(app)
      .post("/api/applications")
      .send({ name: "S", organization: "O", type: "other" })
      .expect(201);
    await request(app)
      .post(`/api/applications/${created.body.application.id}/sources/url`)
      .send({ url: `http://127.0.0.1:${port}/reqs` })
      .expect(400);
    server.close();
  });
});
