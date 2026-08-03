import { useEffect, useState } from "react";
import type { Application, VaultDocument } from "@applyready/shared";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import { ErrorBanner } from "../components/ErrorBanner";
import { EmptyState } from "../components/EmptyState";
import { ConfirmDialog } from "../components/ConfirmDialog";

export function VaultPage() {
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [category, setCategory] = useState("resume");
  const [notes, setNotes] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [versionNote, setVersionNote] = useState("");
  const [pendingDelete, setPendingDelete] = useState<VaultDocument | null>(null);
  const [attachFor, setAttachFor] = useState<VaultDocument | null>(null);
  const [attachAppId, setAttachAppId] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    const [vault, apps] = await Promise.all([
      api.listVault(),
      api.listApplications(),
    ]);
    setDocuments(vault.documents);
    setApplications(apps.applications);
  }

  useEffect(() => {
    load().catch(setError);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl font-semibold">Document vault</h1>
        <p className="mt-2 max-w-3xl text-ink-600 dark:text-ink-300">
          Reuse resumes, transcripts, essays, and recommendation letters across applications.
          Files remain on this machine — ApplyReady does not sync to the cloud.
        </p>
      </div>

      <ErrorBanner error={error} />
      {message ? (
        <p className="card bg-accent-50 p-4 text-sm text-accent-900 dark:bg-accent-950/40 dark:text-accent-100" role="status">
          {message}
        </p>
      ) : null}

      <section className="card space-y-4 p-6">
        <h2 className="font-display text-2xl font-semibold">Upload to vault</h2>
        <label className="block">
          <span className="label">Category</span>
          <select
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Vault document category"
          >
            {[
              "resume",
              "transcript",
              "essay",
              "recommendation",
              "identification",
              "portfolio",
              "certification",
              "other",
            ].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Notes (optional)</span>
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-label="Vault document notes"
          />
        </label>
        <label className="block">
          <span className="label">Version note (optional)</span>
          <input
            className="input"
            value={versionNote}
            onChange={(e) => setVersionNote(e.target.value)}
            placeholder="e.g. Spring 2026 revision"
            aria-label="Vault document version note"
          />
        </label>
        <label className="block">
          <span className="label">Expiration date (optional)</span>
          <input
            type="date"
            className="input"
            value={expirationDate}
            onChange={(e) => setExpirationDate(e.target.value)}
            aria-label="Vault document expiration date"
          />
        </label>
        <label className="block">
          <span className="label">File</span>
          <input
            type="file"
            className="input"
            accept=".pdf,.docx,.txt,.md"
            aria-label="Vault file upload"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const combinedNotes = [notes, versionNote].filter(Boolean).join(" · ");
                await api.uploadVault(file, {
                  category,
                  notes: combinedNotes || undefined,
                  expirationDate: expirationDate || undefined,
                });
                setNotes("");
                setVersionNote("");
                setExpirationDate("");
                setMessage(`Uploaded ${file.name} to the vault.`);
                await load();
              } catch (err) {
                setError(err);
              } finally {
                e.target.value = "";
              }
            }}
          />
        </label>
      </section>

      {documents.length === 0 ? (
        <EmptyState
          title="Vault is empty"
          description="Upload documents you reuse often, then attach them to applications when needed."
        />
      ) : (
        <section className="grid gap-4 md:grid-cols-2">
          {documents.map((doc) => (
            <article key={doc.id} className="card space-y-3 p-5">
              <h2 className="font-display text-xl font-semibold break-all">
                {doc.originalFilename}
              </h2>
              <p className="text-sm text-ink-500">
                {doc.category} · v{doc.version} · added {formatDate(doc.createdAt)}
                {doc.expirationDate ? ` · expires ${formatDate(doc.expirationDate)}` : ""}
              </p>
              {doc.notes ? <p className="text-sm">{doc.notes}</p> : null}
              {doc.extractedSummary ? (
                <div className="evidence break-words">{doc.extractedSummary}</div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setAttachFor(doc);
                    setAttachAppId(applications[0]?.id || "");
                  }}
                >
                  Use in application
                </button>
                <label className="btn-ghost">
                  Replace with newer version
                  <input
                    type="file"
                    className="sr-only"
                    accept=".pdf,.docx,.txt,.md"
                    aria-label={`Replace ${doc.originalFilename}`}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const uploaded = await api.uploadVault(file, {
                          category: doc.category,
                          notes: `Replacement for ${doc.originalFilename}${doc.notes ? ` · ${doc.notes}` : ""}`,
                          expirationDate: doc.expirationDate || undefined,
                        });
                        await api.updateVault(uploaded.document.id, {
                          version: doc.version + 1,
                        });
                        setMessage(
                          "Newer version uploaded. You can delete the previous vault file when ready.",
                        );
                        await load();
                      } catch (err) {
                        setError(err);
                      } finally {
                        e.target.value = "";
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => setPendingDelete(doc)}
                >
                  Delete permanently
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete vault document?"
        description={
          pendingDelete
            ? `Permanently delete ${pendingDelete.originalFilename} and its local file? This cannot be undone.`
            : null
        }
        confirmLabel="Delete permanently"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await api.deleteVault(pendingDelete.id);
            setMessage(`Deleted ${pendingDelete.originalFilename}.`);
            setPendingDelete(null);
            await load();
          } catch (err) {
            setError(err);
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(attachFor)}
        title="Use vault document in an application"
        description={
          <div className="space-y-3">
            <p>
              Attach {attachFor?.originalFilename} to an application. A copy will be processed
              for that packet.
            </p>
            <label className="block">
              <span className="label">Application</span>
              <select
                className="input"
                value={attachAppId}
                onChange={(e) => setAttachAppId(e.target.value)}
                aria-label="Application for vault document"
              >
                <option value="" disabled>
                  Choose an application…
                </option>
                {applications.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
        confirmLabel="Attach document"
        onCancel={() => setAttachFor(null)}
        onConfirm={async () => {
          if (!attachFor || !attachAppId) return;
          try {
            await api.useVault(attachAppId, attachFor.id);
            setMessage(
              `Attached ${attachFor.originalFilename} to the selected application.`,
            );
            setAttachFor(null);
          } catch (err) {
            setError(err);
          }
        }}
      />
    </div>
  );
}
