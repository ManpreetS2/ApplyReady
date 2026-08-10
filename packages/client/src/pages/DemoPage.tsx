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

type DemoStepState = {
  step: number;
  title: string;
  summary: string;
  nextAction: string | null;
  shortLabel: string;
};

const FALLBACK_STEPS: DemoStepState[] = [
  {
    step: 0,
    title: "Initial packet review",
    summary: "The fictional packet starts with several intentional problems.",
    nextAction: "Add fictional transcript",
    shortLabel: "Review",
  },
  {
    step: 1,
    title: "Transcript added",
    summary:
      "The required fictional transcript is now present. The essay is still too long and references the wrong scholarship.",
    nextAction: "Fix essay length and scholarship reference",
    shortLabel: "Transcript",
  },
  {
    step: 2,
    title: "Essay corrected",
    summary:
      "The essay now meets the word limit and references Future Engineers Scholarship. The recommendation still addresses the wrong organization.",
    nextAction: "Fix recommendation letter",
    shortLabel: "Essay",
  },
  {
    step: 3,
    title: "Recommendation corrected",
    summary:
      "The recommendation now addresses Future Engineers Scholarship. The resume still contains the outdated email.",
    nextAction: "Update resume email",
    shortLabel: "Recommendation",
  },
  {
    step: 4,
    title: "Resume corrected",
    summary:
      "The fictional resume now uses the current email. The combined packet filename still needs correction.",
    nextAction: "Fix combined packet filename",
    shortLabel: "Resume",
  },
  {
    step: 5,
    title: "Packet filename corrected",
    summary:
      "The required files and filename are now corrected. Final matching and readiness confirmation remain.",
    nextAction: "Finalize readiness",
    shortLabel: "Packet",
  },
  {
    step: 6,
    title: "Ready to submit",
    summary: "All required fictional items are verified.",
    nextAction: null,
    shortLabel: "Ready",
  },
];

function applyDemoResponse(
  res: {
    application: Application;
    analysis: { report: ReadinessReport; issues: Issue[] };
    step: DemoStepState;
    done?: boolean;
  },
  setters: {
    setApplication: (a: Application) => void;
    setReport: (r: ReadinessReport) => void;
    setIssues: (i: Issue[]) => void;
    setStep: (s: DemoStepState) => void;
    setDone: (d: boolean) => void;
  },
) {
  rememberDemoId(res.application.id);
  setters.setApplication(res.application);
  setters.setReport(res.analysis.report);
  setters.setIssues(res.analysis.issues);
  setters.setStep(res.step);
  setters.setDone(Boolean(res.done) || res.step.step >= 6);
}

