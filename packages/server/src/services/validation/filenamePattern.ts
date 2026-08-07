/**
 * Compile a safe filename template into a RegExp.
 * Supports LastName, FirstName, and {placeholder} tokens.
 * All other characters are treated as literals (regex metacharacters escaped).
 */
export function compileFilenamePattern(
  pattern: string,
): { ok: true; regex: RegExp } | { ok: false; error: string } {
  try {
    let i = 0;
    let body = "";
    while (i < pattern.length) {
      if (pattern.startsWith("LastName", i) || pattern.startsWith("lastname", i)) {
        // Case-insensitive match for the token spelling variants
        const slice = pattern.slice(i, i + 8);
        if (/^lastname$/i.test(slice)) {
          body += "[A-Za-z]+";
          i += 8;
          continue;
        }
      }
      if (pattern.startsWith("FirstName", i) || pattern.startsWith("firstname", i)) {
        const slice = pattern.slice(i, i + 9);
        if (/^firstname$/i.test(slice)) {
          body += "[A-Za-z]+";
          i += 9;
          continue;
        }
      }
      if (pattern[i] === "{") {
        const end = pattern.indexOf("}", i + 1);
        if (end === -1) {
          return { ok: false, error: "Unclosed placeholder brace" };
        }
        body += "[A-Za-z0-9]+";
        i = end + 1;
        continue;
      }
      body += escapeRegexChar(pattern[i]!);
      i += 1;
    }
    return { ok: true, regex: new RegExp(`^${body}$`, "i") };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid filename pattern",
    };
  }
}

function escapeRegexChar(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function conflictFingerprint(
  field: string,
  values: Array<{ value: string }>,
): string {
  const normalized = [
    ...new Set(
      values.map((v) =>
        v.value.trim().toLowerCase().replace(/\s+/g, " "),
      ),
    ),
  ].sort();
  return `${field}::${normalized.join("|")}`;
}
