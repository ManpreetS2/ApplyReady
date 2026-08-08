import type {
  ActivityEvent,
  ApplicantProfile,
  Application,
  DocumentFact,
  DocumentMatch,
  DocumentRecord,
  Issue,
  ProfileConflict,
  Requirement,
  RequirementCertainty,
  RequirementSource,
  ValidationResult,
  VaultDocument,
} from "@applyready/shared";

function jsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizeCertainty(
  raw: unknown,
  required: boolean,
): RequirementCertainty {
  if (raw === "required" || raw === "optional" || raw === "uncertain") {
    return raw;
  }
  return required ? "required" : "optional";
}

export function mapApplication(row: Record<string, unknown>): Application {
  return {
    id: String(row.id),
    name: String(row.name),
    organization: String(row.organization),
    type: row.type as Application["type"],
    deadline: (row.deadline as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    readinessScore:
      row.readiness_score == null ? null : Number(row.readiness_score),
    readinessStatus: (row.readiness_status as Application["readinessStatus"]) ?? null,
    lastAnalyzedAt: (row.last_analyzed_at as string | null) ?? null,
    isDemo: Boolean(row.is_demo),
    demoStep: row.demo_step == null ? null : Number(row.demo_step),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapSource(row: Record<string, unknown>): RequirementSource {
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    sourceType: row.source_type as RequirementSource["sourceType"],
    sourceName: String(row.source_name),
    sourceUrl: (row.source_url as string | null) ?? null,
    extractedTextPreview: (row.extracted_text_preview as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export function mapRequirement(row: Record<string, unknown>): Requirement {
  const conditional = Boolean(row.conditional);
  const rawApplicability = row.applicability;
  const applicability =
    rawApplicability === "applicable" ||
    rawApplicability === "not_applicable" ||
    rawApplicability === "unknown"
      ? rawApplicability
      : conditional
        ? "unknown"
        : "applicable";
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    sourceId: (row.source_id as string | null) ?? null,
    title: String(row.title),
    description: String(row.description ?? ""),
    category: row.category as Requirement["category"],
    required: Boolean(row.required),
    certainty: normalizeCertainty(row.certainty, Boolean(row.required)),
    conditional,
    conditionText: (row.condition_text as string | null) ?? null,
    applicability,
    sourceType: (row.source_type as Requirement["sourceType"]) ?? null,
    sourceName: (row.source_name as string | null) ?? null,
    sourceUrl: (row.source_url as string | null) ?? null,
    sourceEvidence: String(row.source_evidence),
    sourceLocation: (row.source_location as string | null) ?? null,
    confidence: Number(row.confidence),
    confidenceLevel: row.confidence_level as Requirement["confidenceLevel"],
    extractionRule: (row.extraction_rule as string | null) ?? null,
    userConfirmed: Boolean(row.user_confirmed),
    acceptedDocumentTypes: jsonArray(row.accepted_document_types as string),
    acceptedFileExtensions: jsonArray(row.accepted_file_extensions as string),
    minimumCount: Number(row.minimum_count ?? 1),
    maximumCount:
      row.maximum_count == null ? null : Number(row.maximum_count),
    wordLimitMinimum:
      row.word_limit_minimum == null ? null : Number(row.word_limit_minimum),
    wordLimitMaximum:
      row.word_limit_maximum == null ? null : Number(row.word_limit_maximum),
    pageLimitMinimum:
      row.page_limit_minimum == null ? null : Number(row.page_limit_minimum),
    pageLimitMaximum:
      row.page_limit_maximum == null ? null : Number(row.page_limit_maximum),
    filenamePattern: (row.filename_pattern as string | null) ?? null,
    signatureRequired: Boolean(row.signature_required),
    dateRequirement: (row.date_requirement as string | null) ?? null,
    expirationRule: (row.expiration_rule as string | null) ?? null,
    requiredKeywords: jsonArray(row.required_keywords as string),
    organizationNameExpected:
      (row.organization_name_expected as string | null) ?? null,
    customValidationNotes:
      (row.custom_validation_notes as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapDocument(row: Record<string, unknown>): DocumentRecord {
  return {
    id: String(row.id),
    applicationId: (row.application_id as string | null) ?? null,
    vaultDocumentId: (row.vault_document_id as string | null) ?? null,
    originalFilename: String(row.original_filename),
    storedFilename: String(row.stored_filename),
    mimeType: String(row.mime_type),
    fileSize: Number(row.file_size),
    pageCount: row.page_count == null ? null : Number(row.page_count),
    wordCount: row.word_count == null ? null : Number(row.word_count),
    title: (row.title as string | null) ?? null,
    category: (row.category as DocumentRecord["category"]) ?? null,
    categoryConfidence:
      row.category_confidence == null
        ? null
        : Number(row.category_confidence),
    parseStatus: row.parse_status as DocumentRecord["parseStatus"],
    parsingWarnings: jsonArray(row.parsing_warnings as string),
    contentHash: (row.content_hash as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapFact(row: Record<string, unknown>): DocumentFact {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    factType: String(row.fact_type),
    value: String(row.value),
    evidence: (row.evidence as string | null) ?? null,
    confidence: Number(row.confidence),
  };
}

export function mapMatch(row: Record<string, unknown>): DocumentMatch {
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    requirementId: String(row.requirement_id),
    documentId: String(row.document_id),
    status: row.status as DocumentMatch["status"],
    confidence: Number(row.confidence),
    explanation: String(row.explanation),
    evidence: jsonArray(row.evidence as string),
    userConfirmed: Boolean(row.user_confirmed),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapValidation(row: Record<string, unknown>): ValidationResult {
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    requirementId: (row.requirement_id as string | null) ?? null,
    documentId: (row.document_id as string | null) ?? null,
    rule: String(row.rule),
    passed: Boolean(row.passed),
    severity: row.severity as ValidationResult["severity"],
    message: String(row.message),
    evidence: (row.evidence as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export function mapIssue(row: Record<string, unknown>): Issue {
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    requirementId: (row.requirement_id as string | null) ?? null,
    documentId: (row.document_id as string | null) ?? null,
    severity: row.severity as Issue["severity"],
    code: String(row.code),
    title: String(row.title),
    explanation: String(row.explanation),
    evidence: (row.evidence as string | null) ?? null,
    recommendedFix: (row.recommended_fix as string | null) ?? null,
    status: row.status as Issue["status"],
    dismissible: Boolean(row.dismissible),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapProfile(row: Record<string, unknown>): ApplicantProfile {
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    fullLegalName: (row.full_legal_name as string | null) ?? null,
    preferredName: (row.preferred_name as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    school: (row.school as string | null) ?? null,
    expectedGraduationDate:
      (row.expected_graduation_date as string | null) ?? null,
    major: (row.major as string | null) ?? null,
    gpa: (row.gpa as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    targetOrganization: (row.target_organization as string | null) ?? null,
    currentlyEnrolled:
      row.currently_enrolled == null
        ? null
        : Boolean(row.currently_enrolled),
    userConfirmed: Boolean(row.user_confirmed),
    confirmedFields: jsonArray(row.confirmed_fields as string).filter(
      (f): f is ApplicantProfile["confirmedFields"][number] =>
        [
          "fullLegalName",
          "email",
          "phone",
          "school",
          "major",
          "gpa",
          "expectedGraduationDate",
          "targetOrganization",
          "currentlyEnrolled",
        ].includes(f),
    ),
    updatedAt: String(row.updated_at),
  };
}

export function mapConflict(row: Record<string, unknown>): ProfileConflict {
  let values: ProfileConflict["values"] = [];
  try {
    values = JSON.parse(String(row.values_json));
  } catch {
    values = [];
  }
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    field: String(row.field),
    values,
    resolved: Boolean(row.resolved),
    equivalent:
      row.equivalent == null ? null : Boolean(row.equivalent),
    createdAt: String(row.created_at),
  };
}

export function mapVault(row: Record<string, unknown>): VaultDocument {
  return {
    id: String(row.id),
    originalFilename: String(row.original_filename),
    storedFilename: String(row.stored_filename),
    mimeType: String(row.mime_type),
    fileSize: Number(row.file_size),
    category: row.category as VaultDocument["category"],
    version: Number(row.version),
    notes: (row.notes as string | null) ?? null,
    expirationDate: (row.expiration_date as string | null) ?? null,
    wordCount: row.word_count == null ? null : Number(row.word_count),
    pageCount: row.page_count == null ? null : Number(row.page_count),
    extractedSummary: (row.extracted_summary as string | null) ?? null,
    parseStatus: row.parse_status as VaultDocument["parseStatus"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapActivity(row: Record<string, unknown>): ActivityEvent {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(String(row.metadata));
    } catch {
      metadata = null;
    }
  }
  return {
    id: String(row.id),
    applicationId: (row.application_id as string | null) ?? null,
    eventType: String(row.event_type),
    message: String(row.message),
    metadata,
    createdAt: String(row.created_at),
  };
}

export function confidenceLevelFromScore(
  score: number,
): "high" | "medium" | "low" {
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}
