export type ApplicationType =
  | "scholarship"
  | "college"
  | "internship"
  | "other";

export type RequirementCategory =
  | "resume"
  | "transcript"
  | "essay"
  | "recommendation"
  | "identification"
  | "portfolio"
  | "application_form"
  | "certification"
  | "financial_document"
  | "proof_of_enrollment"
  | "proof_of_eligibility"
  | "supplemental_response"
  | "combined_packet"
  | "other";

export type SourceType = "url" | "pdf" | "docx" | "txt" | "markdown" | "pasted_text";

export type MatchStatus =
  | "confirmed"
  | "likely"
  | "possible"
  | "does_not_match"
  | "needs_confirmation";

export type IssueSeverity =
  | "blocking"
  | "warning"
  | "needs_confirmation"
  | "suggestion";

export type IssueStatus = "open" | "resolved" | "dismissed";

export type ReadinessStatus =
  | "ready"
  | "nearly_ready"
  | "needs_attention"
  | "not_ready"
  | "unable_to_determine";

export type ParseStatus =
  | "pending"
  | "parsing"
  | "parsed"
  | "failed"
  | "low_text";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface Application {
  id: string;
  name: string;
  organization: string;
  type: ApplicationType;
  deadline: string | null;
  notes: string | null;
  readinessScore: number | null;
  readinessStatus: ReadinessStatus | null;
  lastAnalyzedAt: string | null;
  isDemo: boolean;
  demoStep: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequirementSource {
  id: string;
  applicationId: string;
  sourceType: SourceType;
  sourceName: string;
  sourceUrl: string | null;
  extractedTextPreview: string | null;
  createdAt: string;
}

export interface Requirement {
  id: string;
  applicationId: string;
  sourceId: string | null;
  title: string;
  description: string;
  category: RequirementCategory;
  required: boolean;
  conditional: boolean;
  conditionText: string | null;
  sourceType: SourceType | null;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceEvidence: string;
  sourceLocation: string | null;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  extractionRule: string | null;
  userConfirmed: boolean;
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
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRecord {
  id: string;
  applicationId: string | null;
  vaultDocumentId: string | null;
  originalFilename: string;
  storedFilename: string;
  mimeType: string;
  fileSize: number;
  pageCount: number | null;
  wordCount: number | null;
  title: string | null;
  category: RequirementCategory | null;
  categoryConfidence: number | null;
  parseStatus: ParseStatus;
  parsingWarnings: string[];
  contentHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentFact {
  id: string;
  documentId: string;
  factType: string;
  value: string;
  evidence: string | null;
  confidence: number;
}

export interface DocumentMatch {
  id: string;
  applicationId: string;
  requirementId: string;
  documentId: string;
  status: MatchStatus;
  confidence: number;
  explanation: string;
  evidence: string[];
  userConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationResult {
  id: string;
  applicationId: string;
  requirementId: string | null;
  documentId: string | null;
  rule: string;
  passed: boolean;
  severity: IssueSeverity;
  message: string;
  evidence: string | null;
  createdAt: string;
}

export interface Issue {
  id: string;
  applicationId: string;
  requirementId: string | null;
  documentId: string | null;
  severity: IssueSeverity;
  code: string;
  title: string;
  explanation: string;
  evidence: string | null;
  recommendedFix: string | null;
  status: IssueStatus;
  dismissible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicantProfile {
  id: string;
  applicationId: string;
  fullLegalName: string | null;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  school: string | null;
  expectedGraduationDate: string | null;
  major: string | null;
  gpa: string | null;
  address: string | null;
  targetOrganization: string | null;
  userConfirmed: boolean;
  updatedAt: string;
}

export interface ProfileConflict {
  id: string;
  applicationId: string;
  field: string;
  values: Array<{ source: string; value: string; documentId?: string }>;
  resolved: boolean;
  equivalent: boolean | null;
  createdAt: string;
}

export interface VaultDocument {
  id: string;
  originalFilename: string;
  storedFilename: string;
  mimeType: string;
  fileSize: number;
  category: RequirementCategory;
  version: number;
  notes: string | null;
  expirationDate: string | null;
  wordCount: number | null;
  pageCount: number | null;
  extractedSummary: string | null;
  parseStatus: ParseStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEvent {
  id: string;
  applicationId: string | null;
  eventType: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ReadinessBreakdown {
  requiredPresent: number;
  requiredTotal: number;
  confirmedMatches: number;
  likelyMatches: number;
  validationPassed: number;
  validationTotal: number;
  blockingIssues: number;
  warnings: number;
  uncertainRequirements: number;
  consistencyConflicts: number;
  factors: Array<{ label: string; weight: number; score: number; note: string }>;
}

export interface ReadinessReport {
  applicationId: string;
  score: number;
  status: ReadinessStatus;
  breakdown: ReadinessBreakdown;
  generatedAt: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
    nextSteps?: string[];
  };
}
