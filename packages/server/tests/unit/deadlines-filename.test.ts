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

  it("marks a date past only after it ended in every inhabited offset", () => {
    // End of 2026-08-06 in UTC−12 is 2026-08-07T12:00:00Z.
    const result = assessDeadline("2026-08-06", noon("2026-08-07"));
    expect(result.status).toBe("past");
  });

  it("does not mark date-only expired near UTC midnight due to TZ choice", () => {
    // 30 minutes after UTC midnight on Aug 7 — Aug 6 is still current in UTC−12.
    const result = assessDeadline(
      "2026-08-06",
      new Date("2026-08-07T00:30:00.000Z"),
    );
    expect(result.status).toBe("today");
  });

  it("marks date-only as today while inside the worldwide envelope", () => {
    const result = assessDeadline("August 7, 2026", noon("2026-08-07"));
    expect(result.status).toBe("today");
  });

  it("marks far-future date-only as future before any offset reaches it", () => {
    // Aug 9 earliest start is Aug 8 10:00 UTC; noon Aug 7 is clearly before.
    const result = assessDeadline("2026-08-09", noon("2026-08-07"));
    expect(result.status).toBe("future");
  });

  it("treats date that has begun only in positive offsets as today, not future", () => {
    // Aug 8 begins at Aug 7 10:00 UTC in UTC+14; noon Aug 7 is inside envelope.
    const result = assessDeadline("2026-08-08", noon("2026-08-07"));
    expect(result.status).toBe("today");
  });

  it("marks invalid dates as ambiguous", () => {
    const result = assessDeadline("not-a-real-date", noon("2026-08-07"));
    expect(result.status).toBe("ambiguous");
  });

  it("compares explicit timezone timestamps as exact instants", () => {
    const result = assessDeadline(
      "2026-08-06T23:00:00-07:00",
      new Date("2026-08-07T12:00:00.000Z"),
    );
    expect(result.status).toBe("past");
  });

  it("keeps an explicit future offset timestamp as future", () => {
    const result = assessDeadline(
      "2026-08-08T12:00:00+02:00",
      new Date("2026-08-07T12:00:00.000Z"),
    );
    expect(result.status).toBe("future");
  });
});

describe("filename placeholder casing", () => {
  it("accepts LastName / LASTNAME / lastname and FirstName variants", () => {
    for (const pattern of [
      "LastName_FirstName.pdf",
      "LASTNAME_FIRSTNAME.pdf",
      "lastname_firstname.pdf",
      "LastName_firstname.pdf",
    ]) {
      const compiled = compileFilenamePattern(pattern);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      expect(compiled.regex.test("Chen_Alex.pdf")).toBe(true);
    }
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
