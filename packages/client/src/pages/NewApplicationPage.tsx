import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  DocumentRecord,
  Requirement,
  VaultDocument,
} from "@applyready/shared";
import { api } from "../lib/api";
import { AutofillUrlDialog } from "../components/AutofillUrlDialog";
import { ErrorBanner } from "../components/ErrorBanner";

const steps = [
  "Application details",
  "Add requirements",
  "Review requirements",
  "Upload documents",
  "Analyze",
  "Readiness",
];

export function NewApplicationPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [appId, setAppId] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [form, setForm] = useState({
    name: "",
    organization: "",
    type: "scholarship",
    deadline: "",
    notes: "",
  });
  const [sourceMode, setSourceMode] = useState<"text" | "url" | "file">("text");
  const [pasted, setPasted] = useState("");
  const [url, setUrl] = useState("");
  const [sourceName, setSourceName] = useState("Official requirements");
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [analysisSummary, setAnalysisSummary] = useState<string>("");
  const [autofillOpen, setAutofillOpen] = useState(false);
  const [autofillUrl, setAutofillUrl] = useState("");
  const [autofillStatus, setAutofillStatus] = useState("");
  const [vaultDocs, setVaultDocs] = useState<VaultDocument[]>([]);
  const [appDocs, setAppDocs] = useState<DocumentRecord[]>([]);

  useEffect(() => {
    if (step !== 3 || !appId) return;
    let cancelled = false;
    Promise.all([
      api.listVault().catch(() => ({ documents: [] as VaultDocument[] })),
      api.getApplication(appId).catch(() => null),
    ]).then(([vaultRes, appRes]) => {
      if (cancelled) return;
      setVaultDocs(vaultRes.documents);
      if (appRes) setAppDocs(appRes.documents);
    });
    return () => {
      cancelled = true;
    };
  }, [step, appId]);

  const progress = useMemo(() => ((step + 1) / steps.length) * 100, [step]);

  async function createApp() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createApplication({
        ...form,
        deadline: form.deadline || null,
        notes: form.notes || null,
      });
      setAppId(res.application.id);
      setStep(1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function continueFromDetails() {
    if (!appId) {
      await createApp();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateApplication(appId, {
        ...form,
        deadline: form.deadline || null,
        notes: form.notes || null,
      });
      setStep(1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function autofillFromUrl() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.previewUrl(autofillUrl);
      const host = hostnameOf(autofillUrl);
      setForm((prev) => ({
        ...prev,
        name: prev.name || res.title.trim().slice(0, 120),
        organization: prev.organization || titleCase(host),
        notes: prev.notes || res.description,
      }));
      setAutofillStatus("Prefilled empty fields from the page.");
    } catch (e) {
      setAutofillStatus(
        e instanceof Error ? e.message : "Could not fetch that URL.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function ingestSource() {
    if (!appId) return;
    setBusy(true);
    setError(null);
    try {
      if (sourceMode === "text") {
        const res = await api.addTextSource(appId, pasted, sourceName);
        setRequirements(res.requirements);
      } else if (sourceMode === "url") {
        const res = await api.addUrlSource(appId, url);
        setRequirements(res.requirements);
      } else {
        const input = document.getElementById(
          "requirements-file",
        ) as HTMLInputElement | null;
        const file = input?.files?.[0];
        if (!file) throw new Error("Choose a requirements file first.");
        const res = await api.addUploadSource(appId, file);
        setRequirements(res.requirements);
      }
      setStep(2);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function uploadDocs(files: FileList | null) {
    if (!appId || !files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        setUploadStatus(`Parsing ${file.name}…`);
        const res = await api.uploadDocument(appId, file);
        setAppDocs((list) => [...list, res.document]);
      }
      setUploadStatus(`Uploaded ${files.length} document(s).`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function attachVaultDocument(vaultId: string) {
    if (!appId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.useVault(appId, vaultId);
      setAppDocs((list) => [...list, res.document]);
      setUploadStatus("Attached from vault.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function removeDocument(id: string) {
    if (!appId) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteDocument(id);
      setAppDocs((list) => list.filter((d) => d.id !== id));
      setUploadStatus("Removed document.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function runAnalyze() {
    if (!appId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.analyze(appId);
      setAnalysisSummary(
        `${res.report.status.replaceAll("_", " ")} · ${res.report.score}% · ${res.issues.filter((i) => i.status === "open").length} open issues`,
      );
      setStep(5);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-4xl font-semibold">New application</h1>
          <p className="mt-2 text-ink-600 dark:text-ink-300">
            Guided setup with evidence-backed requirement extraction.
          </p>
        </div>
        {step === 0 && (
          <button
            type="button"
            className="btn-secondary shrink-0"
            onClick={() => setAutofillOpen(true)}
          >
            Autofill from URL
          </button>
        )}
      </div>

      <div className="card p-4" aria-label="Setup progress">
        <div className="mb-2 flex justify-between text-sm">
          <span>
            Step {step + 1} of {steps.length}: {steps[step]}
          </span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
          <div
            className="h-full rounded-full bg-accent-600 transition-all dark:bg-accent-400"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <ErrorBanner error={error} />

      {step === 0 && (
        <section className="card space-y-4 p-6">
          <Field label="Application name" htmlFor="name">
            <input
              id="name"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Future Engineers Scholarship"
              required
            />
          </Field>
          <Field label="Organization" htmlFor="organization">
            <input
              id="organization"
              className="input"
              value={form.organization}
              onChange={(e) => setForm({ ...form, organization: e.target.value })}
              placeholder="Future Engineers Foundation"
              required
            />
          </Field>
          <Field label="Application type" htmlFor="type">
            <select
              id="type"
              className="input"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option value="scholarship">Scholarship</option>
              <option value="college">College</option>
              <option value="internship">Internship</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Deadline (optional)" htmlFor="deadline">
            <input
              id="deadline"
              type="date"
              className="input"
              value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            />
          </Field>
          <Field label="Notes (optional)" htmlFor="notes">
            <textarea
              id="notes"
              className="input min-h-24"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !form.name || !form.organization}
              onClick={continueFromDetails}
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="card space-y-4 p-6">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Requirement source">
            {(
              [
                ["text", "Paste text"],
                ["url", "Public URL"],
                ["file", "Upload file"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={sourceMode === mode}
                className={sourceMode === mode ? "btn-primary" : "btn-secondary"}
                onClick={() => setSourceMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>

          {sourceMode === "text" && (
            <>
              <Field label="Source name" htmlFor="sourceName">
                <input
                  id="sourceName"
                  className="input"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                />
              </Field>
              <Field label="Requirements text" htmlFor="pasted">
                <textarea
                  id="pasted"
                  className="input min-h-56 font-mono text-xs"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="Paste official requirements…"
                />
              </Field>
            </>
          )}

          {sourceMode === "url" && (
            <Field label="Public requirements URL" htmlFor="url">
              <input
                id="url"
                className="input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.org/scholarship/requirements"
              />
              <p className="mt-2 text-xs text-ink-500">
                Localhost, private IPs, and credentialed URLs are blocked. JavaScript is not executed.
              </p>
            </Field>
          )}

          {sourceMode === "file" && (
            <Field label="Requirements document" htmlFor="requirements-file">
              <input id="requirements-file" type="file" className="input" accept=".pdf,.docx,.txt,.md" />
            </Field>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => setStep(0)}
            >
              Back
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={ingestSource}
            >
              Extract requirements
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4">
          <div className="card p-4">
            <p className="text-sm text-ink-600 dark:text-ink-300">
              Review each item. Uncertain extractions should be confirmed before you rely on them.
            </p>
          </div>
          {requirements.map((req) => (
            <article key={req.id} className="card space-y-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-xl font-semibold">{req.title}</h2>
                  <p className="text-sm text-ink-500">
                    {req.category} ·{" "}
                    {req.certainty === "uncertain"
                      ? "Uncertain"
                      : req.required
                        ? "Required"
                        : "Optional"}{" "}
                    · confidence{" "}
                    {Math.round(req.confidence * 100)}%
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {req.certainty === "uncertain" ? (
                    <>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={async () => {
                          const updated = await api.confirmRequirement(req.id, {
                            certainty: "required",
                          });
                          setRequirements((list) =>
                            list.map((r) =>
                              r.id === req.id ? updated.requirement : r,
                            ),
                          );
                        }}
                      >
                        Mark required
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={async () => {
                          const updated = await api.confirmRequirement(req.id, {
                            certainty: "optional",
                          });
                          setRequirements((list) =>
                            list.map((r) =>
                              r.id === req.id ? updated.requirement : r,
                            ),
                          );
                        }}
                      >
                        Mark optional
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={async () => {
                        const updated = await api.confirmRequirement(req.id);
                        setRequirements((list) =>
                          list.map((r) => (r.id === req.id ? updated.requirement : r)),
                        );
                      }}
                    >
                      Confirm
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={async () => {
                      await api.deleteRequirement(req.id);
                      setRequirements((list) => list.filter((r) => r.id !== req.id));
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <label className="block">
                <span className="label">Title</span>
                <input
                  className="input"
                  value={req.title}
                  onChange={(e) =>
                    setRequirements((list) =>
                      list.map((r) =>
                        r.id === req.id ? { ...r, title: e.target.value } : r,
                      ),
                    )
                  }
                  onBlur={async (e) => {
                    const updated = await api.updateRequirement(req.id, {
                      title: e.target.value,
                    });
                    setRequirements((list) =>
                      list.map((r) => (r.id === req.id ? updated.requirement : r)),
                    );
                  }}
                />
              </label>
              <div>
                <p className="label">Source evidence</p>
                <div className="evidence">{req.sourceEvidence}</div>
              </div>
            </article>
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setStep(1)}
            >
              Back
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setStep(3)}
            >
              Continue to documents
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="card space-y-4 p-6">
          <div>
            <p className="label">What to include ({form.type})</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-600 dark:text-ink-300">
              {DOCUMENT_GUIDANCE[form.type]?.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <Field label="Upload application documents" htmlFor="docs">
            <input
              id="docs"
              type="file"
              multiple
              className="input"
              accept=".pdf,.docx,.txt,.md"
              onChange={(e) => uploadDocs(e.target.files)}
            />
          </Field>
          {uploadStatus ? <p className="text-sm">{uploadStatus}</p> : null}
          {appDocs.length > 0 && (
            <div>
              <p className="label">Attached documents</p>
              <ul className="space-y-2">
                {appDocs.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm">
                      {doc.originalFilename}
                    </span>
                    <button
                      type="button"
                      className="btn-ghost text-sm"
                      disabled={busy}
                      onClick={() => removeDocument(doc.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {vaultDocs.length > 0 && (
            <div>
              <p className="label">Select from vault</p>
              <ul className="space-y-2">
                {vaultDocs.map((doc) => {
                  const attached = appDocs.some(
                    (d) => d.vaultDocumentId === doc.id,
                  );
                  return (
                    <li
                      key={doc.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] px-3 py-2"
                    >
                      <span className="min-w-0 text-sm">
                        <span className="block truncate">{doc.originalFilename}</span>
                        <span className="text-xs text-ink-500">{doc.category}</span>
                      </span>
                      <button
                        type="button"
                        className={attached ? "btn-ghost text-sm" : "btn-secondary text-sm"}
                        disabled={attached || busy}
                        onClick={() => attachVaultDocument(doc.id)}
                      >
                        {attached ? "Attached" : "Attach"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setStep(2)}
            >
              Back
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setStep(4)}
            >
              Continue to analysis
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="card space-y-4 p-6">
          <p>
            Run matching, validation, consistency checks, and readiness scoring on your local
            packet.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => setStep(3)}
            >
              Back
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={runAnalyze}>
              Analyze packet
            </button>
          </div>
        </section>
      )}

      {step === 5 && appId && (
        <section className="card space-y-4 p-6">
          <h2 className="font-display text-2xl font-semibold">Readiness report ready</h2>
          <p>{analysisSummary}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => navigate(`/applications/${appId}`)}
            >
              Open application
            </button>
            <Link to={`/applications/${appId}/report`} className="btn-secondary">
              View printable report
            </Link>
          </div>
        </section>
      )}

      <AutofillUrlDialog
        open={autofillOpen}
        url={autofillUrl}
        busy={busy}
        status={autofillStatus}
        onUrlChange={(next) => {
          setAutofillUrl(next);
          setAutofillStatus("");
        }}
        onSubmit={autofillFromUrl}
        onClose={() => {
          setAutofillOpen(false);
          setAutofillStatus("");
        }}
      />
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

const DOCUMENT_GUIDANCE: Record<string, string[]> = {
  scholarship: [
    "Transcript",
    "Essays",
    "Recommendation letters",
    "Resume optional.",
  ],
  college: [
    "Official transcript",
    "Test scores",
    "Personal statement/essays",
    "Recommendation letters.",
  ],
  internship: [
    "Resume/CV",
    "Cover letter",
    "Portfolio or writing samples",
    "Transcript if requested.",
  ],
  other: [
    "Any documents the application requests (e.g. forms, portfolios, references).",
  ],
};

function hostnameOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function titleCase(value: string): string {
  return value
    .split(/[.-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
