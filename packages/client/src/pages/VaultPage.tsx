import { useEffect, useState } from "react";
import type { VaultDocument } from "@applyready/shared";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import { ErrorBanner } from "../components/ErrorBanner";
import { EmptyState } from "../components/EmptyState";

export function VaultPage() {
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [category, setCategory] = useState("resume");
  const [notes, setNotes] = useState("");

  async function load() {
    const res = await api.listVault();
    setDocuments(res.documents);
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

      <section className="card space-y-4 p-6">
        <h2 className="font-display text-2xl font-semibold">Upload to vault</h2>
        <label className="block">
          <span className="label">Category</span>
          <select
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
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
          />
        </label>
        <label className="block">
          <span className="label">File</span>
          <input
            type="file"
            className="input"
            accept=".pdf,.docx,.txt,.md"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                await api.uploadVault(file, { category, notes });
                setNotes("");
                await load();
              } catch (err) {
                setError(err);
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
              <h2 className="font-display text-xl font-semibold">
                {doc.originalFilename}
              </h2>
              <p className="text-sm text-ink-500">
                {doc.category} · v{doc.version} · added {formatDate(doc.createdAt)}
              </p>
              {doc.notes ? <p className="text-sm">{doc.notes}</p> : null}
              {doc.extractedSummary ? (
                <div className="evidence">{doc.extractedSummary}</div>
              ) : null}
              <button
                type="button"
                className="btn-danger"
                onClick={async () => {
                  if (
                    !confirm(
                      "Permanently delete this vault document and its local file?",
                    )
                  )
                    return;
                  await api.deleteVault(doc.id);
                  await load();
                }}
              >
                Delete permanently
              </button>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
