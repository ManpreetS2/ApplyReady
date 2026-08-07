import { describe, expect, it } from "vitest";
import { Repositories } from "../../src/db/repositories.js";
import { analyzeApplication } from "../../src/services/analysis/analyze.js";
import { computeReadiness } from "../../src/services/readiness/score.js";
import { ingestPastedText } from "../../src/services/requirements/ingest.js";
import { newId } from "../../src/utils/ids.js";
import { useTempDb } from "../helpers.js";

const ctx = useTempDb();

describe("eligibility and readiness correctness", () => {
  it("does not treat school name alone as proof of enrollment", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "Enroll App",
      organization: "Org",
      type: "scholarship",
    });
    await ingestPastedText(
      db,
      app.id,
      "Applicants must be enrolled in a college or university for the academic year.",
      "rules",
    );
    const docId = newId();
    repos.createDocument({
      id: docId,
      applicationId: app.id,
      vaultDocumentId: null,
      originalFilename: "resume.pdf",
      storedFilename: "resume.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      pageCount: 1,
      wordCount: 20,
      title: "Resume",
      category: "resume",
      categoryConfidence: 0.9,
      parseStatus: "parsed",
      parsingWarnings: [],
      contentHash: "h1",
      text: "Alex Chen\nDe Anza College\nExpected Graduation: June 2027",
    });
    repos.replaceFacts(docId, [
      {
        factType: "school",
        value: "De Anza College",
        evidence: "De Anza College",
        confidence: 0.9,
      },
      {
        factType: "expected_graduation_date",
        value: "June 2027",
        evidence: "Expected Graduation: June 2027",
        confidence: 0.9,
      },
    ]);

    const result = analyzeApplication(db, app.id);
    expect(
      result.issues.some(
        (i) => i.code === "ENROLLMENT" && i.status === "open",
      ),
    ).toBe(true);
    expect(result.report.status).not.toBe("ready");
  });

  it("unresolved enrollment prevents ready status", () => {
    const report = computeReadiness({
      applicationId: "a",
      requirements: [],
      matches: [],
      issues: [
        {
          id: "i1",
          applicationId: "a",
          requirementId: "r1",
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
    expect(report.status).not.toBe("ready");
  });

  it("does not pass GPA by choosing Math.max across conflicting docs", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "GPA App",
      organization: "Org",
      type: "scholarship",
    });
    await ingestPastedText(
      db,
      app.id,
      "Applicants must have a minimum GPA of 3.0.",
      "rules",
    );
    const d1 = newId();
    const d2 = newId();
    repos.createDocument({
      id: d1,
      applicationId: app.id,
      vaultDocumentId: null,
      originalFilename: "t1.pdf",
      storedFilename: "t1.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      pageCount: 1,
      wordCount: 20,
      title: null,
      category: "transcript",
      categoryConfidence: 0.9,
      parseStatus: "parsed",
      parsingWarnings: [],
      contentHash: "a",
      text: "GPA: 3.8",
    });
    repos.createDocument({
      id: d2,
      applicationId: app.id,
      vaultDocumentId: null,
      originalFilename: "t2.pdf",
      storedFilename: "t2.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      pageCount: 1,
      wordCount: 20,
      title: null,
      category: "transcript",
      categoryConfidence: 0.9,
      parseStatus: "parsed",
      parsingWarnings: [],
      contentHash: "b",
      text: "GPA: 2.9",
    });
    repos.replaceFacts(d1, [
      {
        factType: "gpa",
        value: "3.8",
        evidence: "GPA: 3.8",
        confidence: 0.9,
      },
    ]);
    repos.replaceFacts(d2, [
      {
        factType: "gpa",
        value: "2.9",
        evidence: "GPA: 2.9",
        confidence: 0.9,
      },
    ]);

    const result = analyzeApplication(db, app.id);
    expect(
      result.issues.some((i) => i.code === "GPA_CONFLICT" && i.status === "open"),
    ).toBe(true);
    expect(result.report.status).not.toBe("ready");
  });

  it("uses confirmed profile GPA and does not override with a higher old doc GPA", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "GPA Profile",
      organization: "Org",
      type: "scholarship",
    });
    await ingestPastedText(
      db,
      app.id,
      "Applicants must have a minimum GPA of 3.0.",
      "rules",
    );
    repos.updateProfile(app.id, {
      gpa: "2.9",
      userConfirmed: true,
    });
    const d1 = newId();
    repos.createDocument({
      id: d1,
      applicationId: app.id,
      vaultDocumentId: null,
      originalFilename: "old.pdf",
      storedFilename: "old.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      pageCount: 1,
      wordCount: 20,
      title: null,
      category: "transcript",
      categoryConfidence: 0.9,
      parseStatus: "parsed",
      parsingWarnings: [],
      contentHash: "c",
      text: "GPA: 3.8",
    });
    repos.replaceFacts(d1, [
      {
        factType: "gpa",
        value: "3.8",
        evidence: "GPA: 3.8",
        confidence: 0.9,
      },
    ]);

    const result = analyzeApplication(db, app.id);
    expect(
      result.issues.some((i) => i.code === "MINIMUM_GPA" && i.status === "open"),
    ).toBe(true);
    const gpaValidation = result.validations.find((v) => v.rule === "minimum_gpa");
    expect(gpaValidation?.passed).toBe(false);
    expect(gpaValidation?.message).toMatch(/2\.9/);
  });

  it("passes when confirmed profile GPA meets the minimum", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "GPA Pass",
      organization: "Org",
      type: "scholarship",
    });
    await ingestPastedText(
      db,
      app.id,
      "Applicants must have a minimum GPA of 3.0.",
      "rules",
    );
    repos.updateProfile(app.id, {
      gpa: "3.5",
      userConfirmed: true,
    });
    const d1 = newId();
    repos.createDocument({
      id: d1,
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
      contentHash: "d",
      text: "GPA: 3.5",
    });
    repos.replaceFacts(d1, [
      {
        factType: "gpa",
        value: "3.5",
        evidence: "GPA: 3.5",
        confidence: 0.9,
      },
    ]);

    const result = analyzeApplication(db, app.id);
    expect(result.issues.some((i) => i.code === "MINIMUM_GPA")).toBe(false);
    expect(result.issues.some((i) => i.code === "GPA_CONFLICT")).toBe(false);
  });

  it("recreates conflicts when a new value set appears after prior resolution", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const app = repos.createApplication({
      name: "Conflict App",
      organization: "Org",
      type: "scholarship",
    });
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
      wordCount: 10,
      title: null,
      category: "resume",
      categoryConfidence: 0.9,
      parseStatus: "parsed",
      parsingWarnings: [],
      contentHash: "e1",
      text: "a@example.com",
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
      wordCount: 10,
      title: null,
      category: "resume",
      categoryConfidence: 0.9,
      parseStatus: "parsed",
      parsingWarnings: [],
      contentHash: "e2",
      text: "b@example.com",
    });
    repos.replaceFacts(d1, [
      {
        factType: "email",
        value: "a@example.com",
        evidence: "a@example.com",
        confidence: 0.9,
      },
    ]);
    repos.replaceFacts(d2, [
      {
        factType: "email",
        value: "b@example.com",
        evidence: "b@example.com",
        confidence: 0.9,
      },
    ]);

    analyzeApplication(db, app.id);
    const first = repos.listConflicts(app.id);
    expect(first.length).toBe(1);
    repos.resolveConflict(first[0]!.id, true);

    const d3 = newId();
    repos.createDocument({
      id: d3,
      applicationId: app.id,
      vaultDocumentId: null,
      originalFilename: "c.pdf",
      storedFilename: "c.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      pageCount: 1,
      wordCount: 10,
      title: null,
      category: "resume",
      categoryConfidence: 0.9,
      parseStatus: "parsed",
      parsingWarnings: [],
      contentHash: "e3",
      text: "c@example.com",
    });
    repos.replaceFacts(d3, [
      {
        factType: "email",
        value: "c@example.com",
        evidence: "c@example.com",
        confidence: 0.9,
      },
    ]);

    analyzeApplication(db, app.id);
    const open = repos.listConflicts(app.id).filter((c) => !c.resolved);
    expect(open.length).toBeGreaterThanOrEqual(1);
    expect(
      open.some((c) =>
        c.values.some((v) => v.value.toLowerCase() === "c@example.com"),
      ),
    ).toBe(true);
  });
});
