import type { ConsistencyChecker } from "../../providers/interfaces.js";

const TRACKED = [
  "full_legal_name",
  "email",
  "phone",
  "school",
  "expected_graduation_date",
  "major",
  "gpa",
] as const;

function normalizeValue(field: string, value: string): string {
  const v = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (field === "full_legal_name") {
    return v.replace(/\./g, "").replace(/\b([a-z])\b/g, "$1");
  }
  if (field === "email") return v;
  if (field === "phone") return v.replace(/\D/g, "");
  return v;
}

function likelyEquivalent(field: string, a: string, b: string): boolean {
  const na = normalizeValue(field, a);
  const nb = normalizeValue(field, b);
  if (na === nb) return true;
  if (field === "full_legal_name") {
    const pa = na.split(" ");
    const pb = nb.split(" ");
    if (pa[0] === pb[0] && pa[pa.length - 1] === pb[pb.length - 1]) return true;
  }
  return false;
}

export class ApplicantConsistencyChecker implements ConsistencyChecker {
  check(
    factsByDocument: Array<{
      documentId: string;
      filename: string;
      facts: Array<{ factType: string; value: string }>;
    }>,
  ) {
    const findings: Array<{
      field: string;
      values: Array<{ source: string; value: string; documentId?: string }>;
    }> = [];

    for (const field of TRACKED) {
      const values: Array<{ source: string; value: string; documentId?: string }> =
        [];
      for (const doc of factsByDocument) {
        for (const fact of doc.facts.filter((f) => f.factType === field)) {
          values.push({
            source: doc.filename,
            value: fact.value,
            documentId: doc.documentId,
          });
        }
      }

      const unique = [...new Map(values.map((v) => [normalizeValue(field, v.value), v])).values()];
      if (unique.length <= 1) continue;

      const allEquivalent = unique.every((v) =>
        likelyEquivalent(field, unique[0]!.value, v.value),
      );

      // Always surface conflicts for user confirmation; blocking decided later.
      if (!allEquivalent || unique.length > 1) {
        findings.push({ field, values: unique });
      }
    }

    return findings;
  }
}
