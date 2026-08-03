import { ISSUE_LABELS, MATCH_LABELS, READINESS_LABELS } from "@applyready/shared";
import type { IssueSeverity, MatchStatus, ReadinessStatus } from "@applyready/shared";

export function readinessLabel(status: ReadinessStatus | null | undefined): string {
  if (!status) return "Not analyzed";
  return READINESS_LABELS[status];
}

export function matchLabel(status: MatchStatus): string {
  return MATCH_LABELS[status];
}

export function issueLabel(severity: IssueSeverity): string {
  return ISSUE_LABELS[severity];
}

export function daysRemaining(deadline: string | null): number | null {
  if (!deadline) return null;
  const end = new Date(`${deadline}T23:59:59`);
  if (Number.isNaN(end.getTime())) return null;
  const diff = end.getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  // Date-only values (YYYY-MM-DD) must be treated as local calendar dates.
  // `new Date('YYYY-MM-DD')` is UTC midnight and shifts a day backward in western timezones.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]) - 1;
    const day = Number(dateOnly[3]);
    const local = new Date(year, month, day);
    return local.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function scoreTone(score: number | null | undefined): string {
  if (score == null) return "text-ink-500";
  if (score >= 90) return "text-accent-700 dark:text-accent-300";
  if (score >= 75) return "text-accent-600";
  if (score >= 55) return "text-warn-600";
  return "text-danger-600";
}
