import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, NetworkError, SESSION_EXPIRED_EVENT } from "./api";
import { useLanguage } from "./i18n";
import type { User } from "./types";

const STORAGE_KEY = "tna.user";

/** Remembered so a supervisor can open the app and queue updates with no signal. */
function rememberedUser(): User | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? (JSON.parse(value) as User) : null;
  } catch {
    return null;
  }
}

function remember(user: User | null) {
  try {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Offline start will ask for sign-in instead.
  }
}

interface SessionValue {
  user: User | null;
  loading: boolean;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { applyProfileLanguage } = useLanguage();

  const adopt = useCallback(
    (next: User | null) => {
      setUser(next);
      remember(next);
      if (next) applyProfileLanguage(next.language);
    },
    [applyProfileLanguage],
  );

  useEffect(() => {
    let active = true;
    api<{ user: User }>("/auth/me")
      .then(({ user: me }) => active && adopt(me))
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof NetworkError) {
          const remembered = rememberedUser();
          if (remembered) {
            setUser(remembered);
            applyProfileLanguage(remembered.language);
          }
        } else if (error instanceof ApiError && error.status === 401) {
          adopt(null);
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [adopt, applyProfileLanguage]);

  useEffect(() => {
    const onExpired = () => adopt(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [adopt]);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      loading,
      async signIn(email, password) {
        const { user: me } = await api<{ user: User }>("/auth/login", {
          method: "POST",
          body: { email, password },
        });
        adopt(me);
      },
      async signOut() {
        await api("/auth/logout", { method: "POST" }).catch(() => undefined);
        adopt(null);
      },
    }),
    [user, loading, adopt],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
