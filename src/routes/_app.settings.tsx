import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useState } from "react";
import { toast } from "sonner";
import { useEngine, useEngineHealth } from "@/lib/engine";
import { MagicDnsSelector } from "@/components/hx/magic-dns-selector";
import { EdgeProviderSelector } from "@/components/hx/edge-provider-selector";
import { isLiveTranslateEnabled, setLiveTranslateEnabled } from "@/lib/live-translator";
import { remoteLogosEnabled, setRemoteLogosEnabled } from "@/lib/privacy";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — HosteraX" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, session, signIn, continueLocal, signOut } = useAuth();
  const engine = useEngine();
  const { data: health } = useEngineHealth();
  const [engUrl, setEngUrl] = useState(engine.url);
  const [engToken, setEngToken] = useState("");
  const [liveTranslate, setLiveTranslate] = useState(() => isLiveTranslateEnabled());
  const [remoteLogos, setRemoteLogos] = useState(() => remoteLogosEnabled());

  const { data: mcp } = useQuery({
    queryKey: ["mcp-info", engine.url],
    queryFn: () => engine.call<{ toolsCount: number; mcp: string }>("GET", "/api/mcp"),
    retry: false,
  });
  const { data: edge } = useQuery({
    queryKey: ["edge-status", engine.url],
    queryFn: () => engine.call<{ provider: string }>("GET", "/api/edge/status"),
    retry: false,
  });

  async function saveEngineConfig() {
    const err = engToken.trim() ? await signIn(engToken, engUrl) : await continueLocal();
    if (err) return toast.error(err);
    setEngToken("");
    toast.success("Connected to the engine");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Your engine connection, edge gateway, DNS and instance details.
        </p>
      </div>

      {/* Managed Edge Gateway Selector (Caddy 2 vs OpenResty vs External) */}
      <EdgeProviderSelector />

      {/* Magic Wildcard DNS Provider Setting */}
      <MagicDnsSelector />

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="text-sm font-medium">Language &amp; translation</div>
        <p className="mt-1 text-xs text-muted-foreground">
          The interface is translated offline using bundled dictionaries. Content that isn't covered
          (e.g. app descriptions) stays in English unless you enable machine translation below.
        </p>
        <label className="mt-3 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={liveTranslate}
            onChange={(e) => {
              setLiveTranslate(e.target.checked);
              setLiveTranslateEnabled(e.target.checked);
              toast[e.target.checked ? "warning" : "success"](
                e.target.checked
                  ? "Machine translation on — on-screen text is sent to Google Translate / MyMemory."
                  : "Machine translation off — nothing is sent to third parties.",
              );
            }}
          />
          <span>
            <span className="font-medium">Machine-translate everything on screen</span>
            <span className="mt-0.5 block text-xs text-amber-400">
              Privacy: this sends the visible text — including project names, logs and email — to
              third-party translation services. Leave it off for private deployments.
            </span>
          </span>
        </label>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="text-sm font-medium">Privacy</div>
        <label className="mt-3 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={remoteLogos}
            onChange={(e) => {
              setRemoteLogos(e.target.checked);
              setRemoteLogosEnabled(e.target.checked);
              toast.success(
                e.target.checked
                  ? "App logos will load from public icon CDNs (reload to apply)."
                  : "App logos off — initials are shown (reload to apply).",
              );
            }}
          />
          <span>
            <span className="font-medium">Load app logos from public icon CDNs</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Fetches icons from jsDelivr, Simple Icons and GitHub using only the app's name. Those
              services can see your IP address. Turn off to show initials instead.
            </span>
          </span>
        </label>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="text-sm font-medium">Engine connection</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Where this dashboard talks to your self-hosted engine (default: http://localhost:7777). A
          token is only needed when the engine is on another machine.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Engine URL</label>
            <input
              type="text"
              value={engUrl}
              onChange={(e) => setEngUrl(e.target.value)}
              placeholder="http://localhost:7777"
              className="w-full rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              API token (leave empty to connect as this device)
            </label>
            <input
              type="password"
              autoComplete="off"
              value={engToken}
              onChange={(e) => setEngToken(e.target.value)}
              placeholder="hxt_…"
              className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={saveEngineConfig}
            className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 w-fit"
          >
            Save &amp; reconnect
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="text-sm font-medium">Your access</div>
        <p className="mt-1 text-xs text-muted-foreground">
          HosteraX has no separate user accounts: what you can do is decided by the engine from your
          API token (or from being on the engine's own machine). Manage tokens under API tokens.
        </p>
        <div className="mt-3 grid gap-3 text-sm">
          <Row k="Signed in as" v={user?.name ?? "—"} />
          <Row k="Role" v={<span className="font-mono text-xs">{user?.role ?? "—"}</span>} />
          <Row
            k="Scopes"
            v={<span className="font-mono text-xs">{session?.scopes?.join(", ") || "—"}</span>}
          />
          <Row k="Connection" v={session?.local ? "Trusted local device" : "API token"} />
        </div>
        <button
          onClick={() => signOut()}
          className="mt-4 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          Sign out
        </button>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-emerald-400"></span>
              Model Context Protocol (MCP) AI Server
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Native JSON-RPC 2.0 endpoint allowing AI agents (Cursor, Claude Desktop, …) to query
              and manage your infrastructure within the permissions of the token they use.
            </p>
          </div>
          <span className="rounded bg-primary/10 text-primary px-2 py-0.5 text-xs font-mono">
            MCP {mcp?.mcp ?? "2024-11-05"}
          </span>
        </div>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs bg-muted/20 p-3 rounded-lg font-mono">
            <div>
              Endpoint: <span className="text-foreground">{engine.url}/api/mcp</span>
            </div>
            <div>
              Transport: <span className="text-foreground">HTTP POST (JSON-RPC 2.0)</span>
            </div>
            <div>
              Available tools:{" "}
              <span className="text-emerald-400 font-semibold">{mcp?.toolsCount ?? "—"} tools</span>
            </div>
            <div>
              Read-only tokens: <span className="text-foreground">inspect only</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Cursor / MCP-over-HTTP client config (create a dedicated token under API tokens):
            </label>
            <pre className="p-3 rounded-md bg-muted/40 font-mono text-[11px] text-foreground/90 overflow-x-auto whitespace-pre">
              {JSON.stringify(
                {
                  mcpServers: {
                    hosterax: {
                      url: `${engine.url}/api/mcp`,
                      headers: { Authorization: "Bearer <YOUR_API_TOKEN>" },
                    },
                  },
                },
                null,
                2,
              )}
            </pre>
            <label className="text-xs font-medium text-muted-foreground">
              Claude Desktop (stdio):
            </label>
            <pre className="p-3 rounded-md bg-muted/40 font-mono text-[11px] text-foreground/90 overflow-x-auto whitespace-pre">
              {JSON.stringify(
                {
                  mcpServers: {
                    hosterax: {
                      command: "npx",
                      args: ["-y", "hosterax", "mcp:stdio"],
                      env: { HOSTERAX_URL: engine.url, HOSTERAX_TOKEN: "<YOUR_API_TOKEN>" },
                    },
                  },
                },
                null,
                2,
              )}
            </pre>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="text-sm font-medium">Instance</div>
        <div className="mt-3 grid gap-3 text-sm">
          <Row k="Engine version" v={health?.version ? `HosteraX v${health.version}` : "offline"} />
          <Row k="Database" v="Embedded SQLite (WAL) — hosterax.db" />
          <Row k="License" v="Apache 2.0" />
          <Row k="Edge proxy" v={edge?.provider ?? "—"} />
          <Row k="Engine API" v={engine.url} />
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}
