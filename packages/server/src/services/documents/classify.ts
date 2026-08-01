import type { RequirementCategory } from "@applyready/shared";
import type { DocumentClassifier } from "../../providers/interfaces.js";

const RULES: Array<{
  category: RequirementCategory;
  filename: RegExp;
  content: RegExp;
  weight: number;
}> = [
  {
    category: "resume",
    filename: /resume|cv/i,
    content: /\b(experience|education|skills|projects)\b/i,
    weight: 1,
  },
  {
    category: "transcript",
    filename: /transcript/i,
    content: /\b(transcript|course|gpa|credit hours|semester)\b/i,
    weight: 1,
  },
  {
    category: "essay",
    filename: /essay|statement|personal[_-]?statement/i,
    content: /\b(I believe|my passion|scholarship|personal statement)\b/i,
    weight: 1,
  },
  {
    category: "recommendation",
    filename: /recommend|reference|lor/i,
    content:
      /\b(I recommend|letter of recommendation|to whom it may concern|recommends)\b/i,
    weight: 1,
  },
  {
    category: "portfolio",
    filename: /portfolio/i,
    content: /\b(portfolio|project showcase|selected works)\b/i,
    weight: 1,
  },
  {
    category: "combined_packet",
    filename: /packet|combined|submission/i,
    content: /\b(application packet|combined submission)\b/i,
    weight: 0.8,
  },
  {
    category: "identification",
    filename: /id|passport|license/i,
    content: /\b(date of birth|identification|passport)\b/i,
    weight: 0.7,
  },
];

export class HeuristicDocumentClassifier implements DocumentClassifier {
  classify(text: string, filename: string) {
    let best: {
      category: RequirementCategory;
      confidence: number;
      reasons: string[];
    } = {
      category: "other",
      confidence: 0.2,
      reasons: ["No strong classification signals found"],
    };

    for (const rule of RULES) {
      const reasons: string[] = [];
      let score = 0;
      if (rule.filename.test(filename)) {
        score += 0.45 * rule.weight;
        reasons.push(`Filename suggests ${rule.category}`);
      }
      if (rule.content.test(text)) {
        score += 0.4 * rule.weight;
        reasons.push(`Content patterns suggest ${rule.category}`);
      }
      if (score > best.confidence) {
        best = {
          category: rule.category,
          confidence: Math.min(0.95, score),
          reasons,
        };
      }
    }

    return best;
  }
}

export function extractHeadings(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 2 && line.length < 80)
    .filter((line) => /^[A-Z][A-Za-z0-9 /&-]{2,}$/.test(line))
    .slice(0, 20);
}
