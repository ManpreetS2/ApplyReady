import type {
  Issue,
  ProfileConflict,
  ReadinessBreakdown,
  ReadinessReport,
  ReadinessStatus,
  Requirement,
  DocumentMatch,
} from "@applyready/shared";

export function computeReadiness(params: {
  applicationId: string;
  requirements: Requirement[];
  matches: DocumentMatch[];
  issues: Issue[];
  conflicts: ProfileConflict[];
}): ReadinessReport {
  const { applicationId, requirements, matches, issues, conflicts } = params;
  const required = requirements.filter(
    (r) =>
      r.required &&
      r.category !== "other" &&
      r.category !== "proof_of_eligibility" &&
      r.category !== "proof_of_enrollment",
  );
  const openIssues = issues.filter((i) => i.status === "open");
  const blocking = openIssues.filter((i) => i.severity === "blocking");
  const warnings = openIssues.filter((i) => i.severity === "warning");
  const unresolvedConflicts = conflicts.filter((c) => !c.resolved);

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
      score: Math.round((1 - blockingPenalty) * 20),
      note: `${blocking.length} open blocking issue(s)`,
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

  const hardBlock =
    blocking.length > 0 ||
    required.some((req) => {
      const match = bestByRequirement.get(req.id);
      return (
        !match ||
        !(
          match.userConfirmed ||
          match.status === "confirmed" ||
          (match.status === "likely" && match.confidence >= 0.8)
        )
      );
    }) ||
    unresolvedConflicts.some((c) => c.equivalent === false);

  let status: ReadinessStatus;
  if (required.length === 0 && matches.length === 0) {
    status = "unable_to_determine";
    score = Math.min(score, 40);
  } else if (hardBlock || score < 55) {
    status = "not_ready";
    if (hardBlock) score = Math.min(score, 54);
  } else if (score < 75 || warnings.length > 0 || uncertainRequirements > 0) {
    status = "needs_attention";
  } else if (score < 90 || likelyMatches > 0) {
    status = "nearly_ready";
  } else {
    status = "ready";
  }

  // Cannot be ready with hard blockers.
  if (hardBlock && status === "ready") status = "not_ready";
  if (
    status === "ready" &&
    (blocking.length > 0 ||
      requiredPresent < required.length ||
      unresolvedConflicts.some((c) => c.equivalent === false))
  ) {
    status = "not_ready";
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
