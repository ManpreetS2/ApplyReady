import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import type { IssueSeverity, MatchStatus, ReadinessStatus } from "@applyready/shared";
import { issueLabel, matchLabel, readinessLabel } from "../lib/format";

export function ReadinessBadge({
  status,
  score,
}: {
  status: ReadinessStatus | null | undefined;
  score?: number | null;
}) {
  const label = readinessLabel(status);
  const tone =
    status === "ready"
      ? "bg-accent-100 text-accent-800 dark:bg-accent-900/50 dark:text-accent-200"
      : status === "nearly_ready"
        ? "bg-accent-50 text-accent-700 dark:bg-ink-800 dark:text-accent-300"
        : status === "needs_attention"
          ? "bg-amber-100 text-warn-600 dark:bg-amber-950/40 dark:text-amber-200"
          : "bg-rose-100 text-danger-600 dark:bg-rose-950/40 dark:text-rose-200";
  return (
    <span className={`status-pill ${tone}`}>
      {status === "ready" ? (
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
      ) : status === "needs_attention" || status === "not_ready" ? (
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <CircleHelp className="h-3.5 w-3.5" aria-hidden />
      )}
      <span>
        {label}
        {score != null ? ` · ${score}%` : ""}
      </span>
    </span>
  );
}

export function MatchBadge({ status }: { status: MatchStatus }) {
  return (
    <span className="status-pill bg-ink-100 text-ink-800 dark:bg-ink-800 dark:text-ink-100">
      {status === "confirmed" ? (
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <CircleHelp className="h-3.5 w-3.5" aria-hidden />
      )}
      {matchLabel(status)}
    </span>
  );
}

export function IssueBadge({ severity }: { severity: IssueSeverity }) {
  const tone =
    severity === "blocking"
      ? "bg-rose-100 text-danger-600 dark:bg-rose-950/50 dark:text-rose-200"
      : severity === "warning"
        ? "bg-amber-100 text-warn-600 dark:bg-amber-950/40 dark:text-amber-200"
        : severity === "needs_confirmation"
          ? "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
          : "bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-100";
  return (
    <span className={`status-pill ${tone}`}>
      {severity === "blocking" ? (
        <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
      ) : severity === "suggestion" ? (
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
      )}
      {issueLabel(severity)}
    </span>
  );
}
