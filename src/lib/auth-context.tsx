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

export type AuthSession = {
  user: AuthUser;
  scopes: string[];
  /** true when the engine accepted us as a trusted local (same machine / same origin) client */
  local: boolean;
};

type WhoAmI = {
  ok: boolean;
  role: "admin" | "operator" | "viewer";
  scopes: string[];
  local: boolean;
  tokenName: string | null;
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
    const name = me.local ? "This device" : (me.tokenName ?? "API token");
    return {
      local: me.local,
      scopes: me.scopes,
      user: {
        id: me.local ? "local" : `token:${me.tokenName ?? "unknown"}`,
        email: me.local ? "local@hosterax" : `${me.tokenName ?? "token"}@engine`,
        name,
        role: me.role,
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
  /** Continue without a token — works only when the engine trusts this device (same machine). */
  continueLocal: () => Promise<string | null>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  session: null,
  user: null,
  loading: true,
  signIn: async () => "not ready",
  continueLocal: async () => "not ready",
  signOut: async () => {},
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
    localStorage.setItem("hx.signed_out", "1");
    setEngineConfig(readUrl(), ""); // forget the token
    setSession(null);
  }, []);

  return (
    <Ctx.Provider
      value={{ session, user: session?.user ?? null, loading, signIn, continueLocal, signOut }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
