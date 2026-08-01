import fs from "node:fs";
import type Database from "better-sqlite3";
import type { RequirementCategory } from "@applyready/shared";
import { Repositories } from "../../db/repositories.js";
import {
  assertSafeUpload,
  hashBuffer,
  resolveUploadPath,
  sanitizeOriginalFilename,
} from "../../utils/files.js";
import { newId } from "../../utils/ids.js";
import { countWords, excerpt } from "../../utils/text.js";
import { HeuristicDocumentClassifier } from "./classify.js";
import { RegexDocumentFactExtractor } from "./facts.js";
import { LocalDocumentReader } from "./readers.js";

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
  const repos = new Repositories(db);
  const { extension: _ext, safeName } = assertSafeUpload({
    originalFilename: params.originalFilename,
    mimeType: params.mimeType,
    size: params.buffer.byteLength,
  });

  const kind = params.applicationId ? "applications" : "vault";
  const target = resolveUploadPath(kind, safeName);
  fs.writeFileSync(target, params.buffer);

  const reader = new LocalDocumentReader();
  const classifier = new HeuristicDocumentClassifier();
  const facts = new RegexDocumentFactExtractor();

  let readResult;
  try {
    readResult = await reader.read(
      params.buffer,
      params.originalFilename,
      params.mimeType,
    );
  } catch (error) {
    fs.unlinkSync(target);
    throw error;
  }

  const classification = classifier.classify(
    readResult.text,
    params.originalFilename,
  );
  const wordCount = countWords(readResult.text);
  const id = newId();

  const doc = repos.createDocument({
    id,
    applicationId: params.applicationId,
    vaultDocumentId: params.vaultDocumentId ?? null,
    originalFilename: sanitizeOriginalFilename(params.originalFilename),
    storedFilename: safeName,
    mimeType: params.mimeType || "application/octet-stream",
    fileSize: params.buffer.byteLength,
    pageCount: readResult.pageCount,
    wordCount,
    title: readResult.title,
    category: params.categoryHint ?? classification.category,
    categoryConfidence: params.categoryHint
      ? Math.max(classification.confidence, 0.9)
      : classification.confidence,
    parseStatus: readResult.lowText ? "low_text" : "parsed",
    parsingWarnings: [
      ...readResult.warnings,
      ...classification.reasons.slice(0, 2),
    ],
    contentHash: hashBuffer(params.buffer),
    text: readResult.text,
  });

  repos.replaceFacts(id, facts.extract(readResult.text));
  if (params.applicationId) {
    repos.addActivity(
      params.applicationId,
      "document_uploaded",
      `Uploaded ${doc.originalFilename}`,
      { documentId: id, category: doc.category },
    );
  }

  return {
    document: doc,
    summary: excerpt(readResult.text, 240),
  };
}
