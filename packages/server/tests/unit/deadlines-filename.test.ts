import { describe, expect, it } from "vitest";
import { assessDeadline } from "../../src/services/deadlines/assess.js";
import {
  compileFilenamePattern,
  conflictFingerprint,
} from "../../src/services/validation/filenamePattern.js";
import { RuleDocumentValidator } from "../../src/services/validation/validator.js";
import type { Requirement } from "@applyready/shared";

function baseReq(partial: Partial<Requirement> = {}): Requirement {
  return {
    id: "r1",
    applicationId: "a",
    sourceId: null,
    title: "Packet",
    description: "",
    category: "combined_packet",
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
    acceptedDocumentTypes: ["combined_packet"],
    acceptedFileExtensions: [".pdf"],
    minimumCount: 1,
    maximumCount: null,
    wordLimitMinimum: null,
    wordLimitMaximum: null,
    pageLimitMinimum: null,
    pageLimitMaximum: null,
    filenamePattern: "LastName_FirstName_2026.pdf",
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

describe("filename pattern safety", () => {
  it("escapes regex metacharacters in literal pattern text", () => {
    const compiled = compileFilenamePattern("Report(final)[v1]+?.pdf");
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.regex.test("Report(final)[v1]+?.pdf")).toBe(true);
    expect(compiled.regex.test("ReportXfinalYv1Z.pdf")).toBe(false);
  });

  it("supports LastName/FirstName/{placeholder} tokens", () => {
    const compiled = compileFilenamePattern("LastName_FirstName_{year}.pdf");
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.regex.test("Chen_Alex_2026.pdf")).toBe(true);
  });

  it("does not crash analysis on malformed patterns", () => {
    const validator = new RuleDocumentValidator();
    const findings = validator.validate({
      requirement: baseReq({ filenamePattern: "broken{pattern" }),
      documentText: "hello",
      filename: "file.pdf",
      wordCount: 1,
      pageCount: 1,
      mimeType: "application/pdf",
    });
    const patternFinding = findings.find((f) => f.rule === "filename_pattern");
    expect(patternFinding?.passed).toBe(false);
    expect(patternFinding?.severity).toBe("needs_confirmation");
  });

  it("handles backslash and other metacharacters without throwing", () => {
    expect(() =>
      compileFilenamePattern(String.raw`a\b*c+d?e{f}g(h)i[j]k|l.pdf`),
    ).not.toThrow();
  });
});

describe("deadline assessment", () => {
  const noon = (isoDate: string) => new Date(`${isoDate}T12:00:00.000Z`);

  it("marks yesterday as past", () => {
    const result = assessDeadline("2026-08-06", noon("2026-08-07"));
    expect(result.status).toBe("past");
  });

  it("marks today conservatively as today", () => {
    const result = assessDeadline("August 7, 2026", noon("2026-08-07"));
    expect(result.status).toBe("today");
  });

  it("marks tomorrow as future", () => {
    const result = assessDeadline("2026-08-08", noon("2026-08-07"));
    expect(result.status).toBe("future");
  });

  it("marks invalid dates as ambiguous", () => {
    const result = assessDeadline("not-a-real-date", noon("2026-08-07"));
    expect(result.status).toBe("ambiguous");
  });

  it("supports explicit timezone timestamps", () => {
    const result = assessDeadline(
      "2026-08-06T23:00:00-07:00",
      new Date("2026-08-07T12:00:00.000Z"),
    );
    expect(result.status).toBe("past");
  });
});

describe("conflict fingerprints", () => {
  it("changes when the conflicting value set changes", () => {
    const a = conflictFingerprint("email", [
      { value: "a@example.com" },
      { value: "b@example.com" },
    ]);
    const b = conflictFingerprint("email", [
      { value: "a@example.com" },
      { value: "c@example.com" },
    ]);
    expect(a).not.toBe(b);
  });
});
