import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Requirement } from "@applyready/shared";
import { Repositories } from "../../src/db/repositories.js";
import { migrateSchema } from "../../src/db/database.js";
import { analyzeApplication } from "../../src/services/analysis/analyze.js";
import { computeReadiness } from "../../src/services/readiness/score.js";
import { allocateDocuments } from "../../src/services/analysis/coverage.js";
import { RegexDocumentFactExtractor } from "../../src/services/documents/facts.js";
import { assessDeadline } from "../../src/services/deadlines/assess.js";
import { RuleRequirementExtractor } from "../../src/services/requirements/extractor.js";
import { ingestPastedText } from "../../src/services/requirements/ingest.js";
import { RuleDocumentValidator } from "../../src/services/validation/validator.js";
import { isGlobalUnicastIp, isPrivateIp } from "../../src/services/net/privateIp.js";
import { config } from "../../src/config.js";
import {
  startGuidedDemo,
  advanceGuidedDemo,
  resetGuidedDemo,
} from "../../src/services/demo/demo.js";
import { newId } from "../../src/utils/ids.js";
import { useTempDb } from "../helpers.js";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ctx = useTempDb();

function baseReq(
  partial: Partial<Requirement> & Pick<Requirement, "id" | "category" | "title">,
): Requirement {
  return {
    applicationId: "a",
    sourceId: null,
    description: partial.description || "",
    required: true,
    certainty: "required",
    conditional: false,
    conditionText: null,
    applicability: "applicable",
    sourceType: "pasted_text",
    sourceName: "t",
    sourceUrl: null,
    sourceEvidence: "evidence",
    sourceLocation: null,
    confidence: 0.9,
    confidenceLevel: "high",
    extractionRule: "test",
    userConfirmed: true,
    acceptedDocumentTypes: [partial.category],
    acceptedFileExtensions: [".pdf"],
    minimumCount: 1,
    maximumCount: null,
    wordLimitMinimum: null,
    wordLimitMaximum: null,
    pageLimitMinimum: null,
    pageLimitMaximum: null,
    filenamePattern: null,
    signatureRequired: false,
    dateRequirement: null,
    expirationRule: null,
    requiredKeywords: [],
    organizationNameExpected: null,
    customValidationNotes: null,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("correctness v2 — readiness needs_confirmation", () => {
  it("open generic needs_confirmation cannot be ready", () => {
    const report = computeReadiness({
      applicationId: "a",
      requirements: [
        baseReq({ id: "r1", category: "resume", title: "Resume" }),
      ],
      matches: [
        {
          id: "m1",
          applicationId: "a",
          requirementId: "r1",
          documentId: "d1",
          status: "confirmed",
          confidence: 1,
          explanation: "ok",
          evidence: [],
          userConfirmed: true,
          createdAt: "",
          updatedAt: "",
        },
      ],
      issues: [
        {
          id: "i1",
          applicationId: "a",
          requirementId: "r1",
          documentId: "d1",
          severity: "needs_confirmation",
          code: "SIGNATURE_TEXT",
          title: "Signature",
          explanation: "needs confirm",
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
    expect(report.status).not.toBe("ready");
    expect(report.status).toBe("needs_attention");
  });

  it("resolved needs_confirmation does not block", () => {
    const report = computeReadiness({
      applicationId: "a",
      requirements: [
        baseReq({ id: "r1", category: "resume", title: "Resume" }),
      ],
      matches: [
        {
          id: "m1",
          applicationId: "a",
          requirementId: "r1",
          documentId: "d1",
          status: "confirmed",
          confidence: 1,
          explanation: "ok",
          evidence: [],
          userConfirmed: true,
          createdAt: "",
          updatedAt: "",
        },
      ],
      issues: [
        {
          id: "i1",
          applicationId: "a",
          requirementId: "r1",
          documentId: "d1",
          severity: "needs_confirmation",
          code: "SIGNATURE_TEXT",
          title: "Signature",
          explanation: "needs confirm",
          evidence: null,
          recommendedFix: null,
          status: "resolved",
          dismissible: true,
          createdAt: "",
          updatedAt: "",
        },
      ],
      conflicts: [],
    });
    expect(report.status).toBe("ready");
  });

  it("blocking + needs_confirmation -> not_ready", () => {
    const report = computeReadiness({
      applicationId: "a",
      requirements: [
        baseReq({ id: "r1", category: "resume", title: "Resume" }),
      ],
      matches: [],
      issues: [
        {
          id: "i1",
          applicationId: "a",
          requirementId: "r1",
          documentId: null,
          severity: "blocking",
          code: "MISSING_DOCUMENT",
          title: "Missing",
          explanation: "missing",
          evidence: null,
          recommendedFix: null,
          status: "open",
          dismissible: false,
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "i2",
          applicationId: "a",
          requirementId: null,
          documentId: null,
          severity: "needs_confirmation",
          code: "VALUE_CONFLICT",
          title: "Conflict",
          explanation: "conflict",
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
    expect(report.status).toBe("not_ready");
  });
});

describe("correctness v2 — conflict lifecycle", () => {
  it("unresolved / equivalent / real mismatch / stale fixed conflict", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "Conflict App",
      organization: "Org",
      type: "scholarship",
    });
    await ingestPastedText(db, app.id, "A resume in PDF format is required.", "rules");
    for (const req of repos.listRequirements(app.id)) {
      repos.updateRequirement(req.id, { userConfirmed: true });
    }

    const d1 = newId();
    const d2 = newId();
    repos.createDocument({
      id: d1,
      applicationId: app.id,
      vaultDocumentId: null,
      originalFilename: "a.pdf",
      storedFilename: "a.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      pageCount: 1,
      wordCount: 30,
      title: null,
      category: "resume",
      categoryConfidence: 0.9,
      parseStatus: "parsed",
      parsingWarnings: [],
      contentHash: "h1",
      text: "Alex Chen\nGPA: 3.5\nResume content",
    });
    repos.createDocument({
      id: d2,
      applicationId: app.id,
      vaultDocumentId: null,
      originalFilename: "b.pdf",
      storedFilename: "b.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      pageCount: 1,
      wordCount: 30,
      title: null,
      category: "resume",
      categoryConfidence: 0.9,
      parseStatus: "parsed",
      parsingWarnings: [],
      contentHash: "h2",
      text: "Alex Chen\nGPA: 3.9\nResume content",
    });
    repos.replaceFacts(d1, [
      { factType: "gpa", value: "3.5", evidence: "GPA: 3.5", confidence: 0.9 },
      {
        factType: "full_legal_name",
        value: "Alex Chen",
        evidence: "Alex Chen",
        confidence: 0.8,
      },
    ]);
    repos.replaceFacts(d2, [
      { factType: "gpa", value: "3.9", evidence: "GPA: 3.9", confidence: 0.9 },
      {
        factType: "full_legal_name",
        value: "Alex Chen",
        evidence: "Alex Chen",
        confidence: 0.8,
      },
    ]);

    let result = analyzeApplication(db, app.id);
    const openConflict = result.conflicts.find((c) => c.field === "gpa");
    expect(openConflict).toBeTruthy();
    expect(openConflict?.equivalent).toBeNull();
    expect(result.report.status).not.toBe("ready");

    // equivalent=true does not block
    repos.resolveConflict(openConflict!.id, true);
    result = analyzeApplication(db, app.id);
    const afterEq = result.conflicts.find((c) => c.field === "gpa");
    expect(afterEq?.equivalent).toBe(true);
    expect(
      result.issues.some(
        (i) => i.code === "CONFIRMED_VALUE_MISMATCH" && i.status === "open",
      ),
    ).toBe(false);

    // equivalent=false blocks
    repos.resolveConflict(afterEq!.id, false);
    result = analyzeApplication(db, app.id);
    expect(
      result.issues.some(
        (i) =>
          i.code === "CONFIRMED_VALUE_MISMATCH" &&
          i.severity === "blocking" &&
          i.status === "open",
      ),
    ).toBe(true);
    expect(result.report.status).toBe("not_ready");

    // Fingerprint survives reanalysis while same conflict remains
    const fpConflict = result.conflicts.find((c) => c.field === "gpa");
    expect(fpConflict?.equivalent).toBe(false);

    // Correct underlying values — stale mismatch no longer blocks
    repos.replaceFacts(d2, [
      { factType: "gpa", value: "3.5", evidence: "GPA: 3.5", confidence: 0.9 },
      {
        factType: "full_legal_name",
        value: "Alex Chen",
        evidence: "Alex Chen",
        confidence: 0.8,
      },
    ]);
    result = analyzeApplication(db, app.id);
    expect(result.conflicts.some((c) => c.field === "gpa")).toBe(false);
    expect(
      result.issues.some(
        (i) => i.code === "CONFIRMED_VALUE_MISMATCH" && i.status === "open",
      ),
    ).toBe(false);

    // Changed value set creates a new unresolved conflict
    repos.replaceFacts(d2, [
      { factType: "gpa", value: "2.1", evidence: "GPA: 2.1", confidence: 0.9 },
    ]);
    result = analyzeApplication(db, app.id);
    const fresh = result.conflicts.find((c) => c.field === "gpa");
    expect(fresh?.equivalent).toBeNull();
    expect(fresh?.resolved).toBe(false);
  });
});

describe("correctness v2 — counts and allocation", () => {
  it("enforces minimumCount with distinct documents", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "Rec Count",
      organization: "Org",
      type: "scholarship",
    });
    await ingestPastedText(
      db,
      app.id,
      "Submit two recommendation letters.",
      "rules",
    );
    const rec = repos
      .listRequirements(app.id)
      .find((r) => r.category === "recommendation");
    expect(rec?.minimumCount).toBe(2);
    repos.updateRequirement(rec!.id, {
      userConfirmed: true,
      certainty: "required",
      required: true,
    });

    const d1 = newId();
    repos.createDocument({
      id: d1,
      applicationId: app.id,
      vaultDocumentId: null,
      originalFilename: "rec1.pdf",
      storedFilename: "rec1.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      pageCount: 1,
      wordCount: 40,
      title: null,
      category: "recommendation",
      categoryConfidence: 0.95,
      parseStatus: "parsed",
      parsingWarnings: [],
      contentHash: "r1",
      text: "Letter of Recommendation\nDear Committee,\nI recommend Alex.",
    });

    let result = analyzeApplication(db, app.id);
    expect(
      result.issues.some(
        (i) =>
          i.code === "INSUFFICIENT_DOCUMENT_COUNT" && i.status === "open",
      ),
    ).toBe(true);
    expect(result.report.status).toBe("not_ready");

    const d2 = newId();
    repos.createDocument({
      id: d2,
      applicationId: app.id,
      vaultDocumentId: null,
      originalFilename: "rec2.pdf",
      storedFilename: "rec2.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      pageCount: 1,
      wordCount: 40,
      title: null,
      category: "recommendation",
      categoryConfidence: 0.95,
      parseStatus: "parsed",
      parsingWarnings: [],
      contentHash: "r2",
      text: "Letter of Recommendation\nDear Committee,\nI also recommend Alex.",
    });
    result = analyzeApplication(db, app.id);
    expect(
      result.issues.some((i) => i.code === "INSUFFICIENT_DOCUMENT_COUNT"),
    ).toBe(false);

    // same document cannot count twice — allocation uses distinct ids
    const refreshed = repos.getRequirement(rec!.id)!;
    const { allocations } = allocateDocuments({
      requirements: [refreshed],
      documents: repos.listDocuments(app.id),
      candidates: [
        {
          requirementId: refreshed.id,
          documentId: d1,
          finding: {
            status: "likely",
            confidence: 0.9,
            explanation: "x",
            evidence: [],
          },
          userConfirmed: false,
        },
        {
          requirementId: refreshed.id,
          documentId: d1,
          finding: {
            status: "likely",
            confidence: 0.9,
            explanation: "x",
            evidence: [],
          },
          userConfirmed: false,
        },
      ],
    });
    expect(new Set(allocations.get(refreshed.id) || []).size).toBe(1);
  });

  it("two essays cannot share one document; companion packet+filename can", () => {
    const essayA = baseReq({
      id: "ea",
      category: "essay",
      title: "Essay Question 1",
    });
    const essayB = baseReq({
      id: "eb",
      category: "essay",
      title: "Essay Question 2",
    });
    const packet = baseReq({
      id: "p1",
      category: "combined_packet",
      title: "Combined Packet",
    });
    const filename = baseReq({
      id: "p2",
      category: "combined_packet",
      title: "Combined Packet Filename",
      filenamePattern: "LastName_FirstName_2026.pdf",
      extractionRule: "filename-pattern",
    });

    const oneEssay = allocateDocuments({
      requirements: [essayA, essayB],
      documents: [
        {
          id: "d1",
          applicationId: "a",
          vaultDocumentId: null,
          originalFilename: "essay.pdf",
          storedFilename: "essay.pdf",
          mimeType: "application/pdf",
          fileSize: 1,
          pageCount: 1,
          wordCount: 10,
          title: null,
          category: "essay",
          categoryConfidence: 1,
          parseStatus: "parsed",
          parsingWarnings: [],
          contentHash: "e",
          createdAt: "",
          updatedAt: "",
        },
      ],
      candidates: [
        {
          requirementId: "ea",
          documentId: "d1",
          finding: {
            status: "likely",
            confidence: 0.9,
            explanation: "",
            evidence: [],
          },
          userConfirmed: false,
        },
        {
          requirementId: "eb",
          documentId: "d1",
          finding: {
            status: "likely",
            confidence: 0.9,
            explanation: "",
            evidence: [],
          },
          userConfirmed: false,
        },
      ],
    });
    const covered = [...oneEssay.allocations.values()].filter((a) => a.length > 0);
    expect(covered.length).toBe(1);

    const companions = allocateDocuments({
      requirements: [packet, filename],
      documents: [
        {
          id: "pkt",
          applicationId: "a",
          vaultDocumentId: null,
          originalFilename: "Chen_Alex_2026.pdf",
          storedFilename: "Chen_Alex_2026.pdf",
          mimeType: "application/pdf",
          fileSize: 1,
          pageCount: 1,
          wordCount: 10,
          title: null,
          category: "combined_packet",
          categoryConfidence: 1,
          parseStatus: "parsed",
          parsingWarnings: [],
          contentHash: "p",
          createdAt: "",
          updatedAt: "",
        },
      ],
      candidates: [
        {
          requirementId: "p1",
          documentId: "pkt",
          finding: {
            status: "likely",
            confidence: 0.9,
            explanation: "",
            evidence: [],
          },
          userConfirmed: false,
        },
        {
          requirementId: "p2",
          documentId: "pkt",
          finding: {
            status: "likely",
            confidence: 0.9,
            explanation: "",
            evidence: [],
          },
          userConfirmed: false,
        },
      ],
    });
    expect(companions.allocations.get("p1")).toEqual(["pkt"]);
    expect(companions.allocations.get("p2")).toEqual(["pkt"]);
  });

  it("maximumCount exceeded creates TOO_MANY_DOCUMENTS", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "Max Docs",
      organization: "Org",
      type: "scholarship",
    });
    const req = repos.createRequirement(app.id, {
      title: "Recommendations",
      category: "recommendation",
      sourceEvidence: "two letters max",
      certainty: "required",
      minimumCount: 1,
      maximumCount: 2,
    });
    for (let i = 0; i < 3; i += 1) {
      const id = newId();
      repos.createDocument({
        id,
        applicationId: app.id,
        vaultDocumentId: null,
        originalFilename: `rec${i}.pdf`,
        storedFilename: `rec${i}.pdf`,
        mimeType: "application/pdf",
        fileSize: 10,
        pageCount: 1,
        wordCount: 40,
        title: null,
        category: "recommendation",
        categoryConfidence: 0.95,
        parseStatus: "parsed",
        parsingWarnings: [],
        contentHash: `m${i}`,
        text: "Letter of Recommendation Dear Committee I recommend.",
      });
      repos.upsertMatch({
        id: newId(),
        applicationId: app.id,
        requirementId: req.id,
        documentId: id,
        status: "confirmed",
        confidence: 1,
        explanation: "manual",
        evidence: ["user"],
        userConfirmed: true,
      });
    }
    // Preserve confirmed matches across analyze
    const result = analyzeApplication(db, app.id);
    expect(
      result.issues.some(
        (i) => i.code === "TOO_MANY_DOCUMENTS" && i.status === "open",
      ),
    ).toBe(true);
  });
});

describe("correctness v2 — conditional applicability", () => {
  it("unknown / applicable / not_applicable", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "Cond",
      organization: "Org",
      type: "scholarship",
    });
    await ingestPastedText(
      db,
      app.id,
      "If applicable, submit a portfolio.",
      "rules",
    );
    const portfolio = repos
      .listRequirements(app.id)
      .find((r) => r.category === "portfolio");
    expect(portfolio?.conditional).toBe(true);
    expect(portfolio?.applicability).toBe("unknown");

    let result = analyzeApplication(db, app.id);
    expect(
      result.issues.some(
        (i) =>
          i.code === "CONDITIONAL_APPLICABILITY" &&
          i.severity === "needs_confirmation",
      ),
    ).toBe(true);
    expect(result.report.status).toBe("needs_attention");

    repos.updateRequirement(portfolio!.id, {
      applicability: "not_applicable",
      userConfirmed: true,
    });
    result = analyzeApplication(db, app.id);
    expect(
      result.issues.some((i) => i.code === "CONDITIONAL_APPLICABILITY"),
    ).toBe(false);
    expect(
      result.issues.some(
        (i) =>
          i.requirementId === portfolio!.id && i.code === "MISSING_DOCUMENT",
      ),
    ).toBe(false);

    repos.updateRequirement(portfolio!.id, {
      applicability: "applicable",
      certainty: "required",
      required: true,
      userConfirmed: true,
    });
    result = analyzeApplication(db, app.id);
    expect(
      result.issues.some(
        (i) =>
          i.requirementId === portfolio!.id &&
          (i.code === "MISSING_DOCUMENT" ||
            i.code === "INSUFFICIENT_DOCUMENT_COUNT"),
      ),
    ).toBe(true);
  });
});

