import { useEffect, useId, useRef } from "react";

type AutofillUrlDialogProps = {
  open: boolean;
  url: string;
  busy: boolean;
  status?: string;
  onUrlChange: (url: string) => void;
  onSubmit: () => void;
  onClose: () => void;
};

export function AutofillUrlDialog({
  open,
  url,
  busy,
  status,
  onUrlChange,
  onSubmit,
  onClose,
}: AutofillUrlDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-ink-950/45"
        aria-label="Dismiss dialog"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 shadow-soft backdrop-blur"
      >
        <h2 id={titleId} className="font-display text-2xl font-semibold">
          Autofill from URL
        </h2>
        <p
          id={descriptionId}
          className="mt-2 text-sm text-ink-600 dark:text-ink-300"
        >
          Paste the application's public page. Empty fields are filled from the
          page title and summary.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <label className="block">
            <span className="label">Page URL</span>
            <input
              ref={inputRef}
              type="url"
              className="input"
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="https://example.org/scholarship"
            />
          </label>
          {status ? (
            <p className="text-sm text-ink-600 dark:text-ink-300">{status}</p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Close
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={busy || !url.trim()}
            >
              {busy ? "Fetching…" : "Fill details"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export type { AutofillUrlDialogProps };
