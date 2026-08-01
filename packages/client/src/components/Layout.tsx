import { Link, NavLink, Outlet } from "react-router-dom";
import { FolderLock, LayoutDashboard, Moon, Shield, Sun, Wand2 } from "lucide-react";
import { useTheme } from "../lib/theme";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/vault", label: "Document Vault", icon: FolderLock },
  { to: "/demo", label: "Guided Demo", icon: Wand2 },
  { to: "/privacy", label: "Privacy", icon: Shield },
];

export function Layout() {
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
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
                className={({ isActive }) =>
                  `inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? "bg-ink-900 text-white dark:bg-accent-400 dark:text-ink-950"
                      : "text-ink-700 hover:bg-ink-100/80 dark:text-ink-100 dark:hover:bg-ink-800"
                  }`
                }
              >
                <item.icon className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{item.label}</span>
                <span className="sm:hidden">{item.label.split(" ")[0]}</span>
              </NavLink>
            ))}
            <button
              type="button"
              className="btn-ghost"
              onClick={toggle}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
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
