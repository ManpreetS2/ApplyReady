/**
 * Conservative deadline assessment.
 * Does not invent timezones. Date-only values compare calendar days only.
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

export function assessDeadline(
  raw: string,
  now = new Date(),
): DeadlineAssessment {
  const original = raw.trim();
  if (!original) {
    return { status: "ambiguous", original, reason: "Empty deadline value" };
  }

  // Explicit timezone / offset timestamps
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
    if (utcDateOnly(instant) === utcDateOnly(now)) {
      // Same UTC calendar day but future clock time → treat as future.
      return {
        status: "future",
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

  const today = utcDateOnly(now);
  if (dateOnly < today) {
    return {
      status: "past",
      original,
      dateOnly: true,
      comparable: dateOnly,
    };
  }
  if (dateOnly === today) {
    // Ambiguous end-of-day semantics — do not prematurely mark expired.
    return {
      status: "today",
      original,
      dateOnly: true,
      comparable: dateOnly,
    };
  }
  return {
    status: "future",
    original,
    dateOnly: true,
    comparable: dateOnly,
  };
}
