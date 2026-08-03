import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDb } from "../helpers.js";
import { fileURLToPath } from "node:url";

const ctx = useTempDb();
const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../qa/fixtures/applyready",
);

describe("QA fixture pack", () => {
  it("bad packet is not ready; corrected packet becomes ready after confirmations", async () => {
    const app = ctx.app();
    const created = await request(app)
      .post("/api/applications")
      .send({
        name: "Future Engineers Scholarship QA",
        organization: "Future Engineers Foundation",
        type: "scholarship",
        deadline: "2026-10-15",
      })
      .expect(201);
    const id = created.body.application.id as string;

    await request(app)
      .patch(`/api/applications/${id}/profile`)
      .send({
        fullLegalName: "Jordan Lee",
        email: "jordan.lee@example.com",
        phone: "(555) 014-0268",
        school: "Redwood Community College",
        expectedGraduationDate: "May 2027",
        major: "Computer Science",
        gpa: "3.62",
        targetOrganization: "Future Engineers Foundation",
      })
      .expect(200);

    const text = fs.readFileSync(
      path.join(fixtures, "requirements/future_engineers_requirements.txt"),
      "utf8",
    );
    const sources = await request(app)
      .post(`/api/applications/${id}/sources/text`)
      .send({ text, sourceName: "official" })
      .expect(201);

    const portfolio = sources.body.requirements.find(
      (r: { category: string }) => r.category === "portfolio",
    );
    expect(portfolio?.required).toBe(false);

    for (const req of sources.body.requirements) {
      await request(app).post(`/api/requirements/${req.id}/confirm`).expect(200);
    }

    for (const file of [
      "Jordan_Lee_Resume.pdf",
      "Engineering_Essay_620_Words.docx",
      "Recommendation_Letter_Other_Scholarship.pdf",
      "JordanLeeFinal.pdf",
    ]) {
      await request(app)
        .post(`/api/applications/${id}/documents`)
        .attach("file", fs.readFileSync(path.join(fixtures, "initial_bad_packet", file)), file)
        .expect(201);
    }

    const bad = await request(app).post(`/api/applications/${id}/analyze`).expect(200);
    expect(bad.body.report.status).toBe("not_ready");
    const codes = bad.body.issues.map((i: { code: string }) => i.code);
    expect(codes).toContain("MISSING_DOCUMENT");
    expect(codes).toContain("WORD_LIMIT_MAX");
    expect(codes.some((c: string) => c.includes("ORGANIZATION"))).toBe(true);
    expect(codes).toContain("EMAIL_PROFILE_MISMATCH");

    const detail = await request(app).get(`/api/applications/${id}`).expect(200);
    for (const doc of detail.body.documents) {
      await request(app).delete(`/api/documents/${doc.id}`).expect(200);
    }

    for (const file of [
      "Lee_Jordan_Resume.pdf",
      "Lee_Jordan_Essay.docx",
      "Lee_Jordan_Recommendation.pdf",
      "Lee_Jordan_Transcript.pdf",
      "Lee_Jordan_2026.pdf",
    ]) {
      await request(app)
        .post(`/api/applications/${id}/documents`)
        .attach("file", fs.readFileSync(path.join(fixtures, "corrected_packet", file)), file)
        .expect(201);
    }

    let analysis = await request(app).post(`/api/applications/${id}/analyze`).expect(200);
    const best = new Map<string, { id: string; confidence: number }>();
    for (const match of analysis.body.matches) {
      if (match.status === "does_not_match") continue;
      const cur = best.get(match.requirementId);
      if (!cur || match.confidence > cur.confidence) best.set(match.requirementId, match);
    }
    for (const match of best.values()) {
      await request(app)
        .patch(`/api/document-matches/${match.id}`)
        .send({ status: "confirmed", userConfirmed: true })
        .expect(200);
    }

    const after = await request(app).get(`/api/applications/${id}`).expect(200);
    for (const conflict of after.body.conflicts) {
      if (!conflict.resolved) {
        await request(app)
          .post(`/api/conflicts/${conflict.id}/resolve`)
          .send({ equivalent: true })
          .expect(200);
      }
    }
    for (const issue of after.body.issues.filter(
      (i: { status: string; dismissible: boolean }) =>
        i.status === "open" && i.dismissible,
    )) {
      await request(app)
        .patch(`/api/issues/${issue.id}`)
        .send({ status: "dismissed" })
        .expect(200);
    }

    analysis = await request(app).post(`/api/applications/${id}/analyze`).expect(200);
    expect(analysis.body.report.status).toBe("ready");
  });

  it("handles edge-case uploads safely", async () => {
    const app = ctx.app();
    const created = await request(app)
      .post("/api/applications")
      .send({
        name: "Edge",
        organization: "Future Engineers Foundation",
        type: "scholarship",
      })
      .expect(201);
    const id = created.body.application.id;

    await request(app)
      .post(`/api/applications/${id}/documents`)
      .attach(
        "file",
        fs.readFileSync(path.join(fixtures, "edge_cases/empty_document.txt")),
        "empty_document.txt",
      )
      .expect(400);

    await request(app)
      .post(`/api/applications/${id}/documents`)
      .attach(
        "file",
        fs.readFileSync(path.join(fixtures, "edge_cases/unsupported_format.rtf")),
        {
          filename: "unsupported_format.rtf",
          contentType: "application/rtf",
        },
      )
      .expect(400);

    await request(app)
      .post(`/api/applications/${id}/documents`)
      .attach(
        "file",
        fs.readFileSync(
          path.join(fixtures, "edge_cases/invalid_mime_disguised_as_pdf.pdf"),
        ),
        {
          filename: "invalid_mime_disguised_as_pdf.pdf",
          contentType: "application/pdf",
        },
      )
      .expect(400);

    const pathLike = await request(app)
      .post(`/api/applications/${id}/documents`)
      .attach(
        "file",
        fs.readFileSync(path.join(fixtures, "edge_cases/.._.._Jordan_Lee_Resume.pdf")),
        ".._.._Jordan_Lee_Resume.pdf",
      )
      .expect(201);
    expect(pathLike.body.document.originalFilename.includes("..")).toBe(false);

    const lowText = await request(app)
      .post(`/api/applications/${id}/documents`)
      .attach(
        "file",
        fs.readFileSync(path.join(fixtures, "edge_cases/low_text_scan_like.pdf")),
        "low_text_scan_like.pdf",
      )
      .expect(201);
    expect(lowText.body.document.parseStatus).toBe("low_text");
    expect(JSON.stringify(lowText.body.document.parsingWarnings)).not.toMatch(
      /OCR successfully|performed OCR/i,
    );
  });
});
