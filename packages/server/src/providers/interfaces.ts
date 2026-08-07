import type { Requirement, RequirementCategory } from "@applyready/shared";

/**
 * Provider interfaces keep the door open for an optional future AI provider.
 * Current implementations are fully deterministic and local.
 */
export interface RequirementSourceReader {
  read(input: {
    buffer?: Buffer;
    text?: string;
    filename?: string;
    mimeType?: string;
    url?: string;
  }): Promise<{ text: string; warnings: string[]; sourceName: string }>;
}

export interface RequirementExtractor {
  extract(text: string, context: ExtractContext): ExtractedRequirementDraft[];
}

export interface RequirementNormalizer {
  normalize(draft: ExtractedRequirementDraft): ExtractedRequirementDraft;
}

export interface RequirementDeduplicator {
  deduplicate(items: ExtractedRequirementDraft[]): ExtractedRequirementDraft[];
}

export interface DocumentReader {
  read(buffer: Buffer, filename: string, mimeType: string): Promise<DocumentReadResult>;
}

export interface DocumentClassifier {
  classify(text: string, filename: string): {
    category: RequirementCategory;
    confidence: number;
    reasons: string[];
  };
}

export interface DocumentFactExtractor {
  extract(text: string): ExtractedFact[];
}

export interface DocumentValidator {
  validate(params: {
    requirement: Requirement;
    documentText: string;
    filename: string;
    wordCount: number | null;
    pageCount: number | null;
    mimeType: string;
    organization?: string;
  }): ValidationFinding[];
}

export interface RequirementMatcher {
  match(params: {
    requirement: Requirement;
    document: {
      id: string;
      filename: string;
      category: RequirementCategory | null;
      categoryConfidence: number | null;
      title: string | null;
      wordCount: number | null;
      pageCount: number | null;
      mimeType: string;
      text: string;
      headings: string[];
    };
  }): MatchFinding;
}

export interface ConsistencyChecker {
  check(factsByDocument: Array<{
    documentId: string;
    filename: string;
    facts: ExtractedFact[];
  }>): ConsistencyFinding[];
}

export interface ExtractContext {
  applicationName?: string;
  organization?: string;
  sourceType: string;
  sourceName: string;
  sourceUrl?: string | null;
}

export interface ExtractedRequirementDraft {
  title: string;
  description: string;
  category: RequirementCategory;
  required: boolean;
  certainty: "required" | "optional" | "uncertain";
  conditional: boolean;
  conditionText: string | null;
  sourceEvidence: string;
  sourceLocation: string | null;
  confidence: number;
  extractionRule: string;
  acceptedDocumentTypes: string[];
  acceptedFileExtensions: string[];
  minimumCount: number;
  maximumCount: number | null;
  wordLimitMinimum: number | null;
  wordLimitMaximum: number | null;
  pageLimitMinimum: number | null;
  pageLimitMaximum: number | null;
  filenamePattern: string | null;
  signatureRequired: boolean;
  dateRequirement: string | null;
  expirationRule: string | null;
  requiredKeywords: string[];
  organizationNameExpected: string | null;
  customValidationNotes: string | null;
}

export interface DocumentReadResult {
  text: string;
  pageCount: number | null;
  title: string | null;
  warnings: string[];
  lowText: boolean;
}

export interface ExtractedFact {
  factType: string;
  value: string;
  evidence: string | null;
  confidence: number;
}

export interface ValidationFinding {
  rule: string;
  passed: boolean;
  severity: "blocking" | "warning" | "needs_confirmation" | "suggestion";
  message: string;
  evidence: string | null;
}

export interface MatchFinding {
  status:
    | "confirmed"
    | "likely"
    | "possible"
    | "does_not_match"
    | "needs_confirmation";
  confidence: number;
  explanation: string;
  evidence: string[];
}

export interface ConsistencyFinding {
  field: string;
  values: Array<{ source: string; value: string; documentId?: string }>;
}
