import type { RequirementCategory } from "@applyready/shared";
import type {
  ExtractContext,
  ExtractedRequirementDraft,
  RequirementDeduplicator,
  RequirementExtractor,
  RequirementNormalizer,
} from "../../providers/interfaces.js";
import { nearbyContext, normalizeWhitespace, splitSentences } from "../../utils/text.js";

const DOC_PATTERNS: Array<{
  category: RequirementCategory;
  terms: RegExp;
  title: string;
}> = [
  {
    category: "resume",
    terms: /\b(resume|curriculum vitae|\bcv\b)\b/i,
    title: "Resume",
  },
  {
    category: "transcript",
    terms: /\b(unofficial\s+transcript|official\s+transcript|transcript)\b/i,
    title: "Transcript",
  },
  {
    category: "essay",
    terms: /\b(personal statement|essay|statement of purpose|cover letter)\b/i,
    title: "Essay / Personal Statement",
  },
  {
    category: "recommendation",
    terms: /\b(recommendation(?:\s+letter)?|letter of recommendation|reference letter|references?|(?:the\s+)?letter\s+must\s+be\s+addressed)\b/i,
    title: "Recommendation Letter",
  },
  {
    category: "portfolio",
    terms: /\b(portfolio|work samples?|project samples?)\b/i,
    title: "Portfolio",
  },
  {
    category: "identification",
    terms: /\b(government[- ]issued id|photo id|identification|passport|driver'?s license)\b/i,
    title: "Identification",
  },
  {
    category: "application_form",
    terms: /\b(application form|completed application|online application)\b/i,
    title: "Application Form",
  },
  {
    category: "proof_of_enrollment",
    terms: /\b(proof of enrollment|enrollment verification|verification of enrollment)\b/i,
    title: "Proof of Enrollment",
  },
  {
    category: "certification",
    terms: /\b(certification|certificate)\b/i,
    title: "Certification",
  },
  {
    category: "combined_packet",
    terms: /\b(combined packet|single pdf|merged packet|application packet)\b/i,
    title: "Combined Application Packet",
  },
  {
    category: "financial_document",
    terms: /\b(financial aid|tax return|fafsa|income verification)\b/i,
    title: "Financial Document",
  },
  {
    category: "proof_of_eligibility",
    terms: /\b(proof of eligibility|eligibility documentation)\b/i,
    title: "Proof of Eligibility",
  },
  {
    category: "supplemental_response",
    terms: /\b(supplemental(?:\s+response|\s+question)?|short answer)\b/i,
    title: "Supplemental Response",
  },
];

function confidenceLevel(score: number): number {
  return Math.max(0.2, Math.min(0.98, score));
}

function detectOptional(sentence: string): boolean {
  return /\b(optional|recommended|may submit|may include|not required|encouraged)\b/i.test(
    sentence,
  );
}

/** Explicit mandatory language only — no silent default to required. */
function detectRequired(sentence: string): boolean {
  return /\b(required|must submit|must provide|shall (?:submit|provide)|needs? to (?:provide|include|submit)|is required)\b/i.test(
    sentence,
  );
}

function detectCertainty(
  sentence: string,
): ExtractedRequirementDraft["certainty"] {
  if (detectOptional(sentence)) return "optional";
  if (detectRequired(sentence)) return "required";
  return "uncertain";
}

function extractWordLimits(sentence: string): {
  min: number | null;
  max: number | null;
} {
  const between = sentence.match(
    /between\s+(\d{2,5})\s*(?:and|–|-|to)\s*(\d{2,5})\s*words?/i,
  );
  if (between) {
    return { min: Number(between[1]), max: Number(between[2]) };
  }
  const maxOnly = sentence.match(
    /(?:maximum|no more than|up to|not exceed(?:ing)?)\s+(\d{2,5})\s*words?/i,
  );
  if (maxOnly) return { min: null, max: Number(maxOnly[1]) };
  const minOnly = sentence.match(
    /(?:minimum|at least|no fewer than)\s+(\d{2,5})\s*words?/i,
  );
  if (minOnly) return { min: Number(minOnly[1]), max: null };
  const range = sentence.match(/(\d{2,5})\s*[-–to]+\s*(\d{2,5})\s*words?/i);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  return { min: null, max: null };
}

function extractPageLimits(sentence: string): {
  min: number | null;
  max: number | null;
} {
  const between = sentence.match(
    /between\s+(\d{1,2})\s*(?:and|–|-|to)\s*(\d{1,2})\s*pages?/i,
  );
  if (between) {
    return { min: Number(between[1]), max: Number(between[2]) };
  }
  const range = sentence.match(
    /\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*pages?\b/i,
  );
  if (range) {
    return { min: Number(range[1]), max: Number(range[2]) };
  }
  const max = sentence.match(
    /(?:maximum|no more than|up to|not exceed(?:ing)?)\s+(\d{1,2})\s*pages?/i,
  );
  if (max) return { min: null, max: Number(max[1]) };
  const minOnly = sentence.match(
    /(?:minimum|at least|no fewer than)\s+(\d{1,2})\s*pages?/i,
  );
  if (minOnly) return { min: Number(minOnly[1]), max: null };
  // Bare "2 pages" / "exactly 2 pages" → exact min=max when clearly a page requirement.
  const exact = sentence.match(
    /(?:exactly\s+)?\b(\d{1,2})\s*pages?\b/i,
  );
  if (
    exact &&
    /page/i.test(sentence) &&
    !/(?:maximum|minimum|at least|no more|up to|between)/i.test(sentence)
  ) {
    const n = Number(exact[1]);
    return { min: n, max: n };
  }
  return { min: null, max: null };
}

/** Only collect extensions when the source explicitly mentions formats. */
function extractExtensions(sentence: string): string[] {
  const found = new Set<string>();
  if (/\bpdf\b/i.test(sentence)) found.add(".pdf");
  if (/\bdocx\b/i.test(sentence)) found.add(".docx");
  if (/\bdoc\b(?!\w)/i.test(sentence) && !/\bdocx\b/i.test(sentence)) {
    // bare "doc" is too ambiguous; only accept explicit .doc extension
  }
  if (/\btxt\b/i.test(sentence)) found.add(".txt");
  const dotted = sentence.match(/\.(pdf|docx|doc|txt)\b/gi) || [];
  for (const ext of dotted) found.add(ext.toLowerCase());
  return [...found];
}

function extractFilenamePattern(sentence: string): string | null {
  const named = sentence.match(
    /(?:named|filename|file name|named as)[:\s]+([A-Za-z0-9_\-{}]+\.(?:pdf|docx|txt))/i,
  );
  if (named?.[1]) return named[1];
  const pattern = sentence.match(
    /\b([A-Za-z]+_[A-Za-z]+_\d{4}\.pdf)\b/,
  );
  return pattern?.[1] ?? null;
}

function extractRecCountNumber(sentence: string): number | null {
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
  };
  const m = sentence.match(
    /\b(one|two|three|four|five|\d+)\s+(?:letters?\s+of\s+recommendation|recommendation(?:\s+letters?)?|references?)\b/i,
  );
  if (!m?.[1]) return null;
  const raw = m[1].toLowerCase();
  return words[raw] ?? Number(raw);
}

