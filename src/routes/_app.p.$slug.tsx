import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/hx/status-badge";
import { STACKS, ENVIRONMENTS } from "@/lib/stacks";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { HealthMetrics } from "@/components/hx/health-metrics";
import { DeploymentDiffModal } from "@/components/hx/deployment-diff";
import { BackupWizardModal } from "@/components/hx/backup-wizard";
import { useEngine } from "@/lib/engine";
import {
  ArrowLeft, Rocket, GitBranch, Globe, Trash2, Eye, EyeOff,
  Plus, ExternalLink, Cpu, MemoryStick, Network, HardDrive, Copy, RotateCcw, Tag, FileCode, Database,
} from "lucide-react";

export const Route = createFileRoute("/_app/p/$slug")({
  head: ({ params }) => ({ meta: [{ title: `${params.slug} — HosteraX` }] }),
  component: ProjectPage,
});

type Tab = "overview" | "deployments" | "logs" | "env" | "domains" | "databases" | "settings";

function ProjectPage() {
  const { slug } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [environment, setEnvironment] = useState<"production" | "preview" | "development">("production");
  const engine = useEngine();

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", slug],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").eq("slug", slug).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Live subscription: refresh project when deployment status flips
  useEffect(() => {
    if (!project) return;
    const ch = supabase
      .channel(`proj-${project.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter: `id=eq.${project.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["project", slug] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [project?.id, slug, qc]);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;
  if (!project) {
    return (
      <div className="mx-auto max-w-xl rounded-lg border border-border bg-card p-8 text-center">
        <h2 className="text-lg font-medium">Project not found</h2>
        <Link to="/dashboard" className="mt-4 inline-block text-sm text-primary hover:underline">← back to dashboard</Link>
      </div>
    );
  }

  const stack = STACKS.find((s) => s.id === project.stack);

  async function deploy(trigger: "manual" | "git" | "upload" | "url" | "cli" | "api" = "manual") {
    try {
      // Upsert project to local engine
      await eng.call("POST", "/api/projects", {
        name: project!.name,
        source: "./", // Default to current dir or fetch from git if implemented
        build_cmd: project!.build_command ?? "npm install && npm run build",
        start_cmd: "npm start",
        target: project!.target_type || "process"
      });
      // Trigger deploy
      await engine.call("POST", `/api/projects/${project!.name}/deploy`, { trigger });
      toast.success(`Deploy queued on Server`);
      setTab("logs");
      qc.invalidateQueries({ queryKey: ["deployments", project!.id] });
    } catch (e: any) {
      toast.error(e?.message ?? "Deploy failed");
    }
  }

  async function del() {
    if (!confirm(`Delete project "${project!.name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("projects").delete().eq("id", project!.id);
    if (error) return toast.error(error.message);
    toast.success("Project deleted");
    nav({ to: "/dashboard" });
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "deployments", label: "Deployments" },
    { id: "logs", label: "Logs" },
    { id: "env", label: "Env vars" },
    { id: "domains", label: "Domains" },
    { id: "databases", label: "Databases" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link to="/dashboard" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> All projects
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface-2 text-xl">{stack?.icon ?? "📦"}</div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatusBadge status={project.status} />
              <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" /> {project.branch}</span>
              {project.subdomain && (
                <a href={`https://${project.subdomain}.hosterax.app`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-primary">
                  <Globe className="h-3 w-3" /> {project.subdomain}.hosterax.app <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as any)}
            className="rounded-md border border-input bg-input/40 px-2 py-2 text-xs outline-none focus:border-primary"
          >
            {ENVIRONMENTS.map((e) => <option key={e.id} value={e.id}>{e.icon} {e.name}</option>)}
          </select>
          <button onClick={() => deploy("manual")} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Rocket className="h-4 w-4" /> Deploy
          </button>
        </div>
      </div>

      {project.current_version && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Tag className="h-3 w-3 text-primary" />
          current release <span className="font-mono text-primary">{project.current_version}</span>
          <span>·</span>
          <span>target: {project.target_type ?? "docker"}</span>
          {project.workspace_type && project.workspace_type !== "none" && (
            <><span>·</span><span>workspace: {project.workspace_type}</span></>
          )}
        </div>
      )}

      <div className="border-b border-border">
        <div className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id} onClick={() => setTab(t.id)}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm transition-colors ${tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && <Overview project={project} />}
      {tab === "deployments" && <Deployments projectId={project.id} projectName={project.name} />}
      {tab === "logs" && <LiveLogs projectName={project.name} />}
      {tab === "env" && <EnvVars projectId={project.id} />}
      {tab === "domains" && <ProjectDomains projectId={project.id} projectName={project.name} />}
      {tab === "databases" && <Databases projectId={project.id} />}
      {tab === "settings" && <Settings project={project} onDelete={del} />}
    </div>
  );
}

