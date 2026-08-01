import { useState } from "react";
import { Link } from "react-router-dom";
import type { Application, Issue, ReadinessReport } from "@applyready/shared";
import { api } from "../lib/api";
import { ErrorBanner } from "../components/ErrorBanner";
import { IssueBadge, ReadinessBadge } from "../components/StatusBadge";

export function DemoPage() {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [application, setApplication] = useState<Application | null>(null);
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [step, setStep] = useState<{
    step: number;
    title: string;
    summary: string;
  } | null>(null);
  const [done, setDone] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.startDemo();
      setApplication(res.application);
      setReport(res.analysis.report);
      setIssues(res.analysis.issues);
      setStep(res.step);
      setDone(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function advance(mode: "next" | "fix" | "reset") {
    if (!application) return;
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "reset"
          ? await api.resetDemo(application.id)
          : mode === "fix"
            ? await api.fixDemo(application.id)
            : await api.advanceDemo(application.id);
      setApplication(res.application);
      setReport(res.analysis.report);
      setIssues(res.analysis.issues);
      setStep(res.step);
      setDone(Boolean(res.done) || res.step.step >= 6);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl font-semibold">Guided demo</h1>
        <p className="mt-2 max-w-3xl text-ink-600 dark:text-ink-300">
          Future Engineers Scholarship — a recruiter-friendly walkthrough that uses the real
          extraction, matching, validation, and readiness pipelines.
        </p>
      </div>

      <ErrorBanner error={error} />

      {!application ? (
        <section className="card space-y-4 p-6">
          <h2 className="font-display text-2xl font-semibold">
            Start Future Engineers Scholarship
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-600 dark:text-ink-300">
            <li>Resume with an outdated email</li>
            <li>Essay over 500 words that references another scholarship</li>
            <li>Recommendation addressed to another organization</li>
            <li>Transcript intentionally missing at first</li>
            <li>Incorrectly named combined packet</li>
          </ul>
          <button type="button" className="btn-primary" disabled={busy} onClick={start}>
            Start guided demo
          </button>
        </section>
      ) : (
        <>
          <section className="card space-y-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-wide text-ink-500">
                  Step {(step?.step ?? 0) + 1}
                </p>
                <h2 className="font-display text-2xl font-semibold">
                  {step?.title || "Demo"}
                </h2>
                <p className="mt-2 text-ink-600 dark:text-ink-300">{step?.summary}</p>
              </div>
              {report ? (
                <ReadinessBadge status={report.status} score={report.score} />
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={busy || done}
                onClick={() => advance("fix")}
              >
                Apply suggested fix
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || done}
                onClick={() => advance("next")}
              >
                Next step
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await api.analyze(application.id);
                    setReport(res.report);
                    setIssues(res.issues);
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Reanalyze
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => advance("reset")}
              >
                Reset demo
              </button>
              <Link to={`/applications/${application.id}`} className="btn-ghost">
                View evidence
              </Link>
              <Link to="/dashboard" className="btn-ghost">
                Return to dashboard
              </Link>
            </div>
            {done ? (
              <p className="rounded-xl bg-accent-100 px-4 py-3 text-accent-900 dark:bg-accent-900/40 dark:text-accent-100">
                Ready to submit — all required items verified.
              </p>
            ) : null}
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-2xl font-semibold">Current issues</h2>
            {issues.filter((i) => i.status === "open").length === 0 ? (
              <p className="card p-5">No open issues.</p>
            ) : (
              issues
                .filter((i) => i.status === "open")
                .map((issue) => (
                  <article key={issue.id} className="card space-y-2 p-5">
                    <IssueBadge severity={issue.severity} />
                    <h3 className="font-display text-lg font-semibold">{issue.title}</h3>
                    <p className="text-sm">{issue.explanation}</p>
                    {issue.evidence ? <div className="evidence">{issue.evidence}</div> : null}
                  </article>
                ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
