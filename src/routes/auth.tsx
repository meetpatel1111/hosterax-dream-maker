import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/hx/logo";
import { useAuth } from "@/lib/auth-context";
import { useEngine } from "@/lib/engine";
import { Server, ShieldCheck, Key } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — HosteraX" },
      { name: "description", content: "Sign in to the HosteraX self-hosted control plane." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { session, loading, signInLocal } = useAuth();
  const engine = useEngine();
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@hosterax.local");
  const [password, setPassword] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [useToken, setUseToken] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!loading && session) return <Navigate to="/dashboard" />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (useToken && tokenInput.trim()) {
        engine.save(engine.url, tokenInput.trim());
        signInLocal({ email: "admin@hosterax.local", name: "Engine Admin" }, tokenInput.trim());
        toast.success("Authenticated via Engine Token");
        nav({ to: "/dashboard" });
        return;
      }

      // Call local engine login
      const res = await engine.call<any>("POST", "/api/auth/login", {
        email,
        password,
      });

      if (res?.token) {
        engine.save(engine.url, res.token);
      }
      signInLocal(res?.user || { email, name: "Admin" }, res?.token);
      toast.success("Signed in to HosteraX Control Plane");
      nav({ to: "/dashboard" });
    } catch (e: any) {
      toast.error(e?.message ?? "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  function handleLocalAdmin() {
    signInLocal();
    toast.success("Signed in as Local Administrator");
    nav({ to: "/dashboard" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 grid-bg">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Sign in to HosteraX
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Self-hosted, 100% offline-capable control plane.
            </p>
          </div>

          <button
            type="button"
            onClick={handleLocalAdmin}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
          >
            <Server className="h-4 w-4" /> 1-Click Local Admin Sign-In
          </button>

          <div className="relative flex items-center justify-center">
            <div className="w-full border-t border-border" />
            <span className="bg-card px-2 text-[10px] uppercase font-mono tracking-widest text-muted-foreground">
              or credentials
            </span>
          </div>

          <form onSubmit={submit} className="space-y-3">
            {!useToken ? (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Email / Username</label>
                  <input
                    type="text"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@hosterax.local"
                    className="w-full rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password (default: hosterax)"
                    className="w-full rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Master Engine Token</label>
                <input
                  type="password"
                  required
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="hxt_..."
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm outline-none focus:border-primary"
                />
              </div>
            )}

            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                onClick={() => setUseToken(!useToken)}
                className="text-primary hover:underline flex items-center gap-1 font-mono text-[11px]"
              >
                <Key className="h-3 w-3" />
                {useToken ? "Use email & password" : "Use Engine token"}
              </button>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground glow-primary hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {busy ? "Signing in..." : "Sign in to Control Plane"}
            </button>
          </form>
        </div>

        <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          <span>Standalone SQLite Engine · No external dependencies</span>
        </div>
      </div>
    </div>
  );
}
