/**
 * Each entry describes the CURRENT application state after reaching that step.
 * `nextAction` describes the mutation Review/Apply fix will perform next.
 */
export const DEMO_STEPS = [
  {
    step: 0,
    title: "Initial packet review",
    summary: "The fictional packet starts with several intentional problems.",
    nextAction: "Add fictional transcript",
    shortLabel: "Review",
  },
  {
    step: 1,
    title: "Transcript added",
    summary:
      "The required fictional transcript is now present. The essay is still too long and references the wrong scholarship.",
    nextAction: "Fix essay length and scholarship reference",
    shortLabel: "Transcript",
  },
  {
    step: 2,
    title: "Essay corrected",
    summary:
      "The essay now meets the word limit and references Future Engineers Scholarship. The recommendation still addresses the wrong organization.",
    nextAction: "Fix recommendation letter",
    shortLabel: "Essay",
  },
  {
    step: 3,
    title: "Recommendation corrected",
    summary:
      "The recommendation now addresses Future Engineers Scholarship. The resume still contains the outdated email.",
    nextAction: "Update resume email",
    shortLabel: "Recommendation",
  },
  {
    step: 4,
    title: "Resume corrected",
    summary:
      "The fictional resume now uses the current email. The combined packet filename still needs correction.",
    nextAction: "Fix combined packet filename",
    shortLabel: "Resume",
  },
  {
    step: 5,
    title: "Packet filename corrected",
    summary:
      "The required files and filename are now corrected. Final matching and readiness confirmation remain.",
    nextAction: "Finalize readiness",
    shortLabel: "Packet",
  },
  {
    step: 6,
    title: "Ready to submit",
    summary: "All required fictional items are verified.",
    nextAction: null,
    shortLabel: "Ready",
  },
] as const;

export type DemoStepInfo = (typeof DEMO_STEPS)[number];
