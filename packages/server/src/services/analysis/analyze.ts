import type Database from "better-sqlite3";
import type { Issue, IssueSeverity } from "@applyready/shared";
import { Repositories } from "../../db/repositories.js";
import { newId } from "../../utils/ids.js";
import { HeuristicDocumentClassifier, extractHeadings } from "../documents/classify.js";
import { ApplicantConsistencyChecker } from "../consistency/checker.js";
import { HeuristicRequirementMatcher } from "../matching/matcher.js";
import { RuleDocumentValidator } from "../validation/validator.js";
import { conflictFingerprint } from "../validation/filenamePattern.js";
import { computeReadiness } from "../readiness/score.js";
import { assessDeadline } from "../deadlines/assess.js";

export function analyzeApplication(db: Database.Database, applicationId: string) {
  const repos = new Repositories(db);
  const app = repos.getApplication(applicationId);
  if (!app) throw new Error("Application not found");

  const requirements = repos.listRequirements(applicationId);
  const documents = repos.listDocuments(applicationId);
  const previousMatches = repos.listMatches(applicationId);
  const previousConflicts = repos.listConflicts(applicationId);
  const matcher = new HeuristicRequirementMatcher();
  const validator = new RuleDocumentValidator();
  const consistency = new ApplicantConsistencyChecker();

  repos.clearAnalysis(applicationId);

  const previousConfirmed = new Set(
    previousMatches
      .filter((m) => m.userConfirmed)
      .map((m) => `${m.requirementId}::${m.documentId}`),
  );
  const resolvedConflictFingerprints = new Set(
    previousConflicts
      .filter((c) => c.resolved)
      .map((c) => conflictFingerprint(c.field, c.values)),
  );

  const matches = [];
  for (const requirement of requirements) {
    if (requirement.category === "other" && requirement.dateRequirement) {
      validateDeadlineRequirement(repos, {
        applicationId,
        requirement,
      });
      continue;
    }

    if (requirement.category === "other" && !requirement.filenamePattern) {
      continue;
    }

    if (
      requirement.category === "proof_of_eligibility" ||
      requirement.category === "proof_of_enrollment"
    ) {
      validateEligibilityRequirement(repos, {
        applicationId,
        requirement,
        documents,
        organization: app.organization,
      });
      continue;
    }

    if (requirement.certainty === "uncertain" && !requirement.userConfirmed) {
      repos.insertIssue({
        id: newId(),
        applicationId,
        requirementId: requirement.id,
        documentId: null,
        severity: "needs_confirmation",
        code: "UNCERTAIN_REQUIREMENT",
        title: `Confirm whether "${requirement.title}" is required`,
        explanation:
          "ApplyReady found a document mention without clear required/optional language. Confirm the rule before treating it as mandatory.",
        evidence: requirement.sourceEvidence,
        recommendedFix:
          "Confirm this requirement if the source intends it to be required, mark it optional, or dismiss if it is not an application rule.",
        status: "open",
        dismissible: true,
      });
      continue;
    }

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
        const confirmed = previousConfirmed.has(
          `${requirement.id}::${document.id}`,
        );
        const saved = repos.upsertMatch({
          id: newId(),
          applicationId,
          requirementId: requirement.id,
          documentId: document.id,
          status: confirmed ? "confirmed" : finding.status,
          confidence: confirmed
            ? Math.max(finding.confidence, 0.95)
            : finding.confidence,
          explanation: finding.explanation,
          evidence: finding.evidence,
          userConfirmed: confirmed,
        });
        matches.push(saved);
      }
    }

    const confirmedBest = matches
      .filter(
        (m) =>
          m.requirementId === requirement.id &&
          m.userConfirmed &&
          m.status !== "does_not_match",
      )
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (confirmedBest) {
      best = {
        status: "confirmed",
        confidence: confirmedBest.confidence,
        explanation: confirmedBest.explanation,
        evidence: confirmedBest.evidence,
      };
      bestDocId = confirmedBest.documentId;
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

    if (
      (best.status === "needs_confirmation" || best.status === "possible") &&
      !previousConfirmed.has(`${requirement.id}::${bestDocId}`)
    ) {
      repos.insertIssue({
        id: newId(),
        applicationId,
        requirementId: requirement.id,
        documentId: bestDocId,
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

  const existingProfile = repos.getProfile(applicationId);
  if (existingProfile?.email) {
    const mismatched = emailFacts.filter(
      (e) =>
        e.fact.value.toLowerCase() !== existingProfile.email!.toLowerCase(),
    );
    if (mismatched.length > 0) {
      repos.insertIssue({
        id: newId(),
        applicationId,
        requirementId: null,
        documentId: mismatched[0]?.doc.id ?? null,
        severity: "warning",
        code: "EMAIL_PROFILE_MISMATCH",
        title: "Resume email differs from confirmed applicant email",
        explanation: `Confirmed applicant email is ${existingProfile.email}, but document(s) contain: ${[
          ...new Set(mismatched.map((m) => m.fact.value)),
        ].join(", ")}.`,
        evidence: mismatched
          .map((e) => `${e.doc.originalFilename}: ${e.fact.value}`)
          .join(" | "),
        recommendedFix:
          "Update the resume/contact document to the confirmed email, or revise the applicant profile if the document is correct.",
        status: "open",
        dismissible: true,
      });
    }
  }

  // Consistency conflicts — resolution applies to a specific value fingerprint
  const factsByDocument = documents.map((doc) => ({
    documentId: doc.id,
    filename: doc.originalFilename,
    facts: repos.listFacts(doc.id),
  }));
  const conflictFindings = consistency.check(factsByDocument);
  for (const finding of conflictFindings) {
    const fingerprint = conflictFingerprint(finding.field, finding.values);
    if (resolvedConflictFingerprints.has(fingerprint)) continue;
    repos.insertConflict({
      id: newId(),
      applicationId,
      field: finding.field,
      values: finding.values,
      resolved: false,
      equivalent: null,
    });
  }

  // Populate profile candidates carefully (do not silently overwrite confirmed values)
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
      const key =
        field === "full_legal_name"
          ? "fullLegalName"
          : field === "expected_graduation_date"
            ? "expectedGraduationDate"
            : field;
      const currentValue = (profile as unknown as Record<string, unknown>)[key];
      if (typeof currentValue === "string" && currentValue.trim()) {
        continue;
      }
      const values = [
        ...new Set(
          factsByDocument.flatMap((d) =>
            d.facts.filter((f) => f.factType === field).map((f) => f.value),
          ),
        ),
      ];
      if (values.length === 1) {
        patch[key] = values[0]!;
      }
    }
    if (Object.keys(patch).length > 0) {
      repos.updateProfile(applicationId, patch);
    }
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
    case "signature_text":
      return "Signature could not be confirmed";
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
    case "signature_text":
      return "Ensure the recommendation includes clear signature-related text, or confirm the signed letter manually.";
    default:
      return "Review the evidence and update the document or requirement.";
  }
}

function parseGpaNumber(raw: string): number | null {
  const n = Number(String(raw).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n > 4.5) return null;
  return n;
}

function validateEligibilityRequirement(
  repos: Repositories,
  params: {
    applicationId: string;
    requirement: ReturnType<Repositories["listRequirements"]>[number];
    documents: ReturnType<Repositories["listDocuments"]>;
    organization: string;
  },
) {
  const { applicationId, requirement, documents } = params;
  const profile = repos.getProfile(applicationId);
  const allFacts = documents.flatMap((doc) =>
    repos.listFacts(doc.id).map((fact) => ({ doc, fact })),
  );

  if (/gpa/i.test(requirement.title) || /gpa/i.test(requirement.description)) {
    const minMatch = requirement.description.match(
      /(?:minimum|at least|gpa(?:\s+of)?)\s*(\d+(?:\.\d+)?)/i,
    );
    const minimum = minMatch ? Number(minMatch[1]) : null;

    const docGpas = allFacts
      .filter((f) => f.fact.factType === "gpa")
      .map((f) => ({
        raw: f.fact.value,
        value: parseGpaNumber(f.fact.value),
        docId: f.doc.id,
        source: f.doc.originalFilename,
      }))
      .filter((g) => g.value != null) as Array<{
      raw: string;
      value: number;
      docId: string;
      source: string;
    }>;

    let chosen: number | null = null;
    let passed = false;
    let unresolved = false;
    let message = "";
    let evidence =
      [...docGpas.map((g) => `${g.source}: ${g.raw}`), profile?.gpa]
        .filter(Boolean)
        .join(" | ") || requirement.sourceEvidence;

    if (profile?.userConfirmed && profile.gpa) {
      chosen = parseGpaNumber(profile.gpa);
      if (chosen == null) {
        unresolved = true;
        message = "Confirmed profile GPA could not be interpreted on a 4.0-scale.";
      } else if (minimum == null) {
        passed = true;
        message = `Using confirmed profile GPA ${chosen}.`;
      } else {
        passed = chosen >= minimum;
        message = passed
          ? `Confirmed profile GPA ${chosen} meets the minimum of ${minimum}.`
          : `Confirmed profile GPA ${chosen} is below the minimum of ${minimum}.`;
      }
    } else {
      const unique = [
        ...new Map(docGpas.map((g) => [g.value.toFixed(3), g])).values(),
      ];
      if (unique.length === 0) {
        unresolved = true;
        message =
          "No GPA value was found in a confirmed profile or uploaded documents.";
      } else if (unique.length > 1) {
        const spread =
          Math.max(...unique.map((g) => g.value)) -
          Math.min(...unique.map((g) => g.value));
        if (spread >= 0.05) {
          unresolved = true;
          message = `Conflicting GPA values were found (${unique
            .map((g) => g.value)
            .join(", ")}). Confirm which value ApplyReady should use.`;
          evidence = unique.map((g) => `${g.source}: ${g.raw}`).join(" | ");
        } else {
          chosen = unique[0]!.value;
        }
      } else {
        chosen = unique[0]!.value;
      }

      if (!unresolved && chosen != null) {
        if (minimum == null) {
          passed = true;
          message = `GPA ${chosen} was found.`;
        } else {
          passed = chosen >= minimum;
          message = passed
            ? `GPA ${chosen} meets the minimum of ${minimum}.`
            : `GPA ${chosen} is below the minimum of ${minimum}.`;
        }
      }
    }

    const severity = unresolved
      ? "needs_confirmation"
      : passed
        ? "suggestion"
        : "blocking";

    repos.insertValidation({
      id: newId(),
      applicationId,
      requirementId: requirement.id,
      documentId: docGpas[0]?.docId ?? null,
      rule: "minimum_gpa",
      passed: passed && !unresolved,
      severity,
      message,
      evidence,
    });

    if (!passed || unresolved) {
      repos.insertIssue({
        id: newId(),
        applicationId,
        requirementId: requirement.id,
        documentId: null,
        severity,
        code: unresolved ? "GPA_CONFLICT" : "MINIMUM_GPA",
        title: unresolved
          ? "GPA requires confirmation"
          : "Minimum GPA not verified",
        explanation: message,
        evidence: requirement.sourceEvidence,
        recommendedFix: unresolved
          ? "Confirm the correct GPA in the applicant profile (and mark the profile confirmed), then reanalyze."
          : "Upload a transcript that includes GPA, or confirm the GPA in the applicant profile.",
        status: "open",
        dismissible: unresolved,
      });
    }
    return;
  }

  if (
    /enroll/i.test(requirement.title) ||
    /enroll/i.test(requirement.description)
  ) {
    const enrollmentFacts = allFacts.filter(
      (f) =>
        f.fact.factType === "enrollment" &&
        /\b(enrolled|enrollment|currently attending|full[- ]time student)\b/i.test(
          `${f.fact.value} ${f.fact.evidence || ""}`,
        ),
    );
    const profileConfirmedEnrollment = profile?.currentlyEnrolled === true;
    const passed =
      enrollmentFacts.length > 0 || profileConfirmedEnrollment;
    const severity = passed ? "suggestion" : "needs_confirmation";

    repos.insertValidation({
      id: newId(),
      applicationId,
      requirementId: requirement.id,
      documentId: enrollmentFacts[0]?.doc.id ?? null,
      rule: "enrollment",
      passed,
      severity,
      message: passed
        ? profileConfirmedEnrollment
          ? "Current enrollment confirmed in the applicant profile."
          : "Explicit enrollment evidence was found in uploaded materials."
        : "School name or expected graduation date alone does not prove current enrollment.",
      evidence: requirement.sourceEvidence,
    });

    if (!passed) {
      repos.insertIssue({
        id: newId(),
        applicationId,
        requirementId: requirement.id,
        documentId: null,
        severity: "needs_confirmation",
        code: "ENROLLMENT",
        title: "Enrollment could not be confirmed",
        explanation:
          "ApplyReady needs explicit enrollment evidence or a profile confirmation of current enrollment. A school name or expected graduation date is not enough.",
        evidence: requirement.sourceEvidence,
        recommendedFix:
          "Confirm currently enrolled in the applicant profile, or upload an enrollment verification / transcript statement that explicitly indicates current enrollment.",
        status: "open",
        dismissible: true,
      });
    }
  }
}

function validateDeadlineRequirement(
  repos: Repositories,
  params: {
    applicationId: string;
    requirement: ReturnType<Repositories["listRequirements"]>[number];
  },
) {
  const { applicationId, requirement } = params;
  const raw = requirement.dateRequirement || "";
  const assessment = assessDeadline(raw);

  if (assessment.status === "ambiguous") {
    repos.insertValidation({
      id: newId(),
      applicationId,
      requirementId: requirement.id,
      documentId: null,
      rule: "deadline",
      passed: false,
      severity: "needs_confirmation",
      message: `Deadline "${raw}" could not be interpreted confidently (${assessment.reason}).`,
      evidence: requirement.sourceEvidence,
    });
    repos.insertIssue({
      id: newId(),
      applicationId,
      requirementId: requirement.id,
      documentId: null,
      severity: "needs_confirmation",
      code: "DEADLINE_AMBIGUOUS",
      title: "Deadline needs confirmation",
      explanation: `ApplyReady could not confidently interpret deadline "${raw}".`,
      evidence: requirement.sourceEvidence,
      recommendedFix:
        "Confirm the official deadline from the source and update the requirement if needed.",
      status: "open",
      dismissible: true,
    });
    return;
  }

  if (assessment.status === "past") {
    repos.insertValidation({
      id: newId(),
      applicationId,
      requirementId: requirement.id,
      documentId: null,
      rule: "deadline",
      passed: false,
      severity: "blocking",
      message: `Deadline ${assessment.original} appears to be in the past.`,
      evidence: requirement.sourceEvidence,
    });
    repos.insertIssue({
      id: newId(),
      applicationId,
      requirementId: requirement.id,
      documentId: null,
      severity: "blocking",
      code: "DEADLINE_EXPIRED",
      title: "Submission deadline has passed",
      explanation: `The extracted deadline (${assessment.original}) is before today.`,
      evidence: requirement.sourceEvidence,
      recommendedFix:
        "Verify whether late submissions are accepted, or update the deadline if the source was misread.",
      status: "open",
      dismissible: false,
    });
    return;
  }

  if (assessment.status === "today") {
    repos.insertValidation({
      id: newId(),
      applicationId,
      requirementId: requirement.id,
      documentId: null,
      rule: "deadline",
      passed: true,
      severity: "needs_confirmation",
      message: `Deadline is today (${assessment.original}). End-of-day timing was not assumed.`,
      evidence: requirement.sourceEvidence,
    });
    repos.insertIssue({
      id: newId(),
      applicationId,
      requirementId: requirement.id,
      documentId: null,
      severity: "needs_confirmation",
      code: "DEADLINE_TODAY",
      title: "Deadline is today",
      explanation: `The deadline (${assessment.original}) is today. ApplyReady did not assume a timezone or end-of-day cutoff.`,
      evidence: requirement.sourceEvidence,
      recommendedFix:
        "Confirm the exact cutoff time from the official source before submitting.",
      status: "open",
      dismissible: true,
    });
    return;
  }

  repos.insertValidation({
    id: newId(),
    applicationId,
    requirementId: requirement.id,
    documentId: null,
    rule: "deadline",
    passed: true,
    severity: "suggestion",
    message: `Deadline ${assessment.original} is in the future.`,
    evidence: requirement.sourceEvidence,
  });
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

void HeuristicDocumentClassifier;
