import type Database from "better-sqlite3";
import { config } from "../../config.js";
import { withTransaction } from "../../db/database.js";
import { Repositories } from "../../db/repositories.js";
import { AppError } from "../../utils/errors.js";
import { deleteFileQuietly, resolveUploadPath } from "../../utils/files.js";
import { newId } from "../../utils/ids.js";
import { analyzeApplication } from "../analysis/analyze.js";
import { processUploadedDocument } from "../documents/process.js";
import { ingestPastedText } from "../requirements/ingest.js";
import { computeReadiness } from "../readiness/score.js";
import { cleanupStaleDemoApplications } from "./cleanup.js";
import {
  DEMO_REQUIREMENTS_TEXT,
  buildDemoEssayPdf,
  buildDemoPacketPdf,
  buildDemoRecommendationPdf,
  buildDemoResumePdf,
  buildDemoTranscriptPdf,
} from "./content.js";
import { withDemoLock } from "./lock.js";

/** Test-only: force a failure during staged demo reset initialization. */
let resetFailAfter: "ingest" | "seed" | "analyze" | "before_swap" | null = null;
/** Test-only: force a failure during staged category document replacement. */
let replaceFailAfter: "before_swap" | null = null;
/** Test-only: force a failure during staged set-step materialization. */
let stepFailAfter: "before_swap" | "replay" | null = null;

export function setDemoResetTestHooks(
  hooks: {
    failAfter?: "ingest" | "seed" | "analyze" | "before_swap" | null;
  } | null,
): void {
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    throw new Error("setDemoResetTestHooks is only available in tests");
  }
  resetFailAfter = hooks?.failAfter ?? null;
}

export function setDemoReplaceTestHooks(
  hooks: {
    failAfter?: "before_swap" | null;
  } | null,
): void {
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    throw new Error("setDemoReplaceTestHooks is only available in tests");
  }
  replaceFailAfter = hooks?.failAfter ?? null;
}

export function setDemoStepTestHooks(
  hooks: {
    failAfter?: "before_swap" | "replay" | null;
  } | null,
): void {
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    throw new Error("setDemoStepTestHooks is only available in tests");
  }
  stepFailAfter = hooks?.failAfter ?? null;
}

/**
 * Each entry describes the CURRENT application state after reaching that step.
 * `nextAction` describes the mutation Apply suggested fix will perform next.
 */
export const DEMO_STEPS = [
  {
    step: 0,
    title: "Initial packet review",
    summary:
      "The fictional packet starts with several intentional problems.",
    nextAction: "Add fictional transcript",
    shortLabel: "Review",
  },
  {
    step: 1,
    title: "Transcript added",
    summary:
      "The required fictional transcript is now present. The essay is still too long and references the wrong scholarship.",
    nextAction: "Fix essay length and scholarship reference",
    shortLabel: "Transcript",
  },
  {
    step: 2,
    title: "Essay corrected",
    summary:
      "The essay now meets the word limit and references Future Engineers Scholarship. The recommendation still addresses the wrong organization.",
    nextAction: "Fix recommendation letter",
    shortLabel: "Essay",
  },
  {
    step: 3,
    title: "Recommendation corrected",
    summary:
      "The recommendation now addresses Future Engineers Scholarship. The resume still contains the outdated email.",
    nextAction: "Update resume email",
    shortLabel: "Recommendation",
  },
  {
    step: 4,
    title: "Resume corrected",
    summary:
      "The fictional resume now uses the current email. The combined packet filename still needs correction.",
    nextAction: "Fix combined packet filename",
    shortLabel: "Resume",
  },
  {
    step: 5,
    title: "Packet filename corrected",
    summary:
      "The required files and filename are now corrected. Final matching and readiness confirmation remain.",
    nextAction: "Finalize readiness",
    shortLabel: "Packet",
  },
  {
    step: 6,
    title: "Ready to submit",
    summary: "All required fictional items are verified.",
    nextAction: null,
    shortLabel: "Ready",
  },
] as const;

export type DemoStepInfo = (typeof DEMO_STEPS)[number];

