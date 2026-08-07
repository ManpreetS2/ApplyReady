import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useConfig } from "../lib/config";
import { formatDate, readinessLabel } from "../lib/format";
import { ErrorBanner } from "../components/ErrorBanner";

export function ReportPage() {
  const { id = "" } = useParams();
  const { publicDemoMode } = useConfig();
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.exportApplication(id).then(setReport).catch(setError);
  }, [id]);

  if (!report && !error) return <p>Loading report…</p>;
  if (!report) return <ErrorBanner error={error} />;

  const application = report.application as {
    name: string;
    organization: string;
    deadline: string | null;
  };
  const readiness = report.readiness as {
    status: "ready" | "nearly_ready" | "needs_attention" | "not_ready" | "unable_to_determine";
    score: number;
  };
  const requirements = report.requirements as Array<{
    id: string;
    title: string;
    required: boolean;
    certainty?: "required" | "optional" | "uncertain";
    category: string;
    sourceEvidence: string;
  }>;
  const documents = report.documents as Array<{
    id: string;
    originalFilename: string;
    category: string | null;
  }>;
  const matches = report.matches as Array<{
    requirementId: string;
    documentId: string;
    status: string;
  }>;
  const issues = report.issues as Array<{
    id: string;
    title: string;
    severity: string;
    status: string;
    explanation: string;
    evidence: string | null;
  }>;
  const validations = report.validations as Array<{
    id: string;
    message: string;
    passed: boolean;
    severity: string;
  }>;

  return (
    <div className="space-y-6">
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
        <header>
          <p className="font-display text-3xl font-semibold">ApplyReady</p>
          <h1 className="mt-2 font-display text-4xl font-semibold">
            {application.name}
          </h1>
          <p className="text-ink-600 dark:text-ink-300">{application.organization}</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              <dt className="text-ink-500">Deadline</dt>
              <dd>{formatDate(application.deadline)}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Readiness</dt>
              <dd>
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
                  <p className="font-semibold">
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
                  <p>
                    {isEligibility
                      ? "Checked against applicant profile and extracted document facts (not a separate upload)."
                      : `Match: ${doc?.originalFilename || "None"} ${match ? `(${match.status})` : ""}`}
                  </p>
                  <div className="evidence mt-2">{req.sourceEvidence}</div>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold">Validation results</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {validations.map((v) => (
              <li key={v.id}>
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
                  <p className="font-semibold">
                    {issue.severity}: {issue.title}
                  </p>
                  <p>{issue.explanation}</p>
                  {issue.evidence ? <div className="evidence mt-2">{issue.evidence}</div> : null}
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
