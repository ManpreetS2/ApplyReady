import type Database from "better-sqlite3";
import type { DemoFixPreview } from "@applyready/shared";
import { Repositories } from "../../db/repositories.js";
import { AppError } from "../../utils/errors.js";
import { DEMO_STEPS } from "./steps.js";
import { DEMO_SUGGESTED, wordCount } from "./content.js";

function excerptAround(
  text: string,
  needle: string,
  radius = 48,
): { before: string; value: string; after: string } | null {
  if (!needle) return null;
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return null;
  const value = text.slice(idx, idx + needle.length);
  const before = text.slice(Math.max(0, idx - radius), idx).replace(/\s+/g, " ");
  const after = text
    .slice(idx + needle.length, idx + needle.length + radius)
    .replace(/\s+/g, " ");
  return { before, value, after };
}

function findOrgInRecommendation(text: string): string | null {
  const match = text.match(/Dear\s+(.+?)\s+Committee/i);
  return match?.[1]?.trim() || null;
}

function findScholarshipInEssay(text: string): string | null {
  const contextual = text.match(/through the (.+?) and how mentorship/i);
  if (contextual?.[1]?.trim()) return contextual[1].trim();
  const match = text.match(
    /\b((?:Horizon Innovators|Future Engineers|Bright Tomorrow|Stanford)[^.\n]{0,80}Scholarship)\b/i,
  );
  return match?.[1]?.trim() || null;
}

/** Literal labeled contact value from the fictional resume (may not be a valid email). */
export function findResumeContactValue(text: string): string | null {
  // PDF text extraction may flatten newlines, so take the next token only.
  const labeled = text.match(/Email:\s*(\S+)/i);
  if (labeled?.[1]?.trim()) return labeled[1].trim();
  return null;
}

/** What ApplyReady recognizes as an email address in the resume text. */
export function findExtractedResumeEmail(text: string): string | null {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] || null;
}

