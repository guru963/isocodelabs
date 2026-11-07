import { useCallback, useEffect, useRef, useState } from "react";

interface Loaded<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload(): Promise<void>;
}

/** Fetches on mount and when `key` changes. A newer request always wins over a slower older one. */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> {
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

  useEffect(() => {
    void reload();
  }, [key, reload]);

  return { ...state, reload };
}
