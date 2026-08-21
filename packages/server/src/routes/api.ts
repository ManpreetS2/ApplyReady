import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import {
  assignDocumentSchema,
  confirmRequirementSchema,
  createApplicationSchema,
  createRequirementSchema,
  mergeRequirementsSchema,
  pastedSourceSchema,
  resolveConflictSchema,
  applyDemoFixSchema,
  setDemoStepSchema,
  updateApplicationSchema,
  updateIssueSchema,
  updateMatchSchema,
  updateProfileSchema,
  updateRequirementSchema,
  urlSourceSchema,
  vaultCreateMetaSchema,
  vaultUpdateSchema,
  MAX_UPLOAD_BYTES,
} from "@applyready/shared";
import type Database from "better-sqlite3";
import type { Application } from "@applyready/shared";
import { config } from "../config.js";
import { Repositories } from "../db/repositories.js";
import { asyncHandler, requireApp } from "../middleware/errorHandler.js";
import {
  publicDemoGuard,
  requirePublicDemoApplication,
} from "../middleware/publicDemo.js";
import { AppError } from "../utils/errors.js";
import {
  deleteFileQuietly,
  resolveUploadPath,
} from "../utils/files.js";
import { newId } from "../utils/ids.js";
import { analyzeApplication } from "../services/analysis/analyze.js";
import { processUploadedDocument, processVaultDocument } from "../services/documents/process.js";
import {
  ingestPastedText,
  ingestUploadedSource,
  ingestUrl,
} from "../services/requirements/ingest.js";
import {
  advanceGuidedDemo,
  applySuggestedDemoFix,
  DEMO_STEPS,
  resetGuidedDemo,
  setGuidedDemoStep,
  startGuidedDemo,
} from "../services/demo/demo.js";
import { getDemoFixPreview } from "../services/demo/preview.js";
import { computeReadiness } from "../services/readiness/score.js";
import { extractHtmlText } from "../services/documents/readers.js";
import {
  assertSafePublicUrl,
  fetchPublicResource,
} from "../services/urlFetch.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

function loadApplicationForRead(
  repos: Repositories,
  id: string,
): Application {
  const application = requireApp(repos, id) as Application;
  if (config.publicDemoMode) {
    return requirePublicDemoApplication(application);
  }
  return application;
}

