import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/hx/logo";
import { useAuth } from "@/lib/auth-context";
import { useEngine } from "@/lib/engine";
import { Server, ShieldCheck, Key, LogIn, Building2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — HosteraX" },
      { name: "description", content: "Sign in to the HosteraX self-hosted control plane." },
    ],
  }),
  component: AuthPage,
});

type Providers = { setupRequired: boolean; password: boolean; sso: { name: string } | null };

const inputClass =
  "w-full rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary";

function AuthPage() {
  const { session, loading, signIn, signInWithPassword, continueLocal } = useAuth();
  const engine = useEngine();
  const nav = useNavigate();
  const [engineUrl, setEngineUrl] = useState(engine.url);
  const [tokenInput, setTokenInput] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [ssoError, setSsoError] = useState<string | null>(null);

  // What does this engine offer (accounts, SSO)? Asked again whenever the address changes.
  useEffect(() => {
    let cancelled = false;
    const url = engineUrl.trim().replace(/\/$/, "");
    if (!/^https?:\/\//.test(url)) return;
    fetch(`${url}/api/auth/providers`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => !cancelled && setProviders(p))
      .catch(() => !cancelled && setProviders(null));
    return () => {
      cancelled = true;
    };
  }, [engineUrl]);

  // Coming back from single sign-on: the engine puts the session in the URL fragment (never sent to
  // any server) or an error message in the query string.
  useEffect(() => {
    const token = /[#&]session=(hxs_[0-9a-f]+)/.exec(window.location.hash)?.[1];
    const error = new URLSearchParams(window.location.search).get("sso_error");
    if (token || error) window.history.replaceState(null, "", window.location.pathname);
    if (error) setSsoError(error);
    if (token) {
      setBusy(true);
      signIn(token, engineUrl)
        .then((err) => (err ? setSsoError(err) : nav({ to: "/dashboard" })))
        .finally(() => setBusy(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loading && session) return <Navigate to="/dashboard" />;

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await signInWithPassword(email, password, needsCode ? code : undefined, engineUrl);
      if (r.twoFactorRequired) setNeedsCode(true);
      if (r.error) {
        // asking for the code is a step, not a failure
        if (r.twoFactorRequired && !code) toast.message("Enter your two-factor code to continue");
        else toast.error(r.error);
        return;
      }
      toast.success("Signed in");
      nav({ to: "/dashboard" });
    } finally {
      setBusy(false);
    }
  }

  async function submitToken(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const err = await signIn(tokenInput, engineUrl);
      if (err) {
        toast.error(err);
        return;
      }
      toast.success("Signed in");
      nav({ to: "/dashboard" });
    } finally {
      setBusy(false);
    }
  }

  async function handleLocal() {
    setBusy(true);
    try {
      const err = await continueLocal();
      if (err) {
        toast.error(err);
        return;
      }
      toast.success("Connected to the local engine");
      nav({ to: "/dashboard" });
    } finally {
      setBusy(false);
    }
  }

  const ssoUrl = `${engineUrl.trim().replace(/\/$/, "")}/api/auth/oidc/login`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 grid-bg">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Sign in to HosteraX</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Access is granted by your engine: a user account, an API token, or being on the
              engine's own machine.
            </p>
          </div>

          {ssoError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Single sign-on failed: {ssoError}
            </div>
          )}

          <div>
            <label
              htmlFor="auth-engine-url"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Engine URL
            </label>
            <input
              id="auth-engine-url"
              type="url"
              required
              value={engineUrl}
              onChange={(e) => setEngineUrl(e.target.value)}
              placeholder="http://localhost:7777"
              className={`${inputClass} font-mono`}
            />
          </div>

          {providers?.sso && (
            <a
              href={ssoUrl}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
            >
              <Building2 className="h-4 w-4" /> Sign in with {providers.sso.name}
            </a>
          )}

          {providers?.password && (
            <form onSubmit={submitPassword} className="space-y-3">
              <div>
                <label
                  htmlFor="auth-email"
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  Email
                </label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label
                  htmlFor="auth-password"
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  Password
                </label>
                <input
                  id="auth-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                />
              </div>
              {needsCode && (
                <div>
                  <label
                    htmlFor="auth-code"
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                  >
                    Two-factor code (or a recovery code)
                  </label>
                  <input
                    id="auth-code"
                    required
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    className={`${inputClass} font-mono tracking-widest`}
                  />
                </div>
              )}
              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground glow-primary hover:opacity-90 disabled:opacity-50 transition-all"
              >
                <LogIn className="h-4 w-4" /> {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          )}

          {providers?.setupRequired && (
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              This engine has no user accounts yet. Continue on this device (or use the engine
              token), then create the owner account under <strong>Users &amp; access</strong>.
            </p>
          )}

          <div className="relative flex items-center justify-center">
            <div className="w-full border-t border-border" />
            <span className="bg-card px-2 text-[10px] uppercase font-mono tracking-widest text-muted-foreground">
              or
            </span>
          </div>

          <button
            type="button"
            onClick={handleLocal}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-xs font-semibold hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Server className="h-4 w-4" /> Continue on this device
          </button>

          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
              Use an API token instead
            </summary>
            <form onSubmit={submitToken} className="mt-3 space-y-3">
              <input
                aria-label="API token"
                type="password"
                required
                autoComplete="off"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="hxt_..."
                className={`${inputClass} font-mono`}
              />
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Key className="h-3 w-3" /> The first token is printed in the engine's console when
                it starts. Create more under API tokens.
              </p>
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-md border border-border bg-surface-2 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50 transition-all"
              >
                {busy ? "Checking…" : "Sign in with token"}
              </button>
            </form>
          </details>
        </div>

        <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          <span>Credentials are verified by your engine and never leave your infrastructure</span>
        </div>
      </div>
    </div>
  );
}
