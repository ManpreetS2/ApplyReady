import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Application, Issue, ReadinessReport } from "@applyready/shared";
import { api, ApiClientError } from "../lib/api";
import { useConfig } from "../lib/config";
import {
  clearDemoIdIfMatches,
  readDemoId,
  rememberDemoId,
} from "../lib/demoSession";
import { ErrorBanner } from "../components/ErrorBanner";
import { IssueBadge, ReadinessBadge } from "../components/StatusBadge";

export function DemoPage() {
  const { publicDemoMode } = useConfig();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
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
        const [detail, stepsRes, exported] = await Promise.all([
          api.getApplication(savedId),
          api.demoSteps(),
          api.exportApplication(savedId).catch(() => null),
        ]);
        if (cancelled) return;
        if (!detail.application.isDemo) {
          clearDemoIdIfMatches(savedId);
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
        setError(null);
        setReport(exported?.readiness ?? null);
      } catch (e) {
        const code =
          e && typeof e === "object" && "code" in e
            ? String((e as { code: string }).code)
            : "";
        // Only forget the session for terminal invalid-session errors.
        if (code === "NOT_FOUND") {
          clearDemoIdIfMatches(savedId);
        } else if (!cancelled) {
          setError(e);
        }
      } finally {
        if (!cancelled) setRestoring(false);
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  function beginBusy(): boolean {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  }

  function endBusy() {
    busyRef.current = false;
    setBusy(false);
  }

  async function start() {
    if (!beginBusy()) return;
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
      endBusy();
    }
  }

  async function advance(mode: "fix" | "reset") {
    if (!application || !beginBusy()) return;
    setError(null);
    try {
      const res =
        mode === "reset"
          ? await api.resetDemo(application.id)
          : await api.fixDemo(application.id);
      rememberDemoId(res.application.id);
      setApplication(res.application);
      setReport(res.analysis.report);
      setIssues(res.analysis.issues);
      setStep(res.step);
      setDone(Boolean(res.done) || res.step.step >= 6);
    } catch (e) {
      setError(e);
    } finally {
      endBusy();
    }
  }

  async function retryRestore() {
    const savedId = readDemoId();
    if (!savedId || !beginBusy()) return;
    setError(null);
    setRestoring(true);
    try {
      const [detail, stepsRes, exported] = await Promise.all([
        api.getApplication(savedId),
        api.demoSteps(),
        api.exportApplication(savedId).catch(() => null),
      ]);
      if (!detail.application.isDemo) {
        clearDemoIdIfMatches(savedId);
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
      setReport(exported?.readiness ?? null);
    } catch (e) {
      const code =
        e && typeof e === "object" && "code" in e
          ? String((e as { code: string }).code)
          : "";
      if (code === "NOT_FOUND") {
        clearDemoIdIfMatches(savedId);
      }
      setError(e);
    } finally {
      endBusy();
      setRestoring(false);
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

  const expired =
    error instanceof ApiClientError && error.code === "NOT_FOUND" && !application;

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
      {expired ? (
        <div className="card space-y-3 p-5">
          <p className="text-sm text-ink-600 dark:text-ink-300">
            This temporary demo has expired.
          </p>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            aria-busy={busy}
            onClick={start}
          >
            Start a new guided demo
          </button>
        </div>
      ) : null}
      {error && !application && readDemoId() && !expired ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void retryRestore()}
        >
          Retry restore
        </button>
      ) : null}
      {busy ? (
        <p className="sr-only" role="status" aria-live="polite">
          Updating guided demo…
        </p>
      ) : null}

      {!application && !expired ? (
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
      ) : null}

      {application ? (
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
                <p className="mt-2 break-words text-ink-600 dark:text-ink-300">
                  {step?.summary}
                </p>
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
                data-testid="demo-apply-fix"
                onClick={(event) => {
                  if (busyRef.current || done) return;
                  const target = event.currentTarget;
                  target.disabled = true;
                  void advance("fix");
                }}
              >
                Apply suggested fix
              </button>
              {!publicDemoMode ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  aria-busy={busy}
                  onClick={async () => {
                    if (!beginBusy()) return;
                    try {
                      const res = await api.analyze(application.id);
                      setReport(res.report);
                      setIssues(res.issues);
                    } catch (e) {
                      setError(e);
                    } finally {
                      endBusy();
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
                onClick={() => void advance("reset")}
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
                    <h3 className="font-display text-lg font-semibold break-words">
                      {issue.title}
                    </h3>
                    <p className="text-sm break-words">{issue.explanation}</p>
                    {issue.evidence ? (
                      <div className="evidence break-words">{issue.evidence}</div>
                    ) : null}
                  </article>
                ))
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
