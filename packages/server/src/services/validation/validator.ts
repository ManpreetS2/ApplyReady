import type { Requirement } from "@applyready/shared";
import type {
  DocumentValidator,
  ValidationFinding,
} from "../../providers/interfaces.js";
import { getExtension } from "../../utils/files.js";

const OTHER_ORG_HINTS = [
  "national merit",
  "gates scholarship",
  "coca-cola scholars",
  "another scholarship",
  "different scholarship",
  "statewide leaders scholarship",
  "horizon innovators scholarship",
  "bright tomorrow scholarship",
  "bright tomorrow",
];

export class RuleDocumentValidator implements DocumentValidator {
  validate({
    requirement,
    documentText,
    filename,
    wordCount,
    pageCount,
    mimeType,
    organization,
  }: {
    requirement: Requirement;
    documentText: string;
    filename: string;
    wordCount: number | null;
    pageCount: number | null;
    mimeType: string;
    organization?: string;
  }): ValidationFinding[] {
    const findings: ValidationFinding[] = [];
    const ext = getExtension(filename);
    const lowerText = documentText.toLowerCase();
    const expectedOrg = (
      requirement.organizationNameExpected ||
      organization ||
      ""
    ).toLowerCase();

    if (requirement.acceptedFileExtensions.length > 0) {
      const ok = requirement.acceptedFileExtensions.includes(ext);
      findings.push({
        rule: "accepted_extension",
        passed: ok,
        severity: ok ? "suggestion" : "blocking",
        message: ok
          ? `File extension ${ext} is accepted.`
          : `File extension ${ext} is not accepted. Expected: ${requirement.acceptedFileExtensions.join(", ")}.`,
        evidence: filename,
      } as const);
    }

    if (requirement.filenamePattern) {
      const pattern = requirement.filenamePattern
        .replace(/LastName/gi, "[A-Za-z]+")
        .replace(/FirstName/gi, "[A-Za-z]+")
        .replace(/\{[^}]+\}/g, "[A-Za-z0-9]+")
        .replace(/\./g, "\\.");
      const re = new RegExp(`^${pattern}$`, "i");
      const ok = re.test(filename);
      findings.push({
        rule: "filename_pattern",
        passed: ok,
        severity: ok ? "suggestion" : "blocking",
        message: ok
          ? "Filename matches the required pattern."
          : `Filename "${filename}" does not match required pattern "${requirement.filenamePattern}".`,
        evidence: filename,
      } as const);
    }

    if (requirement.wordLimitMaximum != null && wordCount != null) {
      const ok = wordCount <= requirement.wordLimitMaximum;
      findings.push({
        rule: "word_limit_max",
        passed: ok,
        severity: ok ? "suggestion" : "blocking",
        message: ok
          ? `Word count ${wordCount} is within the maximum of ${requirement.wordLimitMaximum}.`
          : `Essay/document has ${wordCount} words, exceeding the maximum of ${requirement.wordLimitMaximum}.`,
        evidence: `Word count: ${wordCount}`,
      } as const);
    }

    if (requirement.wordLimitMinimum != null && wordCount != null) {
      const ok = wordCount >= requirement.wordLimitMinimum;
      findings.push({
        rule: "word_limit_min",
        passed: ok,
        severity: ok ? "suggestion" : "blocking",
        message: ok
          ? `Word count ${wordCount} meets the minimum of ${requirement.wordLimitMinimum}.`
          : `Document has ${wordCount} words, below the minimum of ${requirement.wordLimitMinimum}.`,
        evidence: `Word count: ${wordCount}`,
      } as const);
    }

    if (requirement.pageLimitMaximum != null && pageCount != null) {
      const ok = pageCount <= requirement.pageLimitMaximum;
      findings.push({
        rule: "page_limit_max",
        passed: ok,
        severity: ok ? "suggestion" : "warning",
        message: ok
          ? `Page count ${pageCount} is within the limit.`
          : `Document has ${pageCount} pages, exceeding the maximum of ${requirement.pageLimitMaximum}.`,
        evidence: `Page count: ${pageCount}`,
      } as const);
    }

    if (expectedOrg && ["essay", "recommendation", "combined_packet"].includes(requirement.category)) {
      const expectedTokens = expectedOrg
        .split(/\s+/)
        .filter((t) => t.length > 3);
      const mentionsExpected =
        lowerText.includes(expectedOrg) ||
        (expectedTokens.length > 0 &&
          expectedTokens.every((token) => lowerText.includes(token)));
      const mentionsOther = OTHER_ORG_HINTS.some((hint) => lowerText.includes(hint));
      if (mentionsOther && !mentionsExpected) {
        findings.push({
          rule: "organization_reference",
          passed: false,
          severity: "blocking",
          message:
            requirement.category === "recommendation"
              ? "Recommendation letter appears addressed to another organization."
              : "Document references another scholarship/organization.",
          evidence: excerptOrg(documentText),
        } as const);
      } else if (mentionsOther && mentionsExpected) {
        findings.push({
          rule: "organization_reference",
          passed: false,
          severity: "warning",
          message:
            "Document mentions another organization in addition to the expected one.",
          evidence: excerptOrg(documentText),
        } as const);
      } else if (!mentionsExpected && requirement.category === "recommendation") {
        findings.push({
          rule: "organization_reference",
          passed: false,
          severity: "needs_confirmation",
          message:
            "ApplyReady could not confirm the recommendation is addressed to the target organization.",
          evidence: expectedOrg,
        } as const);
      }
    }

    if (requirement.signatureRequired) {
      const hasTextSignature =
        /\b(sincerely|respectfully|signature|signed)\b/i.test(documentText);
      findings.push({
        rule: "signature_text",
        passed: hasTextSignature,
        severity: "needs_confirmation",
        message: hasTextSignature
          ? "Signature-related text was detected."
          : "ApplyReady could not confirm that a signature is present.",
        evidence: hasTextSignature
          ? "Signature-related wording found"
          : "No signature-related text detected; handwritten signatures in images cannot be inspected.",
      } as const);
    }

    if (requirement.requiredKeywords.length) {
      const missing = requirement.requiredKeywords.filter(
        (k) => !lowerText.includes(k.toLowerCase()),
      );
      findings.push({
        rule: "required_keywords",
        passed: missing.length === 0,
        severity: missing.length ? "warning" : "suggestion",
        message:
          missing.length === 0
            ? "Required keywords are present."
            : `Missing required keywords/topics: ${missing.join(", ")}.`,
        evidence: missing.join(", ") || null,
      } as const);
    }

    if (mimeType === "application/pdf" && wordCount != null && wordCount < 20) {
      findings.push({
        rule: "low_text_pdf",
        passed: false,
        severity: "warning",
        message:
          "PDF contains little extractable text. It may be image-only; OCR is not supported in this version.",
        evidence: `Word count: ${wordCount}`,
      } as const);
    }

    return findings;
  }
}

function excerptOrg(text: string): string {
  const line =
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) =>
        /scholarship|dear|addressed to/i.test(l),
      ) || text.slice(0, 160);
  return line.slice(0, 220);
}
