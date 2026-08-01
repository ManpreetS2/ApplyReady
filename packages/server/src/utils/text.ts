export function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function countWords(text: string): number {
  const matches = text.trim().match(/\b[\w’'-]+\b/g);
  return matches?.length ?? 0;
}

export function excerpt(text: string, max = 280): string {
  const cleaned = normalizeWhitespace(text);
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

export function nearbyContext(
  fullText: string,
  matchIndex: number,
  matchLength: number,
  radius = 120,
): string {
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(fullText.length, matchIndex + matchLength + radius);
  return excerpt(fullText.slice(start, end), 400);
}

export function includesAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
