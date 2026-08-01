import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, Wand2 } from "lucide-react";
import type { Application } from "@applyready/shared";
import { api } from "../lib/api";
import { daysRemaining, formatDate, scoreTone } from "../lib/format";
import { ReadinessBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";

export function DashboardPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState<"deadline" | "readiness">("deadline");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listApplications()
      .then((res) => setApplications(res.applications))
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = [...applications];
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.organization.toLowerCase().includes(q),
      );
    }
    if (type !== "all") list = list.filter((a) => a.type === type);
    list.sort((a, b) => {
      if (sort === "readiness") {
        return (b.readinessScore ?? -1) - (a.readinessScore ?? -1);
      }
      const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return ad - bd;
    });
    return list;
  }, [applications, query, type, sort]);

  const needsAttention = filtered.filter(
    (a) =>
      a.readinessStatus === "needs_attention" ||
      a.readinessStatus === "not_ready",
  );
  const upcoming = filtered.filter((a) => {
    const days = daysRemaining(a.deadline);
    return days != null && days >= 0 && days <= 45;
  });
  const ready = filtered.filter((a) => a.readinessStatus === "ready");
  const recent = [...filtered]
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    .slice(0, 6);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-semibold">Dashboard</h1>
          <p className="mt-2 text-ink-600 dark:text-ink-300">
            Track readiness across scholarships, college applications, and internships.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/applications/new" className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden /> New application
          </Link>
          <Link to="/demo" className="btn-secondary">
            <Wand2 className="h-4 w-4" aria-hidden /> Try guided demo
          </Link>
        </div>
      </div>

      <ErrorBanner error={error} />

      <div className="card grid gap-3 p-4 md:grid-cols-[1fr_auto_auto]">
        <label className="relative block">
          <span className="sr-only">Search applications</span>
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-400" />
          <input
            className="input pl-10"
            placeholder="Search by name or organization"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Filter by type</span>
          <select
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="all">All types</option>
            <option value="scholarship">Scholarship</option>
            <option value="college">College</option>
            <option value="internship">Internship</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Sort</span>
          <select
            className="input"
            value={sort}
            onChange={(e) => setSort(e.target.value as "deadline" | "readiness")}
          >
            <option value="deadline">Sort by deadline</option>
            <option value="readiness">Sort by readiness</option>
          </select>
        </label>
      </div>

      {loading ? (
        <p>Loading applications…</p>
      ) : applications.length === 0 ? (
        <EmptyState
          title="No applications yet"
          description="Create your first application packet or start the guided Future Engineers Scholarship demo."
          action={
            <div className="flex flex-wrap gap-2">
              <Link to="/applications/new" className="btn-primary">
                New application
              </Link>
              <Link to="/demo" className="btn-secondary">
                Start guided demo
              </Link>
            </div>
          }
        />
      ) : (
        <>
          <Section title="Needs attention" items={needsAttention} />
          <Section title="Upcoming deadlines" items={upcoming} />
          <Section title="Ready to submit" items={ready} />
          <Section title="Recently updated" items={recent} />
        </>
      )}
    </div>
  );
}

function Section({ title, items }: { title: string; items: Application[] }) {
  if (!items.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="font-display text-2xl font-semibold">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((app) => (
          <ApplicationCard key={`${title}-${app.id}`} app={app} />
        ))}
      </div>
    </section>
  );
}

function ApplicationCard({ app }: { app: Application }) {
  const days = daysRemaining(app.deadline);
  return (
    <Link
      to={`/applications/${app.id}`}
      className="card block p-5 transition hover:-translate-y-0.5 hover:border-accent-400/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-xl font-semibold">{app.name}</h3>
          <p className="text-sm text-ink-600 dark:text-ink-300">{app.organization}</p>
        </div>
        <ReadinessBadge status={app.readinessStatus} score={app.readinessScore} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-ink-500">Deadline</dt>
          <dd className="font-medium">{formatDate(app.deadline)}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Days remaining</dt>
          <dd className="font-medium">{days == null ? "—" : days}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Readiness</dt>
          <dd className={`font-semibold ${scoreTone(app.readinessScore)}`}>
            {app.readinessScore ?? "—"}%
          </dd>
        </div>
        <div>
          <dt className="text-ink-500">Last analyzed</dt>
          <dd className="font-medium">{formatDate(app.lastAnalyzedAt)}</dd>
        </div>
      </dl>
      {app.isDemo ? (
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-accent-700 dark:text-accent-300">
          Guided demo
        </p>
      ) : null}
    </Link>
  );
}
