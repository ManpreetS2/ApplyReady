import { useEffect, useId, useRef, useState } from "react";
import type { DemoFixPreview } from "@applyready/shared";

type FixReviewDialogProps = {
  open: boolean;
  preview: DemoFixPreview | null;
  busy?: boolean;
  onUseSuggested: () => void;
  onUseCustom: (value: string) => void;
  onKeepCurrent: () => void;
};

function DiffBlock({
  label,
  before,
  value,
  after,
  tone,
}: {
  label: string;
  before: string | null;
  value: string | null;
  after: string | null;
  tone: "current" | "suggested";
}) {
  const highlight =
    tone === "current"
      ? "rounded px-0.5 bg-amber-500/25 text-amber-100"
      : "rounded px-0.5 bg-sky-400/25 text-sky-100";
  return (
    <div className="rounded-xl border border-[var(--line)] bg-ink-950/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
        {label}
      </p>
      <p className="mt-2 break-words text-sm leading-relaxed text-ink-300">
        {before ? <span>{before}</span> : null}
        {value ? <span className={highlight}>{value}</span> : <span>—</span>}
        {after ? <span>{after}</span> : null}
      </p>
    </div>
  );
}

export function FixReviewDialog({
  open,
  preview,
  busy = false,
  onUseSuggested,
  onUseCustom,
  onKeepCurrent,
}: FixReviewDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onKeepCurrentRef = useRef(onKeepCurrent);
  const onUseSuggestedRef = useRef(onUseSuggested);
  const onUseCustomRef = useRef(onUseCustom);
  const [draft, setDraft] = useState("");

  onKeepCurrentRef.current = onKeepCurrent;
  onUseSuggestedRef.current = onUseSuggested;
  onUseCustomRef.current = onUseCustom;

  useEffect(() => {
    if (!open || !preview) return;
    setDraft(preview.suggestedValue || preview.currentValue || "");
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      primaryRef.current?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onKeepCurrentRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, preview]);

  useEffect(() => {
    if (open) return;
    const previous = previouslyFocused.current;
    previouslyFocused.current = null;
    if (previous && typeof previous.focus === "function") {
      window.requestAnimationFrame(() => previous.focus());
    }
  }, [open]);

  if (!open || !preview) return null;

  const confirmLabel =
    preview.kind === "add_document"
      ? "Add fictional transcript"
      : preview.kind === "finalize"
        ? "Finalize readiness"
        : "Use suggested change";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-ink-950/55"
        aria-label="Dismiss dialog"
        onClick={onKeepCurrent}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="fix-review-dialog"
        className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 shadow-soft sm:p-6"
      >
        <h2 id={titleId} className="font-display text-2xl font-semibold">
          Review suggested fix
        </h2>
        <p id={descriptionId} className="mt-2 text-sm text-ink-300">
          {preview.title}
        </p>

        <section className="mt-5 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Why ApplyReady flagged this
          </h3>
          <p className="text-sm text-ink-200">{preview.explanation}</p>
          <ul className="space-y-1 text-sm text-ink-400">
            {preview.requirementEvidence.map((item) => (
              <li key={item} className="break-words">
                Requirement: {item}
              </li>
            ))}
            {preview.detectedEvidence.map((item) => (
              <li key={item} className="break-words">
                Detected: {item}
              </li>
            ))}
          </ul>
        </section>

        {preview.kind !== "finalize" && preview.kind !== "add_document" ? (
          <div className="mt-5 grid gap-3">
            <DiffBlock
              label="Current version"
              before={preview.contextBefore}
              value={preview.currentValue}
              after={preview.contextAfter}
              tone="current"
            />
            <DiffBlock
              label="Suggested change"
              before={preview.contextBefore}
              value={preview.suggestedValue}
              after={preview.contextAfter}
              tone="suggested"
            />
          </div>
        ) : null}

        {preview.kind === "add_document" ? (
          <div className="mt-5 space-y-2 rounded-xl border border-[var(--line)] p-3 text-sm">
            <p>
              <span className="text-ink-400">Missing:</span> Unofficial transcript
            </p>
            <p>
              <span className="text-ink-400">Will add:</span>{" "}
              <span className="text-sky-100">{preview.suggestedValue}</span>
            </p>
            <p className="text-ink-400">
              Contains fictional Alex Chen enrollment details (school, major, GPA).
            </p>
          </div>
        ) : null}

        {preview.kind === "finalize" ? (
          <div className="mt-5 rounded-xl border border-[var(--line)] p-3 text-sm text-ink-300">
            Finalization will confirm remaining guided-demo document matches, resolve
            confirmation items, and recompute readiness.
          </div>
        ) : null}

        {preview.editable ? (
          <label className="mt-5 block">
            <span className="label">Your version</span>
            <input
              className="input"
              value={draft}
              maxLength={preview.maxLength ?? undefined}
              data-testid="fix-review-custom-input"
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            />
          </label>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            ref={primaryRef}
            type="button"
            className="btn-primary"
            disabled={busy}
            aria-busy={busy}
            data-testid="fix-review-use-suggested"
            onClick={onUseSuggested}
          >
            {confirmLabel}
          </button>
          {preview.editable ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || !draft.trim()}
              aria-busy={busy}
              data-testid="fix-review-use-custom"
              onClick={() => onUseCustom(draft.trim())}
            >
              Use my version
            </button>
          ) : null}
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            data-testid="fix-review-keep-current"
            onClick={onKeepCurrent}
          >
            Keep current version
          </button>
        </div>
      </div>
    </div>
  );
}
