import type Database from "better-sqlite3";
import type { SourceType } from "@applyready/shared";
import { Repositories } from "../../db/repositories.js";
import { sanitizeOriginalFilename, assertSafeUpload } from "../../utils/files.js";
import { excerpt } from "../../utils/text.js";
import { AppError } from "../../utils/errors.js";
import { extractHtmlText, LocalDocumentReader } from "../documents/readers.js";
import { fetchPublicResource } from "../urlFetch.js";
import { resolveGithubResource } from "../github.js";
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

  let text = "";
  let sourceType: SourceType = "url";
  let warnings: string[] = [];
  let sourceUrl = url;

  const githubResource = await resolveGithubResource(url);
  if (githubResource) {
    text = githubResource.text;
    sourceUrl = githubResource.url;
  } else {
    const fetched = await fetchPublicResource(url);
    sourceUrl = fetched.url;
    text = fetched.text;

    if (fetched.isPdf) {
      const reader = new LocalDocumentReader();
      const parsed = await reader.read(
        fetched.body,
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
    sourceName: sourceUrl,
    sourceUrl,
    extractedTextPreview: excerpt(text, 400),
  });

  const drafts = runRequirementPipeline(text, {
    applicationName: app.name,
    organization: app.organization,
    sourceType,
    sourceName: sourceUrl,
    sourceUrl,
  });

  const requirements = repos.insertRequirementsFromDrafts(
    applicationId,
    source,
    drafts,
  );
  return { source, requirements, warnings };
}

/**
 * Parse requirement source uploads from memory only.
 * Files are not persisted under uploads/sources (avoids orphaned files).
 */
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

  assertSafeUpload({
    originalFilename,
    mimeType,
    size: buffer.byteLength,
  });

  const reader = new LocalDocumentReader();
  let parsed;
  try {
    parsed = await reader.read(buffer, originalFilename, mimeType);
  } catch (error) {
    // Nothing was written to disk; rethrow cleanly.
    throw error;
  }

  if (!parsed.text || parsed.text.trim().length < 20) {
    throw new AppError(
      "EMPTY_REQUIREMENTS",
      "No usable requirement text could be extracted from the uploaded file.",
      400,
      ["Paste the requirements text, or upload a searchable PDF/DOCX/TXT file."],
      { warnings: parsed.warnings },
    );
  }

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
  });

  const requirements = repos.insertRequirementsFromDrafts(
    applicationId,
    source,
    drafts,
  );
  return { source, requirements, warnings: parsed.warnings };
}
