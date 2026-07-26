import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/hx/logo";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — HosteraX" }, { name: "description", content: "Sign in to the HosteraX control plane." }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" ? s.next : "",
  }),
  component: AuthPage,
});

// Only allow same-origin relative paths as return targets.
function safeNext(n: string): string {
  return n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
}

function AuthPage() {
  const { session, loading } = useAuth();
  const { next } = Route.useSearch();
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const target = safeNext(next);

  if (!loading && session) return <Navigate to={target as never} />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "up") {
        const redirectUrl = `${window.location.origin}${target}`;
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: redirectUrl },
        });
        if (error) throw error;
        toast.success("Account created");
        nav({ to: target as never });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        nav({ to: target as never });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Auth failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 grid-bg">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-2xl">
          <h1 className="text-xl font-semibold tracking-tight">
            {mode === "in" ? "Sign in to your control plane" : "Create your control plane"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "in" ? "Welcome back." : "One account manages every server."}
          </p>
          <form onSubmit={submit} className="mt-5 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
              <input
                type="email" required autoFocus value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                placeholder="you@company.dev"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label>
              <input
                type="password" required minLength={6} value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit" disabled={busy}
              className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Working..." : mode === "in" ? "Sign in" : "Create account"}
            </button>
          </form>
          <div className="mt-4 text-center text-xs text-muted-foreground">
            {mode === "in" ? (
              <>No account? <button className="text-primary hover:underline" onClick={() => setMode("up")}>Sign up</button></>
            ) : (
              <>Already have one? <button className="text-primary hover:underline" onClick={() => setMode("in")}>Sign in</button></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
