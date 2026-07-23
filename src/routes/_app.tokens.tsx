import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { KeyRound, Plus, Trash2, Copy, Shield } from "lucide-react";

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

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "hx_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function Tokens() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Array<"read" | "deploy" | "admin">>(["read"]);
  const [issued, setIssued] = useState<string | null>(null);

  const { data: tokens = [] } = useQuery({
    queryKey: ["tokens"],
    queryFn: async () => {
      const { data } = await supabase.from("access_tokens").select("*").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  async function create() {
    if (!user || !name.trim()) return toast.error("Give the token a name");
    const raw = randomToken();
    const hash = await sha256(raw);
    const { error } = await supabase.from("access_tokens").insert({
      owner_id: user.id,
      name: name.trim(),
      token_prefix: raw.slice(0, 10),
      token_hash: hash,
      scopes: scopes as any,
    });
    if (error) return toast.error(error.message);
    setIssued(raw);
    setName("");
    setScopes(["read"]);
    qc.invalidateQueries({ queryKey: ["tokens"] });
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this token? Requests using it will start failing.")) return;
    const { error } = await supabase.from("access_tokens").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["tokens"] });
    toast.success("Token revoked");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API tokens</h1>
        <p className="text-sm text-muted-foreground">Personal access tokens for the HosteraX CLI, REST API, and MCP.</p>
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
                  onChange={(e) =>
                    setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))
                  }
                />
                {s}
              </label>
            ))}
          </div>
          <button onClick={create} className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> Create
          </button>
        </div>
        {issued && (
          <div className="mt-4 rounded-md border border-primary/40 bg-primary/10 p-3">
            <div className="mb-1 text-xs text-primary">Copy this token now — you won't see it again.</div>
            <div className="flex items-center gap-2 font-mono text-sm break-all">
              <span className="flex-1">{issued}</span>
              <button onClick={() => { navigator.clipboard.writeText(issued); toast.success("Copied"); }} className="text-primary hover:opacity-80">
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        {tokens.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No tokens yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {tokens.map((t: any) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <Shield className="h-4 w-4 text-primary" />
                <div className="flex-1">
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{t.token_prefix}…</span>
                    {" · "}
                    scopes: {(t.scopes ?? []).join(", ")}
                    {" · "}
                    created {formatDistanceToNow(new Date(t.created_at))} ago
                  </div>
                </div>
                <button onClick={() => revoke(t.id)} className="text-muted-foreground hover:text-destructive">
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
