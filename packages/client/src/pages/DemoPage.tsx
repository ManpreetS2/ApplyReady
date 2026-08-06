import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Application, Issue, ReadinessReport } from "@applyready/shared";
import { api } from "../lib/api";
import { useConfig } from "../lib/config";
import { ErrorBanner } from "../components/ErrorBanner";
import { IssueBadge, ReadinessBadge } from "../components/StatusBadge";

const DEMO_SESSION_KEY = "applyready.publicDemoApplicationId";

function rememberDemoId(id: string | null) {
  try {
    if (!id) sessionStorage.removeItem(DEMO_SESSION_KEY);
    else sessionStorage.setItem(DEMO_SESSION_KEY, id);
  } catch {
    // Private mode / blocked storage — demo still works without refresh restore.
  }
}

function readDemoId(): string | null {
  try {
    return sessionStorage.getItem(DEMO_SESSION_KEY);
  } catch {
    return null;
  }
}

export function DemoPage() {
  const { publicDemoMode } = useConfig();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [application, setApplication] = useState<Application | null>(null);
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [step, setStep] = useState<{
    step: number;
    title: string;
    summary: string;
  } | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      const savedId = readDemoId();
      if (!savedId) {
        if (!cancelled) setRestoring(false);
        return;
      }
      try {
        const [detail, stepsRes] = await Promise.all([
          api.getApplication(savedId),
          api.demoSteps(),
        ]);
        if (cancelled) return;
        if (!detail.application.isDemo) {
          rememberDemoId(null);
          setRestoring(false);
          return;
        }
        const demoStep = detail.application.demoStep ?? 0;
        const matched =
          stepsRes.steps.find((item) => item.step === demoStep) ||
          stepsRes.steps[0] ||
          null;
        setApplication(detail.application);
        setIssues(detail.issues);
        setStep(matched);
        setDone(demoStep >= 6);
        if (
          detail.application.readinessScore != null &&
          detail.application.readinessStatus
        ) {
          setReport({
            applicationId: detail.application.id,
            score: detail.application.readinessScore,
            status: detail.application.readinessStatus,
            breakdown: {
              requiredPresent: 0,
              requiredTotal: detail.requirements.filter((r) => r.required).length,
              confirmedMatches: detail.matches.filter((m) => m.userConfirmed).length,
              likelyMatches: detail.matches.filter((m) => m.status === "likely").length,
              validationPassed: detail.validations.filter((v) => v.passed).length,
              validationTotal: detail.validations.length,
              blockingIssues: detail.issues.filter(
                (i) => i.status === "open" && i.severity === "blocking",
              ).length,
              warnings: detail.issues.filter(
                (i) => i.status === "open" && i.severity === "warning",
              ).length,
              uncertainRequirements: detail.requirements.filter(
                (r) => !r.userConfirmed,
              ).length,
              consistencyConflicts: detail.conflicts.filter((c) => !c.resolved)
                .length,
              factors: [],
            },
            generatedAt:
              detail.application.lastAnalyzedAt || new Date().toISOString(),
          });
        }
      } catch {
        rememberDemoId(null);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.startDemo();
      rememberDemoId(res.application.id);
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
      rememberDemoId(res.application.id);
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

  if (restoring) {
    return (
      <p
        className="text-sm text-ink-600 dark:text-ink-300"
        role="status"
        aria-busy="true"
        data-testid="demo-page"
        data-demo-state="restoring"
      >
        Restoring guided demo…
      </p>
    );
  }

  return (
    <div
      className="space-y-6"
      data-testid="demo-page"
      data-demo-state={application ? "active" : "idle"}
    >
      <div>
        <h1 className="font-display text-4xl font-semibold">Guided demo</h1>
        <p className="mt-2 max-w-3xl text-ink-600 dark:text-ink-300">
          Future Engineers Scholarship — a recruiter-friendly walkthrough that uses the real
          extraction, matching, validation, and readiness pipelines.
          {publicDemoMode
            ? " All documents are fictional and generated for this portfolio demo."
            : ""}
        </p>
      </div>

      <ErrorBanner error={error} />
      {busy ? (
        <p className="sr-only" role="status" aria-live="polite">
          Updating guided demo…
        </p>
      ) : null}

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
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            aria-busy={busy}
            onClick={start}
          >
            Start guided demo
          </button>
        </section>
      ) : (
        <>
          <section className="card space-y-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
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
                aria-busy={busy}
                onClick={() => advance("fix")}
              >
                Apply suggested fix
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || done}
                aria-busy={busy}
                onClick={() => advance("next")}
              >
                Next step
              </button>
              {!publicDemoMode ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  aria-busy={busy}
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
              ) : null}
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                aria-busy={busy}
                onClick={() => advance("reset")}
              >
                Reset demo
              </button>
              <Link to={`/applications/${application.id}`} className="btn-ghost">
                View evidence
              </Link>
              <Link
                to={`/applications/${application.id}/report`}
                className="btn-ghost"
              >
                Open report
              </Link>
              {!publicDemoMode ? (
                <Link to="/dashboard" className="btn-ghost">
                  Return to dashboard
                </Link>
              ) : null}
            </div>
            {done ? (
              <p
                className="rounded-xl bg-accent-100 px-4 py-3 text-accent-900 dark:bg-accent-900/40 dark:text-accent-100"
                role="status"
              >
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
                    {issue.evidence ? (
                      <div className="evidence break-words">{issue.evidence}</div>
                    ) : null}
                  </article>
                ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
