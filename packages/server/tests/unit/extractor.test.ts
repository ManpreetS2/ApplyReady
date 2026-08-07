import { describe, expect, it } from "vitest";
import { runRequirementPipeline } from "../../src/services/requirements/extractor.js";
import { DEMO_REQUIREMENTS_TEXT } from "../../src/services/demo/content.js";

describe("requirement extraction fidelity", () => {
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
    expect(essay?.certainty).toBe("required");
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

  it("does not invent PDF-only when resume format is unspecified", () => {
    const drafts = runRequirementPipeline(
      "Applicants must submit a resume.",
      { sourceType: "pasted_text", sourceName: "t" },
    );
    const resume = drafts.find((d) => d.category === "resume");
    expect(resume?.certainty).toBe("required");
    expect(resume?.acceptedFileExtensions).toEqual([]);
  });

  it("keeps explicit PDF-only resume formats", () => {
    const drafts = runRequirementPipeline(
      "A resume in PDF format is required.",
      { sourceType: "pasted_text", sourceName: "t" },
    );
    const resume = drafts.find((d) => d.category === "resume");
    expect(resume?.acceptedFileExtensions).toEqual([".pdf"]);
  });

  it("does not imply signatureRequired for recommendations", () => {
    const drafts = runRequirementPipeline(
      "One recommendation letter is required.",
      { sourceType: "pasted_text", sourceName: "t" },
    );
    const rec = drafts.find((d) => d.category === "recommendation");
    expect(rec?.signatureRequired).toBe(false);
  });

  it("sets signatureRequired only with explicit signed wording", () => {
    const drafts = runRequirementPipeline(
      "A signed recommendation letter with signature is required.",
      { sourceType: "pasted_text", sourceName: "t" },
    );
    const rec = drafts.find((d) => d.category === "recommendation");
    expect(rec?.signatureRequired).toBe(true);
  });

  it("marks ambiguous mentions as uncertain, not blocking required", () => {
    const drafts = runRequirementPipeline(
      "Students often include a portfolio with their materials.",
      { sourceType: "pasted_text", sourceName: "t" },
    );
    const portfolio = drafts.find((d) => d.category === "portfolio");
    expect(portfolio?.certainty).toBe("uncertain");
    expect(portfolio?.required).toBe(false);
  });

  it("detects optional requirements", () => {
    const drafts = runRequirementPipeline(
      "A portfolio is optional. Applicants may submit work samples.",
      { sourceType: "pasted_text", sourceName: "t" },
    );
    const portfolio = drafts.find((d) => d.category === "portfolio");
    expect(portfolio?.required).toBe(false);
    expect(portfolio?.certainty).toBe("optional");
  });

  it("keeps two distinct essays as separate requirements", () => {
    const drafts = runRequirementPipeline(
      [
        "Essay question 1: Describe your goals in 300 words. An essay is required.",
        "Essay question 2: Describe a challenge you overcame in 500 words. An essay is required.",
      ].join(" "),
      { sourceType: "pasted_text", sourceName: "t" },
    );
    const essays = drafts.filter((d) => d.category === "essay");
    expect(essays.length).toBeGreaterThanOrEqual(2);
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
