import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
  role?: string;
  app_metadata?: Record<string, any>;
  user_metadata?: Record<string, any>;
  created_at?: string;
  last_sign_in_at?: string;
};

export type AuthSession = {
  access_token: string;
  token_type: string;
  user: AuthUser;
};

const LOCAL_ADMIN_USER: AuthUser = {
  id: "local-admin",
  email: "admin@hosterax.local",
  name: "Local Admin",
  role: "admin",
  app_metadata: { provider: "local" },
  user_metadata: { name: "Local Admin", full_name: "Local Administrator" },
  created_at: new Date(0).toISOString(),
  last_sign_in_at: new Date().toISOString(),
};

const LOCAL_ADMIN_SESSION: AuthSession = {
  access_token: typeof window !== "undefined" 
    ? localStorage.getItem("hx.token") || `hx_local_${crypto.randomUUID()}`
    : "",
  token_type: "bearer",
  user: LOCAL_ADMIN_USER,
};

type AuthCtx = {
  session: AuthSession | null;
  user: AuthUser | null;
  loading: boolean;
  signInLocal: (user?: Partial<AuthUser>, token?: string) => void;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  session: null,
  user: null,
  loading: true,
  signInLocal: () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => {
    if (typeof window === "undefined") return LOCAL_ADMIN_SESSION;
    const isLocal = localStorage.getItem("hx.local_auth");
    if (isLocal === "false") return null;
    return LOCAL_ADMIN_SESSION;
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Default to active admin session for self-hosted instance
    if (typeof window !== "undefined") {
      const isLocal = localStorage.getItem("hx.local_auth");
      if (isLocal !== "false") {
        setSession(LOCAL_ADMIN_SESSION);
      }
    }
    setLoading(false);
  }, []);

  const signInLocal = (customUser?: Partial<AuthUser>, customToken?: string) => {
    const user: AuthUser = {
      ...LOCAL_ADMIN_USER,
      ...customUser,
      last_sign_in_at: new Date().toISOString(),
    };
    const s: AuthSession = {
      access_token: customToken || LOCAL_ADMIN_SESSION.access_token,
      token_type: "bearer",
      user,
    };
    if (typeof window !== "undefined") {
      localStorage.setItem("hx.local_auth", "true");
    }
    setSession(s);
  };

  const signOut = async () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("hx.local_auth", "false");
    }
    setSession(null);
  };

  return (
    <Ctx.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signInLocal,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
