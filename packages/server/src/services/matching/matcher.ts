import type {
  MatchFinding,
  RequirementMatcher,
} from "../../providers/interfaces.js";
import type { Requirement, RequirementCategory } from "@applyready/shared";
import { getExtension } from "../../utils/files.js";
import { includesAny } from "../../utils/text.js";

export class HeuristicRequirementMatcher implements RequirementMatcher {
  match({
    requirement,
    document,
  }: {
    requirement: Requirement;
    document: {
      id: string;
      filename: string;
      category: RequirementCategory | null;
      categoryConfidence: number | null;
      title: string | null;
      wordCount: number | null;
      pageCount: number | null;
      mimeType: string;
      text: string;
      headings: string[];
    };
  }): MatchFinding {
    const evidence: string[] = [];
    let score = 0;

    if (document.category && document.category === requirement.category) {
      score += 0.45 * (document.categoryConfidence ?? 0.7);
      evidence.push(
        `Document category ${document.category} matches requirement category.`,
      );
    } else if (document.category && document.category !== requirement.category) {
      score -= 0.25;
      evidence.push(
        `Document category ${document.category} differs from required ${requirement.category}.`,
      );
    }

    const filename = document.filename.toLowerCase();
    if (filename.includes(requirement.category.replace("_", ""))) {
      score += 0.15;
      evidence.push("Filename contains the requirement category.");
    }
    if (
      requirement.category === "resume" &&
      /resume|cv/.test(filename)
    ) {
      score += 0.2;
      evidence.push("Filename indicates a resume.");
    }
    if (
      requirement.category === "transcript" &&
      /transcript/.test(filename)
    ) {
      score += 0.2;
      evidence.push("Filename indicates a transcript.");
    }
    if (
      requirement.category === "essay" &&
      /essay|statement/.test(filename)
    ) {
      score += 0.2;
      evidence.push("Filename indicates an essay.");
    }
    if (
      requirement.category === "recommendation" &&
      /recommend|reference|lor/.test(filename)
    ) {
      score += 0.2;
      evidence.push("Filename indicates a recommendation letter.");
    }
    if (requirement.category === "combined_packet") {
      if (
        /packet|combined|submission/.test(filename) ||
        /_[0-9]{4}\.pdf$/i.test(document.filename)
      ) {
        score += 0.25;
        evidence.push("Filename suggests a combined packet.");
      }
      if (
        requirement.filenamePattern &&
        /LastName_FirstName_\d{4}\.pdf/i.test(requirement.filenamePattern) &&
        /^[A-Za-z]+_[A-Za-z]+_\d{4}\.pdf$/i.test(document.filename)
      ) {
        score += 0.35;
        evidence.push("Filename matches the required LastName_FirstName_YYYY.pdf pattern.");
      }
      if (/combined application packet|application packet/i.test(document.text)) {
        score += 0.2;
        evidence.push("Document text identifies a combined application packet.");
      }
    }

    if (document.title) {
      const title = document.title.toLowerCase();
      if (title.includes(requirement.category.replace("_", " "))) {
        score += 0.1;
        evidence.push("Document title aligns with the requirement.");
      }
    }

    const ext = getExtension(document.filename);
    if (
      requirement.acceptedFileExtensions.length > 0 &&
      requirement.acceptedFileExtensions.includes(ext)
    ) {
      score += 0.1;
      evidence.push(`File extension ${ext} is accepted.`);
    } else if (requirement.acceptedFileExtensions.length > 0) {
      score -= 0.15;
      evidence.push(
        `File extension ${ext} is not in accepted list (${requirement.acceptedFileExtensions.join(", ")}).`,
      );
    }

    if (requirement.requiredKeywords.length) {
      const hit = includesAny(document.text, requirement.requiredKeywords);
      if (hit) {
        score += 0.1;
        evidence.push("Required keywords found in document.");
      } else {
        score -= 0.1;
        evidence.push("Required keywords not found.");
      }
    }

    if (
      requirement.organizationNameExpected &&
      document.text
        .toLowerCase()
        .includes(requirement.organizationNameExpected.toLowerCase())
    ) {
      score += 0.08;
      evidence.push("Expected organization name found in document.");
    }

    if (
      requirement.wordLimitMinimum != null &&
      document.wordCount != null &&
      document.wordCount >= requirement.wordLimitMinimum
    ) {
      score += 0.05;
    }
    if (
      requirement.wordLimitMaximum != null &&
      document.wordCount != null &&
      document.wordCount <= requirement.wordLimitMaximum
    ) {
      score += 0.05;
    }

    score = Math.max(0, Math.min(0.99, score));

    let status:
      | "confirmed"
      | "likely"
      | "possible"
      | "does_not_match"
      | "needs_confirmation" = "does_not_match";

    if (score >= 0.85 && (document.categoryConfidence ?? 0) >= 0.7) {
      status = "likely";
    } else if (score >= 0.65) {
      status = "likely";
    } else if (score >= 0.45) {
      status = "needs_confirmation";
    } else if (score >= 0.3) {
      status = "possible";
    } else {
      status = "does_not_match";
    }

    // Never auto-confirm low/medium confidence.
    if (status === "likely" && score < 0.9) {
      // keep likely
    }

    return {
      status,
      confidence: score,
      explanation:
        evidence[0] ||
        "Match score computed from category, filename, format, and content signals.",
      evidence,
    };
  }
}
