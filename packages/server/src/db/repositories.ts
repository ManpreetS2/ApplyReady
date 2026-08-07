import type Database from "better-sqlite3";
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
  RequirementSource,
  ValidationResult,
  VaultDocument,
} from "@applyready/shared";
import {
  confidenceLevelFromScore,
  mapActivity,
  mapApplication,
  mapConflict,
  mapDocument,
  mapFact,
  mapIssue,
  mapMatch,
  mapProfile,
  mapRequirement,
  mapSource,
  mapValidation,
  mapVault,
} from "./mappers.js";
import { newId, nowIso } from "../utils/ids.js";
import { AppError } from "../utils/errors.js";
import type { ExtractedRequirementDraft } from "../providers/interfaces.js";

export class Repositories {
  constructor(private db: Database.Database) {}

  listApplications(): Application[] {
    return this.db
      .prepare("SELECT * FROM applications ORDER BY updated_at DESC")
      .all()
      .map((r) => mapApplication(r as Record<string, unknown>));
  }

  /** Demo applications with updated_at strictly before cutoffIso (ISO-8601). */
  listStaleDemoApplications(cutoffIso: string): Application[] {
    return this.db
      .prepare(
        `SELECT * FROM applications
         WHERE is_demo = 1 AND updated_at < ?
         ORDER BY updated_at ASC`,
      )
      .all(cutoffIso)
      .map((r) => mapApplication(r as Record<string, unknown>));
  }

