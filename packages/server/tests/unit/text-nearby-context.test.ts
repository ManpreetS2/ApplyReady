import { describe, expect, it } from "vitest";
import { runRequirementPipeline } from "../../src/services/requirements/extractor.js";
import { DEMO_REQUIREMENTS_TEXT } from "../../src/services/demo/content.js";
import {
  nearbyContext,
  normalizeWhitespace,
  snapEndToWordBoundary,
  snapStartToWordBoundary,
} from "../../src/utils/text.js";

describe("nearbyContext word-boundary snippets", () => {
  it("does not truncate the first character of Future Engineers Scholarship evidence", () => {
    const drafts = runRequirementPipeline(DEMO_REQUIREMENTS_TEXT, {
      organization: "Future Engineers Scholarship",
      sourceType: "pasted_text",
      sourceName: "demo",
    });
    const transcript = drafts.find((d) => d.category === "transcript");
    expect(transcript).toBeTruthy();
    expect(transcript!.sourceEvidence.startsWith("uture")).toBe(false);
    expect(transcript!.sourceEvidence).toMatch(/^Future Engineers/);
  });

  it("snaps a generic mid-word window back to the full leading word", () => {
    const text =
      "Alpha preface. Important Guideline Document Applicants must submit materials promptly for review.";
    const needle = "Applicants must submit materials promptly for review.";
    const idx = text.indexOf(needle);
    expect(idx).toBeGreaterThan(0);

    // Choose a radius that lands inside "Important".
    const importantAt = text.indexOf("Important");
    const radius = idx - importantAt - 1;
    expect(text[importantAt + 1]).toBe("m"); // would become "mportant..." without snapping

    const snippet = nearbyContext(text, idx, needle.length, radius);
    expect(snippet.startsWith("mportant")).toBe(false);
    expect(snippet.startsWith("Important")).toBe(true);
    expect(snippet).toContain(needle);
  });

  it("snap helpers preserve exact boundaries at text edges", () => {
    const text = "Future Engineers Scholarship Applicants must submit.";
    expect(snapStartToWordBoundary(text, 0)).toBe(0);
    expect(snapStartToWordBoundary(text, 1)).toBe(0); // mid "Future" → word start
    expect(text.slice(snapStartToWordBoundary(text, 1))).toMatch(/^Future /);

    const mid = text.indexOf("Scholarship") + 3;
    const end = snapEndToWordBoundary(text, mid);
    expect(text.slice(0, end).endsWith("olarship")).toBe(false);
    expect(end).toBe(text.indexOf("Scholarship"));
  });

  it("preserves bounded lengths for long contexts", () => {
    const cleaned = normalizeWhitespace(DEMO_REQUIREMENTS_TEXT);
    const sentence = "An unofficial transcript is required.";
    const idx = cleaned.indexOf(sentence);
    const snippet = nearbyContext(cleaned, idx, sentence.length, 120);
    expect(snippet.length).toBeLessThanOrEqual(400);
    expect(snippet.startsWith("uture")).toBe(false);
    expect(snippet).toMatch(/^Future Engineers/);
  });
});