describe("correctness v2 — enrollment facts", () => {
  it("extractor produces positive and negative enrollment facts", () => {
    const extractor = new RegexDocumentFactExtractor();
    const positive = extractor.extract(
      "Enrollment verification\nStudent is currently enrolled full-time at De Anza College.",
    );
    expect(
      positive.some(
        (f) =>
          f.factType === "enrollment" && f.value === "currently_enrolled=true",
      ),
    ).toBe(true);

    const negative = extractor.extract(
      "Student is not currently enrolled at any institution.",
    );
    expect(
      negative.some(
        (f) =>
          f.factType === "enrollment" && f.value === "currently_enrolled=false",
      ),
    ).toBe(true);

    const schoolOnly = extractor.extract(
      "De Anza College\nExpected Graduation: June 2027",
    );
    expect(schoolOnly.some((f) => f.factType === "enrollment")).toBe(false);
  });

  it("uses real extractor enrollment evidence in analysis", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "Enroll Doc",
      organization: "Org",
      type: "scholarship",
    });
    await ingestPastedText(
      db,
      app.id,
      "Applicants must be enrolled in a college or university for the academic year.",
      "rules",
    );
    const text =
      "Enrollment verification: Student is currently enrolled at De Anza College.";
    const facts = new RegexDocumentFactExtractor().extract(text);
    const id = newId();
    repos.createDocument({
      id,
      applicationId: app.id,
      vaultDocumentId: null,
      originalFilename: "enroll.pdf",
      storedFilename: "enroll.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      pageCount: 1,
      wordCount: 20,
      title: null,
      category: "proof_of_enrollment",
      categoryConfidence: 0.9,
      parseStatus: "parsed",
      parsingWarnings: [],
      contentHash: "en",
      text,
    });
    repos.replaceFacts(id, facts);
    const result = analyzeApplication(db, app.id);
    expect(result.issues.some((i) => i.code.startsWith("ENROLLMENT"))).toBe(
      false,
    );
  });
});