/**
 * Recommendation cardinality semantics:
 * - "submit/provide N" / "at least N" → min=N, max=null
 * - "exactly N" → min=N, max=N
 * - "no more than / at most / maximum N" → min stays default (1), max=N
 */
function extractRecCountSemantics(sentence: string): {
  minimumCount: number;
  maximumCount: number | null;
} | null {
  const n = extractRecCountNumber(sentence);
  if (n == null || !Number.isFinite(n) || n < 1) return null;

  if (
    /\b(?:exactly|precisely)\s+(?:one|two|three|four|five|\d+)\b/i.test(
      sentence,
    )
  ) {
    return { minimumCount: n, maximumCount: n };
  }
  if (
    /\b(?:no more than|at most|up to|maximum(?:\s+of)?)\s+(?:one|two|three|four|five|\d+)\b/i.test(
      sentence,
    )
  ) {
    return { minimumCount: 1, maximumCount: n };
  }
  // "at least N", "submit N", "N recommendation letters are required", etc.
  return { minimumCount: n, maximumCount: null };
}

function extractDeadline(text: string): string | null {
  // Prefer full cutoff phrases (date + time + optional TZ) over date-only.
  const withTime = text.match(
    /(?:deadline|due(?:\s+date)?|submit by|must be submitted by)[:\s]+([A-Za-z]+ \d{1,2},?\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s*(?:AM|PM)?(?:\s+[A-Z]{2,5})?|\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?|[A-Za-z]+ \d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  );
  return withTime?.[1]?.trim() ?? null;
}

function detectOrganizationExpected(sentence: string): string | null {
  // Locate an explicit address / reference / name verb (case-insensitive),
  // then capture the concrete org name that follows — never leading instruction text.
  const verb = sentence.match(
    /\b(?:(?:must|should)\s+be\s+addressed\s+to|address(?:ed)?\s+(?:(?:the\s+)?(?:letter|essay|recommendation|statement)\s+)?to|(?:must|should)\s+reference|(?:must|should)\s+name|\bname|\breference)\b/i,
  );
  if (!verb || verb.index == null) return null;
  const after = sentence.slice(verb.index + verb[0].length);
  const named = after.match(
    /^\s*(?:the\s+)?([A-Z][A-Za-z0-9 &'-]{1,60}(?:Scholarship|Foundation|Program|Fellowship))\b/,
  );
  const name = named?.[1]?.trim();
  if (!name) return null;
  if (/^(the\s+)?organization\b/i.test(name)) return null;
  return name;
}

function detectSignatureRequired(sentence: string): boolean {
  return /\b(signature|signed (?:letter|recommendation)|hand[- ]?signed|must be signed)\b/i.test(
    sentence,
  );
}

/** Explicit conditional clauses only — bare "when"/"if" in narrative is not enough. */
function detectConditional(sentence: string): boolean {
  return (
    /\bif applicable\b/i.test(sentence) ||
    /\bwhere applicable\b/i.test(sentence) ||
    /\bonly if\b/i.test(sentence) ||
    /\bif you\b/i.test(sentence) ||
    /\bif the applicant\b/i.test(sentence) ||
    /\bif currently\b/i.test(sentence) ||
    /\bfor applicants who\b/i.test(sentence) ||
    /\bwhen required\b/i.test(sentence) ||
    /\bif\s+(?:you\s+are|you\s+have|you\s+were|currently)\b/i.test(sentence)
  );
}

function emptyDraft(
  partial: Partial<ExtractedRequirementDraft> &
    Pick<
      ExtractedRequirementDraft,
      "title" | "category" | "sourceEvidence" | "extractionRule" | "confidence"
    >,
): ExtractedRequirementDraft {
  const certainty = partial.certainty ?? "uncertain";
  const conditional = partial.conditional ?? false;
  return {
    description: "",
    conditionText: null,
    sourceLocation: null,
    acceptedDocumentTypes: [],
    acceptedFileExtensions: [],
    minimumCount: 1,
    maximumCount: null,
    wordLimitMinimum: null,
    wordLimitMaximum: null,
    pageLimitMinimum: null,
    pageLimitMaximum: null,
    filenamePattern: null,
    signatureRequired: false,
    dateRequirement: null,
    expirationRule: null,
    requiredKeywords: [],
    organizationNameExpected: null,
    customValidationNotes: null,
    ...partial,
    certainty,
    required: certainty === "required",
    conditional,
    applicability:
      partial.applicability ?? (conditional ? "unknown" : "applicable"),
  };
}

export class RuleRequirementExtractor implements RequirementExtractor {
  extract(text: string, context: ExtractContext): ExtractedRequirementDraft[] {
    const cleaned = normalizeWhitespace(text);
    const sentences = splitSentences(cleaned);
    const drafts: ExtractedRequirementDraft[] = [];

    for (let i = 0; i < sentences.length; i += 1) {
      const sentence = sentences[i]!;
      const lower = sentence.toLowerCase();
      const looksLikeRequirement =
        detectRequired(sentence) ||
        detectOptional(sentence) ||
        /\b(submit|provide|include|attach|upload)\b/i.test(sentence);

      for (const pattern of DOC_PATTERNS) {
        if (!pattern.terms.test(sentence)) continue;
        if (!looksLikeRequirement && pattern.category !== "combined_packet") {
          // Still capture clear document requirement lines.
          if (
            !/\b(resume|transcript|essay|recommendation|portfolio|packet|letter)\b/i.test(
              sentence,
            )
          ) {
            continue;
          }
        }

        const certaintyRaw = detectCertainty(sentence);
        const words = extractWordLimits(sentence);
        const pages = extractPageLimits(sentence);
        const extensions = extractExtensions(sentence);
        const filenamePattern = extractFilenamePattern(sentence);
        const recCounts = extractRecCountSemantics(sentence);
        const signatureRequired = detectSignatureRequired(sentence);
        // Explicit filename instructions are actionable rules, not ambiguous mentions.
        const certainty =
          filenamePattern && certaintyRaw === "uncertain"
            ? "required"
            : certaintyRaw;
        const match = pattern.terms.exec(sentence);
        const evidence =
          match != null
            ? nearbyContext(cleaned, cleaned.indexOf(sentence), sentence.length)
            : sentence;

        let confidence = 0.55;
        if (certainty === "required" || certainty === "optional") confidence += 0.2;
        if (extensions.length) confidence += 0.08;
        if (words.max || words.min) confidence += 0.08;
        if (filenamePattern) confidence += 0.1;
        if (certainty === "uncertain") confidence -= 0.15;

        const conditional = detectConditional(sentence);
        drafts.push(
          emptyDraft({
            title: pattern.title,
            description: sentence,
            category: pattern.category,
            certainty,
            conditional,
            conditionText: conditional ? sentence : null,
            applicability: conditional ? "unknown" : "applicable",
            sourceEvidence: evidence || sentence,
            sourceLocation: `Sentence ${i + 1}`,
            confidence: confidenceLevel(confidence),
            extractionRule: `doc-pattern:${pattern.category}`,
            acceptedDocumentTypes: [pattern.category],
            acceptedFileExtensions: extensions,
            minimumCount:
              pattern.category === "recommendation" && recCounts
                ? recCounts.minimumCount
                : 1,
            maximumCount:
              pattern.category === "recommendation" && recCounts
                ? recCounts.maximumCount
                : null,
            wordLimitMinimum: words.min,
            wordLimitMaximum: words.max,
            pageLimitMinimum: pages.min,
            pageLimitMaximum: pages.max,
            filenamePattern,
            signatureRequired,
            organizationNameExpected: detectOrganizationExpected(sentence),
            requiredKeywords: [],
          }),
        );
      }

      // Filename-only packet rules without another category
      if (
        /LastName_FirstName_\d{4}\.pdf/i.test(sentence) ||
        /named\s+[A-Za-z0-9_]+\.pdf/i.test(sentence)
      ) {
        const filenamePattern = extractFilenamePattern(sentence);
        if (filenamePattern) {
          drafts.push(
            emptyDraft({
              title: "Combined Packet Filename",
              description: sentence,
              category: "combined_packet",
              certainty: "required",
              sourceEvidence: sentence,
              sourceLocation: `Sentence ${i + 1}`,
              confidence: 0.85,
              extractionRule: "filename-pattern",
              acceptedFileExtensions: [".pdf"],
              filenamePattern,
              organizationNameExpected: detectOrganizationExpected(sentence),
            }),
          );
        }
      }

      if (/\bgpa\b/i.test(lower) && /\b(minimum|at least|required)\b/i.test(lower)) {
        drafts.push(
          emptyDraft({
            title: "Minimum GPA",
            description: sentence,
            category: "proof_of_eligibility",
            certainty: "required",
            sourceEvidence: sentence,
            sourceLocation: `Sentence ${i + 1}`,
            confidence: 0.7,
            extractionRule: "gpa-requirement",
            customValidationNotes: sentence,
          }),
        );
      }

      if (
        /\benrolled\b/i.test(lower) &&
        /\b(must|required|shall)\b/i.test(lower) &&
        /\b(high school|college|university|academic year)\b/i.test(lower)
      ) {
        drafts.push(
          emptyDraft({
            title: "Enrollment Requirement",
            description: sentence,
            category: "proof_of_enrollment",
            certainty: "required",
            sourceEvidence: sentence,
            sourceLocation: `Sentence ${i + 1}`,
            confidence: 0.65,
            extractionRule: "enrollment-requirement",
            customValidationNotes: sentence,
          }),
        );
      }
    }

    const deadline = extractDeadline(cleaned);
    if (deadline) {
      drafts.push(
        emptyDraft({
          title: "Submission Deadline",
          description: `Submission deadline: ${deadline}`,
          category: "other",
          certainty: "required",
          sourceEvidence:
            cleaned.match(
              /(?:deadline|due(?:\s+date)?|submit by)[^.!\n]{0,120}/i,
            )?.[0] ?? `Deadline ${deadline}`,
          sourceLocation: "Deadline statement",
          confidence: 0.9,
          extractionRule: "deadline",
          dateRequirement: deadline,
        }),
      );
    }

    return drafts;
  }
}

export class RuleRequirementNormalizer implements RequirementNormalizer {
  normalize(draft: ExtractedRequirementDraft): ExtractedRequirementDraft {
    const acceptedDocumentTypes =
      draft.acceptedDocumentTypes.length > 0
        ? draft.acceptedDocumentTypes
        : [draft.category];

    // Never invent file formats when the source did not specify them.
    const acceptedFileExtensions = draft.acceptedFileExtensions;

    return {
      ...draft,
      title: draft.title.trim(),
      description: draft.description.trim(),
      required: draft.certainty === "required",
      acceptedDocumentTypes,
      acceptedFileExtensions,
      confidence: confidenceLevel(draft.confidence),
    };
  }
}

function normalizeDedupeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupeKey(item: ExtractedRequirementDraft): string {
  if (item.category === "other" && item.dateRequirement) {
    return `deadline:${normalizeDedupeText(item.dateRequirement)}`;
  }
  if (item.category === "combined_packet" && item.filenamePattern) {
    return `packet:${normalizeDedupeText(item.filenamePattern)}`;
  }
  return [
    item.category,
    normalizeDedupeText(item.title),
    item.sourceLocation || "",
    normalizeDedupeText(item.sourceEvidence).slice(0, 160),
    item.filenamePattern || "",
    item.dateRequirement || "",
    String(item.wordLimitMinimum ?? ""),
    String(item.wordLimitMaximum ?? ""),
    String(item.pageLimitMinimum ?? ""),
    String(item.pageLimitMaximum ?? ""),
    String(item.minimumCount),
    String(item.maximumCount ?? ""),
    [...item.acceptedFileExtensions].sort().join(","),
  ].join("::");
}

export class RuleRequirementDeduplicator implements RequirementDeduplicator {
  deduplicate(items: ExtractedRequirementDraft[]): ExtractedRequirementDraft[] {
    const byKey = new Map<string, ExtractedRequirementDraft>();

    for (const item of items) {
      const key = dedupeKey(item);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, item);
        continue;
      }

      const certaintyOrder = { required: 2, uncertain: 1, optional: 0 } as const;
      const certainty =
        certaintyOrder[existing.certainty] >= certaintyOrder[item.certainty]
          ? existing.certainty
          : item.certainty;

      byKey.set(key, {
        ...existing,
        ...item,
        title: existing.title.length >= item.title.length ? existing.title : item.title,
        description:
          existing.description.length >= item.description.length
            ? existing.description
            : item.description,
        certainty,
        required: certainty === "required",
        confidence: Math.max(existing.confidence, item.confidence),
        sourceEvidence:
          existing.sourceEvidence.length >= item.sourceEvidence.length
            ? existing.sourceEvidence
            : item.sourceEvidence,
        acceptedFileExtensions: [
          ...new Set([
            ...existing.acceptedFileExtensions,
            ...item.acceptedFileExtensions,
          ]),
        ],
        wordLimitMinimum: item.wordLimitMinimum ?? existing.wordLimitMinimum,
        wordLimitMaximum: item.wordLimitMaximum ?? existing.wordLimitMaximum,
        pageLimitMaximum: item.pageLimitMaximum ?? existing.pageLimitMaximum,
        filenamePattern: item.filenamePattern ?? existing.filenamePattern,
        minimumCount: Math.max(existing.minimumCount, item.minimumCount),
        maximumCount: item.maximumCount ?? existing.maximumCount,
        organizationNameExpected:
          item.organizationNameExpected ?? existing.organizationNameExpected,
        signatureRequired: existing.signatureRequired || item.signatureRequired,
        extractionRule: `${existing.extractionRule}+${item.extractionRule}`,
      });
    }

    return [...byKey.values()].sort((a, b) => b.confidence - a.confidence);
  }
}

export function runRequirementPipeline(
  text: string,
  context: ExtractContext,
): ExtractedRequirementDraft[] {
  const extractor = new RuleRequirementExtractor();
  const normalizer = new RuleRequirementNormalizer();
  const deduper = new RuleRequirementDeduplicator();
  const extracted = extractor.extract(text, context).map((d) => normalizer.normalize(d));
  return deduper.deduplicate(extracted);
}
