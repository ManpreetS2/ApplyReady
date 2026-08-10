import { buildSimplePdf, wrapWords } from "./pdf.js";

export const DEMO_REQUIREMENTS_TEXT = `
Future Engineers Scholarship — Application Requirements

Organization: Future Engineers Scholarship

Applicants must submit the following materials:

1. A resume in PDF format is required.
2. An unofficial transcript is required.
3. An essay between 400 and 500 words is required. The essay must reference the Future Engineers Scholarship and discuss your interest in engineering.
4. One recommendation letter is required. The recommendation letter must be addressed to Future Engineers Scholarship.
5. Submit a combined packet named LastName_FirstName_2026.pdf.
6. Submission deadline: October 15, 2026.

Optional: portfolio samples may be submitted.
`.trim();

export const DEMO_SUGGESTED = {
  scholarshipReference: "Future Engineers Scholarship",
  organization: "Future Engineers Scholarship",
  email: "alex.chen@example.com",
  filename: "Chen_Alex_2026.pdf",
  badScholarshipReference: "Horizon Innovators Scholarship",
  badOrganization: "Horizon Innovators Scholarship",
  badEmail: "alex.old.email@example.com",
  badFilename: "final_packet_submission.pdf",
  transcriptFilename: "Unofficial_Transcript.pdf",
} as const;

const ESSAY_PARAGRAPHS = [
  "I am applying because engineering has shaped how I solve problems and serve my community. From tutoring classmates in physics to building small automation scripts for campus clubs, I have learned that thoughtful design can remove friction for real people. This essay explains why I want to continue that path through the Horizon Innovators Scholarship and how mentorship, coursework, and hands-on projects prepared me for the next step.",
  "Growing up, I treated broken things as puzzles. When our community center sign-up process collapsed under spreadsheets, I helped redesign a simple workflow that reduced wait times. That experience taught me that technical work is never only technical. It is communication, empathy, and iteration. At De Anza College I deepened those lessons through computer science coursework, collaborative labs, and late-night debugging sessions that demanded both rigor and humility.",
  "My academic focus blends software engineering with human-centered thinking. I care about systems that remain understandable under pressure. In group projects I volunteer for the parts nobody wants: clarifying requirements, writing tests, documenting tradeoffs, and checking edge cases before demos. Those habits matter in scholarships and in engineering practice because incomplete work is expensive. The best solutions are the ones people can trust when the deadline is close and the stakes are high.",
  "Outside class I mentor newer students who feel intimidated by their first programming course. I remember that feeling. I try to replace fear with a checklist: understand the problem, write a smaller version, verify with evidence, then expand. That same checklist is how I approach applications. Before I press submit I want to know what is missing, what is uncertain, and what still needs confirmation. Readiness is not perfection. It is honesty about gaps.",
  "If selected, I will use the support to continue building tools that help students navigate complex processes with clarity. I hope to contribute to open learning resources, improve local tutoring systems, and pursue internship experience where I can practice careful engineering with real users. Thank you for considering my application and for investing in students who want to build with integrity.",
];

