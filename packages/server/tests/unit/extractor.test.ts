import { describe, expect, it } from "vitest";
import { runRequirementPipeline } from "../../src/services/requirements/extractor.js";
import { DEMO_REQUIREMENTS_TEXT } from "../../src/services/demo/content.js";

describe("requirement extraction", () => {
  it("extracts required documents, word limits, filename, and deadline", () => {
    const drafts = runRequirementPipeline(DEMO_REQUIREMENTS_TEXT, {
      organization: "Future Engineers Foundation",
      sourceType: "pasted_text",
      sourceName: "demo",
    });

    const cats = drafts.map((d) => d.category);
    expect(cats).toContain("resume");
    expect(cats).toContain("transcript");
    expect(cats).toContain("essay");
    expect(cats).toContain("recommendation");
    expect(cats).toContain("combined_packet");

    const essay = drafts.find((d) => d.category === "essay");
    expect(essay?.required).toBe(true);
    expect(essay?.wordLimitMinimum).toBe(400);
    expect(essay?.wordLimitMaximum).toBe(500);
    expect(essay?.sourceEvidence.length).toBeGreaterThan(10);

    const packet = drafts.find((d) => d.category === "combined_packet");
    expect(packet?.filenamePattern).toMatch(/LastName_FirstName_2026\.pdf/i);

    const resume = drafts.find((d) => d.category === "resume");
    expect(resume?.acceptedFileExtensions).toContain(".pdf");

    const deadline = drafts.find((d) => d.dateRequirement);
    expect(deadline?.dateRequirement).toMatch(/October 15, 2026/i);
  });

  it("detects optional requirements", () => {
    const drafts = runRequirementPipeline(
      "A portfolio is optional. Applicants may submit work samples.",
      { sourceType: "pasted_text", sourceName: "t" },
    );
    const portfolio = drafts.find((d) => d.category === "portfolio");
    expect(portfolio?.required).toBe(false);
  });

  it("detects recommendation counts", () => {
    const drafts = runRequirementPipeline(
      "Applicants must submit two letters of recommendation.",
      { sourceType: "pasted_text", sourceName: "t" },
    );
    const rec = drafts.find((d) => d.category === "recommendation");
    expect(rec?.minimumCount).toBe(2);
  });

  it("does not invent unsupported categories without evidence", () => {
    const drafts = runRequirementPipeline(
      "Welcome to our homepage. Contact us anytime.",
      { sourceType: "pasted_text", sourceName: "t" },
    );
    expect(drafts.filter((d) => d.category !== "other").length).toBe(0);
  });
});
