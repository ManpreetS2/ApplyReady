import fs from "node:fs";
import type Database from "better-sqlite3";
import type { SourceType } from "@applyready/shared";
import { Repositories } from "../../db/repositories.js";
import {
  assertSafeUpload,
  resolveUploadPath,
  sanitizeOriginalFilename,
} from "../../utils/files.js";
import { excerpt } from "../../utils/text.js";
import { AppError } from "../../utils/errors.js";
import { extractHtmlText, LocalDocumentReader } from "../documents/readers.js";
import { fetchPublicText } from "../urlFetch.js";
import { runRequirementPipeline } from "./extractor.js";

export async function ingestPastedText(
  db: Database.Database,
  applicationId: string,
  text: string,
  sourceName: string,
) {
  const repos = new Repositories(db);
  const app = repos.getApplication(applicationId);
  if (!app) throw new AppError("NOT_FOUND", "Application not found", 404);

  const source = repos.createSource({
    applicationId,
    sourceType: "pasted_text",
    sourceName,
    extractedTextPreview: excerpt(text, 400),
  });

  const drafts = runRequirementPipeline(text, {
    applicationName: app.name,
    organization: app.organization,
    sourceType: "pasted_text",
    sourceName,
  });

  // Enrich organization expectation on document requirements
  for (const draft of drafts) {
    if (!draft.organizationNameExpected) {
      draft.organizationNameExpected = app.organization;
    }
  }

  const requirements = repos.insertRequirementsFromDrafts(
    applicationId,
    source,
    drafts,
  );
  return { source, requirements, drafts };
}

export async function ingestUrl(
  db: Database.Database,
  applicationId: string,
  url: string,
) {
  const repos = new Repositories(db);
  const app = repos.getApplication(applicationId);
  if (!app) throw new AppError("NOT_FOUND", "Application not found", 404);

  const fetched = await fetchPublicText(url);
  let text = fetched.text;
  let sourceType: SourceType = "url";
  let warnings: string[] = [];

  if (fetched.contentType.includes("pdf")) {
    const reader = new LocalDocumentReader();
    const parsed = await reader.read(
      Buffer.from(fetched.text, "binary"),
      "requirements.pdf",
      "application/pdf",
    );
    text = parsed.text;
    sourceType = "pdf";
    warnings = parsed.warnings;
  } else if (
    fetched.contentType.includes("html") ||
    fetched.text.includes("<html")
  ) {
    const extracted = await extractHtmlText(fetched.text);
    text = extracted.text;
  }

  if (!text || text.trim().length < 20) {
    throw new AppError(
      "EMPTY_REQUIREMENTS",
      "No usable requirement text could be extracted from the URL.",
      400,
      ["Paste the requirements text or upload a PDF/DOCX instead."],
      { warnings },
    );
  }

  const source = repos.createSource({
    applicationId,
    sourceType,
    sourceName: fetched.url,
    sourceUrl: fetched.url,
    extractedTextPreview: excerpt(text, 400),
  });

  const drafts = runRequirementPipeline(text, {
    applicationName: app.name,
    organization: app.organization,
    sourceType,
    sourceName: fetched.url,
    sourceUrl: fetched.url,
  }).map((d) => ({
    ...d,
    organizationNameExpected: d.organizationNameExpected || app.organization,
  }));

  const requirements = repos.insertRequirementsFromDrafts(
    applicationId,
    source,
    drafts,
  );
  return { source, requirements, warnings };
}

export async function ingestUploadedSource(
  db: Database.Database,
  applicationId: string,
  buffer: Buffer,
  originalFilename: string,
  mimeType: string,
) {
  const repos = new Repositories(db);
  const app = repos.getApplication(applicationId);
  if (!app) throw new AppError("NOT_FOUND", "Application not found", 404);

  const { safeName } = assertSafeUpload({
    originalFilename,
    mimeType,
    size: buffer.byteLength,
  });
  const target = resolveUploadPath("sources", safeName);
  fs.writeFileSync(target, buffer);

  const reader = new LocalDocumentReader();
  const parsed = await reader.read(buffer, originalFilename, mimeType);
  const ext = originalFilename.toLowerCase();
  const sourceType: SourceType = ext.endsWith(".pdf")
    ? "pdf"
    : ext.endsWith(".docx")
      ? "docx"
      : ext.endsWith(".md") || ext.endsWith(".markdown")
        ? "markdown"
        : "txt";

  const source = repos.createSource({
    applicationId,
    sourceType,
    sourceName: sanitizeOriginalFilename(originalFilename),
    extractedTextPreview: excerpt(parsed.text, 400),
  });

  const drafts = runRequirementPipeline(parsed.text, {
    applicationName: app.name,
    organization: app.organization,
    sourceType,
    sourceName: originalFilename,
  }).map((d) => ({
    ...d,
    organizationNameExpected: d.organizationNameExpected || app.organization,
  }));

  const requirements = repos.insertRequirementsFromDrafts(
    applicationId,
    source,
    drafts,
  );
  return { source, requirements, warnings: parsed.warnings };
}