export function getDemoFixPreview(
  db: Database.Database,
  applicationId: string,
): DemoFixPreview {
  const repos = new Repositories(db);
  const app = repos.getApplication(applicationId);
  if (!app) {
    throw new AppError("NOT_FOUND", "Application not found.", 404, [
      "Start a new guided demo from the landing page.",
    ]);
  }
  if (!app.isDemo) {
    throw new AppError("NOT_DEMO", "Application is not a guided demo.", 400);
  }

  const step = app.demoStep ?? 0;
  if (step >= 6) {
    throw new AppError(
      "DEMO_ALREADY_READY",
      "This guided demo is already Ready to submit.",
      400,
      ["Use Previous step to revisit an earlier fictional state."],
    );
  }

  const docs = repos.listDocuments(applicationId);
  const requirements = repos.listRequirements(applicationId);
  const stepMeta = DEMO_STEPS[step]!;

  if (step === 0) {
    const transcriptReq = requirements.find((r) => r.category === "transcript");
    return {
      step,
      title: stepMeta.nextAction || "Add fictional transcript",
      explanation:
        "The packet is missing the required unofficial transcript. ApplyReady will add a fictional transcript document.",
      kind: "add_document",
      documentCategory: "transcript",
      field: null,
      currentValue: null,
      extractedValue: null,
      suggestedValue: DEMO_SUGGESTED.transcriptFilename,
      contextBefore: null,
      contextAfter: null,
      editable: false,
      maxLength: null,
      requirementEvidence: transcriptReq
        ? [transcriptReq.sourceEvidence]
        : ["An unofficial transcript is required."],
      detectedEvidence: ["No transcript document is present in the current packet."],
    };
  }

  if (step === 1) {
    const essay = docs.find((d) => d.category === "essay");
    const text = essay ? repos.getDocumentText(essay.id) || "" : "";
    const current =
      findScholarshipInEssay(text) ||
      (essay ? null : DEMO_SUGGESTED.badScholarshipReference);
    const around = current ? excerptAround(text, current) : null;
    const essayReq = requirements.find((r) => r.category === "essay");
    return {
      step,
      title: stepMeta.nextAction || "Fix essay",
      explanation: `Current essay is about ${wordCount(text) || "—"} words and references the wrong scholarship.`,
      kind: "replace_text",
      documentCategory: "essay",
      field: "scholarship_reference",
      currentValue: current,
      extractedValue: current,
      suggestedValue: DEMO_SUGGESTED.scholarshipReference,
      contextBefore: around?.before ?? "…through the ",
      contextAfter: around?.after ?? " and how mentorship…",
      editable: true,
      maxLength: 150,
      requirementEvidence: essayReq
        ? [essayReq.sourceEvidence]
        : [
            "An essay between 400 and 500 words is required. The essay must reference the Future Engineers Scholarship.",
          ],
      detectedEvidence: [
        `Current document scholarship reference: ${current ?? "not found"}`,
        `Detected word count: ${wordCount(text)}`,
      ],
    };
  }

  if (step === 2) {
    const rec = docs.find((d) => d.category === "recommendation");
    const text = rec ? repos.getDocumentText(rec.id) || "" : "";
    const current =
      findOrgInRecommendation(text) ||
      (rec ? null : DEMO_SUGGESTED.badOrganization);
    const around = current ? excerptAround(text, current) : null;
    const recReq = requirements.find((r) => r.category === "recommendation");
    return {
      step,
      title: stepMeta.nextAction || "Fix recommendation letter",
      explanation:
        "The recommendation letter is addressed to the wrong organization.",
      kind: "replace_text",
      documentCategory: "recommendation",
      field: "organization",
      currentValue: current,
      extractedValue: current,
      suggestedValue: DEMO_SUGGESTED.organization,
      contextBefore: around?.before ?? "Dear ",
      contextAfter: around?.after ?? " Committee,",
      editable: true,
      maxLength: 150,
      requirementEvidence: recReq
        ? [recReq.sourceEvidence]
        : [
            "The recommendation letter must be addressed to Future Engineers Scholarship.",
          ],
      detectedEvidence: [`Current document addressee: ${current ?? "not found"}`],
    };
  }

  if (step === 3) {
    const resume = docs.find((d) => d.category === "resume");
    const text = resume ? repos.getDocumentText(resume.id) || "" : "";
    const current =
      findResumeContactValue(text) || (resume ? null : DEMO_SUGGESTED.badEmail);
    const extracted = text ? findExtractedResumeEmail(text) : null;
    const around = current ? excerptAround(text, current) : null;
    const resumeReq = requirements.find((r) => r.category === "resume");
    return {
      step,
      title: stepMeta.nextAction || "Update resume email",
      explanation: "The resume still contains an outdated or inconsistent email address.",
      kind: "replace_text",
      documentCategory: "resume",
      field: "email",
      currentValue: current,
      extractedValue: extracted,
      suggestedValue: DEMO_SUGGESTED.email,
      contextBefore: around?.before ?? "Email: ",
      contextAfter: around?.after ?? "",
      editable: true,
      maxLength: 254,
      requirementEvidence: resumeReq
        ? [resumeReq.sourceEvidence]
        : ["A resume in PDF format is required."],
      detectedEvidence: [
        `Current document contact value: ${current ?? "not found"}`,
        extracted
          ? `ApplyReady extracted email: ${extracted}`
          : "ApplyReady extracted: not recognized as a valid email",
      ],
    };
  }

  if (step === 4) {
    const packet = docs.find((d) => d.category === "combined_packet");
    const current =
      packet?.originalFilename ||
      (packet ? null : DEMO_SUGGESTED.badFilename);
    const packetReq = requirements.find(
      (r) => r.category === "combined_packet" || Boolean(r.filenamePattern),
    );
    return {
      step,
      title: stepMeta.nextAction || "Fix combined packet filename",
      explanation: "The combined packet filename does not match the required pattern.",
      kind: "replace_filename",
      documentCategory: "combined_packet",
      field: "filename",
      currentValue: current,
      extractedValue: current,
      suggestedValue: DEMO_SUGGESTED.filename,
      contextBefore: null,
      contextAfter: null,
      editable: true,
      maxLength: 120,
      requirementEvidence: packetReq
        ? [packetReq.sourceEvidence]
        : ["Submit a combined packet named LastName_FirstName_2026.pdf."],
      detectedEvidence: [`Current document filename: ${current ?? "not found"}`],
    };
  }

  // step === 5 finalize
  return {
    step,
    title: stepMeta.nextAction || "Finalize readiness",
    explanation:
      "Confirm remaining guided-demo document matches, resolve confirmation items, and recompute readiness.",
    kind: "finalize",
    documentCategory: null,
    field: null,
    currentValue: null,
    extractedValue: null,
    suggestedValue: null,
    contextBefore: null,
    contextAfter: null,
    editable: false,
    maxLength: null,
    requirementEvidence: [
      "All required materials should now be present with corrected content.",
    ],
    detectedEvidence: [
      "Final matching and readiness confirmation have not been applied yet.",
    ],
  };
}
