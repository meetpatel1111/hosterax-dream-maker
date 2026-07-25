import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useEngine } from "@/lib/engine";
import { Rocket, Plus, Trash2, RotateCcw, Server, Terminal, Package } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/local")({
  head: () => ({ meta: [{ title: "Local Engine — HosteraX" }] }),
  component: LocalPage,
});

const APPS = [
  { slug: "n8n", name: "n8n", image: "docker.n8n.io/n8nio/n8n", port: 5678, desc: "Workflow automation" },
  { slug: "ghost", name: "Ghost", image: "ghost:5", port: 2368, desc: "Publishing platform" },
  { slug: "gitea", name: "Gitea", image: "gitea/gitea:latest", port: 3000, desc: "Self-hosted Git" },
  { slug: "code-server", name: "code-server", image: "codercom/code-server:latest", port: 8080, desc: "VS Code in browser" },
  { slug: "uptime-kuma", name: "Uptime Kuma", image: "louislam/uptime-kuma:1", port: 3001, desc: "Uptime monitoring" },
  { slug: "vaultwarden", name: "Vaultwarden", image: "vaultwarden/server:latest", port: 80, desc: "Password manager" },
  { slug: "excalidraw", name: "Excalidraw", image: "excalidraw/excalidraw:latest", port: 80, desc: "Whiteboard" },
  { slug: "it-tools", name: "IT-Tools", image: "corentinth/it-tools:latest", port: 80, desc: "Dev utilities" },
];

