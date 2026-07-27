import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEngine } from "@/lib/engine";
import { toast } from "sonner";
import { Server, Package, Terminal, Trash2, ChevronDown } from "lucide-react";

export const ONE_CLICK_APPS = [
  { slug: "n8n", name: "n8n", image: "docker.n8n.io/n8nio/n8n", port: 5678, desc: "Workflow automation" },
  { slug: "ghost", name: "Ghost", image: "ghost:5", port: 2368, desc: "Publishing platform" },
  { slug: "gitea", name: "Gitea", image: "gitea/gitea:latest", port: 3000, desc: "Self-hosted Git" },
  { slug: "code-server", name: "code-server", image: "codercom/code-server:latest", port: 8080, desc: "VS Code in browser" },
  { slug: "uptime-kuma", name: "Uptime Kuma", image: "louislam/uptime-kuma:1", port: 3001, desc: "Uptime monitoring" },
  { slug: "vaultwarden", name: "Vaultwarden", image: "vaultwarden/server:latest", port: 80, desc: "Password manager" },
  { slug: "excalidraw", name: "Excalidraw", image: "excalidraw/excalidraw:latest", port: 80, desc: "Whiteboard" },
  { slug: "it-tools", name: "IT-Tools", image: "corentinth/it-tools:latest", port: 80, desc: "Dev utilities" },
];

export function useEngineHealth() {
  const eng = useEngine();
  return useQuery({
    queryKey: ["engine-health", eng.url],
    queryFn: async () => {
      try {
        const r = await fetch(eng.url + "/health");
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    },
    refetchInterval: 5000,
    retry: false,
  });
}

export function useEngineProjects() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery({
    queryKey: ["engine-projects", eng.url, eng.token],
    queryFn: async () => (await eng.call<any[]>("GET", "/api/projects").catch(() => [])) ?? [],
    enabled: !!health.data?.ok,
    refetchInterval: 3000,
  });
}

export function useEngineSystem() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery({
    queryKey: ["engine-system", eng.url, eng.token],
    queryFn: async () => await eng.call<any>("GET", "/api/system").catch(() => null),
    enabled: !!health.data?.ok,
    refetchInterval: 4000,
  });
}

export function EngineBar() {
  const eng = useEngine();
  const { data: health } = useEngineHealth();
  const [open, setOpen] = useState(false);
  const [urlInput, setUrlInput] = useState(eng.url);
  const [tokenInput, setTokenInput] = useState(eng.token);

  useEffect(() => {
    setUrlInput(eng.url);
    setTokenInput(eng.token);
  }, [eng.url, eng.token]);

  const online = !!health?.ok;

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Server className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Local engine</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{eng.url}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs ${online ? "text-success" : "text-destructive"}`}>
            {online ? `online · v${health.version}` : "offline"}
          </span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-5">
          <p className="text-xs text-muted-foreground">
            Start the runtime with{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">cd hosterax/engine && npm start</code> then
            paste the bootstrap token it prints.
          </p>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="http://localhost:7777"
              className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs"
            />
            <input
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="hxt_..."
              type="password"
              className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs"
            />
            <button
              onClick={() => {
                eng.save(urlInput.replace(/\/$/, ""), tokenInput);
                toast.success("Engine connection saved");
              }}
              className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function OneClickApps() {
  const eng = useEngine();
  const qc = useQueryClient();
  const { data: health } = useEngineHealth();
  const { data: apps = [] } = useQuery({
    queryKey: ["engine-apps", eng.url, eng.token],
    queryFn: async () => (await eng.call<any[]>("GET", "/api/apps").catch(() => [])) ?? [],
    enabled: !!health?.ok,
    refetchInterval: 4000,
  });

  async function install(app: (typeof ONE_CLICK_APPS)[number]) {
    try {
      await eng.call("POST", "/api/apps", { slug: app.slug, name: app.name, image: app.image, port: app.port });
      toast.success(`Installing ${app.name}`);
      qc.invalidateQueries({ queryKey: ["engine-apps"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function uninstall(id: string) {
    try {
      await eng.call("DELETE", `/api/apps/${id}`);
      qc.invalidateQueries({ queryKey: ["engine-apps"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Package className="h-4 w-4 text-primary" /> One-click apps
      </h2>
      <div className="mb-4 grid gap-2 md:grid-cols-2 lg:grid-cols-4">
        {ONE_CLICK_APPS.map((a) => (
          <button
            key={a.slug}
            onClick={() => install(a)}
            disabled={!health?.ok}
            className="rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/60 hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <div className="text-sm font-medium">{a.name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{a.desc}</div>
            <div className="mt-1 font-mono text-[10px] text-muted-foreground">:{a.port}</div>
          </button>
        ))}
      </div>
      {apps.length > 0 && (
        <div className="divide-y divide-border border-t border-border">
          {apps.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between py-2">
              <div className="min-w-0">
                <span className="text-sm font-medium">{a.name}</span>
                <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] uppercase">{a.status}</span>
                {a.port && (
                  <a
                    href={`http://localhost:${a.port}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 font-mono text-xs text-primary hover:underline"
                  >
                    localhost:{a.port}
                  </a>
                )}
              </div>
              <button
                onClick={() => uninstall(a.id)}
                className="rounded-md p-1.5 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EngineLogStream({ deploymentId, onClose }: { deploymentId: string; onClose: () => void }) {
  const eng = useEngine();
  const [logs, setLogs] = useState<Array<{ stream: string; text: string }>>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLogs([]);
    const wsUrl = eng.url.replace(/^http/, "ws") + "/ws?deployment=" + deploymentId;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      return;
    }
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        setLogs((prev) => [...prev, { stream: m.stream, text: m.text }]);
        setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 10);
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, [deploymentId, eng.url]);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Terminal className="h-3.5 w-3.5 text-primary" /> Live logs · {deploymentId.slice(0, 12)}
        </div>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
          close
        </button>
      </div>
      <div ref={logRef} className="max-h-[400px] overflow-y-auto bg-black/40 p-3 font-mono text-[11px]">
        {logs.length === 0 && <div className="text-muted-foreground">waiting for output…</div>}
        {logs.map((l, i) => (
          <div
            key={i}
            className={
              l.stream === "stderr" ? "text-destructive" : l.stream === "system" ? "text-primary" : "text-foreground"
            }
          >
            <span className="text-muted-foreground/60">[{l.stream}]</span> {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}
