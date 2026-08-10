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
  let cut = Math.max(1, max - 1);
  // Prefer ending on a word boundary so the trailing glyph is not a partial character/word.
  while (cut > 0 && !/\s/.test(cleaned[cut]!)) {
    cut -= 1;
  }
  if (cut === 0) {
    cut = Math.max(1, max - 1);
  }
  return `${cleaned.slice(0, cut).trimEnd()}…`;
}

/** Move start left to the beginning of a partial leading word. */
export function snapStartToWordBoundary(text: string, index: number): number {
  let start = Math.max(0, Math.min(index, text.length));
  if (start <= 0) return 0;
  // Mid-word: include the full leading word.
  if (!/\s/.test(text[start] ?? " ") && !/\s/.test(text[start - 1] ?? " ")) {
    while (start > 0 && !/\s/.test(text[start - 1]!)) {
      start -= 1;
    }
  }
  // Skip leading whitespace inside the window.
  while (start < text.length && /\s/.test(text[start]!)) {
    start += 1;
  }
  return start;
}

/** Move end left so the window does not finish mid-word. */
export function snapEndToWordBoundary(text: string, index: number): number {
  let end = Math.max(0, Math.min(index, text.length));
  if (end >= text.length) return text.length;
  // Mid-word: retract to the previous boundary so the last character is complete.
  if (end > 0 && !/\s/.test(text[end - 1]!) && !/\s/.test(text[end]!)) {
    while (end > 0 && !/\s/.test(text[end - 1]!)) {
      end -= 1;
    }
  }
  return end;
}

export function nearbyContext(
  fullText: string,
  matchIndex: number,
  matchLength: number,
  radius = 120,
): string {
  const rawStart = Math.max(0, matchIndex - radius);
  const rawEnd = Math.min(fullText.length, matchIndex + matchLength + radius);
  const start = snapStartToWordBoundary(fullText, rawStart);
  // Keep the matched span intact even if end-snapping would retract into it.
  const minEnd = Math.min(fullText.length, matchIndex + matchLength);
  const end = Math.max(minEnd, snapEndToWordBoundary(fullText, rawEnd));
  return excerpt(fullText.slice(start, end), 400);
}

export function includesAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
