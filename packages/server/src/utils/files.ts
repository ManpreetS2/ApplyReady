import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES } from "@applyready/shared";
import { config } from "../config.js";
import { AppError } from "./errors.js";

const EXT_MIME: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  ".txt": ["text/plain", "application/octet-stream"],
  ".md": ["text/markdown", "text/x-markdown", "text/plain", "application/octet-stream"],
  ".markdown": [
    "text/markdown",
    "text/x-markdown",
    "text/plain",
    "application/octet-stream",
  ],
};

export function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function sanitizeOriginalFilename(filename: string): string {
  const base = path
    .basename(filename)
    .replace(/\.\./g, "__")
    .replace(/[\\/]/g, "_")
    .replace(/[^\w.\- ()[\]]+/g, "_");
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const maxStem = Math.max(1, 180 - ext.length);
  const truncated = `${stem.slice(0, maxStem)}${ext}`;
  return truncated || "document";
}

export function makeSafeStoredFilename(originalFilename: string): string {
  const ext = getExtension(originalFilename);
  const safeExt = ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])
    ? ext
    : "";
  return `${crypto.randomUUID()}${safeExt}`;
}

export function assertSafeUpload(params: {
  originalFilename: string;
  mimeType: string;
  size: number;
}): { extension: string; safeName: string } {
  const { originalFilename, mimeType, size } = params;
  if (size <= 0) {
    throw new AppError("EMPTY_FILE", "Uploaded file is empty.", 400, [
      "Choose a non-empty document and try again.",
    ]);
  }
  if (size > MAX_UPLOAD_BYTES) {
    throw new AppError(
      "FILE_TOO_LARGE",
      `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB upload limit.`,
      400,
      ["Compress the file or upload a smaller document."],
    );
  }

  const extension = getExtension(originalFilename);
  if (
    !ALLOWED_EXTENSIONS.includes(extension as (typeof ALLOWED_EXTENSIONS)[number])
  ) {
    throw new AppError(
      "UNSUPPORTED_EXTENSION",
      `Unsupported file extension: ${extension || "(none)"}.`,
      400,
      ["Upload a PDF, DOCX, TXT, or Markdown file."],
    );
  }

  const allowedMimes = EXT_MIME[extension] ?? [];
  const normalizedMime = (mimeType || "").toLowerCase();
  if (
    normalizedMime &&
    !allowedMimes.includes(normalizedMime) &&
    normalizedMime !== "application/octet-stream"
  ) {
    throw new AppError(
      "UNSUPPORTED_MIME",
      `MIME type ${mimeType} does not match extension ${extension}.`,
      400,
      ["Re-export the file in a supported format and try again."],
    );
  }

  // Path-like names are sanitized rather than rejected so uploads cannot escape
  // the upload directory while still accepting awkward real-world filenames.
  const sanitized = sanitizeOriginalFilename(originalFilename);
  const sanitizedExt = getExtension(sanitized);
  if (
    !ALLOWED_EXTENSIONS.includes(
      sanitizedExt as (typeof ALLOWED_EXTENSIONS)[number],
    )
  ) {
    throw new AppError(
      "UNSUPPORTED_EXTENSION",
      `Unsupported file extension: ${sanitizedExt || "(none)"}.`,
      400,
      ["Upload a PDF, DOCX, TXT, or Markdown file."],
    );
  }

  return {
    extension: sanitizedExt,
    safeName: makeSafeStoredFilename(sanitized),
  };
}

export function resolveUploadPath(
  kind: "applications" | "vault" | "sources",
  storedFilename: string,
): string {
  const base = path.resolve(config.uploadsDir, kind);
  const full = path.resolve(base, storedFilename);
  if (!full.startsWith(base + path.sep) && full !== base) {
    throw new AppError(
      "PATH_TRAVERSAL",
      "Invalid storage path.",
      400,
      ["Retry the upload with a normal filename."],
    );
  }
  return full;
}

export function deleteFileQuietly(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

export function hashBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function readStoredFile(
  kind: "applications" | "vault" | "sources",
  storedFilename: string,
): Buffer {
  const filePath = resolveUploadPath(kind, storedFilename);
  if (!fs.existsSync(filePath)) {
    throw new AppError(
      "FILE_MISSING",
      "Stored file could not be found on disk.",
      404,
      ["Re-upload the document or restore it from your vault."],
    );
  }
  return fs.readFileSync(filePath);
}
