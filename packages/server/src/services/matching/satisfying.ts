import type { DocumentMatch, MatchStatus } from "@applyready/shared";

const LIKELY_CONFIDENCE_THRESHOLD = 0.8;

/**
 * Shared predicate for documents that count toward readiness coverage and
 * min/max cardinality. Candidate matches with status `possible` /
 * `needs_confirmation` remain visible but do not satisfy counts.
 */
export function isSatisfyingMatch(params: {
  status: MatchStatus | DocumentMatch["status"];
  confidence: number;
  userConfirmed: boolean;
}): boolean {
  if (params.userConfirmed) return true;
  if (params.status === "confirmed") return true;
  if (
    params.status === "likely" &&
    params.confidence >= LIKELY_CONFIDENCE_THRESHOLD
  ) {
    return true;
  }
  return false;
}

export { LIKELY_CONFIDENCE_THRESHOLD };
