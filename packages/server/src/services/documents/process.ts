import fs from "node:fs";
import type Database from "better-sqlite3";
import type { RequirementCategory } from "@applyready/shared";
import { Repositories } from "../../db/repositories.js";
import { withTransaction } from "../../db/database.js";
import {
  assertSafeUpload,
  getExtension,
  hashBuffer,
  resolveUploadPath,
  sanitizeOriginalFilename,
} from "../../utils/files.js";
import { AppError } from "../../utils/errors.js";
import { newId } from "../../utils/ids.js";
import { countWords, excerpt } from "../../utils/text.js";
import { HeuristicDocumentClassifier } from "./classify.js";
import { RegexDocumentFactExtractor } from "./facts.js";
import { LocalDocumentReader } from "./readers.js";

export type ParsedDocumentPayload = {
  displayName: string;
  safeName: string;
  mimeType: string;
  fileSize: number;
  text: string;
  pageCount: number | null;
  wordCount: number;
  title: string | null;
  warnings: string[];
  lowText: boolean;
  category: RequirementCategory | null;
  categoryConfidence: number;
  classificationReasons: string[];
  facts: ReturnType<RegexDocumentFactExtractor["extract"]>;
  contentHash: string;
};

/**
 * Parse/classify/extract in memory before any persistence.
 */
export async function parseDocumentInMemory(params: {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  categoryHint?: RequirementCategory | null;
}): Promise<ParsedDocumentPayload> {
  const { extension: _ext, safeName } = assertSafeUpload({
    originalFilename: params.originalFilename,
    mimeType: params.mimeType,
    size: params.buffer.byteLength,
  });
  const displayName = sanitizeOriginalFilename(params.originalFilename);

  if (
    getExtension(displayName) === ".pdf" ||
    params.mimeType === "application/pdf"
  ) {
    const head = params.buffer.subarray(0, 5).toString("utf8");
    if (!head.startsWith("%PDF")) {
      throw new AppError(
        "INVALID_PDF_CONTENT",
        "File extension or MIME type claims PDF, but the contents are not a valid PDF.",
        400,
        [
          "Re-export the document as a real PDF, or upload the original DOCX/TXT/Markdown file.",
        ],
      );
    }
  }

  const reader = new LocalDocumentReader();
  const classifier = new HeuristicDocumentClassifier();
  const facts = new RegexDocumentFactExtractor();

  const readResult = await reader.read(
    params.buffer,
    displayName,
    params.mimeType,
  );
  const classification = classifier.classify(readResult.text, displayName);
  const wordCount = countWords(readResult.text);

  return {
    displayName,
    safeName,
    mimeType: params.mimeType || "application/octet-stream",
    fileSize: params.buffer.byteLength,
    text: readResult.text,
    pageCount: readResult.pageCount,
    wordCount,
    title: readResult.title,
    warnings: readResult.warnings,
    lowText: readResult.lowText,
    category: params.categoryHint ?? classification.category,
    categoryConfidence: params.categoryHint
      ? Math.max(classification.confidence, 0.9)
      : classification.confidence,
    classificationReasons: classification.reasons,
    facts: facts.extract(readResult.text),
    contentHash: hashBuffer(params.buffer),
  };
}

export async function processUploadedDocument(
  db: Database.Database,
  params: {
    applicationId: string | null;
    buffer: Buffer;
    originalFilename: string;
    mimeType: string;
    vaultDocumentId?: string | null;
    categoryHint?: RequirementCategory | null;
  },
) {
  const parsed = await parseDocumentInMemory({
    buffer: params.buffer,
    originalFilename: params.originalFilename,
    mimeType: params.mimeType,
    categoryHint: params.categoryHint,
  });

  const kind = params.applicationId ? "applications" : "vault";
  const target = resolveUploadPath(kind, parsed.safeName);
  const repos = new Repositories(db);
  const id = newId();

  fs.writeFileSync(target, params.buffer);

  try {
    withTransaction(db, () => {
      repos.createDocument({
        id,
        applicationId: params.applicationId,
        vaultDocumentId: params.vaultDocumentId ?? null,
        originalFilename: parsed.displayName,
        storedFilename: parsed.safeName,
        mimeType: parsed.mimeType,
        fileSize: parsed.fileSize,
        pageCount: parsed.pageCount,
        wordCount: parsed.wordCount,
        title: parsed.title,
        category: parsed.category,
        categoryConfidence: parsed.categoryConfidence,
        parseStatus: parsed.lowText ? "low_text" : "parsed",
        parsingWarnings: [
          ...parsed.warnings,
          ...parsed.classificationReasons.slice(0, 2),
        ],
        contentHash: parsed.contentHash,
        text: parsed.text,
      });
      repos.replaceFacts(id, parsed.facts);
      if (params.applicationId) {
        repos.addActivity(
          params.applicationId,
          "document_uploaded",
          `Uploaded ${parsed.displayName}`,
          { documentId: id, category: parsed.category },
        );
      }
    });
  } catch (error) {
    try {
      fs.unlinkSync(target);
    } catch {
      // best-effort cleanup
    }
    throw error;
  }

  return {
    document: repos.getDocument(id)!,
    summary: excerpt(parsed.text, 240),
  };
}

/**
 * Persist a vault document without creating a temporary applications documents row.
 */
export async function processVaultDocument(
  db: Database.Database,
  params: {
    buffer: Buffer;
    originalFilename: string;
    mimeType: string;
    category: RequirementCategory;
    notes?: string | null;
    expirationDate?: string | null;
  },
) {
  const parsed = await parseDocumentInMemory({
    buffer: params.buffer,
    originalFilename: params.originalFilename,
    mimeType: params.mimeType,
    categoryHint: params.category,
  });

  const target = resolveUploadPath("vault", parsed.safeName);
  const repos = new Repositories(db);
  const id = newId();

  fs.writeFileSync(target, params.buffer);

  try {
    const vault = withTransaction(db, () =>
      repos.createVault({
        id,
        originalFilename: parsed.displayName,
        storedFilename: parsed.safeName,
        mimeType: parsed.mimeType,
        fileSize: parsed.fileSize,
        category: params.category,
        version: 1,
        notes: params.notes ?? null,
        expirationDate: params.expirationDate ?? null,
        wordCount: parsed.wordCount,
        pageCount: parsed.pageCount,
        extractedSummary: excerpt(parsed.text, 240),
        parseStatus: parsed.lowText ? "low_text" : "parsed",
      }),
    );
    return { vault, summary: excerpt(parsed.text, 240) };
  } catch (error) {
    try {
      fs.unlinkSync(target);
    } catch {
      // best-effort cleanup
    }
    throw error;
  }
}
