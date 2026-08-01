import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DocumentReadResult, DocumentReader } from "../../providers/interfaces.js";
import { AppError } from "../../utils/errors.js";
import { countWords, normalizeWhitespace } from "../../utils/text.js";
import { getExtension } from "../../utils/files.js";

export class LocalDocumentReader implements DocumentReader {
  async read(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<DocumentReadResult> {
    const ext = getExtension(filename);
    if (ext === ".pdf" || mimeType === "application/pdf") {
      return this.readPdf(buffer);
    }
    if (
      ext === ".docx" ||
      mimeType.includes("wordprocessingml")
    ) {
      return this.readDocx(buffer);
    }
    if (ext === ".txt" || ext === ".md" || ext === ".markdown") {
      return this.readText(buffer, filename);
    }
    throw new AppError(
      "UNSUPPORTED_FORMAT",
      "Unsupported document format.",
      400,
      ["Upload a PDF, DOCX, TXT, or Markdown file."],
    );
  }

  private async readPdf(buffer: Buffer): Promise<DocumentReadResult> {
    try {
      const loadingTask = getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: true,
        isEvalSupported: false,
        disableFontFace: true,
      });
      const pdf = await loadingTask.promise;
      const pages: string[] = [];
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => ("str" in item ? String(item.str) : ""))
          .join(" ");
        pages.push(pageText);
      }
      const pageCount = pdf.numPages;
      const meta = await pdf.getMetadata().catch(() => null);
      const info = (meta?.info ?? {}) as Record<string, unknown>;
      const title = typeof info.Title === "string" ? info.Title : null;
      await pdf.destroy();

      const text = normalizeWhitespace(pages.join("\n"));
      const words = countWords(text);
      const warnings: string[] = [];
      const lowText = words < 20;
      if (lowText) {
        warnings.push(
          "This PDF contains little or no extractable text. It may be an image-only scan. OCR is not included in this version.",
        );
      }

      return {
        text,
        pageCount,
        title,
        warnings,
        lowText,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (/password|encrypt/i.test(message)) {
        throw new AppError(
          "PASSWORD_PROTECTED",
          "Password-protected PDFs are not supported.",
          400,
          ["Remove the password and upload an unlocked PDF."],
        );
      }
      if (/xref|format|invalid|missing/i.test(message)) {
        return {
          text: "",
          pageCount: null,
          title: null,
          warnings: [
            "This PDF contains little or no extractable text. It may be an image-only scan. OCR is not included in this version.",
          ],
          lowText: true,
        };
      }
      throw new AppError(
        "PDF_PARSE_FAILED",
        "Could not extract text from this PDF.",
        400,
        [
          "Try re-exporting the PDF as a searchable text PDF.",
          "Image-only scans are not supported without OCR.",
        ],
        { reason: message },
      );
    }
  }

  private async readDocx(buffer: Buffer): Promise<DocumentReadResult> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      const text = normalizeWhitespace(result.value || "");
      const warnings = (result.messages || []).map((m) => m.message);
      const lowText = countWords(text) < 20;
      if (lowText) {
        warnings.push("DOCX produced little extractable text.");
      }
      return {
        text,
        pageCount: null,
        title: null,
        warnings,
        lowText,
      };
    } catch (error) {
      throw new AppError(
        "DOCX_PARSE_FAILED",
        "Could not extract text from this DOCX file.",
        400,
        ["Re-save the document as DOCX or PDF and try again."],
        { reason: error instanceof Error ? error.message : "unknown" },
      );
    }
  }

  private readText(buffer: Buffer, filename: string): DocumentReadResult {
    const text = normalizeWhitespace(buffer.toString("utf8"));
    const lowText = countWords(text) < 5;
    return {
      text,
      pageCount: null,
      title: filename,
      warnings: lowText ? ["Document contains very little text."] : [],
      lowText,
    };
  }
}

export async function extractHtmlText(html: string): Promise<{
  text: string;
  title: string | null;
}> {
  const { JSDOM } = await import("jsdom");
  const { Readability } = await import("@mozilla/readability");
  const cheerio = await import("cheerio");

  const $ = cheerio.load(html);
  $("script, style, noscript, iframe").remove();
  const cleanedHtml = $.html();

  const dom = new JSDOM(cleanedHtml, { url: "https://example.invalid" });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (article?.textContent && article.textContent.trim().length > 80) {
    return {
      text: normalizeWhitespace(article.textContent),
      title: article.title || null,
    };
  }

  const bodyText = normalizeWhitespace($.root().text());
  return { text: bodyText, title: $("title").first().text() || null };
}