export function DemoPage() {
  const { publicDemoMode } = useConfig();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [restoring, setRestoring] = useState(true);
  const [application, setApplication] = useState<Application | null>(null);
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [step, setStep] = useState<DemoStepState | null>(null);
  const [allSteps, setAllSteps] = useState<DemoStepState[]>(FALLBACK_STEPS);
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
        const steps = stepsRes.steps.length ? stepsRes.steps : FALLBACK_STEPS;
        setAllSteps(steps);
        const demoStep = detail.application.demoStep ?? 0;
        const matched =
          steps.find((item) => item.step === demoStep) || steps[0] || null;
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

  const setters = {
    setApplication,
    setReport,
    setIssues,
    setStep,
    setDone,
  };

  async function start() {
    if (!beginBusy()) return;
    setError(null);
    try {
      const res = await api.startDemo();
      if (res.steps?.length) setAllSteps(res.steps);
      applyDemoResponse(res, setters);
      setDone(false);
    } catch (e) {
      setError(e);
    } finally {
      endBusy();
    }
  }

  async function applyFix() {
    if (!application || done || !beginBusy()) return;
    setError(null);
    try {
      const res = await api.fixDemo(application.id);
      applyDemoResponse(res, setters);
    } catch (e) {
      setError(e);
    } finally {
      endBusy();
    }
  }

  async function goToStep(target: number) {
    if (!application || !beginBusy()) return;
    setError(null);
    try {
      const res = await api.setDemoStep(application.id, target);
      applyDemoResponse(res, setters);
    } catch (e) {
      setError(e);
    } finally {
      endBusy();
    }
  }

  async function resetDemo() {
    if (!application || !beginBusy()) return;
    setError(null);
    try {
      const res = await api.resetDemo(application.id);
      applyDemoResponse(res, setters);
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
      const steps = stepsRes.steps.length ? stepsRes.steps : FALLBACK_STEPS;
      setAllSteps(steps);
      const demoStep = detail.application.demoStep ?? 0;
      const matched =
        steps.find((item) => item.step === demoStep) || steps[0] || null;
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
  const currentStep = step?.step ?? 0;
  const nextAction = step?.nextAction ?? null;

  return (
    <div
      className="space-y-6"
      data-testid="demo-page"
      data-demo-state={application ? "active" : "idle"}
      data-demo-step={application ? String(currentStep) : undefined}
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
          <nav
            aria-label="Guided demo progress"
            data-testid="demo-stepper"
            className="overflow-x-auto"
          >
            <ol className="flex min-w-0 flex-wrap gap-2">
              {allSteps.map((item, index) => {
                const isCurrent = item.step === currentStep;
                const isPast = item.step < currentStep;
                const label = `${index + 1} ${item.shortLabel}`;
                if (isPast) {
                  return (
                    <li key={item.step}>
                      <button
                        type="button"
                        className="rounded-lg border border-accent-500/40 bg-accent-950/30 px-3 py-2 text-sm font-medium text-accent-300 transition hover:bg-accent-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                        disabled={busy}
                        aria-busy={busy}
                        aria-label={`Go to completed step: ${item.title}`}
                        data-testid={`demo-step-${item.step}`}
                        onClick={(event) => {
                          if (busyRef.current) return;
                          event.currentTarget.disabled = true;
                          void goToStep(item.step);
                        }}
                      >
                        {label}
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={item.step}>
                    <span
                      aria-current={isCurrent ? "step" : undefined}
                      data-testid={`demo-step-${item.step}`}
                      className={
                        isCurrent
                          ? "inline-flex rounded-lg border border-accent-400 bg-accent-400 px-3 py-2 text-sm font-semibold text-ink-950"
                          : "inline-flex rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium text-ink-500"
                      }
                    >
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>

          <section className="card space-y-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm uppercase tracking-wide text-ink-500">
                  Step {currentStep + 1} of {allSteps.length}
                </p>
                <h2 className="font-display text-2xl font-semibold">
                  {step?.title || "Demo"}
                </h2>
                <p className="mt-2 break-words text-ink-600 dark:text-ink-300">
                  {step?.summary}
                </p>
                {nextAction ? (
                  <p className="mt-3 text-sm text-ink-300" data-testid="demo-next-action">
                    <span className="font-semibold text-ink-50">Next fix:</span>{" "}
                    {nextAction}
                  </p>
                ) : null}
              </div>
              {report ? (
                <ReadinessBadge status={report.status} score={report.score} />
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {currentStep > 0 ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  aria-busy={busy}
                  data-testid="demo-previous-step"
                  onClick={(event) => {
                    if (busyRef.current) return;
                    event.currentTarget.disabled = true;
                    void goToStep(currentStep - 1);
                  }}
                >
                  Previous step
                </button>
              ) : null}
              {!done ? (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  aria-busy={busy}
                  data-testid="demo-apply-fix"
                  aria-label={
                    nextAction
                      ? `Apply fix: ${nextAction}`
                      : "Apply suggested fix"
                  }
                  onClick={(event) => {
                    if (busyRef.current || done) return;
                    event.currentTarget.disabled = true;
                    void applyFix();
                  }}
                >
                  {nextAction
                    ? `Apply fix: ${nextAction}`
                    : "Apply suggested fix"}
                </button>
              ) : null}
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
                className="btn-danger"
                disabled={busy}
                aria-busy={busy}
                data-testid="demo-reset"
                onClick={() => void resetDemo()}
              >
                Reset demo
              </button>
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
