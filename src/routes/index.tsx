import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { Rocket, Zap, Shield, Database, GitBranch, Terminal } from "lucide-react";
import { Logo } from "@/components/hx/logo";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const { session, loading } = useAuth();
  if (!loading && session) return <Navigate to="/dashboard" />;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Logo />
          <Link
            to="/auth"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Sign in
          </Link>
        </div>
      </header>

      <section className="relative overflow-hidden grid-bg">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-mono text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            v0.2.2 · Apache 2.0
          </div>
          <h1 className="mt-6 text-5xl font-semibold tracking-tight md:text-6xl">
            Deploy anything.
            <br />
            <span className="text-primary">On your own infra.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            Push-to-deploy from any git repo. Auto-detects 42 stacks, provisions SSL, manages
            databases, streams build logs — zero YAML.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
              to="/auth"
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground glow-primary hover:opacity-90"
            >
              Launch control plane
            </Link>
            <a
              href="#features"
              className="rounded-md border border-border px-5 py-2.5 text-sm font-medium hover:bg-accent"
            >
              What's inside
            </a>
          </div>
          <div className="mx-auto mt-14 max-w-3xl rounded-lg border border-border bg-surface p-4 font-mono text-left text-sm text-muted-foreground shadow-2xl">
            <div className="mb-2 flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
              <span className="ml-3 text-xs">~/hx</span>
            </div>
            <div>
              <span className="text-primary">$</span> hx deploy github.com/acme/api
            </div>
            <div>→ detected: Node.js · Express</div>
            <div>→ building image (14s)</div>
            <div>
              → SSL: acme-api.hosterax.app <span className="text-success">✓</span>
            </div>
            <div>
              → live: <span className="text-primary">https://acme-api.hosterax.app</span>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="border-t border-border bg-surface/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-3xl font-semibold tracking-tight">
            Everything the PaaS gives you.
            <br />
            Without the vendor.
          </h2>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              {
                i: Rocket,
                t: "Zero-config deploys",
                d: "42 stacks across 12 languages, auto-detected.",
              },
              { i: Shield, t: "Automatic SSL", d: "Let's Encrypt with wildcard + auto-renewal." },
              {
                i: Database,
                t: "Managed backends",
                d: "Postgres, MySQL, Mongo, Redis. One-click.",
              },
              { i: GitBranch, t: "Git-native", d: "Push to main. We handle the rest." },
              { i: Terminal, t: "Live build logs", d: "Streaming SSE + xterm.js in-browser." },
              { i: Zap, t: "Auto-scaling", d: "Multi-node ready. Sleeps when idle." },
            ].map((f) => (
              <div key={f.t} className="rounded-lg border border-border bg-card p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
                  <f.i className="h-4 w-4" />
                </div>
                <div className="mt-4 font-medium">{f.t}</div>
                <div className="mt-1 text-sm text-muted-foreground">{f.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        HosteraX · Apache 2.0 · Built for self-hosters
      </footer>
    </div>
  );
}