export function wordCount(text: string): number {
  return (text.trim().match(/\b[\w’'-]+\b/g) || []).length;
}

function padToWordCount(text: string, target: number): string {
  const filler =
    " I remain focused on careful preparation, clear evidence, and honest readiness checks before submission.";
  let out = text.trim();
  while (wordCount(out) < target) {
    out += filler;
  }
  return out;
}

function asOptions<T extends Record<string, unknown>>(
  input: boolean | T | undefined,
  badKey: keyof T,
  defaultBad: boolean,
): T {
  if (typeof input === "boolean") {
    return { [badKey]: input } as T;
  }
  if (input && typeof input === "object") {
    return input;
  }
  return { [badKey]: defaultBad } as T;
}

export type DemoResumeOptions = {
  useBadVersion?: boolean;
  emailOverride?: string;
};

export async function buildDemoResumePdf(
  options: boolean | DemoResumeOptions = true,
): Promise<Buffer> {
  const opts = asOptions<DemoResumeOptions>(options, "useBadVersion", true);
  const useBad = opts.useBadVersion !== false;
  const email =
    opts.emailOverride?.trim() ||
    (useBad ? DEMO_SUGGESTED.badEmail : DEMO_SUGGESTED.email);
  return buildSimplePdf([
    "Alex Chen",
    // Stable labeled contact line so preview can recover literal visitor values
    // even when they are not syntactically valid emails.
    `Email: ${email}`,
    "(408) 555-0142",
    "De Anza College",
    "Major: Computer Science",
    "GPA: 3.75",
    "Expected Graduation: June 2027",
    "",
    "EXPERIENCE",
    "Software Engineering Intern - Campus Labs",
    "Built internal tools and improved documentation for student services.",
    "",
    "EDUCATION",
    "De Anza College - Computer Science",
    "",
    "SKILLS",
    "TypeScript, React, Node.js, SQLite, document processing",
    "",
    "PROJECTS",
    "ApplyReady concept exploration and local-first validation workflows",
  ]);
}

export type DemoEssayOptions = {
  useBadVersion?: boolean;
  scholarshipReferenceOverride?: string;
};

export async function buildDemoEssayPdf(
  options: boolean | DemoEssayOptions = true,
): Promise<Buffer> {
  const opts = asOptions<DemoEssayOptions>(options, "useBadVersion", true);
  const hasOverride = Boolean(opts.scholarshipReferenceOverride?.trim());
  const useBad = opts.useBadVersion !== false && !hasOverride;
  const joined = ESSAY_PARAGRAPHS.join(" ");
  const reference =
    opts.scholarshipReferenceOverride?.trim() ||
    (useBad
      ? DEMO_SUGGESTED.badScholarshipReference
      : DEMO_SUGGESTED.scholarshipReference);
  const withReference = joined.replace(
    /Horizon Innovators Scholarship/g,
    reference,
  );
  const text = useBad
    ? padToWordCount(`${withReference} ${withReference}`, 620)
    : padToWordCount(withReference, 420)
        .split(/\s+/)
        .slice(0, 480)
        .join(" ");
  return buildSimplePdf(["Essay", ...wrapWords(text, 85)]);
}

export type DemoRecommendationOptions = {
  useBadVersion?: boolean;
  organizationOverride?: string;
};

export async function buildDemoRecommendationPdf(
  options: boolean | DemoRecommendationOptions = true,
): Promise<Buffer> {
  const opts = asOptions<DemoRecommendationOptions>(options, "useBadVersion", true);
  const useBad = opts.useBadVersion !== false;
  const org =
    opts.organizationOverride?.trim() ||
    (useBad ? DEMO_SUGGESTED.badOrganization : DEMO_SUGGESTED.organization);
  return buildSimplePdf([
    "Letter of Recommendation",
    `Dear ${org} Committee,`,
    "",
    "I recommend Alex Chen for this opportunity. Alex demonstrates strong engineering judgment,",
    "clear communication, and reliable follow-through on complex coursework and projects.",
    "Alex consistently checks requirements, documents evidence, and helps peers improve.",
    "",
    "Sincerely,",
    "Dr. Morgan Patel",
    "Computer Science Faculty",
  ]);
}

export async function buildDemoTranscriptPdf(): Promise<Buffer> {
  return buildSimplePdf([
    "Unofficial Transcript",
    "Student: Alex Chen",
    "School: De Anza College",
    "Major: Computer Science",
    "GPA: 3.75",
    `Email: ${DEMO_SUGGESTED.email}`,
    "",
    "Course                Grade  Credits",
    "Intro to Programming    A      4",
    "Data Structures         A-     4",
    "Discrete Mathematics    B+     4",
    "Computer Organization   A      4",
  ]);
}

export type DemoPacketOptions = {
  /** When true, use the intentional bad filename (legacy boolean false). */
  useBadVersion?: boolean;
  filenameOverride?: string;
};

export async function buildDemoPacketPdf(
  options: boolean | DemoPacketOptions = false,
): Promise<{
  filename: string;
  buffer: Buffer;
}> {
  let filename: string;
  if (typeof options === "boolean") {
    // Legacy: true = correct name, false = bad name.
    filename = options ? DEMO_SUGGESTED.filename : DEMO_SUGGESTED.badFilename;
  } else {
    filename =
      options.filenameOverride?.trim() ||
      (options.useBadVersion
        ? DEMO_SUGGESTED.badFilename
        : DEMO_SUGGESTED.filename);
  }
  const buffer = await buildSimplePdf([
    "Combined Application Packet",
    "Future Engineers Scholarship",
    "Applicant: Alex Chen",
    "This combined submission packet includes the resume, unofficial transcript,",
    "essay personal statement, and recommendation letter for the application.",
    "Use this single PDF packet for the final scholarship submission checklist.",
  ]);
  return { filename, buffer };
}

export async function buildImageOnlyPdf(): Promise<Buffer> {
  return buildSimplePdf([" ", " ", " "]);
}
