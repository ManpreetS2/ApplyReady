import { Link } from "react-router-dom";
import { ArrowRight, FileSearch, Lock, Scale } from "lucide-react";

export function LandingPage() {
  return (
    <div className="space-y-16">
      <section className="relative overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[linear-gradient(160deg,rgba(255,255,255,0.82),rgba(243,236,225,0.9))] px-6 py-14 shadow-soft dark:bg-[linear-gradient(160deg,rgba(38,52,48,0.9),rgba(19,28,25,0.95))] sm:px-12">
        <div
          className="pointer-events-none absolute inset-0 bg-grid-faint bg-[size:28px_28px] opacity-60 dark:opacity-20"
          aria-hidden
        />
        <div className="relative max-w-3xl">
          <p className="font-display text-5xl font-semibold tracking-tight text-ink-950 dark:text-ink-50 sm:text-6xl">
            ApplyReady
          </p>
          <h1 className="mt-4 max-w-2xl font-display text-3xl font-medium leading-tight text-ink-800 dark:text-ink-100 sm:text-4xl">
            Know what’s missing before you press submit.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-600 dark:text-ink-300">
            Extract requirements with evidence, match your local documents, and get an honest
            readiness score for scholarships, college applications, and internships.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/applications/new" className="btn-primary">
              New application <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link to="/demo" className="btn-secondary">
              Try guided demo
            </Link>
            <Link to="/dashboard" className="btn-ghost">
              Open dashboard
            </Link>
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
            title: "Local by design",
            body: "Documents stay on your machine. No cloud AI, analytics, or paid APIs.",
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
          ApplyReady is not legal, immigration, financial, or professional compliance advice. It
          helps you review scholarship, college, and internship packets with deterministic local
          analysis and clear next steps.
        </p>
      </section>
    </div>
  );
}