async function confirmExtractedRequirements(
  repos: Repositories,
  applicationId: string,
) {
  for (const req of repos.listRequirements(applicationId)) {
    if (req.certainty === "uncertain") {
      const certainty = req.category === "portfolio" ? "optional" : "required";
      repos.updateRequirement(req.id, {
        certainty,
        required: certainty === "required",
        userConfirmed: true,
        applicability: "applicable",
      });
    } else {
      repos.updateRequirement(req.id, {
        userConfirmed: true,
        applicability: req.conditional ? "applicable" : req.applicability,
      });
    }
  }
}

/**
 * Fully initialize guided-demo contents on an existing application row.
 * Used by start and by staged reset / set-step materialization.
 */
async function initializeGuidedDemoContents(
  db: Database.Database,
  applicationId: string,
) {
  const repos = new Repositories(db);
  await ingestPastedText(
    db,
    applicationId,
    DEMO_REQUIREMENTS_TEXT,
    "Future Engineers Scholarship Requirements",
  );
  if (resetFailAfter === "ingest") {
    throw new Error("Injected demo reset failure after ingest");
  }
  await confirmExtractedRequirements(repos, applicationId);
  await seedInitialDemoDocs(db, applicationId);
  if (resetFailAfter === "seed") {
    throw new Error("Injected demo reset failure after seed");
  }
  const analysis = analyzeApplication(db, applicationId);
  if (resetFailAfter === "analyze") {
    throw new Error("Injected demo reset failure after analyze");
  }
  return analysis;
}

async function destroyDemoApplication(
  db: Database.Database,
  applicationId: string,
) {
  const repos = new Repositories(db);
  const docs = repos.deleteApplication(applicationId);
  for (const doc of docs) {
    deleteFileQuietly(resolveUploadPath("applications", doc.storedFilename));
  }
}

async function seedInitialDemoDocs(db: Database.Database, applicationId: string) {
  await processUploadedDocument(db, {
    applicationId,
    buffer: await buildDemoResumePdf(true),
    originalFilename: "Alex_Chen_Resume.pdf",
    mimeType: "application/pdf",
    categoryHint: "resume",
  });
  await processUploadedDocument(db, {
    applicationId,
    buffer: await buildDemoEssayPdf(true),
    originalFilename: "Essay_Alex_Chen.pdf",
    mimeType: "application/pdf",
    categoryHint: "essay",
  });
  await processUploadedDocument(db, {
    applicationId,
    buffer: await buildDemoRecommendationPdf(true),
    originalFilename: "Recommendation_Letter.pdf",
    mimeType: "application/pdf",
    categoryHint: "recommendation",
  });
  const packet = await buildDemoPacketPdf(false);
  await processUploadedDocument(db, {
    applicationId,
    buffer: packet.buffer,
    originalFilename: packet.filename,
    mimeType: "application/pdf",
    categoryHint: "combined_packet",
  });
}

async function confirmLikelyMatches(db: Database.Database, applicationId: string) {
  const repos = new Repositories(db);
  const documents = repos.listDocuments(applicationId);
  const requirements = repos.listRequirements(applicationId);
  const matches = repos.listMatches(applicationId);

  for (const req of requirements) {
    if (req.category === "other" && !req.filenamePattern) continue;
    const existing = matches.find(
      (m) =>
        m.requirementId === req.id &&
        m.status !== "does_not_match",
    );
    if (!existing) {
      const doc = documents.find((d) => d.category === req.category);
      if (doc) {
        repos.upsertMatch({
          id: newId(),
          applicationId,
          requirementId: req.id,
          documentId: doc.id,
          status: "confirmed",
          confidence: 1,
          explanation: "Confirmed during guided demo fix sequence.",
          evidence: ["Demo assigned document by category after suggested fix."],
          userConfirmed: true,
        });
      }
    }
  }

  for (const match of repos.listMatches(applicationId)) {
    if (
      match.status === "likely" ||
      match.status === "needs_confirmation" ||
      match.status === "possible"
    ) {
      repos.updateMatch(match.id, { status: "confirmed", userConfirmed: true });
    }
  }
  for (const req of requirements) {
    if (req.certainty === "uncertain") {
      const certainty = req.category === "portfolio" ? "optional" : "required";
      repos.updateRequirement(req.id, {
        certainty,
        required: certainty === "required",
        userConfirmed: true,
        confidence: 0.95,
      });
    } else if (!req.userConfirmed) {
      repos.updateRequirement(req.id, { userConfirmed: true, confidence: 0.95 });
    }
  }
  const conflicts = repos.listConflicts(applicationId);
  for (const conflict of conflicts) {
    if (!conflict.resolved) {
      repos.resolveConflict(conflict.id, true);
    }
  }
  for (const issue of repos.listIssues(applicationId)) {
    if (
      issue.status === "open" &&
      (issue.code === "MATCH_NEEDS_CONFIRMATION" ||
        issue.code === "MISSING_DOCUMENT" ||
        issue.severity === "needs_confirmation")
    ) {
      if (issue.code === "MISSING_DOCUMENT") {
        const reqId = issue.requirementId;
        const hasMatch =
          reqId &&
          repos
            .listMatches(applicationId)
            .some(
              (m) =>
                m.requirementId === reqId &&
                (m.userConfirmed || m.status === "confirmed" || m.status === "likely"),
            );
        if (!hasMatch) continue;
      }
      repos.updateIssue(issue.id, "resolved");
    }
  }
}