describe("correctness v2 — per-field profile confirmation", () => {
  it("auto-populated GPA does not inherit confirmation", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "Profile Fields",
      organization: "Org",
      type: "scholarship",
    });
    repos.updateProfile(app.id, {
      email: "alex@example.com",
      userConfirmed: true,
    });
    const profile = repos.getProfile(app.id)!;
    expect(profile.confirmedFields).toContain("email");
    expect(profile.confirmedFields).not.toContain("gpa");

    await ingestPastedText(
      db,
      app.id,
      "Applicants must have a minimum GPA of 3.0.",
      "rules",
    );
    const id = newId();
    repos.createDocument({
      id,
      applicationId: app.id,
      vaultDocumentId: null,
      originalFilename: "t.pdf",
      storedFilename: "t.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      pageCount: 1,
      wordCount: 20,
      title: null,
      category: "transcript",
      categoryConfidence: 0.9,
      parseStatus: "parsed",
      parsingWarnings: [],
      contentHash: "t",
      text: "GPA: 3.75",
    });
    repos.replaceFacts(id, [
      { factType: "gpa", value: "3.75", evidence: "GPA: 3.75", confidence: 0.9 },
    ]);
    analyzeApplication(db, app.id);
    const after = repos.getProfile(app.id)!;
    expect(after.gpa).toBe("3.75");
    expect(after.confirmedFields).not.toContain("gpa");
    expect(after.confirmedFields).toContain("email");
  });

  it("changing confirmed GPA clears confirmation unless reconfirmed", () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "GPA Change",
      organization: "Org",
      type: "scholarship",
    });
    repos.updateProfile(app.id, { gpa: "3.5", userConfirmed: true });
    expect(repos.getProfile(app.id)!.confirmedFields).toContain("gpa");
    repos.updateProfile(app.id, { gpa: "2.0" });
    expect(repos.getProfile(app.id)!.confirmedFields).not.toContain("gpa");
  });
});

