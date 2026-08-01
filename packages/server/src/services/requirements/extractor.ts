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
    terms: /\b(recommendation(?:\s+letter)?|letter of recommendation|reference letter|references?)\b/i,
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
  return /\b(optional|recommended|may submit|not required|encouraged)\b/i.test(
    sentence,
  );
}

function detectRequired(sentence: string): boolean {
  return /\b(required|must submit|must provide|need to provide|needs to include|include|shall submit|is required)\b/i.test(
    sentence,
  );
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
  const max = sentence.match(
    /(?:maximum|no more than|up to|not exceed(?:ing)?)\s+(\d{1,2})\s*pages?/i,
  );
  if (max) return { min: null, max: Number(max[1]) };
  const exact = sentence.match(/\b(\d{1,2})\s*pages?\b/i);
  if (exact && /page/i.test(sentence)) {
    return { min: null, max: Number(exact[1]) };
  }
  return { min: null, max: null };
}

function extractExtensions(sentence: string): string[] {
  const found = new Set<string>();
  if (/\bpdf\b/i.test(sentence)) found.add(".pdf");
  if (/\bdocx?\b/i.test(sentence)) found.add(".docx");
  if (/\btxt\b/i.test(sentence)) found.add(".txt");
  const dotted = sentence.match(/\.[a-zA-Z]{2,5}/g) || [];
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

function extractRecCount(sentence: string): number | null {
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

function extractDeadline(text: string): string | null {
  const m = text.match(
    /(?:deadline|due(?:\s+date)?|submit by|must be submitted by)[:\s]+([A-Za-z]+ \d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i,
  );
  return m?.[1] ?? null;
}

function emptyDraft(
  partial: Partial<ExtractedRequirementDraft> &
    Pick<
      ExtractedRequirementDraft,
      "title" | "category" | "sourceEvidence" | "extractionRule" | "confidence"
    >,
): ExtractedRequirementDraft {
  return {
    description: "",
    required: true,
    conditional: false,
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
          if (!/\b(resume|transcript|essay|recommendation|portfolio|packet)\b/i.test(sentence)) {
            continue;
          }
        }

        const optional = detectOptional(sentence);
        const required = optional ? false : detectRequired(sentence) || true;
        const words = extractWordLimits(sentence);
        const pages = extractPageLimits(sentence);
        const extensions = extractExtensions(sentence);
        const filenamePattern = extractFilenamePattern(sentence);
        const recCount = extractRecCount(sentence);
        const signatureRequired = /\bsignature\b/i.test(sentence);
        const match = pattern.terms.exec(sentence);
        const evidence =
          match != null
            ? nearbyContext(cleaned, cleaned.indexOf(sentence), sentence.length)
            : sentence;

        let confidence = 0.55;
        if (detectRequired(sentence) || optional) confidence += 0.2;
        if (extensions.length) confidence += 0.08;
        if (words.max || words.min) confidence += 0.08;
        if (filenamePattern) confidence += 0.1;
        if (!detectRequired(sentence) && !optional) confidence -= 0.15;

        drafts.push(
          emptyDraft({
            title: pattern.title,
            description: sentence,
            category: pattern.category,
            required,
            conditional: /\bif\b|\bwhen\b|\bfor applicants who\b/i.test(sentence),
            conditionText: /\bif\b|\bwhen\b/i.test(sentence) ? sentence : null,
            sourceEvidence: evidence || sentence,
            sourceLocation: `Sentence ${i + 1}`,
            confidence: confidenceLevel(confidence),
            extractionRule: `doc-pattern:${pattern.category}`,
            acceptedDocumentTypes: [pattern.category],
            acceptedFileExtensions: extensions,
            minimumCount:
              pattern.category === "recommendation" && recCount
                ? recCount
                : 1,
            maximumCount:
              pattern.category === "recommendation" && recCount
                ? recCount
                : null,
            wordLimitMinimum: words.min,
            wordLimitMaximum: words.max,
            pageLimitMinimum: pages.min,
            pageLimitMaximum: pages.max,
            filenamePattern,
            signatureRequired,
            organizationNameExpected: context.organization || null,
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
              required: true,
              sourceEvidence: sentence,
              sourceLocation: `Sentence ${i + 1}`,
              confidence: 0.85,
              extractionRule: "filename-pattern",
              acceptedFileExtensions: [".pdf"],
              filenamePattern,
              organizationNameExpected: context.organization || null,
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
            required: true,
            sourceEvidence: sentence,
            sourceLocation: `Sentence ${i + 1}`,
            confidence: 0.7,
            extractionRule: "gpa-requirement",
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
          required: true,
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

    let acceptedFileExtensions = draft.acceptedFileExtensions;
    if (
      acceptedFileExtensions.length === 0 &&
      ["resume", "transcript", "essay", "recommendation", "combined_packet"].includes(
        draft.category,
      )
    ) {
      acceptedFileExtensions = [".pdf"];
    }

    return {
      ...draft,
      title: draft.title.trim(),
      description: draft.description.trim(),
      acceptedDocumentTypes,
      acceptedFileExtensions,
      confidence: confidenceLevel(draft.confidence),
    };
  }
}

export class RuleRequirementDeduplicator implements RequirementDeduplicator {
  deduplicate(items: ExtractedRequirementDraft[]): ExtractedRequirementDraft[] {
    const byCategory = new Map<string, ExtractedRequirementDraft>();

    for (const item of items) {
      const key =
        item.category === "other" && item.dateRequirement
          ? `deadline:${item.dateRequirement}`
          : item.category === "combined_packet" && item.filenamePattern
            ? `packet:${item.filenamePattern}`
            : item.category;

      const existing = byCategory.get(key);
      if (!existing) {
        byCategory.set(key, item);
        continue;
      }

      byCategory.set(key, {
        ...existing,
        ...item,
        title: existing.title.length >= item.title.length ? existing.title : item.title,
        description:
          existing.description.length >= item.description.length
            ? existing.description
            : item.description,
        required: existing.required || item.required,
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

    return [...byCategory.values()].sort((a, b) => b.confidence - a.confidence);
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
