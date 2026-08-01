import type Database from "better-sqlite3";
import type { Issue, IssueSeverity } from "@applyready/shared";
import { Repositories } from "../../db/repositories.js";
import { newId } from "../../utils/ids.js";
import { HeuristicDocumentClassifier, extractHeadings } from "../documents/classify.js";
import { ApplicantConsistencyChecker } from "../consistency/checker.js";
import { HeuristicRequirementMatcher } from "../matching/matcher.js";
import { RuleDocumentValidator } from "../validation/validator.js";
import { computeReadiness } from "../readiness/score.js";

export function analyzeApplication(db: Database.Database, applicationId: string) {
  const repos = new Repositories(db);
  const app = repos.getApplication(applicationId);
  if (!app) throw new Error("Application not found");

  const requirements = repos
    .listRequirements(applicationId)
    .filter((r) => r.category !== "other" || r.filenamePattern);
  const documents = repos.listDocuments(applicationId);
  const matcher = new HeuristicRequirementMatcher();
  const validator = new RuleDocumentValidator();
  const consistency = new ApplicantConsistencyChecker();

  repos.clearAnalysis(applicationId);

  // Preserve previously resolved/dismissed issues by only clearing open ones (done above).

  const matches = [];
  for (const requirement of requirements) {
    if (requirement.category === "other" && !requirement.filenamePattern) continue;

    let best = null as ReturnType<typeof matcher.match> | null;
    let bestDocId: string | null = null;

    for (const document of documents) {
      const text = repos.getDocumentText(document.id) || "";
      const finding = matcher.match({
        requirement,
        document: {
          id: document.id,
          filename: document.originalFilename,
          category: document.category,
          categoryConfidence: document.categoryConfidence,
          title: document.title,
          wordCount: document.wordCount,
          pageCount: document.pageCount,
          mimeType: document.mimeType,
          text,
          headings: extractHeadings(text),
        },
      });

      if (
        finding.status !== "does_not_match" &&
        (!best || finding.confidence > best.confidence)
      ) {
        best = finding;
        bestDocId = document.id;
      }

      if (finding.status !== "does_not_match") {
        const saved = repos.upsertMatch({
          id: newId(),
          applicationId,
          requirementId: requirement.id,
          documentId: document.id,
          status: finding.status,
          confidence: finding.confidence,
          explanation: finding.explanation,
          evidence: finding.evidence,
          userConfirmed: false,
        });
        matches.push(saved);
      }
    }

    if (!best || !bestDocId) {
      if (requirement.required) {
        repos.insertIssue({
          id: newId(),
          applicationId,
          requirementId: requirement.id,
          documentId: null,
          severity: "blocking",
          code: "MISSING_DOCUMENT",
          title: `Missing: ${requirement.title}`,
          explanation: `No uploaded document was matched to the required item "${requirement.title}".`,
          evidence: requirement.sourceEvidence,
          recommendedFix: `Upload a ${requirement.category.replaceAll("_", " ")} that satisfies this requirement, or manually assign an existing document.`,
          status: "open",
          dismissible: false,
        });
      }
      continue;
    }

    const document = documents.find((d) => d.id === bestDocId)!;
    const text = repos.getDocumentText(document.id) || "";
    const findings = validator.validate({
      requirement,
      documentText: text,
      filename: document.originalFilename,
      wordCount: document.wordCount,
      pageCount: document.pageCount,
      mimeType: document.mimeType,
      organization: app.organization,
    });

    for (const finding of findings) {
      repos.insertValidation({
        id: newId(),
        applicationId,
        requirementId: requirement.id,
        documentId: document.id,
        rule: finding.rule,
        passed: finding.passed,
        severity: finding.severity,
        message: finding.message,
        evidence: finding.evidence,
      });

      if (!finding.passed && finding.severity !== "suggestion") {
        repos.insertIssue({
          id: newId(),
          applicationId,
          requirementId: requirement.id,
          documentId: document.id,
          severity: finding.severity,
          code: finding.rule.toUpperCase(),
          title: issueTitle(finding.rule, requirement.title),
          explanation: finding.message,
          evidence: finding.evidence,
          recommendedFix: fixFor(finding.rule),
          status: "open",
          dismissible: finding.severity !== "blocking",
        });
      }
    }

    if (best.status === "needs_confirmation" || best.status === "possible") {
      repos.insertIssue({
        id: newId(),
        applicationId,
        requirementId: requirement.id,
        documentId: document.id,
        severity: "needs_confirmation",
        code: "MATCH_NEEDS_CONFIRMATION",
        title: `Confirm match for ${requirement.title}`,
        explanation:
          best.explanation ||
          "ApplyReady found a possible match that needs your confirmation.",
        evidence: best.evidence.join(" | "),
        recommendedFix:
          "Review the evidence and confirm or reassign the document.",
        status: "open",
        dismissible: true,
      });
    }
  }

  // Duplicate detection
  const byHash = new Map<string, string[]>();
  for (const doc of documents) {
    if (!doc.contentHash) continue;
    const list = byHash.get(doc.contentHash) || [];
    list.push(doc.originalFilename);
    byHash.set(doc.contentHash, list);
  }
  for (const [, names] of byHash) {
    if (names.length > 1) {
      repos.insertIssue({
        id: newId(),
        applicationId,
        requirementId: null,
        documentId: null,
        severity: "warning",
        code: "DUPLICATE_FILES",
        title: "Duplicate documents detected",
        explanation: `These files appear identical: ${names.join(", ")}.`,
        evidence: names.join(", "),
        recommendedFix: "Remove the duplicate upload unless both are intentionally required.",
        status: "open",
        dismissible: true,
      });
    }
  }

  // Email inconsistency across docs
  const emailFacts = documents.flatMap((doc) =>
    repos
      .listFacts(doc.id)
      .filter((f) => f.factType === "email")
      .map((f) => ({ doc, fact: f })),
  );
  const uniqueEmails = [...new Set(emailFacts.map((e) => e.fact.value.toLowerCase()))];
  if (uniqueEmails.length > 1) {
    repos.insertIssue({
      id: newId(),
      applicationId,
      requirementId: null,
      documentId: emailFacts[0]?.doc.id ?? null,
      severity: "warning",
      code: "EMAIL_INCONSISTENCY",
      title: "Inconsistent email addresses",
      explanation: `Documents contain different emails: ${uniqueEmails.join(", ")}.`,
      evidence: emailFacts
        .map((e) => `${e.doc.originalFilename}: ${e.fact.value}`)
        .join(" | "),
      recommendedFix:
        "Confirm which email is current and update outdated documents.",
      status: "open",
      dismissible: true,
    });
  }

  // Consistency conflicts
  const factsByDocument = documents.map((doc) => ({
    documentId: doc.id,
    filename: doc.originalFilename,
    facts: repos.listFacts(doc.id),
  }));
  const conflictFindings = consistency.check(factsByDocument);
  for (const finding of conflictFindings) {
    repos.insertConflict({
      id: newId(),
      applicationId,
      field: finding.field,
      values: finding.values,
      resolved: false,
      equivalent: null,
    });
  }

  // Populate profile candidates carefully (do not silently overwrite conflicts)
  const profile = repos.getProfile(applicationId);
  if (profile) {
    const patch: Record<string, string | null> = {};
    for (const field of [
      "full_legal_name",
      "email",
      "phone",
      "school",
      "major",
      "gpa",
      "expected_graduation_date",
    ] as const) {
      const values = [
        ...new Set(
          factsByDocument.flatMap((d) =>
            d.facts.filter((f) => f.factType === field).map((f) => f.value),
          ),
        ),
      ];
      if (values.length === 1) {
        const key =
          field === "full_legal_name"
            ? "fullLegalName"
            : field === "expected_graduation_date"
              ? "expectedGraduationDate"
              : field;
        patch[key] = values[0]!;
      }
    }
    repos.updateProfile(applicationId, patch);
  }

  const allMatches = repos.listMatches(applicationId);
  const issues = repos.listIssues(applicationId);
  const conflicts = repos.listConflicts(applicationId);
  const report = computeReadiness({
    applicationId,
    requirements: repos.listRequirements(applicationId),
    matches: allMatches,
    issues,
    conflicts,
  });

  // Attach validation counts
  const validations = repos.listValidations(applicationId);
  report.breakdown.validationTotal = validations.length;
  report.breakdown.validationPassed = validations.filter((v) => v.passed).length;

  repos.updateApplication(applicationId, {
    readinessScore: report.score,
    readinessStatus: report.status,
    lastAnalyzedAt: report.generatedAt,
  });
  repos.addActivity(
    applicationId,
    "analyzed",
    `Analysis complete: ${report.status} (${report.score}%)`,
    { score: report.score, status: report.status },
  );

  return {
    report,
    issues: repos.listIssues(applicationId),
    matches: allMatches,
    conflicts: repos.listConflicts(applicationId),
    validations,
  };
}

