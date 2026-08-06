import { Link, NavLink, Outlet } from "react-router-dom";
import {
  FolderLock,
  LayoutDashboard,
  Moon,
  Shield,
  Sun,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "../lib/theme";
import { useConfig } from "../lib/config";

type NavItem = { to: string; label: string; icon: LucideIcon };

const localNav: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/vault", label: "Document Vault", icon: FolderLock },
  { to: "/demo", label: "Guided Demo", icon: Wand2 },
  { to: "/privacy", label: "Privacy", icon: Shield },
];

const publicDemoNav: NavItem[] = [
  { to: "/demo", label: "Guided Demo", icon: Wand2 },
  { to: "/privacy", label: "Privacy", icon: Shield },
];

export function Layout() {
  const { theme, toggle } = useTheme();
  const { publicDemoMode } = useConfig();
  const nav = publicDemoMode ? publicDemoNav : localNav;

  return (
    <div className="min-h-screen overflow-x-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      {publicDemoMode ? (
        <div
          className="border-b border-accent-700/30 bg-accent-100 px-4 py-2 text-center text-sm text-accent-950 dark:border-accent-300/20 dark:bg-accent-950/50 dark:text-accent-100"
          role="status"
        >
          Public portfolio demo — all names and documents are fictional. Real uploads are
          disabled.
        </div>
      ) : null}
      <header className="no-print sticky top-0 z-40 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="group flex items-baseline gap-2">
            <span className="font-display text-2xl font-semibold tracking-tight text-ink-950 dark:text-ink-50">
              ApplyReady
            </span>
            <span className="hidden text-xs text-ink-500 group-hover:text-ink-700 dark:text-ink-300 sm:inline">
              Know what’s missing
            </span>
          </Link>
          <nav aria-label="Primary" className="flex flex-wrap items-center gap-1">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                aria-label={item.label}
                className={({ isActive }) =>
                  `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? "bg-ink-900 text-white dark:bg-accent-400 dark:text-ink-950"
                      : "text-ink-700 hover:bg-ink-100/80 dark:text-ink-100 dark:hover:bg-ink-800"
                  }`
                }
              >
                <item.icon className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{item.label}</span>
                <span className="sm:hidden" aria-hidden>
                  {item.label.split(" ")[0]}
                </span>
              </NavLink>
            ))}
            <button
              type="button"
              className="btn-ghost"
              onClick={toggle}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" aria-hidden />
              ) : (
                <Moon className="h-4 w-4" aria-hidden />
              )}
            </button>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
