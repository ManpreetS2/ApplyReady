import type { DocumentRecord, Requirement } from "@applyready/shared";
import type { MatchFinding } from "../../providers/interfaces.js";
import { isSatisfyingMatch } from "../matching/satisfying.js";

export type CandidateMatch = {
  requirementId: string;
  documentId: string;
  finding: MatchFinding;
  userConfirmed: boolean;
};

/**
 * Companion constraints (e.g. packet filename) may share a document with
 * another requirement of the same category. Ordinary instance requirements
 * (Essay 1 vs Essay 2) consume exclusive documents.
 */
export function isCompanionConstraint(
  requirement: Requirement,
  all: Requirement[],
): boolean {
  if (!requirement.filenamePattern) return false;
  if (/filename/i.test(requirement.title)) return true;
  if (requirement.extractionRule === "filename-pattern") return true;
  const siblings = all.filter(
    (r) =>
      r.id !== requirement.id &&
      r.category === requirement.category &&
      r.applicability !== "not_applicable",
  );
  return (
    siblings.length > 0 &&
    requirement.category === "combined_packet" &&
    Boolean(requirement.filenamePattern)
  );
}

export function isExclusiveInstanceRequirement(
  requirement: Requirement,
  all: Requirement[],
): boolean {
  if (requirement.applicability === "not_applicable") return false;
  if (
    requirement.category === "other" ||
    requirement.category === "proof_of_eligibility" ||
    requirement.category === "proof_of_enrollment"
  ) {
    return false;
  }
  if (isCompanionConstraint(requirement, all)) return false;
  return true;
}

function isMatchCandidate(c: CandidateMatch): boolean {
  return c.userConfirmed || c.finding.status !== "does_not_match";
}

function isSatisfyingCandidate(c: CandidateMatch): boolean {
  return isSatisfyingMatch({
    status: c.finding.status,
    confidence: c.finding.confidence,
    userConfirmed: c.userConfirmed,
  });
}

/**
 * Allocate distinct documents to exclusive instance requirements.
 * Only satisfying matches (and user-confirmed assignments) consume coverage
 * slots. Weaker candidates remain visible outside allocation.
 */
export function allocateDocuments(params: {
  requirements: Requirement[];
  documents: DocumentRecord[];
  candidates: CandidateMatch[];
}): {
  allocations: Map<string, string[]>; // requirementId -> documentIds
  lockedDocuments: Set<string>;
} {
  const { requirements, candidates } = params;
  const allocations = new Map<string, string[]>();
  const lockedDocuments = new Set<string>();

  const byReq = new Map<string, CandidateMatch[]>();
  for (const c of candidates) {
    if (!isMatchCandidate(c)) continue;
    const list = byReq.get(c.requirementId) || [];
    list.push(c);
    byReq.set(c.requirementId, list);
  }

  // 1. Honor user-confirmed assignments first.
  for (const req of requirements) {
    const confirmed = (byReq.get(req.id) || []).filter((c) => c.userConfirmed);
    if (confirmed.length === 0) continue;
    const exclusive = isExclusiveInstanceRequirement(req, requirements);
    const assigned: string[] = [];
    for (const c of confirmed.sort(
      (a, b) => b.finding.confidence - a.finding.confidence,
    )) {
      if (exclusive && lockedDocuments.has(c.documentId)) continue;
      if (assigned.includes(c.documentId)) continue;
      assigned.push(c.documentId);
      if (exclusive) lockedDocuments.add(c.documentId);
      const min = Math.max(1, req.minimumCount || 1);
      if (assigned.length >= min) break;
    }
    if (assigned.length > 0) allocations.set(req.id, assigned);
  }

  // 2. Allocate remaining exclusive requirements from satisfying candidates only.
  const exclusiveReqs = requirements
    .filter(
      (r) =>
        r.required &&
        r.applicability !== "not_applicable" &&
        isExclusiveInstanceRequirement(r, requirements),
    )
    .sort((a, b) => {
      const aHave = allocations.get(a.id)?.length ?? 0;
      const bHave = allocations.get(b.id)?.length ?? 0;
      const aNeed = Math.max(1, a.minimumCount || 1) - aHave;
      const bNeed = Math.max(1, b.minimumCount || 1) - bHave;
      return bNeed - aNeed;
    });

  for (const req of exclusiveReqs) {
    const min = Math.max(1, req.minimumCount || 1);
    const existing = allocations.get(req.id) || [];
    if (existing.length >= min) continue;
    const assigned = [...existing];
    const pool = (byReq.get(req.id) || [])
      .filter((c) => isSatisfyingCandidate(c))
      .filter((c) => !c.userConfirmed || assigned.includes(c.documentId))
      .sort((a, b) => b.finding.confidence - a.finding.confidence);

    for (const c of pool) {
      if (assigned.includes(c.documentId)) continue;
      if (lockedDocuments.has(c.documentId)) continue;
      assigned.push(c.documentId);
      lockedDocuments.add(c.documentId);
      if (assigned.length >= min) break;
    }
    allocations.set(req.id, assigned);
  }

  // 3. Companions and non-exclusive: satisfying matches only; may share.
  for (const req of requirements) {
    if (isExclusiveInstanceRequirement(req, requirements)) {
      continue;
    }
    if (allocations.has(req.id) && (allocations.get(req.id) || []).length > 0) {
      continue;
    }
    if (req.applicability === "not_applicable") continue;
    if (
      req.category === "proof_of_eligibility" ||
      req.category === "proof_of_enrollment"
    ) {
      continue;
    }
    if (req.category === "other" && !req.filenamePattern) continue;

    const pool = (byReq.get(req.id) || [])
      .filter((c) => isSatisfyingCandidate(c))
      .sort((a, b) => b.finding.confidence - a.finding.confidence);
    const assigned: string[] = [];
    const min = Math.max(1, req.minimumCount || 1);
    for (const c of pool) {
      if (assigned.includes(c.documentId)) continue;
      assigned.push(c.documentId);
      if (assigned.length >= min) break;
    }
    if (assigned.length > 0) allocations.set(req.id, assigned);
  }

  return { allocations, lockedDocuments };
}

/** Distinct satisfying document IDs for a requirement (for min/max counts). */
export function distinctSatisfyingDocumentIds(
  candidates: CandidateMatch[],
  requirementId: string,
): string[] {
  return [
    ...new Set(
      candidates
        .filter(
          (c) =>
            c.requirementId === requirementId && isSatisfyingCandidate(c),
        )
        .map((c) => c.documentId),
    ),
  ];
}