  /** Active (non-stale) demo applications — used for public demo capacity. */
  countActiveDemoApplications(cutoffIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM applications
         WHERE is_demo = 1 AND updated_at >= ?`,
      )
      .get(cutoffIso) as { count: number };
    return Number(row.count);
  }

  getApplication(id: string): Application | null {
    const row = this.db
      .prepare("SELECT * FROM applications WHERE id = ?")
      .get(id);
    return row ? mapApplication(row as Record<string, unknown>) : null;
  }

  createApplication(input: {
    name: string;
    organization: string;
    type: Application["type"];
    deadline?: string | null;
    notes?: string | null;
    isDemo?: boolean;
    demoStep?: number | null;
  }): Application {
    const id = newId();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO applications
        (id, name, organization, type, deadline, notes, readiness_score, readiness_status,
         last_analyzed_at, is_demo, demo_step, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.organization,
        input.type,
        input.deadline ?? null,
        input.notes ?? null,
        input.isDemo ? 1 : 0,
        input.demoStep ?? null,
        now,
        now,
      );
    this.db
      .prepare(
        `INSERT INTO applicant_profiles
        (id, application_id, target_organization, user_confirmed, updated_at)
        VALUES (?, ?, ?, 0, ?)`,
      )
      .run(newId(), id, input.organization, now);
    this.addActivity(id, "application_created", `Created application ${input.name}`);
    return this.getApplication(id)!;
  }

  updateApplication(
    id: string,
    patch: Partial<{
      name: string;
      organization: string;
      type: Application["type"];
      deadline: string | null;
      notes: string | null;
      readinessScore: number | null;
      readinessStatus: Application["readinessStatus"];
      lastAnalyzedAt: string | null;
      demoStep: number | null;
    }>,
  ): Application {
    const current = this.getApplication(id);
    if (!current) throw new Error("Application not found");
    const next = {
      name: patch.name ?? current.name,
      organization: patch.organization ?? current.organization,
      type: patch.type ?? current.type,
      deadline: patch.deadline === undefined ? current.deadline : patch.deadline,
      notes: patch.notes === undefined ? current.notes : patch.notes,
      readinessScore:
        patch.readinessScore === undefined
          ? current.readinessScore
          : patch.readinessScore,
      readinessStatus:
        patch.readinessStatus === undefined
          ? current.readinessStatus
          : patch.readinessStatus,
      lastAnalyzedAt:
        patch.lastAnalyzedAt === undefined
          ? current.lastAnalyzedAt
          : patch.lastAnalyzedAt,
      demoStep:
        patch.demoStep === undefined ? current.demoStep : patch.demoStep,
    };
    const now = nowIso();
    this.db
      .prepare(
        `UPDATE applications SET
          name=?, organization=?, type=?, deadline=?, notes=?,
          readiness_score=?, readiness_status=?, last_analyzed_at=?,
          demo_step=?, updated_at=?
         WHERE id=?`,
      )
      .run(
        next.name,
        next.organization,
        next.type,
        next.deadline,
        next.notes,
        next.readinessScore,
        next.readinessStatus,
        next.lastAnalyzedAt,
        next.demoStep,
        now,
        id,
      );
    return this.getApplication(id)!;
  }

  /** Test/ops helper: force updated_at for TTL boundary checks. */
  setApplicationTimestamps(
    id: string,
    timestamps: { createdAt?: string; updatedAt?: string },
  ): void {
    const current = this.getApplication(id);
    if (!current) throw new Error("Application not found");
    this.db
      .prepare(
        `UPDATE applications SET created_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        timestamps.createdAt ?? current.createdAt,
        timestamps.updatedAt ?? current.updatedAt,
        id,
      );
  }

  deleteApplication(id: string): DocumentRecord[] {
    const docs = this.listDocuments(id);
    this.db.prepare("DELETE FROM applications WHERE id = ?").run(id);
    return docs;
  }

  createSource(input: {
    applicationId: string;
    sourceType: RequirementSource["sourceType"];
    sourceName: string;
    sourceUrl?: string | null;
    extractedTextPreview?: string | null;
  }): RequirementSource {
    const id = newId();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO requirement_sources
        (id, application_id, source_type, source_name, source_url, extracted_text_preview, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.applicationId,
        input.sourceType,
        input.sourceName,
        input.sourceUrl ?? null,
        input.extractedTextPreview ?? null,
        now,
      );
    return mapSource(
      this.db.prepare("SELECT * FROM requirement_sources WHERE id=?").get(id) as Record<
        string,
        unknown
      >,
    );
  }

  insertRequirementsFromDrafts(
    applicationId: string,
    source: RequirementSource,
    drafts: ExtractedRequirementDraft[],
  ): Requirement[] {
    const now = nowIso();
    const stmt = this.db.prepare(
      `INSERT INTO requirements (
        id, application_id, source_id, title, description, category, required, certainty, conditional,
        condition_text, source_type, source_name, source_url, source_evidence, source_location,
        confidence, confidence_level, extraction_rule, user_confirmed, accepted_document_types,
        accepted_file_extensions, minimum_count, maximum_count, word_limit_minimum, word_limit_maximum,
        page_limit_minimum, page_limit_maximum, filename_pattern, signature_required, date_requirement,
        expiration_rule, required_keywords, organization_name_expected, custom_validation_notes,
        created_at, updated_at
      ) VALUES (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      )`,
    );

    for (const draft of drafts) {
      const certainty = draft.certainty;
      const required = certainty === "required";
      stmt.run(
        newId(),
        applicationId,
        source.id,
        draft.title,
        draft.description,
        draft.category,
        required ? 1 : 0,
        certainty,
        draft.conditional ? 1 : 0,
        draft.conditionText,
        source.sourceType,
        source.sourceName,
        source.sourceUrl,
        draft.sourceEvidence,
        draft.sourceLocation,
        draft.confidence,
        confidenceLevelFromScore(draft.confidence),
        draft.extractionRule,
        draft.confidence >= 0.85 ? 0 : 0,
        JSON.stringify(draft.acceptedDocumentTypes),
        JSON.stringify(draft.acceptedFileExtensions),
        draft.minimumCount,
        draft.maximumCount,
        draft.wordLimitMinimum,
        draft.wordLimitMaximum,
        draft.pageLimitMinimum,
        draft.pageLimitMaximum,
        draft.filenamePattern,
        draft.signatureRequired ? 1 : 0,
        draft.dateRequirement,
        draft.expirationRule,
        JSON.stringify(draft.requiredKeywords),
        draft.organizationNameExpected,
        draft.customValidationNotes,
        now,
        now,
      );
    }
    this.addActivity(
      applicationId,
      "requirements_extracted",
      `Extracted ${drafts.length} requirement(s) from ${source.sourceName}`,
    );
    return this.listRequirements(applicationId);
  }

  listRequirements(applicationId: string): Requirement[] {
    return this.db
      .prepare(
        "SELECT * FROM requirements WHERE application_id=? ORDER BY required DESC, title ASC",
      )
      .all(applicationId)
      .map((r) => mapRequirement(r as Record<string, unknown>));
  }

  getRequirement(id: string): Requirement | null {
    const row = this.db.prepare("SELECT * FROM requirements WHERE id=?").get(id);
    return row ? mapRequirement(row as Record<string, unknown>) : null;
  }

  createRequirement(
    applicationId: string,
    input: Partial<Requirement> &
      Pick<Requirement, "title" | "category" | "sourceEvidence">,
  ): Requirement {
    const now = nowIso();
    const id = newId();
    const certainty =
      input.certainty ??
      (input.required === false ? "optional" : "required");
    const required = certainty === "required";
    this.db
      .prepare(
        `INSERT INTO requirements (
          id, application_id, source_id, title, description, category, required, certainty, conditional,
          condition_text, source_type, source_name, source_url, source_evidence, source_location,
          confidence, confidence_level, extraction_rule, user_confirmed, accepted_document_types,
          accepted_file_extensions, minimum_count, maximum_count, word_limit_minimum, word_limit_maximum,
          page_limit_minimum, page_limit_maximum, filename_pattern, signature_required, date_requirement,
          expiration_rule, required_keywords, organization_name_expected, custom_validation_notes,
          created_at, updated_at
        ) VALUES (
          ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        )`,
      )
      .run(
        id,
        applicationId,
        null,
        input.title,
        input.description ?? "",
        input.category,
        required ? 1 : 0,
        certainty,
        (input.conditional ?? false) ? 1 : 0,
        input.conditionText ?? null,
        "pasted_text",
        "Manual entry",
        null,
        input.sourceEvidence,
        input.sourceLocation ?? "Manual",
        1,
        "high",
        "manual",
        1,
        JSON.stringify(input.acceptedDocumentTypes ?? [input.category]),
        JSON.stringify(input.acceptedFileExtensions ?? []),
        input.minimumCount ?? 1,
        input.maximumCount ?? null,
        input.wordLimitMinimum ?? null,
        input.wordLimitMaximum ?? null,
        input.pageLimitMinimum ?? null,
        input.pageLimitMaximum ?? null,
        input.filenamePattern ?? null,
        input.signatureRequired ? 1 : 0,
        input.dateRequirement ?? null,
        input.expirationRule ?? null,
        JSON.stringify(input.requiredKeywords ?? []),
        input.organizationNameExpected ?? null,
        input.customValidationNotes ?? null,
        now,
        now,
      );
    return this.getRequirement(id)!;
  }

  updateRequirement(id: string, patch: Record<string, unknown>): Requirement {
    const current = this.getRequirement(id);
    if (!current) throw new Error("Requirement not found");
    const next = { ...current, ...patch, updatedAt: nowIso() } as Requirement;
    if (patch.certainty != null) {
      next.certainty = patch.certainty as Requirement["certainty"];
      next.required = next.certainty === "required";
    } else if (patch.required != null) {
      next.required = Boolean(patch.required);
      next.certainty = next.required
        ? "required"
        : current.certainty === "uncertain"
          ? "uncertain"
          : "optional";
    }
    this.db
      .prepare(
        `UPDATE requirements SET
          title=?, description=?, category=?, required=?, certainty=?, conditional=?, condition_text=?,
          source_evidence=?, source_location=?, confidence=?, confidence_level=?, user_confirmed=?,
          accepted_document_types=?, accepted_file_extensions=?, minimum_count=?, maximum_count=?,
          word_limit_minimum=?, word_limit_maximum=?, page_limit_minimum=?, page_limit_maximum=?,
          filename_pattern=?, signature_required=?, date_requirement=?, expiration_rule=?,
          required_keywords=?, organization_name_expected=?, custom_validation_notes=?, updated_at=?
         WHERE id=?`,
      )
      .run(
        next.title,
        next.description,
        next.category,
        next.required ? 1 : 0,
        next.certainty,
        next.conditional ? 1 : 0,
        next.conditionText,
        next.sourceEvidence,
        next.sourceLocation,
        next.confidence,
        confidenceLevelFromScore(next.confidence),
        next.userConfirmed ? 1 : 0,
        JSON.stringify(next.acceptedDocumentTypes),
        JSON.stringify(next.acceptedFileExtensions),
        next.minimumCount,
        next.maximumCount,
        next.wordLimitMinimum,
        next.wordLimitMaximum,
        next.pageLimitMinimum,
        next.pageLimitMaximum,
        next.filenamePattern,
        next.signatureRequired ? 1 : 0,
        next.dateRequirement,
        next.expirationRule,
        JSON.stringify(next.requiredKeywords),
        next.organizationNameExpected,
        next.customValidationNotes,
        next.updatedAt,
        id,
      );
    return this.getRequirement(id)!;
  }

  deleteRequirement(id: string): void {
    this.db.prepare("DELETE FROM requirements WHERE id=?").run(id);
  }

  mergeRequirements(
    keepId: string,
    mergeId: string,
    expectedApplicationId?: string,
  ): Requirement {
    const keep = this.getRequirement(keepId);
    const merge = this.getRequirement(mergeId);
    if (!keep || !merge) {
      throw new AppError("NOT_FOUND", "Requirements not found", 404);
    }
    if (keepId === mergeId) {
      throw new AppError(
        "INVALID_MERGE",
        "Cannot merge a requirement with itself.",
        400,
      );
    }
    if (keep.applicationId !== merge.applicationId) {
      throw new AppError(
        "CROSS_APPLICATION_MERGE",
        "Requirements from different applications cannot be merged.",
        409,
      );
    }
    if (
      expectedApplicationId &&
      (keep.applicationId !== expectedApplicationId ||
        merge.applicationId !== expectedApplicationId)
    ) {
      throw new AppError(
        "CROSS_APPLICATION_MERGE",
        "Requirements must belong to the application in the URL.",
        409,
      );
    }
    const evidence = `${keep.sourceEvidence}\n---\n${merge.sourceEvidence}`;
    const certaintyOrder = { required: 2, uncertain: 1, optional: 0 } as const;
    const certainty =
      certaintyOrder[keep.certainty] >= certaintyOrder[merge.certainty]
        ? keep.certainty
        : merge.certainty;
    this.updateRequirement(keepId, {
      sourceEvidence: evidence,
      wordLimitMinimum: keep.wordLimitMinimum ?? merge.wordLimitMinimum,
      wordLimitMaximum: keep.wordLimitMaximum ?? merge.wordLimitMaximum,
      filenamePattern: keep.filenamePattern ?? merge.filenamePattern,
      acceptedFileExtensions: [
        ...new Set([
          ...keep.acceptedFileExtensions,
          ...merge.acceptedFileExtensions,
        ]),
      ],
      minimumCount: Math.max(keep.minimumCount, merge.minimumCount),
      certainty,
      required: certainty === "required",
      userConfirmed: keep.userConfirmed || merge.userConfirmed,
    });
    this.deleteRequirement(mergeId);
    return this.getRequirement(keepId)!;
  }

  createDocument(input: Omit<DocumentRecord, "createdAt" | "updatedAt"> & { text?: string }): DocumentRecord {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO documents (
          id, application_id, vault_document_id, original_filename, stored_filename, mime_type,
          file_size, page_count, word_count, title, category, category_confidence, parse_status,
          parsing_warnings, content_hash, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.applicationId,
        input.vaultDocumentId,
        input.originalFilename,
        input.storedFilename,
        input.mimeType,
        input.fileSize,
        input.pageCount,
        input.wordCount,
        input.title,
        input.category,
        input.categoryConfidence,
        input.parseStatus,
        JSON.stringify(input.parsingWarnings),
        input.contentHash,
        now,
        now,
      );
    if (input.text != null) {
      this.db
        .prepare(
          "INSERT INTO document_text (document_id, text_content, created_at) VALUES (?, ?, ?)",
        )
        .run(input.id, input.text, now);
    }
    return this.getDocument(input.id)!;
  }

  getDocument(id: string): DocumentRecord | null {
    const row = this.db.prepare("SELECT * FROM documents WHERE id=?").get(id);
    return row ? mapDocument(row as Record<string, unknown>) : null;
  }

  getDocumentText(id: string): string | null {
    const row = this.db
      .prepare("SELECT text_content FROM document_text WHERE document_id=?")
      .get(id) as { text_content?: string } | undefined;
    return row?.text_content ?? null;
  }

  listDocuments(applicationId: string): DocumentRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM documents WHERE application_id=? ORDER BY created_at DESC",
      )
      .all(applicationId)
      .map((r) => mapDocument(r as Record<string, unknown>));
  }

  deleteDocument(id: string): DocumentRecord | null {
    const doc = this.getDocument(id);
    if (!doc) return null;
    this.db.prepare("DELETE FROM documents WHERE id=?").run(id);
    return doc;
  }

  replaceFacts(documentId: string, facts: Omit<DocumentFact, "id" | "documentId">[]): DocumentFact[] {
    this.db.prepare("DELETE FROM document_facts WHERE document_id=?").run(documentId);
    const stmt = this.db.prepare(
      "INSERT INTO document_facts (id, document_id, fact_type, value, evidence, confidence) VALUES (?,?,?,?,?,?)",
    );
    for (const fact of facts) {
      stmt.run(
        newId(),
        documentId,
        fact.factType,
        fact.value,
        fact.evidence,
        fact.confidence,
      );
    }
    return this.listFacts(documentId);
  }

  listFacts(documentId: string): DocumentFact[] {
    return this.db
      .prepare("SELECT * FROM document_facts WHERE document_id=?")
      .all(documentId)
      .map((r) => mapFact(r as Record<string, unknown>));
  }

  listFactsForApplication(applicationId: string): DocumentFact[] {
    return this.db
      .prepare(
        `SELECT f.* FROM document_facts f
         JOIN documents d ON d.id = f.document_id
         WHERE d.application_id=?`,
      )
      .all(applicationId)
      .map((r) => mapFact(r as Record<string, unknown>));
  }

  clearAnalysis(applicationId: string): void {
    this.db
      .prepare("DELETE FROM document_matches WHERE application_id=?")
      .run(applicationId);
    this.db
      .prepare("DELETE FROM validation_results WHERE application_id=?")
      .run(applicationId);
    this.db
      .prepare(
        "DELETE FROM issues WHERE application_id=? AND status='open'",
      )
      .run(applicationId);
    this.db
      .prepare(
        "DELETE FROM profile_conflicts WHERE application_id=? AND resolved=0",
      )
      .run(applicationId);
  }

  upsertMatch(input: Omit<DocumentMatch, "createdAt" | "updatedAt">): DocumentMatch {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO document_matches
        (id, application_id, requirement_id, document_id, status, confidence, explanation, evidence, user_confirmed, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(requirement_id, document_id) DO UPDATE SET
          status=excluded.status,
          confidence=excluded.confidence,
          explanation=excluded.explanation,
          evidence=excluded.evidence,
          user_confirmed=excluded.user_confirmed,
          updated_at=excluded.updated_at`,
      )
      .run(
        input.id,
        input.applicationId,
        input.requirementId,
        input.documentId,
        input.status,
        input.confidence,
        input.explanation,
        JSON.stringify(input.evidence),
        input.userConfirmed ? 1 : 0,
        now,
        now,
      );
    return mapMatch(
      this.db
        .prepare(
          "SELECT * FROM document_matches WHERE requirement_id=? AND document_id=?",
        )
        .get(input.requirementId, input.documentId) as Record<string, unknown>,
    );
  }

  listMatches(applicationId: string): DocumentMatch[] {
    return this.db
      .prepare("SELECT * FROM document_matches WHERE application_id=?")
      .all(applicationId)
      .map((r) => mapMatch(r as Record<string, unknown>));
  }

  getMatch(id: string): DocumentMatch | null {
    const row = this.db.prepare("SELECT * FROM document_matches WHERE id=?").get(id);
    return row ? mapMatch(row as Record<string, unknown>) : null;
  }

  updateMatch(
    id: string,
    patch: Partial<Pick<DocumentMatch, "status" | "userConfirmed">>,
  ): DocumentMatch {
    const current = this.getMatch(id);
    if (!current) throw new Error("Match not found");
    const status = patch.status ?? current.status;
    const userConfirmed =
      patch.userConfirmed === undefined
        ? current.userConfirmed
        : patch.userConfirmed;
    this.db
      .prepare(
        "UPDATE document_matches SET status=?, user_confirmed=?, updated_at=? WHERE id=?",
      )
      .run(status, userConfirmed ? 1 : 0, nowIso(), id);
    return this.getMatch(id)!;
  }

  insertValidation(input: Omit<ValidationResult, "createdAt">): ValidationResult {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO validation_results
        (id, application_id, requirement_id, document_id, rule, passed, severity, message, evidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.applicationId,
        input.requirementId,
        input.documentId,
        input.rule,
        input.passed ? 1 : 0,
        input.severity,
        input.message,
        input.evidence,
        now,
      );
    return mapValidation(
      this.db
        .prepare("SELECT * FROM validation_results WHERE id=?")
        .get(input.id) as Record<string, unknown>,
    );
  }

  listValidations(applicationId: string): ValidationResult[] {
    return this.db
      .prepare("SELECT * FROM validation_results WHERE application_id=?")
      .all(applicationId)
      .map((r) => mapValidation(r as Record<string, unknown>));
  }

  insertIssue(input: Omit<Issue, "createdAt" | "updatedAt">): Issue {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO issues
        (id, application_id, requirement_id, document_id, severity, code, title, explanation, evidence, recommended_fix, status, dismissible, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.applicationId,
        input.requirementId,
        input.documentId,
        input.severity,
        input.code,
        input.title,
        input.explanation,
        input.evidence,
        input.recommendedFix,
        input.status,
        input.dismissible ? 1 : 0,
        now,
        now,
      );
    return this.getIssue(input.id)!;
  }

  getIssue(id: string): Issue | null {
    const row = this.db.prepare("SELECT * FROM issues WHERE id=?").get(id);
    return row ? mapIssue(row as Record<string, unknown>) : null;
  }

  listIssues(applicationId: string): Issue[] {
    return this.db
      .prepare(
        "SELECT * FROM issues WHERE application_id=? ORDER BY created_at DESC",
      )
      .all(applicationId)
      .map((r) => mapIssue(r as Record<string, unknown>));
  }

  updateIssue(id: string, status: Issue["status"]): Issue {
    this.db
      .prepare("UPDATE issues SET status=?, updated_at=? WHERE id=?")
      .run(status, nowIso(), id);
    return this.getIssue(id)!;
  }

  getProfile(applicationId: string): ApplicantProfile | null {
    const row = this.db
      .prepare("SELECT * FROM applicant_profiles WHERE application_id=?")
      .get(applicationId);
    return row ? mapProfile(row as Record<string, unknown>) : null;
  }

  updateProfile(
    applicationId: string,
    patch: Partial<ApplicantProfile>,
  ): ApplicantProfile {
    const current = this.getProfile(applicationId);
    if (!current) throw new Error("Profile not found");
    const next = { ...current, ...patch, updatedAt: nowIso() };
    this.db
      .prepare(
        `UPDATE applicant_profiles SET
          full_legal_name=?, preferred_name=?, email=?, phone=?, school=?,
          expected_graduation_date=?, major=?, gpa=?, address=?, target_organization=?,
          currently_enrolled=?, user_confirmed=?, updated_at=?
         WHERE application_id=?`,
      )
      .run(
        next.fullLegalName,
        next.preferredName,
        next.email,
        next.phone,
        next.school,
        next.expectedGraduationDate,
        next.major,
        next.gpa,
        next.address,
        next.targetOrganization,
        next.currentlyEnrolled == null
          ? null
          : next.currentlyEnrolled
            ? 1
            : 0,
        next.userConfirmed ? 1 : 0,
        next.updatedAt,
        applicationId,
      );
    return this.getProfile(applicationId)!;
  }

  insertConflict(input: Omit<ProfileConflict, "createdAt">): ProfileConflict {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO profile_conflicts
        (id, application_id, field, values_json, resolved, equivalent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.applicationId,
        input.field,
        JSON.stringify(input.values),
        input.resolved ? 1 : 0,
        input.equivalent == null ? null : input.equivalent ? 1 : 0,
        now,
      );
    return mapConflict(
      this.db
        .prepare("SELECT * FROM profile_conflicts WHERE id=?")
        .get(input.id) as Record<string, unknown>,
    );
  }

  listConflicts(applicationId: string): ProfileConflict[] {
    return this.db
      .prepare("SELECT * FROM profile_conflicts WHERE application_id=?")
      .all(applicationId)
      .map((r) => mapConflict(r as Record<string, unknown>));
  }

  resolveConflict(
    id: string,
    equivalent: boolean,
  ): ProfileConflict {
    this.db
      .prepare(
        "UPDATE profile_conflicts SET resolved=1, equivalent=? WHERE id=?",
      )
      .run(equivalent ? 1 : 0, id);
    return mapConflict(
      this.db
        .prepare("SELECT * FROM profile_conflicts WHERE id=?")
        .get(id) as Record<string, unknown>,
    );
  }

  listVault(): VaultDocument[] {
    return this.db
      .prepare("SELECT * FROM vault_documents ORDER BY updated_at DESC")
      .all()
      .map((r) => mapVault(r as Record<string, unknown>));
  }

  getVault(id: string): VaultDocument | null {
    const row = this.db.prepare("SELECT * FROM vault_documents WHERE id=?").get(id);
    return row ? mapVault(row as Record<string, unknown>) : null;
  }

  createVault(input: Omit<VaultDocument, "createdAt" | "updatedAt">): VaultDocument {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO vault_documents
        (id, original_filename, stored_filename, mime_type, file_size, category, version,
         notes, expiration_date, word_count, page_count, extracted_summary, parse_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.originalFilename,
        input.storedFilename,
        input.mimeType,
        input.fileSize,
        input.category,
        input.version,
        input.notes,
        input.expirationDate,
        input.wordCount,
        input.pageCount,
        input.extractedSummary,
        input.parseStatus,
        now,
        now,
      );
    return this.getVault(input.id)!;
  }

  updateVault(
    id: string,
    patch: Partial<Pick<VaultDocument, "category" | "notes" | "expirationDate" | "version">>,
  ): VaultDocument {
    const current = this.getVault(id);
    if (!current) throw new Error("Vault document not found");
    this.db
      .prepare(
        `UPDATE vault_documents SET category=?, notes=?, expiration_date=?, version=?, updated_at=? WHERE id=?`,
      )
      .run(
        patch.category ?? current.category,
        patch.notes === undefined ? current.notes : patch.notes,
        patch.expirationDate === undefined
          ? current.expirationDate
          : patch.expirationDate,
        patch.version ?? current.version,
        nowIso(),
        id,
      );
    return this.getVault(id)!;
  }

  deleteVault(id: string): VaultDocument | null {
    const doc = this.getVault(id);
    if (!doc) return null;
    this.db.prepare("DELETE FROM vault_documents WHERE id=?").run(id);
    return doc;
  }

  addActivity(
    applicationId: string | null,
    eventType: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): ActivityEvent {
    const id = newId();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO activity_events (id, application_id, event_type, message, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        applicationId,
        eventType,
        message,
        metadata ? JSON.stringify(metadata) : null,
        now,
      );
    return mapActivity(
      this.db.prepare("SELECT * FROM activity_events WHERE id=?").get(id) as Record<
        string,
        unknown
      >,
    );
  }

  listActivity(applicationId: string): ActivityEvent[] {
    return this.db
      .prepare(
        "SELECT * FROM activity_events WHERE application_id=? ORDER BY created_at DESC LIMIT 100",
      )
      .all(applicationId)
      .map((r) => mapActivity(r as Record<string, unknown>));
  }

  clearAllData(): void {
    this.db.exec(`
      DELETE FROM activity_events;
      DELETE FROM profile_conflicts;
      DELETE FROM applicant_profiles;
      DELETE FROM issues;
      DELETE FROM validation_results;
      DELETE FROM document_matches;
      DELETE FROM document_facts;
      DELETE FROM document_text;
      DELETE FROM documents;
      DELETE FROM requirements;
      DELETE FROM requirement_sources;
      DELETE FROM vault_documents;
      DELETE FROM applications;
      DELETE FROM settings;
    `);
  }
}
