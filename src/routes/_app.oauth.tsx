import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ShieldCheck, Plus, Trash2, Copy, Bot } from "lucide-react";

export const Route = createFileRoute("/_app/oauth")({
  head: () => ({
    meta: [
      { title: "OAuth apps — HosteraX" },
      { name: "description", content: "OAuth 2.1 clients and MCP integrations for AI agents." },
    ],
  }),
  component: OAuthApps,
});

function randomClientId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return "hxc_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function randomSecret() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "hxs_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function OAuthApps() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [redirectUri, setRedirectUri] = useState("http://localhost:3000/callback");
  const [isMcp, setIsMcp] = useState(false);
  const [issued, setIssued] = useState<{ id: string; secret: string } | null>(null);

  const { data: clients = [] } = useQuery({
    queryKey: ["oauth_clients"],
    queryFn: async () => {
      const { data } = await supabase.from("oauth_clients").select("*").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: grants = [] } = useQuery({
    queryKey: ["oauth_grants"],
    queryFn: async () => {
      const { data } = await supabase.from("oauth_grants").select("*, oauth_clients(name)").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  async function register() {
    if (!user || !name.trim()) return toast.error("Give your app a name");
    const clientId = randomClientId();
    const secret = randomSecret();
    const secretHash = await sha256(secret);
    const { error } = await supabase.from("oauth_clients").insert({
      owner_id: user.id,
      client_id: clientId,
      client_secret_hash: secretHash,
      name: name.trim(),
      redirect_uris: [redirectUri],
      scopes: ["read", "deploy"],
      is_mcp: isMcp,
    });
    if (error) return toast.error(error.message);
    setIssued({ id: clientId, secret });
    setName("");
    qc.invalidateQueries({ queryKey: ["oauth_clients"] });
  }

  async function del(id: string) {
    if (!confirm("Delete this OAuth client? All issued grants will be revoked.")) return;
    await supabase.from("oauth_clients").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["oauth_clients"] });
    qc.invalidateQueries({ queryKey: ["oauth_grants"] });
  }

  async function revoke(id: string) {
    await supabase.from("oauth_grants").update({ revoked: true }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["oauth_grants"] });
    toast.success("Grant revoked");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">OAuth apps</h1>
        <p className="text-sm text-muted-foreground">OAuth 2.1 authorization server for third-party apps and MCP-compatible AI agents.</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-primary" /> Register client
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="App name" className="rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary" />
          <input value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} placeholder="Redirect URI" className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm outline-none focus:border-primary" />
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={isMcp} onChange={(e) => setIsMcp(e.target.checked)} />
          <Bot className="h-3.5 w-3.5" /> This is an MCP client (AI agent)
        </label>
        <div className="mt-3 flex justify-end">
          <button onClick={register} className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> Register
          </button>
        </div>
        {issued && (
          <div className="mt-4 space-y-2 rounded-md border border-primary/40 bg-primary/10 p-3">
            <div className="text-xs text-primary">Copy your credentials — the secret won't be shown again.</div>
            <Row label="Client ID" value={issued.id} />
            <Row label="Client secret" value={issued.secret} />
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-3 text-sm font-medium">Registered clients</div>
        {clients.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No clients yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {clients.map((c: any) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {c.name}
                    {c.is_mcp && <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] uppercase text-primary">MCP</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{c.client_id}</span>
                    {" · "}redirects: {(c.redirect_uris ?? []).join(", ") || "—"}
                    {" · "}scopes: {(c.scopes ?? []).join(" ")}
                  </div>
                </div>
                <button onClick={() => del(c.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-3 text-sm font-medium">Authorization grants</div>
        {grants.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No active grants.</div>
        ) : (
          <div className="divide-y divide-border">
            {grants.map((g: any) => (
              <div key={g.id} className="flex items-center gap-3 p-3 text-sm">
                <div className="flex-1">
                  <div>{g.oauth_clients?.name ?? "Unknown app"} · <span className="text-xs text-muted-foreground">{g.grant_type}</span></div>
                  <div className="text-xs text-muted-foreground">
                    scopes: {(g.scopes ?? []).join(" ")}
                    {" · "}granted {formatDistanceToNow(new Date(g.created_at))} ago
                    {g.revoked && " · revoked"}
                  </div>
                </div>
                {!g.revoked && (
                  <button onClick={() => revoke(g.id)} className="text-xs text-muted-foreground hover:text-destructive">Revoke</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      <span className="w-24 text-muted-foreground">{label}</span>
      <span className="flex-1 break-all">{value}</span>
      <button onClick={() => { navigator.clipboard.writeText(value); toast.success("Copied"); }} className="text-primary">
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}
