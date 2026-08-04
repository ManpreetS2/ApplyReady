import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useConfig } from "../lib/config";
import { ErrorBanner } from "../components/ErrorBanner";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Link } from "react-router-dom";

export function PrivacyPage() {
  const { publicDemoMode } = useConfig();
  const [storage, setStorage] = useState<{
    dataDir?: string;
    uploadsDir?: string;
    dbPath?: string;
    privacy: string;
    publicDemoMode?: boolean;
  } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState("");
  const [confirmStep, setConfirmStep] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    api
      .storage()
      .then(setStorage)
      .catch(setError);
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-4xl font-semibold">Privacy & data controls</h1>
        <p className="mt-2 text-ink-600 dark:text-ink-300">
          {publicDemoMode
            ? "You are viewing the hosted public portfolio demo."
            : "ApplyReady is local-first. Your documents are processed on this machine."}
        </p>
      </div>

      <ErrorBanner error={error} />
      {message ? (
        <p
          className="card bg-accent-50 p-4 text-accent-900 dark:bg-accent-950/40 dark:text-accent-100"
          role="status"
        >
          {message}
        </p>
      ) : null}

      {publicDemoMode ? (
        <section className="card space-y-3 p-6">
          <h2 className="font-display text-2xl font-semibold">Hosted public demo</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>The demo contains only generated fictional documents and names.</li>
            <li>Do not submit personal documents — real uploads are disabled.</li>
            <li>Demo data is temporary and automatically removed after inactivity.</li>
            <li>No account is created and visitors cannot enumerate other demos.</li>
            <li>
              Independent concurrent demo sessions use unpredictable IDs. This is not authenticated
              private storage — do not enter personal or sensitive information.
            </li>
            <li>
              This hosted demo is not the same as running the full local ApplyReady application.
            </li>
            <li>
              ApplyReady is not legal, immigration, financial, admissions, or professional
              compliance advice.
            </li>
          </ul>
          <p className="text-sm text-ink-600 dark:text-ink-300">
            {storage?.privacy}
          </p>
          <Link to="/demo" className="btn-primary inline-flex">
            Open guided demo
          </Link>
        </section>
      ) : (
        <>
          <section className="card space-y-3 p-6">
            <h2 className="font-display text-2xl font-semibold">What stays local</h2>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
              <li>Documents remain on your machine in a local application data directory.</li>
              <li>No files are sent to AI providers or external analysis services.</li>
              <li>No analytics, telemetry, or tracking is used.</li>
              <li>SQLite stores metadata, extracted requirements, matches, and issues locally.</li>
              <li>Deleting an application can also delete associated uploaded files.</li>
              <li>Deleting a vault document permanently removes the stored file.</li>
            </ul>
            <p className="text-sm text-ink-600 dark:text-ink-300">
              ApplyReady does not provide legal, immigration, financial, admissions, or
              professional compliance advice.
            </p>
          </section>

          <section className="card space-y-3 p-6">
            <h2 className="font-display text-2xl font-semibold">Local storage location</h2>
            {storage?.dataDir ? (
              <dl className="space-y-2 font-mono text-xs break-all">
                <div>
                  <dt className="text-ink-500">Data directory</dt>
                  <dd>{storage.dataDir}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">Uploads directory</dt>
                  <dd>{storage.uploadsDir}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">Database</dt>
                  <dd>{storage.dbPath}</dd>
                </div>
              </dl>
            ) : (
              <p>Loading storage paths…</p>
            )}
          </section>

          <section className="card space-y-4 p-6">
            <h2 className="font-display text-2xl font-semibold">Destructive actions</h2>
            <button
              type="button"
              className="btn-danger"
              onClick={() => setConfirmStep(1)}
            >
              Clear all local data
            </button>
          </section>

          <ConfirmDialog
            open={confirmStep === 1}
            title="Clear all local data?"
            description="Clear ALL local ApplyReady data, including applications, vault files, and the database?"
            confirmLabel="Continue"
            danger
            onCancel={() => setConfirmStep(0)}
            onConfirm={() => setConfirmStep(2)}
          />
          <ConfirmDialog
            open={confirmStep === 2}
            title="Final confirmation"
            description="This cannot be undone. Clear everything?"
            confirmLabel="Clear everything"
            danger
            onCancel={() => setConfirmStep(0)}
            onConfirm={async () => {
              try {
                await api.clearAll();
                setMessage("All local ApplyReady data was cleared.");
                setConfirmStep(0);
              } catch (e) {
                setError(e);
                setConfirmStep(0);
              }
            }}
          />
        </>
      )}
    </div>
  );
}