describe("correctness v2 — nondismissible issues", () => {
  it("rejects manual resolve for nondismissible issues", async () => {
    const app = ctx.app();
    const created = await request(app)
      .post("/api/applications")
      .send({ name: "Issues", organization: "Org", type: "scholarship" })
      .expect(201);
    const id = created.body.application.id as string;
    await request(app)
      .post(`/api/applications/${id}/sources/text`)
      .send({
        text: "A resume in PDF format is required.",
        sourceName: "rules",
      })
      .expect(201);
    const analysis = await request(app)
      .post(`/api/applications/${id}/analyze`)
      .expect(200);
    const blocking = analysis.body.issues.find(
      (i: { dismissible: boolean; status: string }) =>
        !i.dismissible && i.status === "open",
    );
    expect(blocking).toBeTruthy();
    const rejected = await request(app)
      .patch(`/api/issues/${blocking.id}`)
      .send({ status: "resolved" })
      .expect(400);
    expect(rejected.body.error.code).toBe("ISSUE_REQUIRES_FIX");
  });
});

describe("correctness v2 — manual match survival", () => {
  it("preserves user-confirmed assignment across reanalysis", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "Manual Match",
      organization: "Org",
      type: "scholarship",
    });
    await ingestPastedText(
      db,
      app.id,
      "An essay between 400 and 500 words is required.",
      "rules",
    );
    const essay = repos
      .listRequirements(app.id)
      .find((r) => r.category === "essay")!;
    repos.updateRequirement(essay.id, { userConfirmed: true });
    const id = newId();
    repos.createDocument({
      id,
      applicationId: app.id,
      vaultDocumentId: null,
      originalFilename: "odd_name_xyz.pdf",
      storedFilename: "odd_name_xyz.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      pageCount: 1,
      wordCount: 450,
      title: null,
      category: "other",
      categoryConfidence: 0.2,
      parseStatus: "parsed",
      parsingWarnings: [],
      contentHash: "odd",
      text: "A ".repeat(450),
    });
    repos.upsertMatch({
      id: newId(),
      applicationId: app.id,
      requirementId: essay.id,
      documentId: id,
      status: "confirmed",
      confidence: 1,
      explanation: "manual",
      evidence: ["user"],
      userConfirmed: true,
    });
    const result = analyzeApplication(db, app.id);
    expect(
      result.matches.some(
        (m) =>
          m.requirementId === essay.id &&
          m.documentId === id &&
          m.userConfirmed,
      ),
    ).toBe(true);
  });
});

