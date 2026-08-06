import {
  createContext,
  useCallback,
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
  const [retryToken, setRetryToken] = useState(0);

  const loadConfig = useCallback(() => {
    setError(null);
    setConfig(null);
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
        // Fail closed: never enable local-only navigation without a confirmed config.
        setConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return loadConfig();
  }, [loadConfig, retryToken]);

  if (!config) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-sm text-ink-600 dark:text-ink-300" role="status">
          {error
            ? "Could not load ApplyReady configuration. Local and demo controls stay locked until the server responds."
            : "Loading ApplyReady…"}
        </p>
        {error ? (
          <button
            type="button"
            className="btn-primary"
            onClick={() => setRetryToken((value) => value + 1)}
          >
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
  );
}

export function useConfig(): ClientConfig {
  const value = useContext(ConfigContext);
  if (!value) {
    throw new Error("useConfig must be used within ConfigProvider");
  }
  return value;
}
