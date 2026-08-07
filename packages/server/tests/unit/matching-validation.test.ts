import { describe, expect, it } from "vitest";
import type { Requirement } from "@applyready/shared";
import { HeuristicRequirementMatcher } from "../../src/services/matching/matcher.js";
import { RuleDocumentValidator } from "../../src/services/validation/validator.js";
import { computeReadiness } from "../../src/services/readiness/score.js";

function req(partial: Partial<Requirement> & Pick<Requirement, "id" | "category" | "title">): Requirement {
  return {
    applicationId: "a",
    sourceId: null,
    description: "",
    required: true,
    certainty: "required",
    conditional: false,
    conditionText: null,
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
    organizationNameExpected: "Future Engineers Foundation",
    customValidationNotes: null,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("matching and validation", () => {
  const matcher = new HeuristicRequirementMatcher();
  const validator = new RuleDocumentValidator();

  it("matches resume to resume requirement", () => {
    const result = matcher.match({
      requirement: req({ id: "1", category: "resume", title: "Resume" }),
      document: {
        id: "d",
        filename: "resume.pdf",
        category: "resume",
        categoryConfidence: 0.9,
        title: "Resume",
        wordCount: 200,
        pageCount: 1,
        mimeType: "application/pdf",
        text: "Experience Education Skills",
        headings: ["Experience"],
      },
    });
    expect(["likely", "confirmed", "needs_confirmation"]).toContain(result.status);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("rejects wrong document category", () => {
    const result = matcher.match({
      requirement: req({ id: "1", category: "transcript", title: "Transcript" }),
      document: {
        id: "d",
        filename: "essay.pdf",
        category: "essay",
        categoryConfidence: 0.9,
        title: "Essay",
        wordCount: 400,
        pageCount: 1,
        mimeType: "application/pdf",
        text: "personal statement",
        headings: [],
      },
    });
    expect(["does_not_match", "possible"]).toContain(result.status);
  });

  it("flags essay word limit and wrong organization", () => {
    const findings = validator.validate({
      requirement: req({
        id: "1",
        category: "essay",
        title: "Essay",
        wordLimitMinimum: 400,
        wordLimitMaximum: 500,
        organizationNameExpected: "Future Engineers Scholarship",
      }),
      documentText:
        "I am applying to the Horizon Innovators Scholarship because engineering matters. ".repeat(
          40,
        ),
      filename: "essay.pdf",
      wordCount: 620,
      pageCount: 2,
      mimeType: "application/pdf",
      organization: "Future Engineers Foundation",
    });
    expect(findings.some((f) => f.rule === "word_limit_max" && !f.passed)).toBe(
      true,
    );
    expect(
      findings.some((f) => f.rule === "organization_reference" && !f.passed),
    ).toBe(true);
  });

  it("flags incorrect filename pattern", () => {
    const findings = validator.validate({
      requirement: req({
        id: "1",
        category: "combined_packet",
        title: "Packet",
        filenamePattern: "LastName_FirstName_2026.pdf",
      }),
      documentText: "packet",
      filename: "final_packet_submission.pdf",
      wordCount: 10,
      pageCount: 1,
      mimeType: "application/pdf",
    });
    expect(findings.some((f) => f.rule === "filename_pattern" && !f.passed)).toBe(
      true,
    );
  });

  it("blocking issue prevents ready status", () => {
    const report = computeReadiness({
      applicationId: "a",
      requirements: [
        req({ id: "r1", category: "transcript", title: "Transcript" }),
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
          title: "Missing transcript",
          explanation: "missing",
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
    expect(report.status).not.toBe("ready");
    expect(report.score).toBeLessThan(90);
  });
});
