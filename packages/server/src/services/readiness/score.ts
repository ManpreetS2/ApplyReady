import type {
  Issue,
  ProfileConflict,
  ReadinessBreakdown,
  ReadinessReport,
  ReadinessStatus,
  Requirement,
  DocumentMatch,
} from "@applyready/shared";

const ELIGIBILITY_ISSUE_CODES = new Set([
  "MINIMUM_GPA",
  "GPA_CONFLICT",
  "ENROLLMENT",
  "ENROLLMENT_FAILED",
  "DEADLINE_EXPIRED",
  "DEADLINE_AMBIGUOUS",
  "DEADLINE_TODAY",
  "ELIGIBILITY_UNRESOLVED",
]);

function isDocumentRequirement(r: Requirement): boolean {
  return (
    r.category !== "other" &&
    r.category !== "proof_of_eligibility" &&
    r.category !== "proof_of_enrollment"
  );
}

function isEligibilityOrDeadlineRequirement(r: Requirement): boolean {
  return (
    r.required &&
    (r.category === "proof_of_eligibility" ||
      r.category === "proof_of_enrollment" ||
      (r.category === "other" && Boolean(r.dateRequirement)))
  );
}

export function computeReadiness(params: {
  applicationId: string;
  requirements: Requirement[];
  matches: DocumentMatch[];
  issues: Issue[];
  conflicts: ProfileConflict[];
}): ReadinessReport {
  const { applicationId, requirements, matches, issues, conflicts } = params;
  const required = requirements.filter(
    (r) => r.required && isDocumentRequirement(r),
  );
  const openIssues = issues.filter((i) => i.status === "open");
  const blocking = openIssues.filter((i) => i.severity === "blocking");
  const warnings = openIssues.filter((i) => i.severity === "warning");
  const unresolvedConflicts = conflicts.filter((c) => !c.resolved);
  const uncertainRequirementIssues = openIssues.filter(
    (i) => i.code === "UNCERTAIN_REQUIREMENT",
  );
  const eligibilityUnresolved = openIssues.filter(
    (i) =>
      ELIGIBILITY_ISSUE_CODES.has(i.code) &&
      (i.severity === "blocking" || i.severity === "needs_confirmation"),
  );
  const hasEligibilityOrDeadline = requirements.some(
    isEligibilityOrDeadlineRequirement,
  );

  const bestByRequirement = new Map<string, DocumentMatch>();
  for (const match of matches) {
    if (match.status === "does_not_match") continue;
    const existing = bestByRequirement.get(match.requirementId);
    if (!existing || match.confidence > existing.confidence) {
      bestByRequirement.set(match.requirementId, match);
    }
  }

  let requiredPresent = 0;
  let confirmedMatches = 0;
  let likelyMatches = 0;
  let uncertainRequirements = 0;

  for (const req of required) {
    const match = bestByRequirement.get(req.id);
    if (!match) {
      uncertainRequirements += 1;
      continue;
    }
    if (
      match.userConfirmed ||
      match.status === "confirmed" ||
      (match.status === "likely" && match.confidence >= 0.8)
    ) {
      requiredPresent += 1;
      if (match.userConfirmed || match.status === "confirmed") confirmedMatches += 1;
      else likelyMatches += 1;
    } else if (
      match.status === "needs_confirmation" ||
      match.status === "possible"
    ) {
      uncertainRequirements += 1;
    } else {
      uncertainRequirements += 1;
    }
  }

  uncertainRequirements += uncertainRequirementIssues.length;

  const requiredCoverage =
    required.length === 0 ? 1 : requiredPresent / required.length;
  const confirmationRatio =
    required.length === 0
      ? 1
      : (confirmedMatches + likelyMatches * 0.75) / required.length;
  const blockingPenalty = Math.min(1, blocking.length * 0.18);
  const warningPenalty = Math.min(0.25, warnings.length * 0.04);
  const uncertaintyPenalty = Math.min(
    0.3,
    uncertainRequirements * 0.06 +
      requirements.filter((r) => !r.userConfirmed && r.confidence < 0.6).length *
        0.02,
  );
  const conflictPenalty = Math.min(
    0.2,
    unresolvedConflicts.filter((c) => c.equivalent === false).length * 0.1 +
      unresolvedConflicts.filter((c) => c.equivalent == null).length * 0.03,
  );
  const eligibilityPenalty = Math.min(0.35, eligibilityUnresolved.length * 0.12);

  const factors: ReadinessBreakdown["factors"] = [
    {
      label: "Required documents present",
      weight: 40,
      score: Math.round(requiredCoverage * 40),
      note: `${requiredPresent}/${required.length || 0} required items covered`,
    },
    {
      label: "Match confirmation quality",
      weight: 25,
      score: Math.round(confirmationRatio * 25),
      note: `${confirmedMatches} confirmed, ${likelyMatches} likely`,
    },
    {
      label: "Blocking issues",
      weight: 20,
      score: Math.round((1 - blockingPenalty - eligibilityPenalty / 2) * 20),
      note: `${blocking.length} blocking, ${eligibilityUnresolved.length} eligibility`,
    },
    {
      label: "Warnings & uncertainty",
      weight: 10,
      score: Math.round((1 - warningPenalty - uncertaintyPenalty / 2) * 10),
      note: `${warnings.length} warnings, ${uncertainRequirements} uncertain`,
    },
    {
      label: "Consistency",
      weight: 5,
      score: Math.round((1 - conflictPenalty) * 5),
      note: `${unresolvedConflicts.length} unresolved conflict(s)`,
    },
  ];

  let score = factors.reduce(
    (sum: number, f: ReadinessBreakdown["factors"][number]) => sum + f.score,
    0,
  );
  score = Math.max(0, Math.min(100, score));

  const missingRequiredDocs = required.some((req) => {
    const match = bestByRequirement.get(req.id);
    return (
      !match ||
      !(
        match.userConfirmed ||
        match.status === "confirmed" ||
        (match.status === "likely" && match.confidence >= 0.8)
      )
    );
  });

  const hardBlock =
    blocking.length > 0 ||
    missingRequiredDocs ||
    unresolvedConflicts.some((c) => c.equivalent === false) ||
    eligibilityUnresolved.some((i) => i.severity === "blocking");

  const preventsReady =
    hardBlock ||
    eligibilityUnresolved.length > 0 ||
    uncertainRequirementIssues.length > 0;

  /**
   * Status ordering:
   * 1. Known hard failures (including eligibility/deadline) win over "no documents".
   * 2. Unresolved eligibility / uncertain requirements → needs_attention.
   * 3. Eligibility-only apps with all checks passing → ready (documented).
   * 4. Empty apps with nothing to evaluate → unable_to_determine.
   */
  let status: ReadinessStatus;
  if (hardBlock) {
    status = "not_ready";
    score = Math.min(score, 54);
  } else if (
    eligibilityUnresolved.length > 0 ||
    uncertainRequirementIssues.length > 0
  ) {
    status = "needs_attention";
  } else if (required.length === 0 && matches.length === 0) {
    if (hasEligibilityOrDeadline) {
      // Required eligibility/deadline checks exist and none are unresolved/failed.
      status = "ready";
    } else if (requirements.length === 0) {
      status = "unable_to_determine";
      score = Math.min(score, 40);
    } else {
      // Only optional/uncertain non-eligibility items with no matches.
      status = "unable_to_determine";
      score = Math.min(score, 40);
    }
  } else if (score < 55) {
    status = "not_ready";
  } else if (score < 75 || warnings.length > 0 || uncertainRequirements > 0) {
    status = "needs_attention";
  } else if (score < 90 || likelyMatches > 0) {
    status = "nearly_ready";
  } else {
    status = "ready";
  }

  if (hardBlock && status === "ready") status = "not_ready";
  if (preventsReady && status === "ready") {
    status = hardBlock ? "not_ready" : "needs_attention";
  }
  if (
    status === "ready" &&
    (blocking.length > 0 ||
      requiredPresent < required.length ||
      unresolvedConflicts.some((c) => c.equivalent === false) ||
      eligibilityUnresolved.length > 0 ||
      uncertainRequirementIssues.length > 0)
  ) {
    status = hardBlock ? "not_ready" : "needs_attention";
  }

  return {
    applicationId,
    score,
    status,
    breakdown: {
      requiredPresent,
      requiredTotal: required.length,
      confirmedMatches,
      likelyMatches,
      validationPassed: 0,
      validationTotal: 0,
      blockingIssues: blocking.length,
      warnings: warnings.length,
      uncertainRequirements,
      consistencyConflicts: unresolvedConflicts.length,
      factors,
    },
    generatedAt: new Date().toISOString(),
  };
}