export function createApiRouter(db: Database.Database): Router {
  const router = Router();
  const repos = new Repositories(db);

  router.use(publicDemoGuard);

  router.get("/health", (_req, res) => {
    if (config.publicDemoMode) {
      res.json({
        ok: true,
        service: "ApplyReady",
        mode: "public-demo",
        time: new Date().toISOString(),
      });
      return;
    }
    res.json({
      ok: true,
      service: "ApplyReady",
      mode: "local",
      time: new Date().toISOString(),
      storage: {
        dataDir: config.dataDir,
        uploadsDir: config.uploadsDir,
        dbPath: config.dbPath,
      },
    });
  });

  router.get("/config", (_req, res) => {
    res.json({
      publicDemoMode: config.publicDemoMode,
      mode: config.publicDemoMode ? "public-demo" : "local",
    });
  });

  router.get("/settings/storage", (_req, res) => {
    if (config.publicDemoMode) {
      res.json({
        publicDemoMode: true,
        privacy:
          "This hosted portfolio demo uses generated fictional documents and optional temporary visitor-provided fictional scalar edits. Use fictional or example values only. Custom demo edits are processed inside the generated fictional packet and automatically removed with the demo. Real uploads are disabled. No account is created.",
      });
      return;
    }
    res.json({
      dataDir: config.dataDir,
      uploadsDir: config.uploadsDir,
      dbPath: config.dbPath,
      privacy:
        "Documents remain on this machine. ApplyReady does not upload files to external AI providers or analytics services.",
    });
  });

  router.delete(
    "/settings/clear-all",
    asyncHandler(async (_req, res) => {
      const apps = repos.listApplications();
      for (const app of apps) {
        const docs = repos.deleteApplication(app.id);
        for (const doc of docs) {
          deleteFileQuietly(
            resolveUploadPath("applications", doc.storedFilename),
          );
        }
      }
      for (const vault of repos.listVault()) {
        repos.deleteVault(vault.id);
        deleteFileQuietly(resolveUploadPath("vault", vault.storedFilename));
      }
      repos.clearAllData();
      // wipe upload folders
      for (const kind of ["applications", "vault", "sources"] as const) {
        const dir = path.join(config.uploadsDir, kind);
        if (fs.existsSync(dir)) {
          for (const file of fs.readdirSync(dir)) {
            deleteFileQuietly(path.join(dir, file));
          }
        }
      }
      res.json({ ok: true });
    }),
  );

  // Applications
  router.get("/applications", (_req, res) => {
    res.json({ applications: repos.listApplications() });
  });

  router.post(
    "/applications",
    asyncHandler(async (req, res) => {
      const body = createApplicationSchema.parse(req.body);
      const application = repos.createApplication(body);
      res.status(201).json({ application });
    }),
  );

  router.post(
    "/applications/preview-url",
    asyncHandler(async (req, res) => {
      const body = urlSourceSchema.parse(req.body);
      await assertSafePublicUrl(body.url);
      const fetched = await fetchPublicResource(body.url);
      if (fetched.isPdf) {
        throw new AppError(
          "UNSUPPORTED_CONTENT_TYPE",
          "URL points to a PDF; preview needs an HTML or text page.",
          400,
          ["Use a public webpage URL."],
        );
      }
      const extracted = await extractHtmlText(fetched.text);
      res.json({
        title: extracted.title || "",
        description: extracted.text.slice(0, 300),
        text: extracted.text,
      });
    }),
  );

  router.get(
    "/applications/:id",
    asyncHandler(async (req, res) => {
      const application = loadApplicationForRead(repos, req.params.id!);
      res.json({
        application,
        requirements: repos.listRequirements(req.params.id!),
        documents: repos.listDocuments(req.params.id!),
        issues: repos.listIssues(req.params.id!),
        matches: repos.listMatches(req.params.id!),
        conflicts: repos.listConflicts(req.params.id!),
        profile: repos.getProfile(req.params.id!),
        activity: repos.listActivity(req.params.id!),
        validations: repos.listValidations(req.params.id!),
      });
    }),
  );

  router.patch(
    "/applications/:id",
    asyncHandler(async (req, res) => {
      requireApp(repos, req.params.id!);
      const body = updateApplicationSchema.parse(req.body);
      const application = repos.updateApplication(req.params.id!, body);
      res.json({ application });
    }),
  );

  router.delete(
    "/applications/:id",
    asyncHandler(async (req, res) => {
      requireApp(repos, req.params.id!);
      const docs = repos.deleteApplication(req.params.id!);
      for (const doc of docs) {
        deleteFileQuietly(
          resolveUploadPath("applications", doc.storedFilename),
        );
      }
      res.json({ ok: true, deletedFiles: docs.length });
    }),
  );

  router.get(
    "/applications/:id/export",
    asyncHandler(async (req, res) => {
      const id = req.params.id!;
      const application = loadApplicationForRead(repos, id);
      const documents = repos.listDocuments(id).map((d) => {
        if (!config.publicDemoMode) return d;
        const { storedFilename: _stored, ...safe } = d;
        return safe;
      });
      const report = {
        application,
        requirements: repos.listRequirements(id),
        documents,
        matches: repos.listMatches(id),
        issues: repos.listIssues(id),
        conflicts: repos.listConflicts(id),
        validations: repos.listValidations(id),
        readiness: computeReadiness({
          applicationId: id,
          requirements: repos.listRequirements(id),
          matches: repos.listMatches(id),
          issues: repos.listIssues(id),
          conflicts: repos.listConflicts(id),
        }),
        generatedAt: new Date().toISOString(),
      };
      res.json(report);
    }),
  );

  // Sources
  router.post(
    "/applications/:id/sources/text",
    asyncHandler(async (req, res) => {
      requireApp(repos, req.params.id!);
      const body = pastedSourceSchema.parse(req.body);
      const result = await ingestPastedText(
        db,
        req.params.id!,
        body.text,
        body.sourceName,
      );
      res.status(201).json(result);
    }),
  );

  router.post(
    "/applications/:id/sources/url",
    asyncHandler(async (req, res) => {
      requireApp(repos, req.params.id!);
      const body = urlSourceSchema.parse(req.body);
      const result = await ingestUrl(db, req.params.id!, body.url);
      res.status(201).json(result);
    }),
  );

  router.post(
    "/applications/:id/sources/upload",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      requireApp(repos, req.params.id!);
      if (!req.file) {
        throw new AppError("NO_FILE", "No file uploaded.", 400, [
          "Choose a requirements file and try again.",
        ]);
      }
      const result = await ingestUploadedSource(
        db,
        req.params.id!,
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
      );
      res.status(201).json(result);
    }),
  );

  // Requirements
  router.get(
    "/applications/:id/requirements",
    asyncHandler(async (req, res) => {
      requireApp(repos, req.params.id!);
      res.json({ requirements: repos.listRequirements(req.params.id!) });
    }),
  );

  router.post(
    "/applications/:id/requirements",
    asyncHandler(async (req, res) => {
      requireApp(repos, req.params.id!);
      const body = createRequirementSchema.parse(req.body);
      const requirement = repos.createRequirement(req.params.id!, body);
      res.status(201).json({ requirement });
    }),
  );

  router.patch(
    "/requirements/:id",
    asyncHandler(async (req, res) => {
      const current = repos.getRequirement(req.params.id!);
      if (!current) {
        throw new AppError("NOT_FOUND", "Requirement not found.", 404);
      }
      const body = updateRequirementSchema.parse(req.body);
      const requirement = repos.updateRequirement(req.params.id!, body);
      res.json({ requirement });
    }),
  );

  router.delete(
    "/requirements/:id",
    asyncHandler(async (req, res) => {
      const current = repos.getRequirement(req.params.id!);
      if (!current) {
        throw new AppError("NOT_FOUND", "Requirement not found.", 404);
      }
      repos.deleteRequirement(req.params.id!);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/requirements/:id/confirm",
    asyncHandler(async (req, res) => {
      const current = repos.getRequirement(req.params.id!);
      if (!current) {
        throw new AppError("NOT_FOUND", "Requirement not found.", 404);
      }
      const body = confirmRequirementSchema.parse(req.body ?? {});
      if (current.certainty === "uncertain") {
        if (!body.certainty) {
          throw new AppError(
            "CERTAINTY_REQUIRED",
            "Uncertain requirements must be resolved as required or optional.",
            400,
            [
              'Send { "certainty": "required" } or { "certainty": "optional" } when confirming.',
            ],
          );
        }
        const requirement = repos.updateRequirement(req.params.id!, {
          certainty: body.certainty,
          required: body.certainty === "required",
          userConfirmed: true,
          confidence: Math.max(current.confidence, 0.9),
          ...(body.applicability ? { applicability: body.applicability } : {}),
        });
        res.json({ requirement });
        return;
      }
      const requirement = repos.updateRequirement(req.params.id!, {
        ...(body.certainty
          ? {
              certainty: body.certainty,
              required: body.certainty === "required",
            }
          : {}),
        ...(body.applicability ? { applicability: body.applicability } : {}),
        userConfirmed: true,
        confidence: Math.max(current.confidence, 0.9),
      });
      res.json({ requirement });
    }),
  );

  router.post(
    "/applications/:id/requirements/merge",
    asyncHandler(async (req, res) => {
      requireApp(repos, req.params.id!);
      const body = mergeRequirementsSchema.parse(req.body);
      const requirement = repos.mergeRequirements(
        body.keepId,
        body.mergeId,
        req.params.id!,
      );
      res.json({ requirement });
    }),
  );

  // Documents
  router.get(
    "/applications/:id/documents",
    asyncHandler(async (req, res) => {
      requireApp(repos, req.params.id!);
      const documents = repos.listDocuments(req.params.id!).map((doc) => ({
        ...doc,
        facts: repos.listFacts(doc.id),
      }));
      res.json({ documents });
    }),
  );

  router.post(
    "/applications/:id/documents",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      requireApp(repos, req.params.id!);
      if (!req.file) {
        throw new AppError("NO_FILE", "No file uploaded.", 400);
      }
      const result = await processUploadedDocument(db, {
        applicationId: req.params.id!,
        buffer: req.file.buffer,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
      });
      res.status(201).json(result);
    }),
  );

  router.get(
    "/documents/:id",
    asyncHandler(async (req, res) => {
      const document = repos.getDocument(req.params.id!);
      if (!document) {
        throw new AppError("NOT_FOUND", "Document not found.", 404);
      }
      res.json({
        document,
        facts: repos.listFacts(document.id),
        textPreview: (repos.getDocumentText(document.id) || "").slice(0, 500),
      });
    }),
  );

  router.delete(
    "/documents/:id",
    asyncHandler(async (req, res) => {
      const doc = repos.deleteDocument(req.params.id!);
      if (!doc) {
        throw new AppError("NOT_FOUND", "Document not found.", 404);
      }
      deleteFileQuietly(resolveUploadPath("applications", doc.storedFilename));
      if (doc.applicationId) {
        repos.addActivity(
          doc.applicationId,
          "document_deleted",
          `Deleted ${doc.originalFilename}`,
        );
      }
      res.json({ ok: true });
    }),
  );

  // Analysis
  router.post(
    "/applications/:id/analyze",
    asyncHandler(async (req, res) => {
      requireApp(repos, req.params.id!);
      const result = analyzeApplication(db, req.params.id!);
      res.json(result);
    }),
  );

  router.get(
    "/applications/:id/readiness",
    asyncHandler(async (req, res) => {
      requireApp(repos, req.params.id!);
      const report = computeReadiness({
        applicationId: req.params.id!,
        requirements: repos.listRequirements(req.params.id!),
        matches: repos.listMatches(req.params.id!),
        issues: repos.listIssues(req.params.id!),
        conflicts: repos.listConflicts(req.params.id!),
      });
      res.json({ report });
    }),
  );

  router.get(
    "/applications/:id/issues",
    asyncHandler(async (req, res) => {
      requireApp(repos, req.params.id!);
      res.json({ issues: repos.listIssues(req.params.id!) });
    }),
  );

  router.patch(
    "/issues/:id",
    asyncHandler(async (req, res) => {
      const issue = repos.getIssue(req.params.id!);
      if (!issue) throw new AppError("NOT_FOUND", "Issue not found.", 404);
      const body = updateIssueSchema.parse(req.body);
      if (body.status === "dismissed" && !issue.dismissible) {
        throw new AppError(
          "NOT_DISMISSIBLE",
          "This issue cannot be dismissed without fixing the underlying problem.",
          400,
        );
      }
      if (body.status === "resolved" && !issue.dismissible) {
        throw new AppError(
          "ISSUE_REQUIRES_FIX",
          "This issue cannot be manually marked resolved. Fix the underlying condition and reanalyze.",
          400,
        );
      }
      const updated = repos.updateIssue(req.params.id!, body.status);
      res.json({ issue: updated });
    }),
  );

  router.get(
    "/applications/:id/conflicts",
    asyncHandler(async (req, res) => {
      requireApp(repos, req.params.id!);
      res.json({
        conflicts: repos.listConflicts(req.params.id!),
        profile: repos.getProfile(req.params.id!),
      });
    }),
  );

  router.patch(
    "/applications/:id/profile",
    asyncHandler(async (req, res) => {
      requireApp(repos, req.params.id!);
      const body = updateProfileSchema.parse(req.body);
      const profile = repos.updateProfile(req.params.id!, body);
      res.json({ profile });
    }),
  );

  router.post(
    "/conflicts/:id/resolve",
    asyncHandler(async (req, res) => {
      const body = resolveConflictSchema.parse(req.body);
      const conflict = repos.resolveConflict(req.params.id!, body.equivalent);
      if (body.confirmedValue && conflict) {
        const fieldMap: Record<string, string> = {
          full_legal_name: "fullLegalName",
          email: "email",
          phone: "phone",
          school: "school",
          major: "major",
          gpa: "gpa",
          expected_graduation_date: "expectedGraduationDate",
        };
        const key = fieldMap[conflict.field];
        if (key) {
          repos.updateProfile(conflict.applicationId, {
            [key]: body.confirmedValue,
          });
        }
      }
      res.json({ conflict });
    }),
  );

  // Matches
  router.patch(
    "/document-matches/:id",
    asyncHandler(async (req, res) => {
      const current = repos.getMatch(req.params.id!);
      if (!current) throw new AppError("NOT_FOUND", "Match not found.", 404);
      const body = updateMatchSchema.parse(req.body);
      const match = repos.updateMatch(req.params.id!, body);
      res.json({ match });
    }),
  );

  router.post(
    "/requirements/:id/assign-document",
    asyncHandler(async (req, res) => {
      const requirement = repos.getRequirement(req.params.id!);
      if (!requirement) {
        throw new AppError("NOT_FOUND", "Requirement not found.", 404);
      }
      const body = assignDocumentSchema.parse(req.body);
      const document = repos.getDocument(body.documentId);
      if (!document) {
        throw new AppError("NOT_FOUND", "Document not found.", 404);
      }
      if (document.applicationId !== requirement.applicationId) {
        throw new AppError(
          "CROSS_APPLICATION_DOCUMENT",
          "Documents can only be assigned to requirements in the same application.",
          409,
          ["Choose a document that belongs to this application."],
        );
      }
      const match = repos.upsertMatch({
        id: newId(),
        applicationId: requirement.applicationId,
        requirementId: requirement.id,
        documentId: document.id,
        status: "confirmed",
        confidence: 1,
        explanation: "Manually assigned by user.",
        evidence: ["User confirmed this document satisfies the requirement."],
        userConfirmed: true,
      });
      res.json({ match });
    }),
  );

  // Vault
  router.get("/vault", (_req, res) => {
    res.json({ documents: repos.listVault() });
  });

  router.post(
    "/vault",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new AppError("NO_FILE", "No file uploaded.", 400);
      const meta = vaultCreateMetaSchema.parse({
        category: req.body.category,
        notes: req.body.notes || null,
        expirationDate: req.body.expirationDate || null,
      });
      const processed = await processVaultDocument(db, {
        buffer: req.file.buffer,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        category: meta.category,
        notes: meta.notes ?? null,
        expirationDate: meta.expirationDate ?? null,
      });
      res.status(201).json({ document: processed.vault });
    }),
  );

  router.patch(
    "/vault/:id",
    asyncHandler(async (req, res) => {
      const current = repos.getVault(req.params.id!);
      if (!current) throw new AppError("NOT_FOUND", "Vault document not found.", 404);
      const body = vaultUpdateSchema.parse(req.body);
      const document = repos.updateVault(req.params.id!, body);
      res.json({ document });
    }),
  );

  router.delete(
    "/vault/:id",
    asyncHandler(async (req, res) => {
      const doc = repos.deleteVault(req.params.id!);
      if (!doc) throw new AppError("NOT_FOUND", "Vault document not found.", 404);
      deleteFileQuietly(resolveUploadPath("vault", doc.storedFilename));
      res.json({ ok: true });
    }),
  );

  router.post(
    "/applications/:id/use-vault-document/:vaultId",
    asyncHandler(async (req, res) => {
      requireApp(repos, req.params.id!);
      const vault = repos.getVault(req.params.vaultId!);
      if (!vault) throw new AppError("NOT_FOUND", "Vault document not found.", 404);
      const buffer = fs.readFileSync(
        resolveUploadPath("vault", vault.storedFilename),
      );
      const result = await processUploadedDocument(db, {
        applicationId: req.params.id!,
        buffer,
        originalFilename: vault.originalFilename,
        mimeType: vault.mimeType,
        vaultDocumentId: vault.id,
        categoryHint: vault.category,
      });
      res.status(201).json(result);
    }),
  );

  // Demo
  router.post(
    "/demo/start",
    asyncHandler(async (_req, res) => {
      const result = await startGuidedDemo(db);
      res.status(201).json({ ...result, steps: DEMO_STEPS });
    }),
  );

  router.post(
    "/demo/:id/advance",
    asyncHandler(async (req, res) => {
      const result = await advanceGuidedDemo(db, req.params.id!);
      res.json({ ...result, steps: DEMO_STEPS });
    }),
  );

  router.post(
    "/demo/:id/fix",
    asyncHandler(async (req, res) => {
      const body =
        req.body && Object.keys(req.body).length > 0
          ? applyDemoFixSchema.parse(req.body)
          : ({ mode: "suggested" } as const);
      const result = await applySuggestedDemoFix(db, req.params.id!, body);
      res.json({ ...result, steps: DEMO_STEPS });
    }),
  );

  router.get(
    "/demo/:id/fix-preview",
    asyncHandler(async (req, res) => {
      const preview = getDemoFixPreview(db, req.params.id!);
      res.json({ preview });
    }),
  );

  router.post(
    "/demo/:id/reset",
    asyncHandler(async (req, res) => {
      const result = await resetGuidedDemo(db, req.params.id!);
      res.json({ ...result, steps: DEMO_STEPS });
    }),
  );

  router.post(
    "/demo/:id/step",
    asyncHandler(async (req, res) => {
      const body = setDemoStepSchema.parse(req.body);
      const result = await setGuidedDemoStep(db, req.params.id!, body.step);
      res.json({ ...result, steps: DEMO_STEPS });
    }),
  );

  router.get("/demo/steps", (_req, res) => {
    res.json({ steps: DEMO_STEPS });
  });

  return router;
}
