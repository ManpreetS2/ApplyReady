import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  ActivityEvent,
  ApplicantProfile,
  Application,
  DocumentMatch,
  DocumentRecord,
  Issue,
  ProfileConflict,
  ReadinessReport,
  Requirement,
  ValidationResult,
} from "@applyready/shared";
import { api } from "../lib/api";
import { useConfig } from "../lib/config";
import { daysRemaining, formatDate, scoreTone } from "../lib/format";
import { ErrorBanner } from "../components/ErrorBanner";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { IssueBadge, MatchBadge, ReadinessBadge } from "../components/StatusBadge";
import type { VaultDocument } from "@applyready/shared";

type Tab =
  | "overview"
  | "requirements"
  | "documents"
  | "issues"
  | "consistency"
  | "readiness"
  | "activity";

export function ApplicationDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { publicDemoMode } = useConfig();
  const readOnly = publicDemoMode;
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [application, setApplication] = useState<Application | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [matches, setMatches] = useState<DocumentMatch[]>([]);
  const [conflicts, setConflicts] = useState<ProfileConflict[]>([]);
  const [profile, setProfile] = useState<ApplicantProfile | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [validations, setValidations] = useState<ValidationResult[]>([]);
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [vaultDocs, setVaultDocs] = useState<VaultDocument[]>([]);
  const [pendingDeleteApp, setPendingDeleteApp] = useState(false);
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<DocumentRecord | null>(
    null,
  );
  const [profileDraft, setProfileDraft] = useState({
    fullLegalName: "",
    email: "",
    phone: "",
    school: "",
    major: "",
    gpa: "",
    expectedGraduationDate: "",
    targetOrganization: "",
  });

  const load = useCallback(async () => {
    const data = await api.getApplication(id);
    const vault = readOnly
      ? { documents: [] as VaultDocument[] }
      : await api.listVault().catch(() => ({ documents: [] as VaultDocument[] }));
    setApplication(data.application);
    setRequirements(data.requirements);
    setDocuments(data.documents);
    setIssues(data.issues);
    setMatches(data.matches);
    setConflicts(data.conflicts);
    setProfile(data.profile);
    setVaultDocs(vault.documents);
    setActivity(data.activity);
    setValidations(data.validations);
    if (data.profile) {
      setProfileDraft({
        fullLegalName: data.profile.fullLegalName || "",
        email: data.profile.email || "",
        phone: data.profile.phone || "",
        school: data.profile.school || "",
        major: data.profile.major || "",
        gpa: data.profile.gpa || "",
        expectedGraduationDate: data.profile.expectedGraduationDate || "",
        targetOrganization: data.profile.targetOrganization || "",
      });
    }
    if (data.application.readinessScore != null && data.application.readinessStatus) {
      setReport({
        applicationId: id,
        score: data.application.readinessScore,
        status: data.application.readinessStatus,
        breakdown: {
          requiredPresent: 0,
          requiredTotal: data.requirements.filter((r) => r.required).length,
          confirmedMatches: data.matches.filter((m) => m.userConfirmed).length,
          likelyMatches: data.matches.filter((m) => m.status === "likely").length,
          validationPassed: data.validations.filter((v) => v.passed).length,
          validationTotal: data.validations.length,
          blockingIssues: data.issues.filter(
            (i) => i.status === "open" && i.severity === "blocking",
          ).length,
          warnings: data.issues.filter(
            (i) => i.status === "open" && i.severity === "warning",
          ).length,
          uncertainRequirements: data.requirements.filter((r) => !r.userConfirmed).length,
          consistencyConflicts: data.conflicts.filter((c) => !c.resolved).length,
          factors: [],
        },
        generatedAt: data.application.lastAnalyzedAt || new Date().toISOString(),
      });
    }
  }, [id, readOnly]);

  useEffect(() => {
    setBusy(true);
    load()
      .catch(setError)
      .finally(() => setBusy(false));
  }, [load]);

  const openIssues = useMemo(
    () => issues.filter((i) => i.status === "open"),
    [issues],
  );
  const blocking = openIssues.filter((i) => i.severity === "blocking");

  async function analyze() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.analyze(id);
      setReport(res.report);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!application && !error) {
    return <p>Loading application…</p>;
  }

  if (!application) {
    return (
      <div className="space-y-4">
        <ErrorBanner error={error || new Error("Application not found")} />
        {publicDemoMode ? (
          <Link to="/demo" className="btn-primary inline-flex">
            Back to guided demo
          </Link>
        ) : (
          <Link to="/dashboard" className="btn-secondary inline-flex">
            Return to dashboard
          </Link>
        )}
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "requirements", label: "Requirements" },
    { id: "documents", label: "Documents" },
    { id: "issues", label: "Issues" },
    { id: "consistency", label: "Consistency" },
    { id: "readiness", label: "Readiness Report" },
    { id: "activity", label: "Activity" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-ink-500">
            {application.type} · {application.organization}
          </p>
          <h1 className="font-display text-4xl font-semibold">{application.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ReadinessBadge
              status={application.readinessStatus}
              score={application.readinessScore}
            />
            <span className="text-sm text-ink-500">
              Deadline {formatDate(application.deadline)}
              {daysRemaining(application.deadline) != null
                ? ` · ${daysRemaining(application.deadline)} days left`
                : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!readOnly ? (
            <button type="button" className="btn-primary" disabled={busy} onClick={analyze}>
              Reanalyze
            </button>
          ) : (
            <Link to="/demo" className="btn-primary">
              Back to guided demo
            </Link>
          )}
          <Link to={`/applications/${id}/report`} className="btn-secondary">
            Printable report
          </Link>
          {!readOnly ? (
            <button
              type="button"
              className="btn-danger"
              onClick={() => setPendingDeleteApp(true)}
            >
              Delete application
            </button>
          ) : null}
        </div>
      </div>

      <ErrorBanner error={error} />

      <div
        className="no-print flex flex-wrap gap-2"
        role="tablist"
        aria-label="Application sections"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "btn-primary" : "btn-secondary"}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="card p-6">
            <h2 className="font-display text-2xl font-semibold">Readiness</h2>
            <p className={`mt-4 font-display text-6xl font-semibold ${scoreTone(application.readinessScore)}`}>
              {application.readinessScore ?? "—"}
              <span className="text-3xl">%</span>
            </p>
            <p className="mt-2 text-ink-600 dark:text-ink-300">
              {blocking[0]?.title ||
                openIssues[0]?.title ||
                "No open issues. Confirm remaining matches if needed."}
            </p>
            <p className="mt-4 text-sm">
              Next recommended action:{" "}
              <strong>
                {blocking.length
                  ? blocking[0]?.recommendedFix || "Resolve blocking issues"
                  : openIssues.length
                    ? openIssues[0]?.recommendedFix || "Review open warnings"
                    : "Export or print your readiness report"}
              </strong>
            </p>
          </div>
          <div className="card space-y-3 p-6">
            <h2 className="font-display text-2xl font-semibold">Checklist</h2>
            <p>
                      Required requirements:{" "}
                      {requirements.filter(
                        (r) =>
                          r.required &&
                          r.category !== "other" &&
                          r.category !== "proof_of_eligibility" &&
                          r.category !== "proof_of_enrollment",
                      ).length}
            </p>
            <p>Documents uploaded: {documents.length}</p>
            <p>Blocking issues: {blocking.length}</p>
            <p>Warnings: {openIssues.filter((i) => i.severity === "warning").length}</p>
            <p>Last analyzed: {formatDate(application.lastAnalyzedAt)}</p>
          </div>
        </section>
      )}

      {tab === "requirements" && (
        <section className="space-y-4">
          {requirements.map((req) => {
            const match = matches
              .filter((m) => m.requirementId === req.id)
              .sort((a, b) => b.confidence - a.confidence)[0];
            const doc = documents.find((d) => d.id === match?.documentId);
            return (
              <article key={req.id} className="card space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-xl font-semibold">{req.title}</h2>
                    <p className="text-sm text-ink-500">
                      {req.category} · {req.required ? "Required" : "Optional"} ·{" "}
                      {req.userConfirmed ? "Confirmed" : "Needs confirmation"}
                    </p>
                  </div>
                  {match ? (
                    <MatchBadge status={match.status} />
                  ) : req.category === "proof_of_eligibility" ||
                    req.category === "proof_of_enrollment" ? (
                    <span className="status-pill bg-sand-100 text-ink-700 dark:bg-ink-800 dark:text-ink-100">
                      Eligibility check
                    </span>
                  ) : (
                    <span className="status-pill bg-rose-100 text-danger-600">Missing</span>
                  )}
                </div>
                <p className="text-sm">{req.description}</p>
                <div>
                  <p className="label">Source evidence</p>
                  <div className="evidence">{req.sourceEvidence}</div>
                  <p className="mt-1 text-xs text-ink-500">
                    {req.sourceName} {req.sourceLocation ? `· ${req.sourceLocation}` : ""}
                  </p>
                </div>
                {doc ? (
                  <p className="text-sm">
                    Matched document: <strong>{doc.originalFilename}</strong>
                    {match ? ` · ${Math.round(match.confidence * 100)}%` : ""}
                  </p>
                ) : null}
                {match?.evidence?.length ? (
                  <ul className="list-disc pl-5 text-sm text-ink-600 dark:text-ink-300">
                    {match.evidence.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {!readOnly && !req.userConfirmed ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={async () => {
                        await api.confirmRequirement(req.id);
                        await load();
                      }}
                    >
                      Confirm requirement
                    </button>
                  ) : null}
                  {!readOnly && match && !match.userConfirmed ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={async () => {
                        await api.updateMatch(match.id, {
                          status: "confirmed",
                          userConfirmed: true,
                        });
                        await load();
                      }}
                    >
                      Confirm match
                    </button>
                  ) : null}
                  {!readOnly &&
                  req.category !== "proof_of_eligibility" &&
                  req.category !== "proof_of_enrollment" ? (
                  <label className="btn-ghost">
                    Assign document
                    <select
                      className="ml-2 rounded-lg border border-ink-200 bg-transparent px-2 py-1 dark:border-ink-700"
                      defaultValue=""
                      onChange={async (e) => {
                        if (!e.target.value) return;
                        await api.assignDocument(req.id, e.target.value);
                        await load();
                      }}
                    >
                      <option value="" disabled>
                        Choose…
                      </option>
                      {documents.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.originalFilename}
                        </option>
                      ))}
                    </select>
                  </label>
                  ) : req.category === "proof_of_eligibility" ||
                    req.category === "proof_of_enrollment" ? (
                    <p className="text-sm text-ink-500">
                      Validated from profile and document facts—no separate upload required.
                    </p>
                  ) : null}
                </div>              </article>
            );
          })}
        </section>
      )}

      {tab === "documents" && (
        <section className="space-y-4">
          {!readOnly ? (
          <div className="card space-y-4 p-4">
            <label className="label" htmlFor="more-docs">
              Upload more documents
            </label>
            <input
              id="more-docs"
              type="file"
              multiple
              className="input"
              accept=".pdf,.docx,.txt,.md"
              onChange={async (e) => {
                if (!e.target.files) return;
                setBusy(true);
                try {
                  for (const file of Array.from(e.target.files)) {
                    await api.uploadDocument(id, file);
                  }
                  await load();
                } catch (err) {
                  setError(err);
                } finally {
                  setBusy(false);
                  e.target.value = "";
                }
              }}
            />
            {vaultDocs.length > 0 ? (
              <label className="block">
                <span className="label">Attach from document vault</span>
                <select
                  className="input"
                  defaultValue=""
                  aria-label="Attach from document vault"
                  onChange={async (e) => {
                    if (!e.target.value) return;
                    setBusy(true);
                    try {
                      await api.useVault(id, e.target.value);
                      await load();
                    } catch (err) {
                      setError(err);
                    } finally {
                      setBusy(false);
                      e.target.value = "";
                    }
                  }}
                >
                  <option value="" disabled>
                    Choose a vault document…
                  </option>
                  {vaultDocs.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.originalFilename} ({doc.category})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          ) : (
            <p className="card p-4 text-sm text-ink-600 dark:text-ink-300">
              Read-only demo evidence — uploads are disabled in the public portfolio demo.
            </p>
          )}
          {documents.map((doc) => (
            <article key={doc.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-xl font-semibold break-all">
                    {doc.originalFilename}
                  </h2>
                  <p className="text-sm text-ink-500">
                    {doc.category || "uncategorized"} · {doc.parseStatus} ·{" "}
                    {doc.wordCount ?? "—"} words
                    {doc.pageCount != null ? ` · ${doc.pageCount} pages` : ""}
                  </p>
                </div>
                {!readOnly ? (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => setPendingDeleteDoc(doc)}
                >
                  Delete
                </button>
                ) : null}
              </div>
              {doc.parsingWarnings.length ? (
                <ul className="mt-3 list-disc pl-5 text-sm text-warn-600">
                  {doc.parsingWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-3 text-sm">
                Matches:{" "}
                {matches
                  .filter((m) => m.documentId === doc.id)
                  .map((m) => requirements.find((r) => r.id === m.requirementId)?.title)
                  .filter(Boolean)
                  .join(", ") || "None yet"}
              </p>
            </article>
          ))}
        </section>
      )}

      {tab === "issues" && (
        <section className="space-y-4">
          {issues.length === 0 ? (
            <p className="card p-6">No issues yet. Run analysis to generate findings.</p>
          ) : null}
          {issues.map((issue) => (
            <article key={issue.id} className="card space-y-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <IssueBadge severity={issue.severity} />
                <span className="text-xs uppercase tracking-wide text-ink-500">
                  {issue.status}
                </span>
              </div>
              <h2 className="font-display text-xl font-semibold">{issue.title}</h2>
              <p className="text-sm">{issue.explanation}</p>
              {issue.evidence ? <div className="evidence">{issue.evidence}</div> : null}
              {issue.recommendedFix ? (
                <p className="text-sm">
                  <strong>Recommended fix:</strong> {issue.recommendedFix}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {!readOnly && issue.status === "open" ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={async () => {
                      await api.updateIssue(issue.id, "resolved");
                      await load();
                    }}
                  >
                    Mark resolved
                  </button>
                ) : null}
                {!readOnly && issue.status === "open" && issue.dismissible ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={async () => {
                      await api.updateIssue(issue.id, "dismissed");
                      await load();
                    }}
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>            </article>
          ))}
        </section>
      )}

      {tab === "consistency" && (
        <section className="space-y-4">
          <div className="card space-y-3 p-5">
            <h2 className="font-display text-2xl font-semibold">Applicant profile</h2>
            <p className="text-sm text-ink-600 dark:text-ink-300">
              Candidate values are extracted from documents. Confirm them yourself—ApplyReady
              does not silently choose between conflicts.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["fullLegalName", "Full legal name"],
                  ["email", "Email"],
                  ["phone", "Phone"],
                  ["school", "School"],
                  ["major", "Major"],
                  ["gpa", "GPA"],
                  ["expectedGraduationDate", "Expected graduation"],
                  ["targetOrganization", "Target organization"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="label">{label}</span>
                  <input
                    className="input"
                    value={profileDraft[key]}
                    disabled={readOnly}
                    onChange={(e) =>
                      setProfileDraft((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            {!readOnly ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={async () => {
                try {
                  const res = await api.updateProfile(id, profileDraft);
                  setProfile(res.profile);
                } catch (err) {
                  setError(err);
                }
              }}
            >
              Save profile
            </button>
            ) : null}            {profile ? (
              <p className="text-xs text-ink-500">
                Last saved profile values remain local to this application.
              </p>
            ) : null}
          </div>
          {conflicts.map((conflict) => (
            <article key={conflict.id} className="card space-y-3 p-5">
              <h3 className="font-display text-xl font-semibold">
                Conflict: {conflict.field.replaceAll("_", " ")}
              </h3>
              <ul className="space-y-2 text-sm">
                {conflict.values.map((v) => (
                  <li key={`${v.source}-${v.value}`} className="evidence break-words">
                    {v.source}: {v.value}
                  </li>
                ))}
              </ul>
              {!conflict.resolved ? (
                readOnly ? (
                  <p className="text-sm text-ink-500">Open conflict (read-only in public demo).</p>
                ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={async () => {
                      await api.resolveConflict(conflict.id, true);
                      await load();
                    }}
                  >
                    Mark equivalent
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={async () => {
                      await api.resolveConflict(conflict.id, false);
                      await load();
                    }}
                  >
                    Mark as real mismatch
                  </button>
                </div>
                )
              ) : (
                <p className="text-sm">
                  Resolved · {conflict.equivalent ? "treated as equivalent" : "mismatch confirmed"}
                </p>
              )}
            </article>
          ))}
        </section>
      )}

      {tab === "readiness" && (
        <section className="card space-y-4 p-6">
          <h2 className="font-display text-2xl font-semibold">Readiness report</h2>
          <p className={`font-display text-5xl font-semibold ${scoreTone(application.readinessScore)}`}>
            {application.readinessScore ?? "—"}%
          </p>
          <ReadinessBadge
            status={application.readinessStatus}
            score={application.readinessScore}
          />
          {report?.breakdown.factors?.length ? (
            <ul className="space-y-2">
              {report.breakdown.factors.map((f) => (
                <li key={f.label} className="rounded-xl border border-[var(--line)] p-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <strong>{f.label}</strong>
                    <span>
                      {f.score}/{f.weight}
                    </span>
                  </div>
                  <p className="text-ink-600 dark:text-ink-300">{f.note}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-600 dark:text-ink-300">
              Run analysis to refresh the weighted score breakdown.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <p>Validations passed: {validations.filter((v) => v.passed).length}/{validations.length}</p>
            <p>Open blocking issues: {blocking.length}</p>
          </div>
          <Link to={`/applications/${id}/report`} className="btn-secondary">
            Open printable report
          </Link>
        </section>
      )}

      {tab === "activity" && (
        <section className="card p-6">
          <h2 className="font-display text-2xl font-semibold">Activity</h2>
          <ol className="mt-4 space-y-3">
            {activity.map((event) => (
              <li key={event.id} className="border-b border-[var(--line)] pb-3 text-sm">
                <p className="font-medium">{event.message}</p>
                <p className="text-ink-500">{formatDate(event.createdAt)}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <ConfirmDialog
        open={pendingDeleteApp}
        title="Delete application?"
        description="Delete this application and associated local files? This cannot be undone."
        confirmLabel="Delete application"
        danger
        onCancel={() => setPendingDeleteApp(false)}
        onConfirm={async () => {
          await api.deleteApplication(id);
          navigate("/dashboard");
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDeleteDoc)}
        title="Delete document?"
        description={
          pendingDeleteDoc
            ? `Delete ${pendingDeleteDoc.originalFilename}?`
            : null
        }
        confirmLabel="Delete document"
        danger
        onCancel={() => setPendingDeleteDoc(null)}
        onConfirm={async () => {
          if (!pendingDeleteDoc) return;
          await api.deleteDocument(pendingDeleteDoc.id);
          setPendingDeleteDoc(null);
          await load();
        }}
      />
    </div>
  );
}
