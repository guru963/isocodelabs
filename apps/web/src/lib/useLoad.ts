import { useCallback, useEffect, useRef, useState } from "react";

interface Loaded<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload(): Promise<void>;
}

interface LoadOptions {
  /**
   * Keeps the screen current: fetches again every `liveMs` while the tab is visible, and at once
   * when the tab comes back into view. These refreshes are quiet: no loading state, and a failed
   * one keeps what is on screen.
   */
  liveMs?: number;
}

/** Fetches on mount and when `key` changes. A newer request always wins over a slower older one. */
export function useLoad<T>(load: () => Promise<T>, key: string, options: LoadOptions = {}): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const latest = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  const reload = useCallback(async () => {
    const request = ++latest.current;
    setState((current) => ({ ...current, loading: true }));
    try {
      const data = await loader.current();
      if (request === latest.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (request === latest.current) setState((current) => ({ ...current, error, loading: false }));
    }
  }, []);

  const refreshQuietly = useCallback(async () => {
    const request = ++latest.current;
    try {
      const data = await loader.current();
      if (request === latest.current) setState({ data, error: null, loading: false });
    } catch {
      // Offline or a blip: keep showing the last figures; the next tick tries again.
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [key, reload]);

  const { liveMs } = options;
  useEffect(() => {
    if (!liveMs) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refreshQuietly();
    };
    const timer = window.setInterval(tick, liveMs);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [key, liveMs, refreshQuietly]);

  return { ...state, reload };
}
