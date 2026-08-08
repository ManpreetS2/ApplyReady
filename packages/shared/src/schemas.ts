import { z } from "zod";

export const applicationTypeSchema = z.enum([
  "scholarship",
  "college",
  "internship",
  "other",
]);

export const requirementCategorySchema = z.enum([
  "resume",
  "transcript",
  "essay",
  "recommendation",
  "identification",
  "portfolio",
  "application_form",
  "certification",
  "financial_document",
  "proof_of_enrollment",
  "proof_of_eligibility",
  "supplemental_response",
  "combined_packet",
  "other",
]);

export const createApplicationSchema = z.object({
  name: z.string().min(1).max(200),
  organization: z.string().min(1).max(200),
  type: applicationTypeSchema,
  deadline: z.string().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export const updateApplicationSchema = createApplicationSchema.partial();

export const pastedSourceSchema = z.object({
  text: z.string().min(1).max(200_000),
  sourceName: z.string().min(1).max(200).default("Pasted requirements"),
});

export const urlSourceSchema = z.object({
  url: z.string().url().max(2000),
});

export const createRequirementSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).default(""),
  category: requirementCategorySchema,
  required: z.boolean().default(true),
  certainty: z.enum(["required", "optional", "uncertain"]).optional(),
  conditional: z.boolean().default(false),
  conditionText: z.string().nullable().optional(),
  applicability: z
    .enum(["applicable", "not_applicable", "unknown"])
    .optional(),
  sourceEvidence: z.string().default("Manually added by user"),
  sourceLocation: z.string().nullable().optional(),
  acceptedDocumentTypes: z.array(z.string()).default([]),
  acceptedFileExtensions: z.array(z.string()).default([]),
  minimumCount: z.number().int().min(0).default(1),
  maximumCount: z.number().int().min(1).nullable().optional(),
  wordLimitMinimum: z.number().int().min(0).nullable().optional(),
  wordLimitMaximum: z.number().int().min(0).nullable().optional(),
  pageLimitMinimum: z.number().int().min(0).nullable().optional(),
  pageLimitMaximum: z.number().int().min(0).nullable().optional(),
  filenamePattern: z.string().nullable().optional(),
  signatureRequired: z.boolean().default(false),
  dateRequirement: z.string().nullable().optional(),
  expirationRule: z.string().nullable().optional(),
  requiredKeywords: z.array(z.string()).default([]),
  organizationNameExpected: z.string().nullable().optional(),
  customValidationNotes: z.string().nullable().optional(),
});

export const requirementApplicabilitySchema = z.enum([
  "applicable",
  "not_applicable",
  "unknown",
]);

export const updateRequirementSchema = createRequirementSchema.partial().extend({
  userConfirmed: z.boolean().optional(),
  applicability: requirementApplicabilitySchema.optional(),
});

/** Confirm a requirement. Uncertain items must explicitly resolve to required or optional. */
export const confirmRequirementSchema = z.object({
  certainty: z.enum(["required", "optional"]).optional(),
  applicability: requirementApplicabilitySchema.optional(),
});

export const updateMatchSchema = z.object({
  status: z
    .enum(["confirmed", "likely", "possible", "does_not_match", "needs_confirmation"])
    .optional(),
  userConfirmed: z.boolean().optional(),
});

export const assignDocumentSchema = z.object({
  documentId: z.string().uuid(),
});

export const updateIssueSchema = z.object({
  status: z.enum(["open", "resolved", "dismissed"]),
});

export const profileConfirmableFieldSchema = z.enum([
  "fullLegalName",
  "email",
  "phone",
  "school",
  "major",
  "gpa",
  "expectedGraduationDate",
  "targetOrganization",
  "currentlyEnrolled",
]);

export const updateProfileSchema = z.object({
  fullLegalName: z.string().nullable().optional(),
  preferredName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  school: z.string().nullable().optional(),
  expectedGraduationDate: z.string().nullable().optional(),
  major: z.string().nullable().optional(),
  gpa: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  targetOrganization: z.string().nullable().optional(),
  currentlyEnrolled: z.boolean().nullable().optional(),
  userConfirmed: z.boolean().optional(),
  confirmedFields: z.array(profileConfirmableFieldSchema).optional(),
});

export const resolveConflictSchema = z.object({
  equivalent: z.boolean(),
  confirmedValue: z.string().optional(),
});

export const vaultCreateMetaSchema = z.object({
  category: requirementCategorySchema,
  notes: z.string().nullable().optional(),
  expirationDate: z.string().nullable().optional(),
});

export const vaultUpdateSchema = z.object({
  category: requirementCategorySchema.optional(),
  notes: z.string().nullable().optional(),
  expirationDate: z.string().nullable().optional(),
  version: z.number().int().positive().optional(),
});

export const mergeRequirementsSchema = z.object({
  keepId: z.string().uuid(),
  mergeId: z.string().uuid(),
});
