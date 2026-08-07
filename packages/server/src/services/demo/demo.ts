import type Database from "better-sqlite3";
import { config } from "../../config.js";
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

export const DEMO_STEPS = [
  {
    step: 0,
    title: "Initial packet review",
    summary:
      "The demo starts Not ready: transcript missing, essay too long, wrong organization references, outdated email, and incorrect packet filename.",
  },
  {
    step: 1,
    title: "Add unofficial transcript",
    summary: "Upload the missing transcript and reanalyze.",
  },
  {
    step: 2,
    title: "Fix essay length and organization reference",
    summary: "Replace the essay with a 400–500 word version for Future Engineers Scholarship.",
  },
  {
    step: 3,
    title: "Fix recommendation letter",
    summary: "Replace the recommendation so it addresses Future Engineers Scholarship.",
  },
  {
    step: 4,
    title: "Update resume email",
    summary: "Replace the resume that still uses an outdated email address.",
  },
  {
    step: 5,
    title: "Rename combined packet",
    summary: "Upload a correctly named Chen_Alex_2026.pdf packet and confirm matches.",
  },
  {
    step: 6,
    title: "Ready to submit",
    summary: "All required items verified. Ready to submit.",
  },
] as const;

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
    if (!req.userConfirmed) {
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
      // Only resolve missing-document after a matching document exists.
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

export async function startGuidedDemo(db: Database.Database) {
  const repos = new Repositories(db);

  // Opportunistic cleanup of expired demos only — never delete active visitor demos.
  try {
    cleanupStaleDemoApplications(db);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[applyready] opportunistic demo cleanup failed: ${message}`);
  }

  // Public-demo capacity ceiling (local mode is unaffected).
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

  await ingestPastedText(
    db,
    app.id,
    DEMO_REQUIREMENTS_TEXT,
    "Future Engineers Scholarship Requirements",
  );

  // Confirm extracted requirements for a clean demo path
  for (const req of repos.listRequirements(app.id)) {
    repos.updateRequirement(req.id, { userConfirmed: true });
  }

  await seedInitialDemoDocs(db, app.id);
  const analysis = analyzeApplication(db, app.id);
  repos.updateApplication(app.id, { demoStep: 0 });
  repos.addActivity(app.id, "demo_started", "Guided demo started");

  return {
    application: repos.getApplication(app.id),
    step: DEMO_STEPS[0],
    analysis,
  };
}

export async function advanceGuidedDemo(db: Database.Database, applicationId: string) {
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

  if (next === 1) {
    await processUploadedDocument(db, {
      applicationId,
      buffer: await buildDemoTranscriptPdf(),
      originalFilename: "Unofficial_Transcript.pdf",
      mimeType: "application/pdf",
      categoryHint: "transcript",
    });
  }

  if (next === 2) {
    await replaceCategoryDoc(db, applicationId, "essay", async () => {
      await processUploadedDocument(db, {
        applicationId,
        buffer: await buildDemoEssayPdf(false),
        originalFilename: "Essay_Alex_Chen.pdf",
        mimeType: "application/pdf",
        categoryHint: "essay",
      });
    });
  }

  if (next === 3) {
    await replaceCategoryDoc(db, applicationId, "recommendation", async () => {
      await processUploadedDocument(db, {
        applicationId,
        buffer: await buildDemoRecommendationPdf(false),
        originalFilename: "Recommendation_Letter.pdf",
        mimeType: "application/pdf",
        categoryHint: "recommendation",
      });
    });
  }

  if (next === 4) {
    await replaceCategoryDoc(db, applicationId, "resume", async () => {
      await processUploadedDocument(db, {
        applicationId,
        buffer: await buildDemoResumePdf(false),
        originalFilename: "Alex_Chen_Resume.pdf",
        mimeType: "application/pdf",
        categoryHint: "resume",
      });
    });
  }

  if (next === 5) {
    await replaceCategoryDoc(db, applicationId, "combined_packet", async () => {
      const packet = await buildDemoPacketPdf(true);
      await processUploadedDocument(db, {
        applicationId,
        buffer: packet.buffer,
        originalFilename: packet.filename,
        mimeType: "application/pdf",
        categoryHint: "combined_packet",
      });
    });
  }

  let analysis = analyzeApplication(db, applicationId);

  if (next >= 5) {
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
  upload: () => Promise<void>,
) {
  const repos = new Repositories(db);
  const existing = repos
    .listDocuments(applicationId)
    .filter((d) => d.category === category);
  for (const doc of existing) {
    repos.deleteDocument(doc.id);
    deleteFileQuietly(resolveUploadPath("applications", doc.storedFilename));
  }
  await upload();
}

export async function resetGuidedDemo(db: Database.Database, applicationId: string) {
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
  const docs = repos.deleteApplication(applicationId);
  for (const doc of docs) {
    deleteFileQuietly(resolveUploadPath("applications", doc.storedFilename));
  }
  return startGuidedDemo(db);
}

export async function applySuggestedDemoFix(
  db: Database.Database,
  applicationId: string,
) {
  return advanceGuidedDemo(db, applicationId);
}
