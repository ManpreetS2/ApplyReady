import request from "supertest";
import { describe, expect, it } from "vitest";
import { Repositories } from "../../src/db/repositories.js";
import { analyzeApplication } from "../../src/services/analysis/analyze.js";
import { computeReadiness } from "../../src/services/readiness/score.js";
import { ingestPastedText } from "../../src/services/requirements/ingest.js";
import { newId } from "../../src/utils/ids.js";
import { useTempDb } from "../helpers.js";
import type { Requirement } from "@applyready/shared";

const ctx = useTempDb();

function baseReq(partial: Partial<Requirement>): Requirement {
  return {
    id: partial.id || newId(),
    applicationId: "a",
    sourceId: null,
    title: partial.title || "Req",
    description: partial.description || "",
    category: partial.category || "resume",
    required: partial.required ?? false,
    certainty: partial.certainty || "uncertain",
    conditional: false,
    conditionText: null,
    applicability: "applicable",
    sourceType: "pasted_text",
    sourceName: "t",
    sourceUrl: null,
    sourceEvidence: "evidence",
    sourceLocation: null,
    confidence: 0.5,
    confidenceLevel: "medium",
    extractionRule: "test",
    userConfirmed: partial.userConfirmed ?? false,
    acceptedDocumentTypes: [],
    acceptedFileExtensions: [],
    minimumCount: 1,
    maximumCount: null,
    wordLimitMinimum: null,
    wordLimitMaximum: null,
    pageLimitMinimum: null,
    pageLimitMaximum: null,
    filenamePattern: null,
    signatureRequired: false,
    dateRequirement: partial.dateRequirement ?? null,
    expirationRule: null,
    requiredKeywords: [],
    organizationNameExpected: null,
    customValidationNotes: null,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("uncertain requirement resolution", () => {
  it("rejects generic confirmation while certainty is uncertain", async () => {
    const app = ctx.app();
    const created = await request(app)
      .post("/api/applications")
      .send({ name: "U", organization: "Org", type: "scholarship" })
      .expect(201);
    const id = created.body.application.id as string;
    const sources = await request(app)
      .post(`/api/applications/${id}/sources/text`)
      .send({
        text: "Students often include a portfolio with their materials.",
        sourceName: "t",
      })
      .expect(201);
    const uncertain = sources.body.requirements.find(
      (r: { certainty: string }) => r.certainty === "uncertain",
    );
    expect(uncertain).toBeTruthy();

    const blocked = await request(app)
      .post(`/api/requirements/${uncertain.id}/confirm`)
      .send({})
      .expect(400);
    expect(blocked.body.error.code).toBe("CERTAINTY_REQUIRED");

    const afterGeneric = await request(app)
      .post(`/api/applications/${id}/analyze`)
      .expect(200);
    expect(
      afterGeneric.body.issues.some(
        (i: { code: string }) => i.code === "UNCERTAIN_REQUIREMENT",
      ),
    ).toBe(true);
  });

  it("resolving uncertain -> required participates in missing-doc checks", async () => {
    const app = ctx.app();
    const created = await request(app)
      .post("/api/applications")
      .send({ name: "U2", organization: "Org", type: "scholarship" })
      .expect(201);
    const id = created.body.application.id as string;
    const sources = await request(app)
      .post(`/api/applications/${id}/sources/text`)
      .send({
        text: "Students often include a portfolio with their materials.",
        sourceName: "t",
      })
      .expect(201);
    const uncertain = sources.body.requirements.find(
      (r: { certainty: string }) => r.certainty === "uncertain",
    );

    const confirmed = await request(app)
      .post(`/api/requirements/${uncertain.id}/confirm`)
      .send({ certainty: "required" })
      .expect(200);
    expect(confirmed.body.requirement.certainty).toBe("required");
    expect(confirmed.body.requirement.required).toBe(true);

    const analysis = await request(app)
      .post(`/api/applications/${id}/analyze`)
      .expect(200);
    expect(
      analysis.body.issues.some((i: { code: string }) => i.code === "MISSING_DOCUMENT"),
    ).toBe(true);
    expect(analysis.body.report.status).toBe("not_ready");
  });

  it("resolving uncertain -> optional does not become blocking", async () => {
    const app = ctx.app();
    const created = await request(app)
      .post("/api/applications")
      .send({ name: "U3", organization: "Org", type: "scholarship" })
      .expect(201);
    const id = created.body.application.id as string;
    const sources = await request(app)
      .post(`/api/applications/${id}/sources/text`)
      .send({
        text: "Students often include a portfolio with their materials.",
        sourceName: "t",
      })
      .expect(201);
    const uncertain = sources.body.requirements.find(
      (r: { certainty: string }) => r.certainty === "uncertain",
    );

    await request(app)
      .post(`/api/requirements/${uncertain.id}/confirm`)
      .send({ certainty: "optional" })
      .expect(200);

    const analysis = await request(app)
      .post(`/api/applications/${id}/analyze`)
      .expect(200);
    expect(
      analysis.body.issues.some((i: { code: string }) => i.code === "MISSING_DOCUMENT"),
    ).toBe(false);
    expect(
      analysis.body.issues.some(
        (i: { code: string }) => i.code === "UNCERTAIN_REQUIREMENT",
      ),
    ).toBe(false);
  });
});

describe("enrollment three-state profile logic", () => {
  async function seedEnrollmentApp() {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "Enroll",
      organization: "Org",
      type: "scholarship",
    });
    await ingestPastedText(
      db,
      app.id,
      "Applicants must be enrolled in a college or university for the academic year.",
      "rules",
    );
    return { db, repos, app };
  }

  it("passes only when currentlyEnrolled=true and profile is confirmed", async () => {
    const { db, repos, app } = await seedEnrollmentApp();
    repos.updateProfile(app.id, {
      currentlyEnrolled: true,
      userConfirmed: true,
    });
    const result = analyzeApplication(db, app.id);
    expect(result.issues.some((i) => i.code.startsWith("ENROLLMENT"))).toBe(false);
  });

  it("blocks when currentlyEnrolled=false and profile is confirmed", async () => {
    const { db, repos, app } = await seedEnrollmentApp();
    repos.updateProfile(app.id, {
      currentlyEnrolled: false,
      userConfirmed: true,
    });
    const result = analyzeApplication(db, app.id);
    expect(
      result.issues.some(
        (i) => i.code === "ENROLLMENT_FAILED" && i.severity === "blocking",
      ),
    ).toBe(true);
    expect(result.report.status).toBe("not_ready");
  });

  it("needs confirmation when currentlyEnrolled is set without profile confirmation", async () => {
    const { db, repos, app } = await seedEnrollmentApp();
    repos.updateProfile(app.id, {
      currentlyEnrolled: true,
      userConfirmed: false,
    });
    const result = analyzeApplication(db, app.id);
    expect(
      result.issues.some(
        (i) => i.code === "ENROLLMENT" && i.severity === "needs_confirmation",
      ),
    ).toBe(true);
  });

  it("needs confirmation when currentlyEnrolled is null", async () => {
    const appHttp = ctx.app();
    const created = await request(appHttp)
      .post("/api/applications")
      .send({ name: "Enroll API", organization: "Org", type: "scholarship" })
      .expect(201);
    const id = created.body.application.id as string;
    await request(appHttp)
      .post(`/api/applications/${id}/sources/text`)
      .send({
        text: "Applicants must be enrolled in a college or university for the academic year.",
        sourceName: "rules",
      })
      .expect(201);
    await request(appHttp)
      .patch(`/api/applications/${id}/profile`)
      .send({ school: "De Anza College", currentlyEnrolled: null, userConfirmed: true })
      .expect(200);
    const analysis = await request(appHttp)
      .post(`/api/applications/${id}/analyze`)
      .expect(200);
    expect(
      analysis.body.issues.some(
        (i: { code: string; severity: string }) =>
          i.code === "ENROLLMENT" && i.severity === "needs_confirmation",
      ),
    ).toBe(true);
  });
});

