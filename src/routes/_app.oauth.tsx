import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, KeyRound, Bot } from "lucide-react";

export const Route = createFileRoute("/_app/oauth")({
  head: () => ({
    meta: [
      { title: "OAuth apps — HosteraX" },
      {
        name: "description",
        content: "OAuth 2.1 for MCP clients is planned. API tokens work today.",
      },
    ],
  }),
  component: OAuthApps,
});

function OAuthApps() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldCheck className="h-6 w-6 text-primary" /> OAuth apps
          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
            planned
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          OAuth 2.1 (authorization-code + PKCE) for third-party apps and MCP clients is on the
          roadmap, but the engine does not implement an authorization server yet — so this page
          deliberately does not create client IDs or secrets that would not work.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4 text-primary" /> What to use today
        </div>
        <p className="text-sm text-muted-foreground">
          Every integration — the CLI, the REST API and MCP agents such as Cursor or Claude Desktop
          — authenticates with a scoped API token. Give each client its own token with the least
          privilege it needs (<code className="font-mono text-xs">read</code> for dashboards and
          inspection, <code className="font-mono text-xs">deploy</code> for CI,{" "}
          <code className="font-mono text-xs">admin</code> only where required), and revoke it
          independently at any time.
        </p>
        <Link
          to="/tokens"
          className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Manage API tokens
        </Link>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Bot className="h-4 w-4 text-primary" /> Connecting an AI agent
        </div>
        <p className="text-sm text-muted-foreground">
          See <span className="font-medium text-foreground">Settings → Model Context Protocol</span>{" "}
          for ready-to-paste configuration for Cursor (HTTP) and Claude Desktop (stdio).
        </p>
      </div>
    </div>
  );
}