/**
 * Shared demo mutation for reaching `nextStep` from `nextStep - 1`.
 * Does not update demoStep — callers set that after success.
 */
async function applyDemoTransition(
  db: Database.Database,
  applicationId: string,
  nextStep: number,
) {
  const repos = new Repositories(db);

  if (nextStep === 1) {
    await processUploadedDocument(db, {
      applicationId,
      buffer: await buildDemoTranscriptPdf(),
      originalFilename: "Unofficial_Transcript.pdf",
      mimeType: "application/pdf",
      categoryHint: "transcript",
    });
  }

  if (nextStep === 2) {
    await replaceCategoryDoc(db, applicationId, "essay", async (targetId) => {
      await processUploadedDocument(db, {
        applicationId: targetId,
        buffer: await buildDemoEssayPdf(false),
        originalFilename: "Essay_Alex_Chen.pdf",
        mimeType: "application/pdf",
        categoryHint: "essay",
      });
    });
  }

  if (nextStep === 3) {
    await replaceCategoryDoc(db, applicationId, "recommendation", async (targetId) => {
      await processUploadedDocument(db, {
        applicationId: targetId,
        buffer: await buildDemoRecommendationPdf(false),
        originalFilename: "Recommendation_Letter.pdf",
        mimeType: "application/pdf",
        categoryHint: "recommendation",
      });
    });
  }

  if (nextStep === 4) {
    await replaceCategoryDoc(db, applicationId, "resume", async (targetId) => {
      await processUploadedDocument(db, {
        applicationId: targetId,
        buffer: await buildDemoResumePdf(false),
        originalFilename: "Alex_Chen_Resume.pdf",
        mimeType: "application/pdf",
        categoryHint: "resume",
      });
    });
  }

  if (nextStep === 5) {
    await replaceCategoryDoc(db, applicationId, "combined_packet", async (targetId) => {
      const packet = await buildDemoPacketPdf(true);
      await processUploadedDocument(db, {
        applicationId: targetId,
        buffer: packet.buffer,
        originalFilename: packet.filename,
        mimeType: "application/pdf",
        categoryHint: "combined_packet",
      });
    });
  }

  let analysis = analyzeApplication(db, applicationId);

  if (nextStep >= 5) {
    await confirmLikelyMatches(db, applicationId);
    for (const issue of repos.listIssues(applicationId)) {
      if (
        issue.status === "open" &&
        (issue.severity === "warning" ||
          issue.severity === "needs_confirmation" ||
          issue.severity === "suggestion")
      ) {
        repos.updateIssue(issue.id, "resolved");
      }
    }
    const report = computeReadiness({
      applicationId,
      requirements: repos.listRequirements(applicationId),
      matches: repos.listMatches(applicationId),
      issues: repos.listIssues(applicationId),
      conflicts: repos.listConflicts(applicationId),
    });
    repos.updateApplication(applicationId, {
      readinessScore: report.score,
      readinessStatus: report.status,
      lastAnalyzedAt: report.generatedAt,
    });
    analysis = {
      report,
      issues: repos.listIssues(applicationId),
      matches: repos.listMatches(applicationId),
      conflicts: repos.listConflicts(applicationId),
      validations: repos.listValidations(applicationId),
    };
  }

  return analysis;
}

