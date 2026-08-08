/**
 * Conservative deadline assessment.
 * Does not invent a timezone for date-only values or ambiguous clock times.
 *
 * Exact timestamps with an explicit offset/Z are compared as instants.
 * Date-only values use a worldwide timezone envelope (UTC−12 … UTC+14):
 * - past only when the calendar date has ended in every inhabited offset
 * - future only when the calendar date has not begun in any offset
 * - otherwise today / needs-confirmation (never prematurely expired)
 *
 * Natural-language deadlines with a clock time but without a safely
 * interpretable numeric offset remain ambiguous (named TZ abbreviations
 * are preserved in the original string but not silently converted).
 */

export type DeadlineAssessment =
  | {
      status: "future" | "today" | "past";
      original: string;
      dateOnly: boolean;
      comparable: string;
    }
  | {
      status: "ambiguous";
      original: string;
      reason: string;
    };

/** Latest inhabited offset still used for calendar-day envelopes. */
const MAX_POSITIVE_OFFSET_HOURS = 14;
/** Earliest inhabited offset still used for calendar-day envelopes. */
const MAX_NEGATIVE_OFFSET_HOURS = 12;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function utcDateOnly(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function parseDateOnlyParts(
  year: number,
  month: number,
  day: number,
): string | null {
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const iso = `${year}-${pad2(month)}-${pad2(day)}`;
  const check = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(check.getTime()) || utcDateOnly(check) !== iso) return null;
  return iso;
}

/**
 * Instant when calendar date D first begins somewhere (UTC+14 midnight).
 * D 00:00 in UTC+14 = (D − 1 day) 10:00 UTC.
 */
function dateOnlyEarliestStartUtc(dateOnly: string): Date {
  const start = new Date(`${dateOnly}T00:00:00.000Z`);
  start.setUTCHours(start.getUTCHours() - MAX_POSITIVE_OFFSET_HOURS);
  return start;
}

/**
 * Instant when calendar date D has ended everywhere (UTC−12 end-of-day).
 * End of D in UTC−12 = (D + 1 day) 12:00 UTC.
 */
function dateOnlyLatestEndUtc(dateOnly: string): Date {
  const end = new Date(`${dateOnly}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  end.setUTCHours(MAX_NEGATIVE_OFFSET_HOURS, 0, 0, 0);
  return end;
}

function hasClockTime(original: string): boolean {
  return (
    /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(original) ||
    /\bat\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/i.test(original)
  );
}

function hasNamedTimezoneAbbrev(original: string): boolean {
  return /\b(?:UTC|GMT|PT|PST|PDT|ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|AKST|AKDT|HST|BST|CET|CEST)\b/i.test(
    original,
  );
}

function hasNumericOffsetOrZ(original: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})\s*$/i.test(original.trim());
}

export function assessDeadline(
  raw: string,
  now = new Date(),
): DeadlineAssessment {
  const original = raw.trim();
  if (!original) {
    return { status: "ambiguous", original, reason: "Empty deadline value" };
  }

  // Explicit timezone / offset timestamps — compare exact instant.
  const withTz =
    original.match(
      /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:?\d{2})$/i,
    ) || null;
  if (withTz) {
    const normalized = original.replace(" ", "T");
    const instant = new Date(normalized);
    if (Number.isNaN(instant.getTime())) {
      return {
        status: "ambiguous",
        original,
        reason: "Could not parse timestamp with timezone",
      };
    }
    if (instant.getTime() < now.getTime()) {
      return {
        status: "past",
        original,
        dateOnly: false,
        comparable: instant.toISOString(),
      };
    }
    return {
      status: "future",
      original,
      dateOnly: false,
      comparable: instant.toISOString(),
    };
  }

  // Clock time present without a safely interpretable numeric offset/Z:
  // preserve the full original string and mark ambiguous (do not strip to date-only).
  if (hasClockTime(original) && !hasNumericOffsetOrZ(original)) {
    const reason = hasNamedTimezoneAbbrev(original)
      ? "Deadline includes a clock time with a named timezone abbreviation that is not safely converted to an exact instant"
      : "Deadline includes a clock time without an explicit numeric timezone offset";
    return { status: "ambiguous", original, reason };
  }

  // ISO date-only
  let dateOnly: string | null = null;
  const isoDate = original.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    dateOnly = parseDateOnlyParts(
      Number(isoDate[1]),
      Number(isoDate[2]),
      Number(isoDate[3]),
    );
  }

  // US slash dates
  const slash = original.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!dateOnly && slash) {
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    dateOnly = parseDateOnlyParts(year, Number(slash[1]), Number(slash[2]));
  }

  // Month name dates: October 15, 2026
  const named = original.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!dateOnly && named) {
    const month = MONTHS[named[1]!.toLowerCase()];
    if (month) {
      dateOnly = parseDateOnlyParts(
        Number(named[3]),
        month,
        Number(named[2]),
      );
    }
  }

  if (!dateOnly) {
    return {
      status: "ambiguous",
      original,
      reason: "Malformed or unrecognized deadline format",
    };
  }

  const earliestStart = dateOnlyEarliestStartUtc(dateOnly);
  const latestEnd = dateOnlyLatestEndUtc(dateOnly);

  if (now.getTime() < earliestStart.getTime()) {
    return {
      status: "future",
      original,
      dateOnly: true,
      comparable: dateOnly,
    };
  }
  if (now.getTime() >= latestEnd.getTime()) {
    return {
      status: "past",
      original,
      dateOnly: true,
      comparable: dateOnly,
    };
  }

  // Inside the worldwide envelope for this calendar date — do not assume a cutoff TZ.
  return {
    status: "today",
    original,
    dateOnly: true,
    comparable: dateOnly,
  };
}
