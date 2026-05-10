import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const AUTH_STORAGE_KEY = "sb-eyliwidiljmzllsmytdh-auth-token";

const storedSessionIsExpired = () => {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return false;
    const value = JSON.parse(raw);
    const expiresAt = Number(value?.expires_at ?? 0);
    return Boolean(expiresAt) && expiresAt * 1000 <= Date.now() + 30_000;
  } catch {
    return true;
  }
};

export const clearStoredAuthSession = () => {
  if (typeof window === "undefined") return;
  [AUTH_STORAGE_KEY, `${AUTH_STORAGE_KEY}-code-verifier`, `${AUTH_STORAGE_KEY}-user`].forEach((key) => {
    window.localStorage.removeItem(key);
  });
};

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setLoading(false);
      }
    );

    const restoreSession = async () => {
      try {
        if (storedSessionIsExpired()) {
          clearStoredAuthSession();
          setSession(null);
          return;
        }

        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 8000)),
        ]);

        if (cancelled) return;
        if (!result || result.error) {
          clearStoredAuthSession();
          setSession(null);
        } else {
          setSession(result.data.session);
        }
      } catch {
        if (!cancelled) {
          clearStoredAuthSession();
          setSession(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    restoreSession();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    clearStoredAuthSession();
    setSession(null);
    await supabase.auth.signOut({ scope: "local" });
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