export async function startGuidedDemo(db: Database.Database) {
  const repos = new Repositories(db);

  try {
    cleanupStaleDemoApplications(db);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[applyready] opportunistic demo cleanup failed: ${message}`);
  }

  if (config.publicDemoMode) {
    const ttlMs = Math.max(1, config.publicDemoTtlHours) * 60 * 60 * 1000;
    const cutoffIso = new Date(Date.now() - ttlMs).toISOString();
    const active = repos.countActiveDemoApplications(cutoffIso);
    if (active >= config.publicDemoMaxActiveDemos) {
      throw new AppError(
        "DEMO_CAPACITY_REACHED",
        "The public demo is at capacity. Please try again later.",
        503,
        [
          "Wait a few minutes and try again.",
          "Expired demos are cleaned up automatically; active demos are never deleted to make room.",
        ],
      );
    }
  }

  const app = repos.createApplication({
    name: "Future Engineers Scholarship",
    organization: "Future Engineers Scholarship",
    type: "scholarship",
    deadline: "2026-10-15",
    notes: "Guided demo application packet",
    isDemo: true,
    demoStep: 0,
  });

  try {
    const analysis = await initializeGuidedDemoContents(db, app.id);
    repos.updateApplication(app.id, { demoStep: 0 });
    repos.addActivity(app.id, "demo_started", "Guided demo started");

    return {
      application: repos.getApplication(app.id),
      step: DEMO_STEPS[0],
      analysis,
    };
  } catch (error) {
    try {
      await destroyDemoApplication(db, app.id);
    } catch (cleanupError) {
      const message =
        cleanupError instanceof Error ? cleanupError.message : "unknown error";
      console.error(`[applyready] demo start cleanup failed: ${message}`);
    }
    throw error;
  }
}

export async function advanceGuidedDemo(db: Database.Database, applicationId: string) {
  return withDemoLock(applicationId, () => advanceGuidedDemoUnlocked(db, applicationId));
}

async function advanceGuidedDemoUnlocked(db: Database.Database, applicationId: string) {
  const repos = new Repositories(db);
  const app = repos.getApplication(applicationId);
  if (!app) {
    throw new AppError("NOT_FOUND", "Application not found.", 404, [
      "Start a new guided demo from the landing page.",
    ]);
  }
  if (!app.isDemo) {
    throw new AppError("NOT_DEMO", "Application is not a guided demo.", 400);
  }

  const current = app.demoStep ?? 0;
  if (current >= 6) {
    return {
      application: app,
      step: DEMO_STEPS[6],
      analysis: analyzeApplication(db, applicationId),
      done: true,
    };
  }

  const next = current + 1;
  const analysis = await applyDemoTransition(db, applicationId, next);

  repos.updateApplication(applicationId, { demoStep: next });
  repos.addActivity(
    applicationId,
    "demo_advanced",
    `Demo advanced to step ${next}: ${DEMO_STEPS[next]?.title ?? ""}`,
  );

  return {
    application: repos.getApplication(applicationId),
    step: DEMO_STEPS[next],
    analysis,
    done: next >= 6,
  };
}

async function replaceCategoryDoc(
  db: Database.Database,
  applicationId: string,
  category: string,
  upload: (targetApplicationId: string) => Promise<void>,
) {
  const repos = new Repositories(db);
  const existing = repos
    .listDocuments(applicationId)
    .filter((d) => d.category === category);

  const staging = repos.createApplication({
    name: "Demo document staging",
    organization: "Demo document staging",
    type: "scholarship",
    notes: "Temporary guided-demo replacement staging",
    isDemo: false,
    demoStep: 0,
  });

  let stagedDocs: ReturnType<Repositories["listDocuments"]> = [];
  try {
    await upload(staging.id);
    stagedDocs = repos.listDocuments(staging.id);
    if (stagedDocs.length === 0) {
      throw new Error("Guided demo replacement produced no document");
    }
    if (replaceFailAfter === "before_swap") {
      throw new Error("Injected demo replace failure before swap");
    }

    withTransaction(db, () => {
      for (const doc of existing) {
        repos.deleteDocument(doc.id);
      }
      db.prepare(
        "UPDATE documents SET application_id=? WHERE application_id=?",
      ).run(applicationId, staging.id);
      db.prepare("DELETE FROM activity_events WHERE application_id=?").run(
        staging.id,
      );
      db.prepare("DELETE FROM applicant_profiles WHERE application_id=?").run(
        staging.id,
      );
      db.prepare("DELETE FROM applications WHERE id=?").run(staging.id);
    });
  } catch (error) {
    try {
      if (repos.getApplication(staging.id)) {
        await destroyDemoApplication(db, staging.id);
      } else {
        const liveStored = new Set(
          repos.listDocuments(applicationId).map((d) => d.storedFilename),
        );
        for (const doc of stagedDocs) {
          if (!liveStored.has(doc.storedFilename)) {
            deleteFileQuietly(
              resolveUploadPath("applications", doc.storedFilename),
            );
          }
        }
      }
    } catch (cleanupError) {
      const message =
        cleanupError instanceof Error ? cleanupError.message : "unknown error";
      console.error(
        `[applyready] demo replace staging cleanup failed: ${message}`,
      );
    }
    throw error;
  }

  for (const doc of existing) {
    try {
      deleteFileQuietly(resolveUploadPath("applications", doc.storedFilename));
    } catch (cleanupError) {
      const message =
        cleanupError instanceof Error ? cleanupError.message : "unknown error";
      console.error(
        `[applyready] demo replace old-file cleanup failed: ${message}`,
      );
    }
  }
}

/**
 * Stage-and-swap the live demo to an exact deterministic step state.
 * Used by reset (target 0) and setGuidedDemoStep (rewind / jump to past).
 */
async function materializeGuidedDemoStep(
  db: Database.Database,
  applicationId: string,
  targetStep: number,
  activity: { type: string; message: string },
) {
  const repos = new Repositories(db);
  const app = repos.getApplication(applicationId);
  if (!app) {
    throw new AppError("NOT_FOUND", "Application not found.", 404, [
      "Start a new guided demo from the landing page.",
    ]);
  }
  if (!app.isDemo) {
    throw new AppError("NOT_DEMO", "Application is not a guided demo.", 400);
  }
  if (!Number.isInteger(targetStep) || targetStep < 0 || targetStep > 6) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Demo step must be an integer between 0 and 6.",
      400,
    );
  }

  const previousDocs = repos.listDocuments(applicationId);
  const previousReqCount = repos.listRequirements(applicationId).length;
  const previousDemoStep = app.demoStep;

  const staging = repos.createApplication({
    name: "Future Engineers Scholarship",
    organization: "Future Engineers Scholarship",
    type: "scholarship",
    deadline: "2026-10-15",
    notes: "Guided demo staging (temporary)",
    isDemo: false,
    demoStep: 0,
  });

  let stagingDocs: ReturnType<Repositories["listDocuments"]> = [];
  let stagedAnalysis: ReturnType<typeof analyzeApplication> | null = null;
  try {
    stagedAnalysis = await initializeGuidedDemoContents(db, staging.id);
    for (let step = 1; step <= targetStep; step += 1) {
      stagedAnalysis = await applyDemoTransition(db, staging.id, step);
      if (stepFailAfter === "replay" && step === targetStep) {
        throw new Error("Injected demo step failure during replay");
      }
    }
    stagingDocs = repos.listDocuments(staging.id);
    const stagedApp = repos.getApplication(staging.id)!;
    repos.updateApplication(staging.id, {
      demoStep: targetStep,
      readinessScore: stagedApp.readinessScore,
      readinessStatus: stagedApp.readinessStatus,
      lastAnalyzedAt: stagedApp.lastAnalyzedAt,
    });

    if (resetFailAfter === "before_swap" || stepFailAfter === "before_swap") {
      throw new Error(
        stepFailAfter === "before_swap"
          ? "Injected demo step failure before swap"
          : "Injected demo reset failure before swap",
      );
    }

    const finalStaged = repos.getApplication(staging.id)!;
    withTransaction(db, () => {
      repos.clearApplicationContents(applicationId);
      repos.transferApplicationContents(staging.id, applicationId);
      repos.updateApplication(applicationId, {
        demoStep: targetStep,
        deadline: "2026-10-15",
        notes: "Guided demo application packet",
        name: "Future Engineers Scholarship",
        organization: "Future Engineers Scholarship",
        readinessScore: finalStaged.readinessScore,
        readinessStatus: finalStaged.readinessStatus,
        lastAnalyzedAt: finalStaged.lastAnalyzedAt,
      });
      repos.addActivity(applicationId, activity.type, activity.message);
    });
  } catch (error) {
    try {
      if (repos.getApplication(staging.id)) {
        await destroyDemoApplication(db, staging.id);
      } else {
        const liveStored = new Set(
          repos.listDocuments(applicationId).map((d) => d.storedFilename),
        );
        for (const doc of stagingDocs) {
          if (!liveStored.has(doc.storedFilename)) {
            deleteFileQuietly(
              resolveUploadPath("applications", doc.storedFilename),
            );
          }
        }
      }
    } catch (cleanupError) {
      const message =
        cleanupError instanceof Error ? cleanupError.message : "unknown error";
      console.error(
        `[applyready] demo step staging cleanup failed: ${message}`,
      );
    }

    const still = repos.getApplication(applicationId);
    if (
      !still ||
      repos.listDocuments(applicationId).length !== previousDocs.length ||
      repos.listRequirements(applicationId).length !== previousReqCount
    ) {
      console.error(
        `[applyready] demo step failure left unexpected state for ${applicationId} (step was ${previousDemoStep})`,
      );
    }
    throw error;
  }

  for (const doc of previousDocs) {
    try {
      deleteFileQuietly(resolveUploadPath("applications", doc.storedFilename));
    } catch (cleanupError) {
      const message =
        cleanupError instanceof Error ? cleanupError.message : "unknown error";
      console.error(
        `[applyready] demo step old-file cleanup failed: ${message}`,
      );
    }
  }

  const analysis = {
    report: {
      ...stagedAnalysis!.report,
      applicationId,
    },
    issues: repos.listIssues(applicationId),
    matches: repos.listMatches(applicationId),
    conflicts: repos.listConflicts(applicationId),
    validations: repos.listValidations(applicationId),
  };

  return {
    application: repos.getApplication(applicationId),
    step: DEMO_STEPS[targetStep],
    analysis,
    done: targetStep >= 6,
  };
}

export async function resetGuidedDemo(db: Database.Database, applicationId: string) {
  return withDemoLock(applicationId, () =>
    materializeGuidedDemoStep(db, applicationId, 0, {
      type: "demo_reset",
      message: "Guided demo reset in place",
    }),
  );
}

export async function setGuidedDemoStep(
  db: Database.Database,
  applicationId: string,
  targetStep: number,
) {
  return withDemoLock(applicationId, async () => {
    const repos = new Repositories(db);
    const app = repos.getApplication(applicationId);
    if (!app) {
      throw new AppError("NOT_FOUND", "Application not found.", 404, [
        "Start a new guided demo from the landing page.",
      ]);
    }
    if (!app.isDemo) {
      throw new AppError("NOT_DEMO", "Application is not a guided demo.", 400);
    }
    if (!Number.isInteger(targetStep) || targetStep < 0 || targetStep > 6) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Demo step must be an integer between 0 and 6.",
        400,
      );
    }

    const current = app.demoStep ?? 0;
    if (targetStep === current) {
      const analysis = analyzeApplication(db, applicationId);
      return {
        application: app,
        step: DEMO_STEPS[current],
        analysis,
        done: current >= 6,
      };
    }

    // Forward jumps must still rebuild from scratch so state stays deterministic.
    return materializeGuidedDemoStep(db, applicationId, targetStep, {
      type: "demo_step_set",
      message: `Guided demo moved to step ${targetStep}: ${DEMO_STEPS[targetStep]?.title ?? ""}`,
    });
  });
}

export async function applySuggestedDemoFix(
  db: Database.Database,
  applicationId: string,
) {
  return advanceGuidedDemo(db, applicationId);
}
