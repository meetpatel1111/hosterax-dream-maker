import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { KeyRound, Plus, Trash2, Copy } from "lucide-react";
import { useEngine } from "@/lib/engine";

export const Route = createFileRoute("/_app/tokens")({
  head: () => ({
    meta: [
      { title: "API tokens — HosteraX" },
      { name: "description", content: "Personal access tokens for HosteraX API, CLI, and MCP." },
    ],
  }),
  component: Tokens,
});

type Scope = "read" | "deploy" | "admin";

const SCOPE_HELP: Record<Scope, string> = {
  read: "View projects, logs and metrics. Cannot change anything.",
  deploy: "Everything in read, plus deploy, restart, env vars, domains, backups.",
  admin: "Full control, including tokens, servers, settings and destructive actions.",
};

type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_at: number;
  last_used_at: number | null;
};

function Tokens() {
  const engine = useEngine();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("deploy");
  const [issued, setIssued] = useState<string | null>(null);

  const {
    data: tokens = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["tokens", engine.url],
    queryFn: () => engine.call<TokenRow[]>("GET", "/api/tokens"),
    refetchInterval: 10000,
  });

  async function create() {
    if (!name.trim()) return toast.error("Give the token a name");
    try {
      const res = await engine.call<{ token: string }>("POST", "/api/tokens", {
        name: name.trim(),
        scopes: [scope],
      });
      setIssued(res.token);
      toast.success(`Token "${name.trim()}" created`);
      setName("");
      qc.invalidateQueries({ queryKey: ["tokens"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to create token");
    }
  }

  async function revoke(t: TokenRow) {
    if (!confirm(`Revoke "${t.name}"? Anything using it will start failing immediately.`)) return;
    try {
      await engine.call("DELETE", `/api/tokens/${t.id}`);
      qc.invalidateQueries({ queryKey: ["tokens"] });
      toast.success("Token revoked");
    } catch (e: any) {
      toast.error(e.message || "Failed to revoke token");
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API tokens</h1>
        <p className="text-sm text-muted-foreground">
          Tokens authenticate the HosteraX CLI, REST API and MCP clients. Only a one-way hash is
          stored, so a token can be shown exactly once — when you create it.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4 text-primary" /> Create token
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. laptop-cli"
            className="rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            className="rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
          >
            {(Object.keys(SCOPE_HELP) as Scope[]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={create}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Create
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{SCOPE_HELP[scope]}</p>

        {issued && (
          <div className="mt-4 rounded-md border border-primary/40 bg-primary/10 p-3">
            <div className="text-xs font-semibold text-primary">
              Copy your new token now — it will not be shown again:
            </div>
            <div className="mt-1 flex items-center gap-2 font-mono text-sm">
              <span className="flex-1 truncate rounded bg-background px-2 py-1 select-all">
                {issued}
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(issued);
                  toast.success("Token copied");
                }}
                className="rounded border border-border bg-card px-2 py-1 text-xs hover:bg-accent flex items-center gap-1"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        {error ? (
          <div className="p-8 text-center text-sm text-destructive">
            {(error as Error).message.includes("scope")
              ? "Your token is not allowed to manage tokens (admin scope required)."
              : (error as Error).message}
          </div>
        ) : isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : tokens.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No tokens yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {tokens.map((t) => (
              <div key={t.id} className="flex items-center justify-between p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {t.name}
                    <div className="flex gap-1">
                      {t.scopes.map((s) => (
                        <span
                          key={s}
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono"
                        >
                          {s === "*" ? "admin (all)" : s}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
                    <span>{t.prefix}••••••••</span>
                    <span>·</span>
                    <span>
                      Created {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
                    </span>
                    <span>·</span>
                    <span>
                      {t.last_used_at
                        ? `Last used ${formatDistanceToNow(new Date(t.last_used_at), { addSuffix: true })}`
                        : "Never used"}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => revoke(t)}
                  title="Revoke"
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
