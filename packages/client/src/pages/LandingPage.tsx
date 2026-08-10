import { Link } from "react-router-dom";
import { ArrowRight, FileSearch, Lock, Scale } from "lucide-react";
import { useConfig } from "../lib/config";

export function LandingPage() {
  const { publicDemoMode } = useConfig();

  return (
    <div className="space-y-16">
      <section className="relative overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[linear-gradient(165deg,#ffffff_0%,#f1f5f9_100%)] px-6 py-14 shadow-soft dark:bg-[linear-gradient(165deg,#121821_0%,#0b0f14_100%)] sm:px-12">
        <div
          className="pointer-events-none absolute inset-0 bg-grid-faint bg-[size:28px_28px] opacity-40 dark:opacity-25"
          aria-hidden
        />
        <div className="pointer-events-none absolute -right-16 top-10 h-56 w-56 rounded-full bg-slate-400/10 blur-3xl dark:bg-[#38BDF8]/08" aria-hidden />
        <div className="relative max-w-3xl">
          <p className="font-display text-5xl font-semibold tracking-tight text-ink-950 dark:text-ink-50 sm:text-6xl">
            ApplyReady
          </p>
          <h1 className="mt-4 max-w-2xl font-display text-3xl font-medium leading-tight text-ink-800 dark:text-ink-100 sm:text-4xl">
            Know what’s missing before you press submit.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-600 dark:text-ink-300">
            {publicDemoMode
              ? "Explore the fictional Future Engineers Scholarship walkthrough: extract requirements, inspect evidence, fix issues, and reach Ready to submit — without uploading personal files."
              : "Extract evidence-backed document requirements, match your local files, and get an honest readiness score for scholarships, college applications, and internships. Not a full ATS or job-qualification matcher."}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/demo" className="btn-primary">
              Try the guided demo <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            {!publicDemoMode ? (
              <>
                <Link to="/applications/new" className="btn-secondary">
                  New application
                </Link>
                <Link to="/dashboard" className="btn-ghost">
                  Open dashboard
                </Link>
              </>
            ) : (
              <Link to="/privacy" className="btn-ghost">
                Privacy & demo limits
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        {[
          {
            icon: FileSearch,
            title: "Evidence first",
            body: "Every extracted requirement links back to the exact sentence that produced it.",
          },
          {
            icon: Scale,
            title: "Honest uncertainty",
            body: "Matches stay unconfirmed until the evidence is strong—or you say they are.",
          },
          {
            icon: Lock,
            title: publicDemoMode ? "Demo by design" : "Local by design",
            body: publicDemoMode
              ? "This hosted demo uses generated fictional documents only. Real uploads, vault storage, and arbitrary URL fetching are disabled."
              : "Files stay on the machine running ApplyReady—local SQLite and uploads, not hosted AI or cloud sync.",
          },
        ].map((item) => (
          <article key={item.title} className="card p-6">
            <item.icon className="h-5 w-5 text-accent-700 dark:text-accent-300" aria-hidden />
            <h2 className="mt-4 font-display text-xl font-semibold">{item.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
              {item.body}
            </p>
          </article>
        ))}
      </section>

      <section className="card p-6 sm:p-8">
        <h2 className="font-display text-2xl font-semibold">Built for application packets</h2>
        <p className="mt-2 max-w-3xl text-ink-600 dark:text-ink-300">
          ApplyReady is not legal, immigration, financial, admissions, or professional compliance
          advice. It helps you review scholarship, college, and internship packets with
          deterministic analysis and clear next steps.
        </p>
      </section>
    </div>
  );
}