function LocalPage() {
  const eng = useEngine();
  const [urlInput, setUrlInput] = useState(eng.url);
  const [tokenInput, setTokenInput] = useState(eng.token);
  const qc = useQueryClient();

  const { data: health } = useQuery({
    queryKey: ["engine-health", eng.url],
    queryFn: async () => {
      const r = await fetch(eng.url + "/health").then((r) => r.json()).catch(() => null);
      return r;
    },
    refetchInterval: 5000,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["engine-projects", eng.url, eng.token],
    queryFn: async () => (await eng.call<any[]>("GET", "/api/projects").catch(() => [])) ?? [],
    enabled: !!eng.token,
    refetchInterval: 3000,
  });

  const { data: apps = [] } = useQuery({
    queryKey: ["engine-apps", eng.url, eng.token],
    queryFn: async () => (await eng.call<any[]>("GET", "/api/apps").catch(() => [])) ?? [],
    enabled: !!eng.token,
    refetchInterval: 3000,
  });

  const { data: sys } = useQuery({
    queryKey: ["engine-sys", eng.url, eng.token],
    queryFn: async () => await eng.call<any>("GET", "/api/system").catch(() => null),
    enabled: !!eng.token,
    refetchInterval: 3000,
  });

  const [newProj, setNewProj] = useState({ name: "", source: "", buildCmd: "", startCmd: "", target: "process" });

  async function createProject() {
    if (!newProj.name || !newProj.source) { toast.error("name and source required"); return; }
    try {
      await eng.call("POST", "/api/projects", newProj);
      toast.success("project created");
      setNewProj({ name: "", source: "", buildCmd: "", startCmd: "", target: "process" });
      qc.invalidateQueries({ queryKey: ["engine-projects"] });
    } catch (e: any) { toast.error(e.message); }
  }

  async function deploy(name: string) {
    try {
      const r = await eng.call<{ id: string }>("POST", `/api/projects/${name}/deploy`, { trigger: "manual" });
      toast.success("deploy queued " + r.id);
      setStreamId(r.id);
    } catch (e: any) { toast.error(e.message); }
  }

  async function rm(name: string) {
    if (!confirm("Delete " + name + "?")) return;
    await eng.call("DELETE", `/api/projects/${name}`);
    qc.invalidateQueries({ queryKey: ["engine-projects"] });
  }

  async function installApp(app: typeof APPS[number]) {
    try {
      await eng.call("POST", "/api/apps", { slug: app.slug, name: app.name, image: app.image, port: app.port });
      toast.success(`installing ${app.name}`);
      qc.invalidateQueries({ queryKey: ["engine-apps"] });
    } catch (e: any) { toast.error(e.message); }
  }

  async function uninstallApp(id: string) {
    await eng.call("DELETE", `/api/apps/${id}`);
    qc.invalidateQueries({ queryKey: ["engine-apps"] });
  }

  // Live log stream
  const [streamId, setStreamId] = useState<string | null>(null);
  const [logs, setLogs] = useState<Array<{ stream: string; text: string }>>([]);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!streamId) return;
    setLogs([]);
    const wsUrl = eng.url.replace(/^http/, "ws") + "/ws?deployment=" + streamId;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        setLogs((prev) => [...prev, { stream: m.stream, text: m.text }]);
        setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 10);
      } catch {}
    };
    return () => ws.close();
  }, [streamId, eng.url]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Server className="h-6 w-6 text-primary" /> Local Engine
        </h1>
        <p className="text-sm text-muted-foreground">
          Drive a real HosteraX engine running on your machine. Start it with{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">cd hosterax/engine && npm start</code>
        </p>
      </div>

      {/* Connection */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Connection</h2>
          <span className={`text-xs ${health?.ok ? "text-success" : "text-destructive"}`}>
            {health?.ok ? `✓ engine v${health.version} online` : "✗ engine offline"}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="http://localhost:7777"
            className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs" />
          <input value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="hxt_..." type="password"
            className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs" />
          <button onClick={() => { eng.save(urlInput, tokenInput); toast.success("saved"); }}
            className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90">Save</button>
        </div>
      </div>

      {/* System */}
      {sys && (
        <div className="grid gap-3 md:grid-cols-4">
          <Stat label="CPU" value={`${sys.cpu.percent}%`} sub={`${sys.cpu.cores} cores`} />
          <Stat label="Memory" value={`${sys.memory.percent}%`} sub={`${sys.memory.used_mb}/${sys.memory.total_mb} MB`} />
          <Stat label="Disk" value={`${sys.disk.percent}%`} sub={`${sys.disk.used_gb}/${sys.disk.total_gb} GB`} />
          <Stat label="Host" value={sys.hostname} sub={sys.platform} />
        </div>
      )}

      {/* New project */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Plus className="h-4 w-4" /> New project</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input placeholder="name" value={newProj.name} onChange={(e) => setNewProj({ ...newProj, name: e.target.value })}
            className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs" />
          <input placeholder="git URL or local path" value={newProj.source} onChange={(e) => setNewProj({ ...newProj, source: e.target.value })}
            className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs" />
          <input placeholder="build cmd (auto-detect if blank)" value={newProj.buildCmd} onChange={(e) => setNewProj({ ...newProj, buildCmd: e.target.value })}
            className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs" />
          <input placeholder="start cmd" value={newProj.startCmd} onChange={(e) => setNewProj({ ...newProj, startCmd: e.target.value })}
            className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs" />
          <select value={newProj.target} onChange={(e) => setNewProj({ ...newProj, target: e.target.value })}
            className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs">
            <option value="process">Process</option>
            <option value="docker">Docker</option>
          </select>
          <button onClick={createProject}
            className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90">Create</button>
        </div>
      </div>

      {/* Projects */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">Projects on this engine</div>
        <div className="divide-y divide-border">
          {projects.length === 0 && <div className="p-6 text-center text-xs text-muted-foreground">No projects yet.</div>}
          {projects.map((p: any) => (
            <div key={p.name} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">{p.name}</div>
                <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{p.source} · {p.target}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => deploy(p.name)} className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2.5 py-1 text-xs text-primary hover:bg-primary/25">
                  <Rocket className="h-3 w-3" /> Deploy
                </button>
                <button onClick={() => rm(p.name)} className="rounded-md p-1.5 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* One-click apps */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Package className="h-4 w-4" /> One-click apps</h2>
        <div className="mb-4 grid gap-2 md:grid-cols-2 lg:grid-cols-4">
          {APPS.map((a) => (
            <button key={a.slug} onClick={() => installApp(a)} className="rounded-lg border border-border p-3 text-left hover:border-primary/60 hover:bg-accent/30">
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
                <div>
                  <span className="text-sm font-medium">{a.name}</span>
                  <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] uppercase">{a.status}</span>
                  {a.port && <span className="ml-2 font-mono text-xs text-muted-foreground">→ http://localhost:{a.port}</span>}
                </div>
                <button onClick={() => uninstallApp(a.id)} className="rounded-md p-1.5 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Live logs */}
      {streamId && (
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <div className="flex items-center gap-2 text-xs font-medium"><Terminal className="h-3.5 w-3.5 text-primary" /> Live logs · {streamId.slice(0, 12)}</div>
            <button onClick={() => setStreamId(null)} className="text-xs text-muted-foreground hover:text-foreground">close</button>
          </div>
          <div ref={logRef} className="max-h-[400px] overflow-y-auto bg-black/40 p-3 font-mono text-[11px]">
            {logs.length === 0 && <div className="text-muted-foreground">waiting…</div>}
            {logs.map((l, i) => (
              <div key={i} className={l.stream === "stderr" ? "text-destructive" : l.stream === "system" ? "text-primary" : "text-foreground"}>
                <span className="text-muted-foreground/60">[{l.stream}]</span> {l.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