describe("correctness v2 — deadlines and pages and org", () => {
  it("assesses top-level application deadline and conflicts", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 3);
    const past = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterday.getUTCDate()).padStart(2, "0")}`;
    const app = repos.createApplication({
      name: "Deadline App",
      organization: "Org",
      type: "scholarship",
      deadline: past,
    });
    let result = analyzeApplication(db, app.id);
    expect(
      result.issues.some(
        (i) => i.code === "DEADLINE_EXPIRED" && i.status === "open",
      ),
    ).toBe(true);

    const futureApp = repos.createApplication({
      name: "Future Deadline",
      organization: "Org",
      type: "scholarship",
      deadline: "2099-12-01",
    });
    result = analyzeApplication(db, futureApp.id);
    expect(
      result.issues.some((i) => i.code === "DEADLINE_EXPIRED"),
    ).toBe(false);

    await ingestPastedText(
      db,
      futureApp.id,
      "Submission deadline: October 15, 2026.",
      "rules",
    );
    result = analyzeApplication(db, futureApp.id);
    expect(
      result.issues.some((i) => i.code === "DEADLINE_CONFLICT"),
    ).toBe(true);
  });

  it("preserves cutoff times and marks ambiguous TZ", () => {
    expect(
      assessDeadline("2026-10-15T17:00:00-07:00").status,
    ).not.toBe("ambiguous");
    const named = assessDeadline("October 15, 2026 at 5:00 PM PT");
    expect(named.status).toBe("ambiguous");
    expect(named.original).toContain("5:00 PM PT");
    const noTz = assessDeadline("October 15, 2026 at 5:00 PM");
    expect(noTz.status).toBe("ambiguous");
    expect(assessDeadline("October 15, 2026").status).not.toBe("ambiguous");
  });

  it("extracts page min/max/exact/range", () => {
    const extractor = new RuleRequirementExtractor();
    const maxOnly = extractor.extract(
      "Submit an essay of maximum 2 pages.",
      { applicationName: "A", organization: "O", sourceType: "pasted_text", sourceName: "t" },
    );
    expect(maxOnly[0]?.pageLimitMaximum).toBe(2);
    expect(maxOnly[0]?.pageLimitMinimum).toBeNull();

    const minOnly = extractor.extract(
      "Submit an essay of at least 2 pages.",
      { applicationName: "A", organization: "O", sourceType: "pasted_text", sourceName: "t" },
    );
    expect(minOnly[0]?.pageLimitMinimum).toBe(2);

    const exact = extractor.extract(
      "Submit an essay of 2 pages.",
      { applicationName: "A", organization: "O", sourceType: "pasted_text", sourceName: "t" },
    );
    expect(exact[0]?.pageLimitMinimum).toBe(2);
    expect(exact[0]?.pageLimitMaximum).toBe(2);

    const range = extractor.extract(
      "Submit an essay of 2-3 pages.",
      { applicationName: "A", organization: "O", sourceType: "pasted_text", sourceName: "t" },
    );
    expect(range[0]?.pageLimitMinimum).toBe(2);
    expect(range[0]?.pageLimitMaximum).toBe(3);

    const validator = new RuleDocumentValidator();
    const findings = validator.validate({
      requirement: baseReq({
        id: "p",
        category: "essay",
        title: "Essay",
        pageLimitMinimum: 2,
        pageLimitMaximum: 2,
      }),
      documentText: "hi",
      filename: "e.pdf",
      wordCount: 10,
      pageCount: 1,
      mimeType: "application/pdf",
    });
    expect(findings.some((f) => f.rule === "page_limit_min" && !f.passed)).toBe(
      true,
    );
  });

  it("does not invent organization requirements", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "Org Faithful",
      organization: "Future Engineers Scholarship",
      type: "scholarship",
    });
    await ingestPastedText(
      db,
      app.id,
      "One recommendation letter is required.",
      "rules",
    );
    const rec = repos
      .listRequirements(app.id)
      .find((r) => r.category === "recommendation")!;
    expect(rec.organizationNameExpected).toBeNull();

    await ingestPastedText(
      db,
      app.id,
      "The recommendation letter must be addressed to Future Engineers Scholarship.",
      "rules2",
    );
    const addressed = repos
      .listRequirements(app.id)
      .filter((r) => r.category === "recommendation")
      .some((r) => r.organizationNameExpected?.includes("Future Engineers"));
    expect(addressed).toBe(true);
  });
});

describe("correctness v2 — SSRF global unicast", () => {
  it("rejects special-use and allows global unicast", () => {
    expect(isGlobalUnicastIp("8.8.8.8")).toBe(true);
    expect(isGlobalUnicastIp("2001:4860:4860::8888")).toBe(true);
    expect(isGlobalUnicastIp("192.0.2.1")).toBe(false);
    expect(isGlobalUnicastIp("198.51.100.1")).toBe(false);
    expect(isGlobalUnicastIp("203.0.113.1")).toBe(false);
    expect(isGlobalUnicastIp("198.18.0.1")).toBe(false);
    expect(isGlobalUnicastIp("224.0.0.1")).toBe(false);
    expect(isGlobalUnicastIp("240.0.0.1")).toBe(false);
    expect(isGlobalUnicastIp("255.255.255.255")).toBe(false);
    expect(isGlobalUnicastIp("2001:db8::1")).toBe(false);
    expect(isGlobalUnicastIp("ff02::1")).toBe(false);
    expect(isGlobalUnicastIp("::ffff:192.0.2.1")).toBe(false);
    expect(isPrivateIp("192.0.2.1")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });
});

describe("correctness v2 — cleanup interval zero", () => {
  it("accepts 0 for PUBLIC_DEMO_CLEANUP_INTERVAL_MS", async () => {
    const { envNonNegativeNumber } = await import("../../src/config.js");
    const key = "APPLYREADY_TEST_CLEANUP_INTERVAL";
    delete process.env[key];
    expect(envNonNegativeNumber(key, 15)).toBe(15);
    process.env[key] = "0";
    expect(envNonNegativeNumber(key, 15)).toBe(0);
    process.env[key] = "120000";
    expect(envNonNegativeNumber(key, 15)).toBe(120000);
    process.env[key] = "-1";
    expect(envNonNegativeNumber(key, 15)).toBe(15);
    process.env[key] = "NaN";
    expect(envNonNegativeNumber(key, 15)).toBe(15);
    delete process.env[key];
  });
});

describe("correctness v2 — rate limit exemptions", () => {
  it("health and config remain available after general limiter exhaustion", async () => {
    const prevMax = config.rateLimit.max;
    const prevEnable = process.env.APPLYREADY_ENABLE_RATE_LIMIT;
    config.rateLimit.max = 3;
    process.env.APPLYREADY_ENABLE_RATE_LIMIT = "true";
    try {
      const app = ctx.app();
      for (let i = 0; i < 5; i += 1) {
        await request(app).get("/api/applications");
      }
      const limited = await request(app).get("/api/applications");
      expect(limited.status).toBe(429);
      await request(app).get("/api/health").expect(200);
      await request(app).get("/api/config").expect(200);
    } finally {
      config.rateLimit.max = prevMax;
      if (prevEnable === undefined) {
        delete process.env.APPLYREADY_ENABLE_RATE_LIMIT;
      } else {
        process.env.APPLYREADY_ENABLE_RATE_LIMIT = prevEnable;
      }
    }
  });
});

describe("correctness v2 — demo concurrency and reset", () => {
  it("serializes concurrent mutations to the same demo", async () => {
    const db = ctx.db();
    const started = await startGuidedDemo(db);
    const id = started.application!.id;
    await Promise.all([
      advanceGuidedDemo(db, id),
      advanceGuidedDemo(db, id),
    ]);
    const repos = new Repositories(db);
    const app = repos.getApplication(id)!;
    expect(app.demoStep).toBeGreaterThanOrEqual(1);
    const transcripts = repos
      .listDocuments(id)
      .filter((d) => d.category === "transcript");
    expect(transcripts.length).toBeLessThanOrEqual(1);
  });

  it("reset preserves demo id", async () => {
    const db = ctx.db();
    const started = await startGuidedDemo(db);
    const id = started.application!.id;
    const reset = await resetGuidedDemo(db, id);
    expect(reset.application!.id).toBe(id);
    expect(reset.application!.demoStep).toBe(0);
  });
});

describe("correctness v2 — migration", () => {
  it("adds applicability and confirmed_fields to existing schema", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ar-mig-"));
    const dbPath = path.join(tmp, "old.sqlite");
    const old = new Database(dbPath);
    old.exec(`
      CREATE TABLE applications (
        id TEXT PRIMARY KEY, name TEXT, organization TEXT, type TEXT,
        deadline TEXT, notes TEXT, readiness_score INTEGER, readiness_status TEXT,
        last_analyzed_at TEXT, is_demo INTEGER DEFAULT 0, demo_step INTEGER,
        created_at TEXT, updated_at TEXT
      );
      CREATE TABLE requirements (
        id TEXT PRIMARY KEY, application_id TEXT, source_id TEXT, title TEXT,
        description TEXT, category TEXT, required INTEGER, certainty TEXT,
        conditional INTEGER DEFAULT 0, condition_text TEXT,
        source_type TEXT, source_name TEXT, source_url TEXT, source_evidence TEXT,
        source_location TEXT, confidence REAL, confidence_level TEXT,
        extraction_rule TEXT, user_confirmed INTEGER, accepted_document_types TEXT,
        accepted_file_extensions TEXT, minimum_count INTEGER, maximum_count INTEGER,
        word_limit_minimum INTEGER, word_limit_maximum INTEGER,
        page_limit_minimum INTEGER, page_limit_maximum INTEGER,
        filename_pattern TEXT, signature_required INTEGER, date_requirement TEXT,
        expiration_rule TEXT, required_keywords TEXT, organization_name_expected TEXT,
        custom_validation_notes TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE TABLE applicant_profiles (
        id TEXT PRIMARY KEY, application_id TEXT, full_legal_name TEXT,
        preferred_name TEXT, email TEXT, phone TEXT, school TEXT,
        expected_graduation_date TEXT, major TEXT, gpa TEXT, address TEXT,
        target_organization TEXT, currently_enrolled INTEGER,
        user_confirmed INTEGER DEFAULT 0, updated_at TEXT
      );
    `);
    old
      .prepare(
        `INSERT INTO applicant_profiles (id, application_id, email, gpa, user_confirmed, updated_at)
         VALUES ('p1','a1','a@b.c','3.2',1,'now')`,
      )
      .run();
    old
      .prepare(
        `INSERT INTO requirements (id, application_id, title, description, category, required, certainty, conditional, source_evidence, confidence, confidence_level, user_confirmed, accepted_document_types, accepted_file_extensions, minimum_count, required_keywords, created_at, updated_at)
         VALUES ('r1','a1','Portfolio','If applicable', 'portfolio', 0, 'optional', 1, 'evidence', 0.5, 'medium', 0, '[]', '[]', 1, '[]', 'now', 'now')`,
      )
      .run();
    old.close();

    const instance = new Database(dbPath);
    instance.pragma("foreign_keys = ON");
    migrateSchema(instance);
    const cols = instance
      .prepare(`PRAGMA table_info(requirements)`)
      .all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "applicability")).toBe(true);
    const req = instance
      .prepare(`SELECT applicability FROM requirements WHERE id='r1'`)
      .get() as { applicability: string };
    expect(req.applicability).toBe("unknown");
    const profile = instance
      .prepare(`SELECT confirmed_fields FROM applicant_profiles WHERE id='p1'`)
      .get() as { confirmed_fields: string };
    const fields = JSON.parse(profile.confirmed_fields) as string[];
    expect(fields).toContain("email");
    expect(fields).toContain("gpa");
    instance.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
