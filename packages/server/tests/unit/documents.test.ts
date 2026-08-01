import { describe, expect, it } from "vitest";
import {
  buildDemoEssayPdf,
  buildDemoResumePdf,
  buildImageOnlyPdf,
  wordCount,
} from "../../src/services/demo/content.js";
import { LocalDocumentReader } from "../../src/services/documents/readers.js";
import { HeuristicDocumentClassifier } from "../../src/services/documents/classify.js";
import { RegexDocumentFactExtractor } from "../../src/services/documents/facts.js";

describe("document processing", () => {
  const reader = new LocalDocumentReader();
  const classifier = new HeuristicDocumentClassifier();
  const facts = new RegexDocumentFactExtractor();

  it("extracts PDF text and classifies a resume", async () => {
    const buffer = await buildDemoResumePdf(true);
    const parsed = await reader.read(buffer, "resume.pdf", "application/pdf");
    expect(parsed.text.toLowerCase()).toContain("alex chen");
    expect(parsed.lowText).toBe(false);
    const classified = classifier.classify(parsed.text, "resume.pdf");
    expect(classified.category).toBe("resume");
    const extracted = facts.extract(parsed.text);
    expect(extracted.some((f) => f.factType === "email")).toBe(true);
  });

  it("counts essay words above limit", async () => {
    const buffer = await buildDemoEssayPdf(true);
    const parsed = await reader.read(buffer, "essay.pdf", "application/pdf");
    expect(wordCount(parsed.text)).toBeGreaterThan(500);
  });

  it("parses plain text", async () => {
    const parsed = await reader.read(
      Buffer.from("Hello world from transcript GPA: 3.5"),
      "notes.txt",
      "text/plain",
    );
    expect(parsed.text).toContain("transcript");
  });

  it("warns on image-only PDF", async () => {
    const parsed = await reader.read(
      await buildImageOnlyPdf(),
      "scan.pdf",
      "application/pdf",
    );
    expect(parsed.lowText).toBe(true);
    expect(
      parsed.warnings.some((w) => /image-only|little or no extractable/i.test(w)),
    ).toBe(true);
  });

  it("classifies recommendation letters", () => {
    const result = classifier.classify(
      "I recommend Alex for this role. Letter of recommendation.",
      "lor.pdf",
    );
    expect(result.category).toBe("recommendation");
  });
});