describe("readiness status ordering for eligibility-only apps", () => {
  it("failed eligibility-only GPA is not_ready, not unable_to_determine", () => {
    const req = baseReq({
      id: "gpa1",
      title: "Minimum GPA",
      category: "proof_of_eligibility",
      required: true,
      certainty: "required",
      description: "minimum GPA of 3.0",
    });
    const report = computeReadiness({
      applicationId: "a",
      requirements: [req],
      matches: [],
      issues: [
        {
          id: "i1",
          applicationId: "a",
          requirementId: req.id,
          documentId: null,
          severity: "blocking",
          code: "MINIMUM_GPA",
          title: "GPA",
          explanation: "below",
          evidence: null,
          recommendedFix: null,
          status: "open",
          dismissible: false,
          createdAt: "",
          updatedAt: "",
        },
      ],
      conflicts: [],
    });
    expect(report.status).toBe("not_ready");
  });

  it("unresolved eligibility-only enrollment is needs_attention", () => {
    const req = baseReq({
      id: "en1",
      title: "Enrollment Requirement",
      category: "proof_of_enrollment",
      required: true,
      certainty: "required",
    });
    const report = computeReadiness({
      applicationId: "a",
      requirements: [req],
      matches: [],
      issues: [
        {
          id: "i1",
          applicationId: "a",
          requirementId: req.id,
          documentId: null,
          severity: "needs_confirmation",
          code: "ENROLLMENT",
          title: "Enrollment",
          explanation: "x",
          evidence: null,
          recommendedFix: null,
          status: "open",
          dismissible: true,
          createdAt: "",
          updatedAt: "",
        },
      ],
      conflicts: [],
    });
    expect(report.status).toBe("needs_attention");
  });

  it("satisfied eligibility-only requirement is ready", () => {
    const req = baseReq({
      id: "gpa2",
      title: "Minimum GPA",
      category: "proof_of_eligibility",
      required: true,
      certainty: "required",
      description: "minimum GPA of 3.0",
    });
    const report = computeReadiness({
      applicationId: "a",
      requirements: [req],
      matches: [],
      issues: [],
      conflicts: [],
    });
    expect(report.status).toBe("ready");
  });

  it("expired deadline with no document requirements is not_ready", () => {
    const req = baseReq({
      id: "d1",
      title: "Submission Deadline",
      category: "other",
      required: true,
      certainty: "required",
      dateRequirement: "2020-01-01",
    });
    const report = computeReadiness({
      applicationId: "a",
      requirements: [req],
      matches: [],
      issues: [
        {
          id: "i1",
          applicationId: "a",
          requirementId: req.id,
          documentId: null,
          severity: "blocking",
          code: "DEADLINE_EXPIRED",
          title: "Deadline",
          explanation: "past",
          evidence: null,
          recommendedFix: null,
          status: "open",
          dismissible: false,
          createdAt: "",
          updatedAt: "",
        },
      ],
      conflicts: [],
    });
    expect(report.status).toBe("not_ready");
  });
});
