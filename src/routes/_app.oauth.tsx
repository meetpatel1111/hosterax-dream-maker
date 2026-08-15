import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useEngine } from "@/lib/engine";
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

type OAuthClient = {
  id: string;
  client_id: string;
  name: string;
  redirect_uris: string[];
  scopes: string[];
  is_mcp: boolean;
  created_at: string;
};

function OAuthApps() {
  const { user } = useAuth();
  const engine = useEngine();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [redirectUri, setRedirectUri] = useState("http://localhost:3000/callback");
  const [isMcp, setIsMcp] = useState(false);
  const [issued, setIssued] = useState<{ id: string; secret: string } | null>(null);

  const { data: clients = [] } = useQuery({
    queryKey: ["oauth_clients_local", engine.url],
    queryFn: async () => {
      try {
        const stored = localStorage.getItem("hx.oauth_clients");
        return stored ? (JSON.parse(stored) as OAuthClient[]) : [];
      } catch {
        return [];
      }
    },
  });

  async function register() {
    if (!name.trim()) return toast.error("Give your app a name");
    const clientId = randomClientId();
    const secret = randomSecret();
    const newClient: OAuthClient = {
      id: "cli_" + Date.now(),
      client_id: clientId,
      name: name.trim(),
      redirect_uris: [redirectUri],
      scopes: ["read", "deploy"],
      is_mcp: isMcp,
      created_at: new Date().toISOString(),
    };

    const next = [newClient, ...clients];
    localStorage.setItem("hx.oauth_clients", JSON.stringify(next));
    setIssued({ id: clientId, secret });
    setName("");
    qc.invalidateQueries({ queryKey: ["oauth_clients_local"] });
    toast.success("OAuth client registered in HosteraX Engine");
  }

  async function del(id: string) {
    if (!confirm("Delete this OAuth client?")) return;
    const next = clients.filter((c) => c.id !== id);
    localStorage.setItem("hx.oauth_clients", JSON.stringify(next));
    qc.invalidateQueries({ queryKey: ["oauth_clients_local"] });
    toast.success("OAuth client removed");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">OAuth 2.1 & MCP Clients</h1>
        <p className="text-sm text-muted-foreground">
          Register clients for Claude Code, Cursor, Copilot, or custom MCP servers.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="text-sm font-medium">Register OAuth client</div>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="App name (e.g. Cursor MCP)"
            className="rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <input
            value={redirectUri}
            onChange={(e) => setRedirectUri(e.target.value)}
            placeholder="Redirect URI"
            className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={isMcp}
              onChange={(e) => setIsMcp(e.target.checked)}
              className="rounded"
            />
            <Bot className="h-3.5 w-3.5 text-primary" /> MCP Agent Server Client
          </label>
          <button
            onClick={register}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Register
          </button>
        </div>

        {issued && (
          <div className="mt-4 rounded-md border border-primary/40 bg-primary/10 p-3 space-y-2 font-mono text-xs">
            <div className="font-semibold text-primary">Save client credentials:</div>
            <div>
              <span className="text-muted-foreground">Client ID:</span> {issued.id}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Client Secret:</span>
              <span className="flex-1 truncate rounded bg-background px-2 py-1 select-all">
                {issued.secret}
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`${issued.id}:${issued.secret}`);
                  toast.success("Credentials copied");
                }}
                className="rounded border border-border bg-card px-2 py-1 hover:bg-accent flex items-center gap-1 font-sans"
              >
                <Copy className="h-3 w-3" /> Copy pair
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        {clients.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No OAuth clients registered yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {clients.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {c.name}
                    {c.is_mcp && (
                      <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-mono text-primary flex items-center gap-1">
                        <Bot className="h-3 w-3" /> MCP
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    ID: {c.client_id} · {c.redirect_uris[0]}
                  </div>
                </div>
                <button
                  onClick={() => del(c.id)}
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
