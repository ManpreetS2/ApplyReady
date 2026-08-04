import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ClientConfig = {
  publicDemoMode: boolean;
  mode: "public-demo" | "local";
};

const ConfigContext = createContext<ClientConfig | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ClientConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load application config");
        return response.json() as Promise<{
          publicDemoMode?: boolean;
          mode?: string;
        }>;
      })
      .then((data) => {
        if (cancelled) return;
        setConfig({
          publicDemoMode: Boolean(data.publicDemoMode),
          mode: data.publicDemoMode ? "public-demo" : "local",
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Config load failed");
        // Fail closed toward local UX only when the API is unreachable in local
        // development; public demos always serve /api/config from the same origin.
        setConfig({ publicDemoMode: false, mode: "local" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-ink-600 dark:text-ink-300" role="status">
          Loading ApplyReady…
        </p>
      </div>
    );
  }

  return (
    <ConfigContext.Provider value={config}>
      {error ? (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          Could not refresh mode configuration. Continuing in local UI mode.
        </div>
      ) : null}
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig(): ClientConfig {
  const value = useContext(ConfigContext);
  if (!value) {
    throw new Error("useConfig must be used within ConfigProvider");
  }
  return value;
}