function Overview({ project }: { project: any }) {
  const { data: recent = [] } = useQuery({
    queryKey: ["deployments", project.id, "recent"],
    queryFn: async () => {
      const { data } = await supabase.from("deployments").select("*").eq("project_id", project.id).order("created_at", { ascending: false }).limit(5);
      return data ?? [];
    },
    refetchInterval: 2000,
  });

  const metrics = useMemo(() => ({
    cpu: 8 + Math.random() * 24,
    mem: 42 + Math.random() * 30,
    net: 1.2 + Math.random() * 4,
    disk: 18 + Math.random() * 6,
  }), [project.id]);

  return (
    <div className="space-y-6">
      <HealthMetrics projectId={project.id} projectName={project.name} status={project.status} />

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="font-semibold text-sm">Recent Deployments Feed</div>
          <div className="text-xs text-muted-foreground">Showing last 5 releases</div>
        </div>
        <div className="divide-y divide-border">
          {recent.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No deployments yet. Click Deploy to build.</div>
          ) : recent.map((d: any) => (
            <div key={d.id} className="flex items-center justify-between p-4 text-sm hover:bg-accent/30 transition-colors">
              <div className="flex items-center gap-3">
                <StatusBadge status={d.status} />
                <div>
                  <div className="font-medium text-foreground">{d.commit_message || "Deployment"}</div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">{d.commit_sha} · {d.branch}</div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground text-right">
                <div>{formatDistanceToNow(new Date(d.created_at))} ago</div>
                <div className="font-mono">{d.duration_ms ? `${(d.duration_ms / 1000).toFixed(1)}s` : "—"}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Deployments({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [showDiff, setShowDiff] = useState(false);
  const [diffBaseId, setDiffBaseId] = useState<string | undefined>();

  const { data: project } = useQuery({
    queryKey: ["project-raw", projectId],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle();
      return data;
    },
  });
  const { data: deployments = [] } = useQuery({
    queryKey: ["deployments", projectId],
    queryFn: async () => {
      const { data } = await supabase.from("deployments").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
      return data ?? [];
    },
    refetchInterval: 2000,
  });

  async function doRollback(dep: any) {
    if (!project) return;
    if (!confirm(`Rollback to ${dep.version ?? dep.commit_sha}? A new build will be queued from this snapshot.`)) return;
    try {
      await rollbackTo(project as any, dep.id, dep.version);
      toast.success("Rollback queued");
      qc.invalidateQueries({ queryKey: ["deployments", projectId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Rollback failed");
    }
  }

  return (
    <div className="space-y-4">
      {deployments.length >= 2 && (
        <div className="flex justify-end">
          <button
            onClick={() => { setDiffBaseId(undefined); setShowDiff(true); }}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            <FileCode className="h-3.5 w-3.5 text-primary" /> Compare Releases (Diff)
          </button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {deployments.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No deployments yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {deployments.map((d: any, idx: number) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-accent/30 transition-colors">
                <div className="flex items-center gap-3">
                  <StatusBadge status={d.status} />
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {d.commit_message ?? "Deployment"}
                      {d.version && <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">{d.version}</span>}
                      {d.rollback_of && <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[10px] text-warning">rollback</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{d.commit_sha}</span>
                      <span>·</span><span>{d.branch}</span>
                      <span>·</span><span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase">{d.environment}</span>
                      <span>·</span><span className="uppercase text-[10px]">{d.trigger_type}</span>
                      <span>·</span><span>phase: {d.phase ?? "—"}</span>
                      <span>·</span><span>{format(new Date(d.created_at), "MMM d, HH:mm:ss")}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setDiffBaseId(d.id); setShowDiff(true); }}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/60 hover:text-primary transition-colors"
                  >
                    <FileCode className="h-3 w-3" /> Diff
                  </button>

                  {d.status === "success" && idx !== 0 && (
                    <button onClick={() => doRollback(d)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:border-primary/60 hover:text-primary transition-colors">
                      <RotateCcw className="h-3 w-3" /> Rollback here
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showDiff && <DeploymentDiffModal deployments={deployments} initialBaseId={diffBaseId} onClose={() => setShowDiff(false)} />}
    </div>
  );
}

function LiveLogs({ projectName }: { projectName: string }) {
  const engine = useEngine();
  const [selected, setSelected] = useState<string | null>(null);
  
  const { data: deployments = [] } = useQuery({
    queryKey: ["local-deployments", projectName, engine.url],
    queryFn: async () => {
      const data = await engine.call<any[]>("GET", `/api/projects/${projectName}/deployments`);
      return data ?? [];
    },
    refetchInterval: 3000,
  });
  
  const active = selected ?? deployments[0]?.id ?? null;

  const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => {
    if (!active) return;
    setLogs([]);
    const ch = new EventSource(`${engine.url}/api/projects/${projectName}/logs/stream?token=${engine.token}`);
    ch.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        setLogs((prev) => [...prev, payload]);
      } catch (err) {}
    };
    return () => ch.close();
  }, [active, eng.url]);

  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">Recent Builds</div>
        <div className="max-h-[500px] overflow-y-auto">
          {deployments.length === 0 && <div className="p-4 text-xs text-muted-foreground">No builds yet</div>}
          {deployments.map((d: any) => (
            <button
              key={d.id} onClick={() => setSelected(d.id)}
              className={`flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-xs hover:bg-accent ${active === d.id ? "bg-accent" : ""}`}
            >
              <StatusBadge status={d.phase === "ready" ? "success" : d.phase === "failed" ? "error" : "building"} />
              <div className="ml-auto flex flex-col items-end">
                <span className="font-mono text-muted-foreground">{d.version}</span>
                <span className="text-[10px] text-muted-foreground/50">{formatDistanceToNow(new Date(d.started_at))} ago</span>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-border bg-[oklch(0.12_0.01_265)] font-mono text-xs">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 text-muted-foreground">
          <span>build.log · {logs.length} lines</span>
          {active && <span className="text-primary">● live</span>}
        </div>
        <div className="h-[500px] overflow-y-auto p-4 flex flex-col gap-1">
          {!active && <div className="text-muted-foreground">Trigger a deployment to see logs stream in real time.</div>}
          {logs.map((l, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-muted-foreground/60">{format(new Date(l.ts), "HH:mm:ss")}</span>
              <span className={
                l.stream === "stderr" ? "text-destructive" :
                l.stream === "system" ? "text-primary/70" :
                "text-foreground/85"
              }>{l.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EnvVars({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: vars = [] } = useQuery({
    queryKey: ["envs", projectId],
    queryFn: async () => {
      const { data } = await supabase.from("env_vars").select("*").eq("project_id", projectId).order("key");
      return data ?? [];
    },
  });
  const [key, setKey] = useState(""); const [value, setValue] = useState(""); const [secret, setSecret] = useState(true);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});

  async function add() {
    if (!key.trim()) return;
    const { error } = await supabase.from("env_vars").insert({ project_id: projectId, key: key.trim(), value, is_secret: secret });
    if (error) return toast.error(error.message);
    setKey(""); setValue("");
    qc.invalidateQueries({ queryKey: ["envs", projectId] });
  }
  async function del(id: string) {
    await supabase.from("env_vars").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["envs", projectId] });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 text-sm font-medium">Add variable</div>
        <div className="flex flex-wrap gap-2">
          <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} placeholder="KEY" className="flex-1 min-w-[160px] rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm outline-none focus:border-primary" />
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="value" className="flex-[2] min-w-[200px] rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm outline-none focus:border-primary" />
          <label className="flex items-center gap-2 rounded-md border border-border px-3 text-xs">
            <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} /> Secret
          </label>
          <button onClick={add} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card">
        {vars.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No variables. Add API keys, connection strings, or config.</div>
        ) : (
          <div className="divide-y divide-border">
            {vars.map((v: any) => (
              <div key={v.id} className="flex items-center gap-3 p-3 font-mono text-sm">
                <span className="w-56 truncate text-primary">{v.key}</span>
                <span className="flex-1 truncate text-muted-foreground">
                  {v.is_secret && !reveal[v.id] ? "•".repeat(Math.min(v.value.length, 16)) : v.value}
                </span>
                {v.is_secret && (
                  <button onClick={() => setReveal({ ...reveal, [v.id]: !reveal[v.id] })} className="text-muted-foreground hover:text-foreground">
                    {reveal[v.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                )}
                <button onClick={() => { navigator.clipboard.writeText(v.value); toast.success("Copied"); }} className="text-muted-foreground hover:text-foreground">
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => del(v.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Databases({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: dbs = [] } = useQuery({
    queryKey: ["dbs", projectId],
    queryFn: async () => {
      const { data } = await supabase.from("databases").select("*").eq("project_id", projectId).order("created_at");
      return data ?? [];
    },
    refetchInterval: 3000,
  });

  async function provision(engine: string) {
    const name = prompt(`Name for ${engine} instance?`, `${engine}-main`);
    if (!name) return;
    const { data, error } = await supabase.from("databases").insert({
      project_id: projectId, name, engine: engine as any, status: "provisioning", size_mb: 1024,
    }).select().single();
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["dbs", projectId] });
    toast.success(`${engine} provisioning...`);
    setTimeout(async () => {
      const conn = `${engine}://hx:${Math.random().toString(36).slice(2, 10)}@internal.hosterax.app:5432/${name}`;
      await supabase.from("databases").update({ status: "running", connection_string: conn }).eq("id", data!.id);
      qc.invalidateQueries({ queryKey: ["dbs", projectId] });
    }, 3500);
  }

  async function del(id: string) {
    if (!confirm("Delete this database?")) return;
    await supabase.from("databases").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["dbs", projectId] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {["postgres", "mysql", "mongodb", "redis"].map((e) => (
          <button key={e} onClick={() => provision(e)} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm hover:border-primary/40">
            <Plus className="h-4 w-4" /> {e}
          </button>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card">
        {dbs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No databases attached. Provision one above.</div>
        ) : (
          <div className="divide-y divide-border">
            {dbs.map((d: any) => (
              <div key={d.id} className="flex items-center gap-3 p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-2 font-mono text-xs uppercase text-primary">{d.engine.slice(0, 2)}</div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{d.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {d.engine} · {d.size_mb} MB
                    {d.connection_string && <> · <span className="font-mono">{d.connection_string.replace(/:[^:@]+@/, ":••••@")}</span></>}
                  </div>
                </div>
                <StatusBadge status={d.status} />
                <button onClick={() => del(d.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Settings({ project, onDelete }: { project: any; onDelete: () => void }) {
  const [name, setName] = useState(project.name);
  const [branch, setBranch] = useState(project.branch);
  const [buildCmd, setBuildCmd] = useState(project.build_command ?? "");
  const [startCmd, setStartCmd] = useState(project.start_command ?? "");
  const [port, setPort] = useState(project.port ?? 3000);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const { error } = await supabase.from("projects").update({
      name, branch, build_command: buildCmd, start_command: startCmd, port: Number(port),
    }).eq("id", project.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="text-sm font-medium">General</div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Project name"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
          <Field label="Branch"><input value={branch} onChange={(e) => setBranch(e.target.value)} className={inputCls} /></Field>
        </div>
        <Field label="Build command"><input value={buildCmd} onChange={(e) => setBuildCmd(e.target.value)} placeholder="npm run build" className={inputCls + " font-mono"} /></Field>
        <Field label="Start command"><input value={startCmd} onChange={(e) => setStartCmd(e.target.value)} placeholder="npm start" className={inputCls + " font-mono"} /></Field>
        <Field label="Port"><input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} className={inputCls} /></Field>
        <div className="flex justify-end">
          <button onClick={save} disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {busy ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <div className="text-sm font-medium text-destructive">Danger zone</div>
        <p className="mt-1 text-xs text-muted-foreground">Deletes the project, all deployments, envs, and databases.</p>
        <button onClick={onDelete} className="mt-3 inline-flex items-center gap-1 rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive hover:bg-destructive/10">
          <Trash2 className="h-4 w-4" /> Delete project
        </button>
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>{children}</div>;
}

function ProjectDomains({ projectId, projectName }: { projectId: string; projectName: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-12 text-center shadow-sm">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary mb-4">
        <Globe className="h-6 w-6" />
      </div>
      <h3 className="text-lg font-medium">Custom Domains & SSL</h3>
      <p className="mt-2 text-sm text-muted-foreground mb-6 max-w-md mx-auto">
        Manage custom domains, verify DNS ownership, and automatically provision Let's Encrypt SSL certificates for <span className="font-medium text-foreground">{projectName}</span>.
      </p>
      <Link to="/domains" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
        <Globe className="h-4 w-4" /> Manage Domains
      </Link>
    </div>
  );
}

