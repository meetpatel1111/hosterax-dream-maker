import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { setEngineConfig } from "./engine";
import { defaultEngineUrl } from "./engine-url";

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
  role?: string;
  app_metadata?: Record<string, any>;
  user_metadata?: Record<string, any>;
};

/** A person's account on the engine (as opposed to an API token or the local machine). */
export type Account = {
  id: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "developer" | "viewer";
  twoFactorEnabled: boolean;
  authSource: "password" | "oidc";
};

export type AuthSession = {
  user: AuthUser;
  scopes: string[];
  /** true when the engine accepted us as a trusted local (same machine / same origin) client */
  local: boolean;
  /** set when signed in with a user account (password or SSO) rather than a token */
  account: Account | null;
};

type WhoAmI = {
  ok: boolean;
  role: "admin" | "operator" | "viewer";
  scopes: string[];
  local: boolean;
  tokenName: string | null;
  user?: Account | null;
};

const readUrl = () =>
  (typeof window !== "undefined" && localStorage.getItem("hx.url")) || defaultEngineUrl();
const readToken = () => (typeof window !== "undefined" && localStorage.getItem("hx.token")) || "";

/**
 * Asks the ENGINE who we are. The dashboard has no accounts of its own: what you may do is decided
 * by the engine from your API token (or from being a trusted local client).
 */
async function whoAmI(url: string, token: string): Promise<AuthSession | null> {
  try {
    const r = await fetch(url.replace(/\/$/, "") + "/api/auth/me", {
      headers: token ? { authorization: "Bearer " + token } : {},
    });
    if (!r.ok) return null;
    const me = (await r.json()) as WhoAmI;
    const account = me.user ?? null;
    const name =
      account?.name || account?.email || (me.local ? "This device" : (me.tokenName ?? "API token"));
    return {
      local: me.local,
      scopes: me.scopes,
      account,
      user: {
        id: account?.id ?? (me.local ? "local" : `token:${me.tokenName ?? "unknown"}`),
        email:
          account?.email ?? (me.local ? "local@hosterax" : `${me.tokenName ?? "token"}@engine`),
        name,
        role: account?.role ?? me.role,
      },
    };
  } catch {
    return null;
  }
}

type AuthCtx = {
  session: AuthSession | null;
  user: AuthUser | null;
  loading: boolean;
  /** Signs in with an engine API token; resolves to an error message, or null on success. */
  signIn: (token: string, url?: string) => Promise<string | null>;
  /** Signs in with an email and password (and a two-factor code when the account has one). */
  signInWithPassword: (
    email: string,
    password: string,
    code?: string,
    url?: string,
  ) => Promise<{ error: string | null; twoFactorRequired?: boolean }>;
  /** Continue without a token — works only when the engine trusts this device (same machine). */
  continueLocal: () => Promise<string | null>;
  signOut: () => Promise<void>;
  /** Re-reads who the engine thinks we are (after enabling two-factor, a role change, …). */
  refreshSession: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  session: null,
  user: null,
  loading: true,
  signIn: async () => "not ready",
  signInWithPassword: async () => ({ error: "not ready" }),
  continueLocal: async () => "not ready",
  signOut: async () => {},
  refreshSession: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      // After an explicit sign-out we don't silently re-enter through local trust.
      const signedOut = localStorage.getItem("hx.signed_out") === "1";
      const s = signedOut ? null : await whoAmI(readUrl(), readToken());
      if (mounted.current) {
        setSession(s);
        setLoading(false);
      }
    })();

    // The engine told us a request was unauthorized (e.g. token revoked): drop the session.
    const onUnauthorized = () => {
      toast.error("Your engine session is no longer authorized — please sign in again.");
      setSession(null);
    };
    window.addEventListener("hx:unauthorized", onUnauthorized);
    return () => {
      mounted.current = false;
      window.removeEventListener("hx:unauthorized", onUnauthorized);
    };
  }, []);

  const signIn = useCallback(async (token: string, url?: string) => {
    const target = (url || readUrl()).trim().replace(/\/$/, "");
    const clean = token.trim();
    if (!clean) return "Enter your engine token.";
    const s = await whoAmI(target, clean);
    if (!s) return "The engine rejected this token (or could not be reached).";
    setEngineConfig(target, clean);
    localStorage.removeItem("hx.signed_out");
    setSession(s);
    return null;
  }, []);

  const signInWithPassword = useCallback(
    async (email: string, password: string, code?: string, url?: string) => {
      const target = (url || readUrl()).trim().replace(/\/$/, "");
      try {
        const r = await fetch(`${target}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password, ...(code ? { code } : {}) }),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok || !body.token) {
          return {
            error: body.error || `Sign-in failed (${r.status})`,
            twoFactorRequired: Boolean(body.twoFactorRequired),
          };
        }
        const err = await signIn(body.token, target);
        return { error: err };
      } catch {
        return { error: "Could not reach the engine." };
      }
    },
    [signIn],
  );

  const continueLocal = useCallback(async () => {
    const s = await whoAmI(readUrl(), "");
    if (!s) {
      return "This engine does not trust this device — sign in with an API token instead.";
    }
    setEngineConfig(readUrl(), "");
    localStorage.removeItem("hx.signed_out");
    setSession(s);
    return null;
  }, []);

  const signOut = useCallback(async () => {
    // end the engine-side session too when this is a user account (best effort)
    const token = readToken();
    if (token.startsWith("hxs_")) {
      fetch(`${readUrl().replace(/\/$/, "")}/api/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.setItem("hx.signed_out", "1");
    setEngineConfig(readUrl(), ""); // forget the token
    setSession(null);
  }, []);

  const refreshSession = useCallback(async () => {
    const s = await whoAmI(readUrl(), readToken());
    if (s) setSession(s);
  }, []);

  return (
    <Ctx.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signIn,
        signInWithPassword,
        continueLocal,
        signOut,
        refreshSession,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
