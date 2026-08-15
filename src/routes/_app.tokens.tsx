import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { KeyRound, Plus, Trash2, Copy, Shield } from "lucide-react";
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

const ALL_SCOPES: Array<"read" | "deploy" | "admin"> = ["read", "deploy", "admin"];

function Tokens() {
  const engine = useEngine();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Array<"read" | "deploy" | "admin">>(["read", "deploy", "admin"]);
  const [issued, setIssued] = useState<string | null>(null);

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ["tokens-sqlite", engine.url],
    queryFn: async () => {
      try {
        const data = await engine.call<any[]>("GET", "/api/tokens");
        return (data ?? []).map((t) => ({
          id: t.token,
          token: t.token,
          name: t.name || "token",
          created_at: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString(),
          token_prefix: (t.token || "").slice(0, 10),
          scopes: ["read", "deploy", "admin"],
        }));
      } catch {
        return [];
      }
    },
    refetchInterval: 5000,
  });

  async function create() {
    if (!name.trim()) return toast.error("Give the token a name");
    try {
      const res = await engine.call<any>("POST", "/api/tokens", {
        name: name.trim(),
        scopes,
      });
      if (res?.token) {
        setIssued(res.token);
        toast.success(`Token "${name.trim()}" created and saved to SQLite DB`);
      } else {
        toast.success("Token created");
      }
      setName("");
      qc.invalidateQueries({ queryKey: ["tokens-sqlite"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to create token");
    }
  }

  async function revoke(tokenVal: string) {
    if (!confirm("Revoke this token? Requests using it will start failing.")) return;
    try {
      await engine.call("DELETE", `/api/tokens/${tokenVal}`);
      qc.invalidateQueries({ queryKey: ["tokens-sqlite"] });
      toast.success("Token revoked from SQLite DB");
    } catch (e: any) {
      toast.error(e.message || "Failed to revoke token");
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API tokens</h1>
        <p className="text-sm text-muted-foreground">
          Personal access tokens for the HosteraX CLI, REST API, and MCP stored in SQLite.
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
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
            {ALL_SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={(e) => {
                    setScopes(
                      e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s),
                    );
                  }}
                />
                <span className="capitalize">{s}</span>
              </label>
            ))}
          </div>
          <button
            onClick={create}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Create
          </button>
        </div>

        {issued && (
          <div className="mt-4 rounded-md border border-primary/40 bg-primary/10 p-3">
            <div className="text-xs font-semibold text-primary">
              New token created — copy now (won't be shown in full again):
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
        {tokens.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No personal access tokens created yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {tokens.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {t.name}
                    <div className="flex gap-1">
                      {t.scopes?.map((s: string) => (
                        <span
                          key={s}
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono capitalize"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                    <span>{t.token_prefix}••••••••</span>
                    <span>·</span>
                    <span>Created {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}</span>
                  </div>
                </div>
                <button
                  onClick={() => revoke(t.token)}
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
