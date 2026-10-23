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
  const { session, loading, signIn, continueLocal } = useAuth();
  const engine = useEngine();
  const nav = useNavigate();
  const [engineUrl, setEngineUrl] = useState(engine.url);
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && session) return <Navigate to="/dashboard" />;

  async function submit(e: React.FormEvent) {
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
              Access is granted by your engine. Use an API token, or continue directly if the engine
              runs on this machine.
            </p>
          </div>

          <button
            type="button"
            onClick={handleLocal}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            <Server className="h-4 w-4" /> Continue on this device
          </button>

          <div className="relative flex items-center justify-center">
            <div className="w-full border-t border-border" />
            <span className="bg-card px-2 text-[10px] uppercase font-mono tracking-widest text-muted-foreground">
              or use a token
            </span>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Engine URL
              </label>
              <input
                type="url"
                required
                value={engineUrl}
                onChange={(e) => setEngineUrl(e.target.value)}
                placeholder="http://localhost:7777"
                className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                API token
              </label>
              <input
                type="password"
                required
                autoComplete="off"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="hxt_..."
                className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm outline-none focus:border-primary"
              />
              <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                <Key className="h-3 w-3" /> The first token is printed in the engine's console when
                it starts. Create more under Settings → API tokens.
              </p>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground glow-primary hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {busy ? "Checking…" : "Sign in with token"}
            </button>
          </form>
        </div>

        <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
          <span>Tokens are verified by your engine and never leave your infrastructure</span>
        </div>
      </div>
    </div>
  );
}
