import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ApplicationExport } from "@applyready/shared";
import { api, ApiClientError } from "../lib/api";
import { useConfig } from "../lib/config";
import { rememberDemoId } from "../lib/demoSession";
import { formatDate, readinessLabel } from "../lib/format";
import { ErrorBanner } from "../components/ErrorBanner";

export function ReportPage() {
  const { id = "" } = useParams();
  const { publicDemoMode } = useConfig();
  const [report, setReport] = useState<ApplicationExport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const payload = await api.exportApplication(id);
    if (publicDemoMode && payload.application.isDemo) {
      rememberDemoId(payload.application.id);
    }
    setReport(payload);
  }, [id, publicDemoMode]);

  useEffect(() => {
    setBusy(true);
    setError(null);
    setReport(null);
    load()
      .catch(setError)
      .finally(() => setBusy(false));
  }, [load]);

  if (!report && !error) {
    return (
      <p role="status" aria-busy="true">
        Loading report…
      </p>
    );
  }

  if (!report) {
    const expired =
      publicDemoMode && error instanceof ApiClientError && error.code === "NOT_FOUND";
    return (
      <div className="space-y-4" data-testid="report-recovery">
        <ErrorBanner error={error} />
        {expired ? (
          <p className="text-sm text-ink-600 dark:text-ink-300" role="status">
            This temporary demo has expired.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {publicDemoMode ? (
            <Link to="/demo" className="btn-primary inline-flex">
              {expired ? "Start a new guided demo" : "Back to guided demo"}
            </Link>
          ) : (
            <Link to="/dashboard" className="btn-secondary inline-flex">
              Return to dashboard
            </Link>
          )}
          {!expired ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              aria-busy={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                load()
                  .catch(setError)
                  .finally(() => setBusy(false));
              }}
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const { application, readiness, requirements, documents, matches, issues, validations } =
    report;

  return (
    <div className="space-y-6" data-testid="report-page">
      <div className="no-print flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            const blob = new Blob([JSON.stringify(report, null, 2)], {
              type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `applyready-report-${id}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export JSON
        </button>
        <Link to={`/applications/${id}`} className="btn-ghost">
          Back to application
        </Link>
        {publicDemoMode ? (
          <Link to="/demo" className="btn-ghost">
            Back to guided demo
          </Link>
        ) : null}
      </div>

      <article className="card space-y-6 p-6 sm:p-8">
        <header className="min-w-0">
          <p className="font-display text-3xl font-semibold">ApplyReady</p>
          <h1 className="mt-2 font-display text-4xl font-semibold break-words">
            {application.name}
          </h1>
          <p className="break-words text-ink-600 dark:text-ink-300">
            {application.organization}
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              <dt className="text-ink-500">Deadline</dt>
              <dd>{formatDate(application.deadline)}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Readiness</dt>
              <dd className="break-words">
                {readinessLabel(readiness.status)} · {readiness.score}%
              </dd>
            </div>
            <div>
              <dt className="text-ink-500">Generated</dt>
              <dd>{formatDate(String(report.generatedAt))}</dd>
            </div>
          </dl>
        </header>

        <section>
          <h2 className="font-display text-2xl font-semibold">Requirements checklist</h2>
          <ul className="mt-3 space-y-3">
            {requirements.map((req) => {
              const match = matches.find((m) => m.requirementId === req.id);
              const doc = documents.find((d) => d.id === match?.documentId);
              const isEligibility =
                req.category === "proof_of_eligibility" ||
                req.category === "proof_of_enrollment";
              return (
                <li key={req.id} className="rounded-xl border border-[var(--line)] p-3 text-sm">
                  <p className="font-semibold break-words">
                    {req.title}{" "}
                    <span className="font-normal text-ink-500">
                      ({req.certainty === "uncertain"
                        ? "uncertain"
                        : req.required
                          ? "required"
                          : "optional"}{" "}
                      · {req.category})
                    </span>
                  </p>
                  <p className="break-words">
                    {isEligibility
                      ? "Checked against applicant profile and extracted document facts (not a separate upload)."
                      : `Match: ${doc?.originalFilename || "None"} ${match ? `(${match.status})` : ""}`}
                  </p>
                  <div className="evidence mt-2 break-words">{req.sourceEvidence}</div>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold">Validation results</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {validations.map((v) => (
              <li key={v.id} className="break-words">
                {v.passed ? "Pass" : "Fail"} · {v.severity}: {v.message}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold">Unresolved issues & warnings</h2>
          <ul className="mt-3 space-y-3">
            {issues
              .filter((i) => i.status === "open")
              .map((issue) => (
                <li key={issue.id} className="rounded-xl border border-[var(--line)] p-3 text-sm">
                  <p className="font-semibold break-words">
                    {issue.severity}: {issue.title}
                  </p>
                  <p className="break-words">{issue.explanation}</p>
                  {issue.evidence ? (
                    <div className="evidence mt-2 break-words">{issue.evidence}</div>
                  ) : null}
                </li>
              ))}
          </ul>
        </section>

        <p className="text-xs text-ink-500">
          This report includes evidence references and metadata only. Full uploaded document
          contents are not included. ApplyReady is not legal or professional advice.
        </p>
      </article>
    </div>
  );
}
