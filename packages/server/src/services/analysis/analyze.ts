import type Database from "better-sqlite3";
import type { Issue, IssueSeverity, Requirement } from "@applyready/shared";
import { Repositories } from "../../db/repositories.js";
import { newId } from "../../utils/ids.js";
import { HeuristicDocumentClassifier, extractHeadings } from "../documents/classify.js";
import { ApplicantConsistencyChecker } from "../consistency/checker.js";
import { HeuristicRequirementMatcher } from "../matching/matcher.js";
import { RuleDocumentValidator } from "../validation/validator.js";
import { conflictFingerprint } from "../validation/filenamePattern.js";
import { computeReadiness } from "../readiness/score.js";
import { assessDeadline } from "../deadlines/assess.js";
import {
  allocateDocuments,
  distinctSatisfyingDocumentIds,
  type CandidateMatch,
} from "./coverage.js";
import { isSatisfyingMatch } from "../matching/satisfying.js";

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

  // Preserve decisions before clearAnalysis wipes conflicts/matches.
  const previousConfirmed = new Set(
    previousMatches
      .filter((m) => m.userConfirmed)
      .map((m) => `${m.requirementId}::${m.documentId}`),
  );
  const previousConflictDecisions = new Map(
    previousConflicts
      .filter((c) => c.equivalent != null)
      .map((c) => [
        conflictFingerprint(c.field, c.values),
        { equivalent: c.equivalent as boolean },
      ]),
  );

  repos.clearAnalysis(applicationId);

  const candidates: CandidateMatch[] = [];
  const documentIds = new Set(documents.map((d) => d.id));
  const requirementIds = new Set(requirements.map((r) => r.id));

  for (const requirement of requirements) {
    if (requirement.applicability === "not_applicable") {
      continue;
    }

    if (
      requirement.conditional &&
      requirement.applicability === "unknown"
    ) {
      repos.insertIssue({
        id: newId(),
        applicationId,
        requirementId: requirement.id,
        documentId: null,
        severity: "needs_confirmation",
        code: "CONDITIONAL_APPLICABILITY",
        title: `Does "${requirement.title}" apply to you?`,
        explanation:
          requirement.conditionText ||
          "This requirement is conditional. Confirm whether it applies before readiness can be Ready.",
        evidence: requirement.sourceEvidence,
        recommendedFix:
          'Mark "Applies to me" or "Does not apply" on this requirement.',
        status: "open",
        dismissible: true,
      });
      // Still do not treat as required coverage until marked applicable.
      continue;
    }

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

    if (requirement.certainty === "uncertain") {
      repos.insertIssue({
        id: newId(),
        applicationId,
        requirementId: requirement.id,
        documentId: null,
        severity: "needs_confirmation",
        code: "UNCERTAIN_REQUIREMENT",
        title: `Confirm whether "${requirement.title}" is required`,
        explanation:
          "ApplyReady found a document mention without clear required/optional language. Choose required or optional before treating this as settled.",
        evidence: requirement.sourceEvidence,
        recommendedFix:
          "Resolve this requirement as required or optional. Confirming alone is not enough while certainty remains uncertain.",
        status: "open",
        dismissible: true,
      });
      continue;
    }

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

      const confirmed = previousConfirmed.has(
        `${requirement.id}::${document.id}`,
      );

      // Explicit user-confirmed assignments outrank the heuristic, even when
      // the matcher would return does_not_match.
      if (confirmed || finding.status !== "does_not_match") {
        candidates.push({
          requirementId: requirement.id,
          documentId: document.id,
          finding: confirmed
            ? {
                status: "confirmed",
                confidence: Math.max(finding.confidence, 0.95),
                explanation:
                  finding.status === "does_not_match"
                    ? "Preserved explicit user assignment from a previous review."
                    : finding.explanation,
                evidence:
                  finding.evidence.length > 0
                    ? finding.evidence
                    : ["User-confirmed assignment"],
              }
            : finding,
          userConfirmed: confirmed,
        });
      }
    }
  }

  // Also restore confirmed assignments if requirement+document still exist,
  // even when the loop above skipped the requirement category (should be rare).
  for (const key of previousConfirmed) {
    const [reqId, docId] = key.split("::");
    if (!reqId || !docId) continue;
    if (!requirementIds.has(reqId) || !documentIds.has(docId)) continue;
    const req = requirements.find((r) => r.id === reqId);
    if (!req || req.applicability === "not_applicable") continue;
    if (req.certainty === "uncertain") continue;
    if (
      req.category === "proof_of_eligibility" ||
      req.category === "proof_of_enrollment"
    ) {
      continue;
    }
    if (candidates.some((c) => c.requirementId === reqId && c.documentId === docId)) {
      continue;
    }
    candidates.push({
      requirementId: reqId,
      documentId: docId,
      finding: {
        status: "confirmed",
        confidence: 0.95,
        explanation: "Preserved explicit user assignment from a previous review.",
        evidence: ["User-confirmed assignment"],
      },
      userConfirmed: true,
    });
  }

  const { allocations } = allocateDocuments({
    requirements,
    documents,
    candidates,
  });

  // Persist all candidate matches (for UI), then validate allocated docs.
  for (const c of candidates) {
    repos.upsertMatch({
      id: newId(),
      applicationId,
      requirementId: c.requirementId,
      documentId: c.documentId,
      status: c.userConfirmed ? "confirmed" : c.finding.status,
      confidence: c.finding.confidence,
      explanation: c.finding.explanation,
      evidence: c.finding.evidence,
      userConfirmed: c.userConfirmed,
    });
  }

  for (const requirement of requirements) {
    if (requirement.applicability === "not_applicable") continue;
    if (
      requirement.conditional &&
      requirement.applicability === "unknown"
    ) {
      continue;
    }
    if (requirement.certainty === "uncertain") continue;
    if (
      requirement.category === "proof_of_eligibility" ||
      requirement.category === "proof_of_enrollment"
    ) {
      continue;
    }
    if (requirement.category === "other" && requirement.dateRequirement) continue;
    if (requirement.category === "other" && !requirement.filenamePattern) continue;

    const allocated = allocations.get(requirement.id) || [];
    const minCount = Math.max(1, requirement.minimumCount || 1);
    const maxCount = requirement.maximumCount;

    // Coverage uses allocated docs that are genuinely satisfying.
    const qualifyingDocs = [
      ...new Set(
        allocated.filter((docId) =>
          candidates.some(
            (c) =>
              c.requirementId === requirement.id &&
              c.documentId === docId &&
              isSatisfyingMatch({
                status: c.finding.status,
                confidence: c.finding.confidence,
                userConfirmed: c.userConfirmed,
              }),
          ),
        ),
      ),
    ];

    // Cardinality uses the same satisfying predicate (not mere candidates).
    const allQualifyingDistinct = distinctSatisfyingDocumentIds(
      candidates,
      requirement.id,
    );

    const reqCandidates = candidates
      .filter(
        (c) =>
          c.requirementId === requirement.id &&
          (c.userConfirmed || c.finding.status !== "does_not_match"),
      )
      .sort((a, b) => b.finding.confidence - a.finding.confidence);

    if (requirement.required && qualifyingDocs.length < minCount) {
      const hasWeakCandidates = reqCandidates.some(
        (c) =>
          !isSatisfyingMatch({
            status: c.finding.status,
            confidence: c.finding.confidence,
            userConfirmed: c.userConfirmed,
          }),
      );
      // minCount=1 with only weak candidates → confirmation UX, not MISSING.
      // Still emit INSUFFICIENT when more than one qualifying doc is required
      // (or when some but not enough are already satisfying).
      const emitCardinalityGap =
        minCount > 1 ||
        qualifyingDocs.length > 0 ||
        !hasWeakCandidates;
      if (emitCardinalityGap) {
        repos.insertIssue({
          id: newId(),
          applicationId,
          requirementId: requirement.id,
          documentId: null,
          severity: "blocking",
          code:
            minCount > 1 || qualifyingDocs.length > 0
              ? "INSUFFICIENT_DOCUMENT_COUNT"
              : "MISSING_DOCUMENT",
          title:
            minCount > 1 || qualifyingDocs.length > 0
              ? `Need ${minCount} documents for ${requirement.title}`
              : `Missing: ${requirement.title}`,
          explanation:
            minCount > 1 || qualifyingDocs.length > 0
              ? `This requirement needs ${minCount} distinct qualifying documents; found ${qualifyingDocs.length}.`
              : `No uploaded document was matched to the required item "${requirement.title}".`,
          evidence: requirement.sourceEvidence,
          recommendedFix:
            minCount > 1 || qualifyingDocs.length > 0
              ? `Upload ${minCount} distinct ${requirement.category.replaceAll("_", " ")} documents, or assign existing ones.`
              : `Upload a ${requirement.category.replaceAll("_", " ")} that satisfies this requirement, or manually assign an existing document.`,
          status: "open",
          dismissible: false,
        });
      }
    }

    if (maxCount != null && allQualifyingDistinct.length > maxCount) {
      repos.insertIssue({
        id: newId(),
        applicationId,
        requirementId: requirement.id,
        documentId: null,
        severity: "blocking",
        code: "TOO_MANY_DOCUMENTS",
        title: `Too many documents for ${requirement.title}`,
        explanation: `Found ${allQualifyingDistinct.length} qualifying documents but the maximum is ${maxCount}.`,
        evidence: requirement.sourceEvidence,
        recommendedFix: `Keep at most ${maxCount} document(s) assigned to this requirement.`,
        status: "open",
        dismissible: false,
      });
    }

    // Validate satisfying allocations plus best match candidates so content
    // issues (word limits, org name, etc.) still surface before confirmation.
    const docsToValidate = [
      ...new Set([
        ...qualifyingDocs,
        ...reqCandidates
          .slice(0, Math.max(minCount, maxCount ?? minCount, 1))
          .map((c) => c.documentId),
      ]),
    ];

    for (const docId of docsToValidate) {
      const document = documents.find((d) => d.id === docId);
      if (!document) continue;
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
    }

    const bestCandidate = reqCandidates[0] ?? null;
    if (
      bestCandidate &&
      !isSatisfyingMatch({
        status: bestCandidate.finding.status,
        confidence: bestCandidate.finding.confidence,
        userConfirmed: bestCandidate.userConfirmed,
      })
    ) {
      repos.insertIssue({
        id: newId(),
        applicationId,
        requirementId: requirement.id,
        documentId: bestCandidate.documentId,
        severity: "needs_confirmation",
        code: "MATCH_NEEDS_CONFIRMATION",
        title: `Confirm match for ${requirement.title}`,
        explanation:
          bestCandidate.finding.explanation ||
          "ApplyReady found a possible match that needs your confirmation.",
        evidence: bestCandidate.finding.evidence.join(" | "),
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

  // Consistency conflicts — retain decisions only for still-active fingerprints
  const factsByDocument = documents.map((doc) => ({
    documentId: doc.id,
    filename: doc.originalFilename,
    facts: repos.listFacts(doc.id),
  }));
  const conflictFindings = consistency.check(factsByDocument);
  for (const finding of conflictFindings) {
    const fingerprint = conflictFingerprint(finding.field, finding.values);
    const prior = previousConflictDecisions.get(fingerprint);
    if (prior) {
      // equivalent=true → benign; equivalent=false → confirmed mismatch (blocking)
      repos.insertConflict({
        id: newId(),
        applicationId,
        field: finding.field,
        values: finding.values,
        resolved: true,
        equivalent: prior.equivalent,
      });
      if (prior.equivalent === false) {
        repos.insertIssue({
          id: newId(),
          applicationId,
          requirementId: null,
          documentId: finding.values[0]?.documentId ?? null,
          severity: "blocking",
          code: "CONFIRMED_VALUE_MISMATCH",
          title: `Confirmed mismatch: ${finding.field}`,
          explanation:
            "You confirmed these values are a real mismatch. Correct the underlying documents or profile before the application can be Ready.",
          evidence: finding.values
            .map((v) => `${v.source}: ${v.value}`)
            .join(" | "),
          recommendedFix:
            "Update documents so values agree, or mark them equivalent if they are the same fact in different forms.",
          status: "open",
          dismissible: false,
        });
      }
    } else {
      repos.insertConflict({
        id: newId(),
        applicationId,
        field: finding.field,
        values: finding.values,
        resolved: false,
        equivalent: null,
      });
      repos.insertIssue({
        id: newId(),
        applicationId,
        requirementId: null,
        documentId: finding.values[0]?.documentId ?? null,
        severity: "needs_confirmation",
        code: "VALUE_CONFLICT",
        title: `Confirm values for ${finding.field}`,
        explanation:
          "Documents disagree on this field. Mark them equivalent or confirm a real mismatch.",
        evidence: finding.values
          .map((v) => `${v.source}: ${v.value}`)
          .join(" | "),
        recommendedFix:
          'Use "Mark equivalent" if the values mean the same thing, or "Confirm real mismatch" if they conflict.',
        status: "open",
        dismissible: true,
      });
    }
  }

  // Populate profile candidates carefully (do not confirm auto-populated fields)
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
      // Intentionally omit userConfirmed / confirmedFields so auto-fill stays unconfirmed.
      repos.updateProfile(applicationId, patch);
    }
  }

  // Top-level application deadline participates in readiness.
  assessApplicationDeadline(repos, {
    applicationId,
    applicationDeadline: app.deadline,
    requirements,
  });

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
    case "page_limit_max":
      return `Page limit exceeded for ${requirementTitle}`;
    case "page_limit_min":
      return `Page count too low for ${requirementTitle}`;
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
    case "page_limit_max":
      return "Shorten the document to fit within the stated page limit.";
    case "page_limit_min":
      return "Expand the document to meet the minimum page count.";
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

function profileFieldConfirmed(
  profile: NonNullable<ReturnType<Repositories["getProfile"]>>,
  field: string,
): boolean {
  return profile.confirmedFields.includes(
    field as (typeof profile.confirmedFields)[number],
  );
}

function validateEligibilityRequirement(
  repos: Repositories,
  params: {
    applicationId: string;
    requirement: Requirement;
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

    const gpaConfirmed =
      profile && profile.gpa && profileFieldConfirmed(profile, "gpa");

    if (gpaConfirmed && profile.gpa) {
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
          "No GPA value was found in a confirmed profile field or uploaded documents.";
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
          ? "Confirm the correct GPA in the applicant profile (confirm the GPA field), then reanalyze."
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
      (f) => f.fact.factType === "enrollment",
    );
    const positive = enrollmentFacts.filter((f) =>
      /currently_enrolled=true/i.test(f.fact.value),
    );
    const negative = enrollmentFacts.filter((f) =>
      /currently_enrolled=false/i.test(f.fact.value),
    );

    let passed = false;
    let severity: "suggestion" | "blocking" | "needs_confirmation" =
      "needs_confirmation";
    let message =
      "School name or expected graduation date alone does not prove current enrollment.";
    let issueCode = "ENROLLMENT";
    let issueTitle = "Enrollment could not be confirmed";
    let issueExplanation =
      "ApplyReady needs explicit enrollment evidence or a confirmed profile enrollment value. A school name or expected graduation date is not enough.";
    let recommendedFix =
      "Confirm current enrollment in the applicant profile (set currently enrolled and save), or upload enrollment verification that explicitly indicates current enrollment.";

    if (negative.length > 0) {
      passed = false;
      severity = "blocking";
      issueCode = "ENROLLMENT_FAILED";
      issueTitle = "Not currently enrolled";
      message =
        "Uploaded materials explicitly indicate the applicant is not currently enrolled.";
      issueExplanation = message;
      recommendedFix =
        "Upload current enrollment verification, or update documents if enrollment status changed.";
    } else if (positive.length > 0) {
      passed = true;
      severity = "suggestion";
      message =
        "Explicit enrollment evidence was found in uploaded materials.";
    } else if (
      profile &&
      profileFieldConfirmed(profile, "currentlyEnrolled") &&
      profile.currentlyEnrolled === true
    ) {
      passed = true;
      severity = "suggestion";
      message =
        "Current enrollment confirmed in the applicant profile.";
    } else if (
      profile &&
      profileFieldConfirmed(profile, "currentlyEnrolled") &&
      profile.currentlyEnrolled === false
    ) {
      passed = false;
      severity = "blocking";
      issueCode = "ENROLLMENT_FAILED";
      issueTitle = "Not currently enrolled";
      message =
        "Confirmed applicant profile states the applicant is not currently enrolled.";
      issueExplanation = message;
      recommendedFix =
        "If enrollment status changed, update and confirm the applicant profile, then reanalyze.";
    } else {
      passed = false;
      severity = "needs_confirmation";
    }

    repos.insertValidation({
      id: newId(),
      applicationId,
      requirementId: requirement.id,
      documentId: (negative[0] ?? positive[0])?.doc.id ?? null,
      rule: "enrollment",
      passed,
      severity,
      message,
      evidence: requirement.sourceEvidence,
    });

    if (!passed) {
      repos.insertIssue({
        id: newId(),
        applicationId,
        requirementId: requirement.id,
        documentId: null,
        severity,
        code: issueCode,
        title: issueTitle,
        explanation: issueExplanation,
        evidence: requirement.sourceEvidence,
        recommendedFix,
        status: "open",
        dismissible: severity !== "blocking",
      });
    }
  }
}

function emitDeadlineAssessment(
  repos: Repositories,
  params: {
    applicationId: string;
    requirementId: string | null;
    raw: string;
    evidence: string;
    sourceLabel: string;
  },
) {
  const { applicationId, requirementId, raw, evidence, sourceLabel } = params;
  const assessment = assessDeadline(raw);

  if (assessment.status === "ambiguous") {
    repos.insertValidation({
      id: newId(),
      applicationId,
      requirementId,
      documentId: null,
      rule: "deadline",
      passed: false,
      severity: "needs_confirmation",
      message: `Deadline "${raw}" from ${sourceLabel} could not be interpreted confidently (${assessment.reason}).`,
      evidence,
    });
    repos.insertIssue({
      id: newId(),
      applicationId,
      requirementId,
      documentId: null,
      severity: "needs_confirmation",
      code: "DEADLINE_AMBIGUOUS",
      title: "Deadline needs confirmation",
      explanation: `ApplyReady could not confidently interpret deadline "${raw}" (${sourceLabel}).`,
      evidence,
      recommendedFix:
        "Confirm the official deadline from the source and update the application or requirement if needed.",
      status: "open",
      dismissible: true,
    });
    return assessment;
  }

  if (assessment.status === "past") {
    repos.insertValidation({
      id: newId(),
      applicationId,
      requirementId,
      documentId: null,
      rule: "deadline",
      passed: false,
      severity: "blocking",
      message: `Deadline ${assessment.original} (${sourceLabel}) appears to be in the past.`,
      evidence,
    });
    repos.insertIssue({
      id: newId(),
      applicationId,
      requirementId,
      documentId: null,
      severity: "blocking",
      code: "DEADLINE_EXPIRED",
      title: "Submission deadline has passed",
      explanation: `The deadline (${assessment.original}) from ${sourceLabel} is before now.`,
      evidence,
      recommendedFix:
        "Verify whether late submissions are accepted, or update the deadline if the source was misread.",
      status: "open",
      dismissible: false,
    });
    return assessment;
  }

  if (assessment.status === "today") {
    repos.insertValidation({
      id: newId(),
      applicationId,
      requirementId,
      documentId: null,
      rule: "deadline",
      passed: true,
      severity: "needs_confirmation",
      message: `Deadline is today (${assessment.original}) from ${sourceLabel}. End-of-day timing was not assumed.`,
      evidence,
    });
    repos.insertIssue({
      id: newId(),
      applicationId,
      requirementId,
      documentId: null,
      severity: "needs_confirmation",
      code: "DEADLINE_TODAY",
      title: "Deadline is today",
      explanation: `The deadline (${assessment.original}) from ${sourceLabel} is today. ApplyReady did not assume a timezone or end-of-day cutoff.`,
      evidence,
      recommendedFix:
        "Confirm the exact cutoff time from the official source before submitting.",
      status: "open",
      dismissible: true,
    });
    return assessment;
  }

  repos.insertValidation({
    id: newId(),
    applicationId,
    requirementId,
    documentId: null,
    rule: "deadline",
    passed: true,
    severity: "suggestion",
    message: `Deadline ${assessment.original} (${sourceLabel}) is in the future.`,
    evidence,
  });
  return assessment;
}

function normalizeDeadlineKey(raw: string): string {
  const assessment = assessDeadline(raw);
  if (assessment.status === "ambiguous") return raw.trim().toLowerCase();
  return assessment.comparable;
}

function validateDeadlineRequirement(
  repos: Repositories,
  params: {
    applicationId: string;
    requirement: Requirement;
  },
) {
  const { applicationId, requirement } = params;
  const raw = requirement.dateRequirement || "";
  emitDeadlineAssessment(repos, {
    applicationId,
    requirementId: requirement.id,
    raw,
    evidence: requirement.sourceEvidence,
    sourceLabel: "extracted requirement",
  });
}

function assessApplicationDeadline(
  repos: Repositories,
  params: {
    applicationId: string;
    applicationDeadline: string | null;
    requirements: Requirement[];
  },
) {
  const { applicationId, applicationDeadline, requirements } = params;
  if (!applicationDeadline || !applicationDeadline.trim()) return;

  const extracted = requirements.filter(
    (r) =>
      r.dateRequirement &&
      (r.category === "other" || Boolean(r.dateRequirement)),
  );

  if (extracted.length === 0) {
    emitDeadlineAssessment(repos, {
      applicationId,
      requirementId: null,
      raw: applicationDeadline,
      evidence: applicationDeadline,
      sourceLabel: "application deadline",
    });
    return;
  }

  // Reconcile with extracted deadlines — conflict if they clearly disagree.
  let agreed = false;
  let conflicted = false;
  for (const req of extracted) {
    const extractedRaw = req.dateRequirement!;
    const appKey = normalizeDeadlineKey(applicationDeadline);
    const extKey = normalizeDeadlineKey(extractedRaw);
    const appAssess = assessDeadline(applicationDeadline);
    const extAssess = assessDeadline(extractedRaw);

    if (
      appAssess.status !== "ambiguous" &&
      extAssess.status !== "ambiguous" &&
      appKey === extKey
    ) {
      agreed = true;
      continue;
    }

    if (
      appAssess.status !== "ambiguous" &&
      extAssess.status !== "ambiguous" &&
      appKey !== extKey
    ) {
      conflicted = true;
    }
  }

  if (conflicted) {
    repos.insertIssue({
      id: newId(),
      applicationId,
      requirementId: extracted[0]?.id ?? null,
      documentId: null,
      severity: "needs_confirmation",
      code: "DEADLINE_CONFLICT",
      title: "Application deadline conflicts with extracted deadline",
      explanation: `The application deadline (${applicationDeadline}) does not match the deadline extracted from requirements.`,
      evidence: [
        `application: ${applicationDeadline}`,
        ...extracted.map((r) => `extracted: ${r.dateRequirement}`),
      ].join(" | "),
      recommendedFix:
        "Confirm the official deadline and update the application and/or requirement so they agree.",
      status: "open",
      dismissible: true,
    });
    return;
  }

  if (agreed) {
    // One logical check already emitted via extracted requirement validation.
    return;
  }

  // Extracted existed but was ambiguous — still assess top-level as user input.
  emitDeadlineAssessment(repos, {
    applicationId,
    requirementId: null,
    raw: applicationDeadline,
    evidence: applicationDeadline,
    sourceLabel: "application deadline",
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
