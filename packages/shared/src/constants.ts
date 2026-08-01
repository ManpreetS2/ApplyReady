export const APP_NAME = "ApplyReady";
export const APP_TAGLINE = "Know what’s missing before you press submit.";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_FETCH_BYTES = 5 * 1024 * 1024; // 5 MB
export const FETCH_TIMEOUT_MS = 12_000;

export const ALLOWED_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".markdown",
] as const;

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/octet-stream",
] as const;

export const READINESS_LABELS = {
  ready: "Ready to submit",
  nearly_ready: "Nearly ready",
  needs_attention: "Needs attention",
  not_ready: "Not ready",
  unable_to_determine: "Unable to determine",
} as const;

export const MATCH_LABELS = {
  confirmed: "Confirmed",
  likely: "Likely match",
  possible: "Possible match",
  does_not_match: "Does not match",
  needs_confirmation: "Needs user confirmation",
} as const;

export const ISSUE_LABELS = {
  blocking: "Blocking issue",
  warning: "Warning",
  needs_confirmation: "Needs confirmation",
  suggestion: "Suggestion",
} as const;