function issueTitle(rule: string, requirementTitle: string): string {
  switch (rule) {
    case "word_limit_max":
      return `Word limit exceeded for ${requirementTitle}`;
    case "word_limit_min":
      return `Word count too low for ${requirementTitle}`;
    case "filename_pattern":
      return "Incorrect filename";
    case "organization_reference":
      return "Organization mismatch";
    case "accepted_extension":
      return "Incorrect file format";
    case "low_text_pdf":
      return "Little extractable text";
    default:
      return `Issue with ${requirementTitle}`;
  }
}

function fixFor(rule: string): string {
  switch (rule) {
    case "word_limit_max":
      return "Shorten the essay to fit within the stated word limit.";
    case "word_limit_min":
      return "Expand the response to meet the minimum word count.";
    case "filename_pattern":
      return "Rename the file to match the required pattern exactly.";
    case "organization_reference":
      return "Update the document so it references the correct organization.";
    case "accepted_extension":
      return "Export/upload the document in an accepted file format.";
    case "low_text_pdf":
      return "Provide a searchable PDF (OCR is not included in this version).";
    default:
      return "Review the evidence and update the document or requirement.";
  }
}

export function createDocumentIssue(
  severity: IssueSeverity,
  partial: Omit<Issue, "id" | "createdAt" | "updatedAt" | "severity" | "status"> & {
    status?: Issue["status"];
  },
): Omit<Issue, "createdAt" | "updatedAt"> {
  return {
    id: newId(),
    severity,
    status: partial.status ?? "open",
    ...partial,
  };
}

// keep classifier import used for potential reclassify helpers
void HeuristicDocumentClassifier;
