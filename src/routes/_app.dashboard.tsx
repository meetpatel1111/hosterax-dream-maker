import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/hx/status-badge";
import { DeployFeed } from "@/components/hx/deploy-feed";
import {
  EngineBar,
  EngineLogStream,
  OneClickApps,
  useEngineHealth,
  useEngineProjects,
  useEngineSystem,
} from "@/components/hx/engine-panel";
import { useEngine } from "@/lib/engine";
import { STACKS } from "@/lib/stacks";
import { Plus, Search, GitBranch, Globe, Star, Sparkles, Rocket, Trash2, Cpu } from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Projects — HosteraX" },
      { name: "description", content: "Deploy and manage local and cloud projects from one HosteraX control plane." },
      { property: "og:title", content: "Projects — HosteraX" },
      { property: "og:description", content: "Deploy and manage local and cloud projects from one control plane." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const [q, setQ] = useState("");
  const [selectedStack, setSelectedStack] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [streamId, setStreamId] = useState<string | null>(null);
  const [showNewLocal, setShowNewLocal] = useState(false);
  const [newProj, setNewProj] = useState({ name: "", source: "", buildCmd: "", startCmd: "", target: "process" });

  const eng = useEngine();
  const qc = useQueryClient();
  const { data: health } = useEngineHealth();
  const { data: engineProjects = [] } = useEngineProjects();
  const { data: sys } = useEngineSystem();

  const [starred, setStarred] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem("hx.starred") || "[]");
    } catch {
      return [];
    }
  });

  const toggleStar = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const next = starred.includes(id) ? starred.filter((x) => x !== id) : [...starred, id];
    setStarred(next);
    localStorage.setItem("hx.starred", JSON.stringify(next));
  };

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 5000,
  });

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [dep, dbs] = await Promise.all([
        supabase.from("deployments").select("id, status"),
        supabase.from("databases").select("id", { count: "exact", head: true }),
      ]);
      const total = dep.data?.length || 0;
      const ok = dep.data?.filter((d) => d.status === "success").length || 0;
      return {
        deployments: total,
        successRate: total > 0 ? ((ok / total) * 100).toFixed(1) : "0.0",
        databases: dbs.count || 0,
      };
    },
    refetchInterval: 10000,
  });

  async function createLocalProject() {
    if (!newProj.name || !newProj.source) {
      toast.error("Name and source are required");
      return;
    }
    try {
      await eng.call("POST", "/api/projects", newProj);
      toast.success("Local project created");
      setNewProj({ name: "", source: "", buildCmd: "", startCmd: "", target: "process" });
      setShowNewLocal(false);
      qc.invalidateQueries({ queryKey: ["engine-projects"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function deployLocal(name: string) {
    try {
      const r = await eng.call<{ id: string }>("POST", `/api/projects/${name}/deploy`, { trigger: "manual" });
      toast.success("Deploy queued");
      setStreamId(r.id);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function removeLocal(name: string) {
    if (!confirm(`Delete local project ${name}?`)) return;
    try {
      await eng.call("DELETE", `/api/projects/${name}`);
      qc.invalidateQueries({ queryKey: ["engine-projects"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  const matchesFilters = (name: string, slug: string, stack: string, status: string) => {
    const term = q.toLowerCase();
    return (
      (name.toLowerCase().includes(term) || slug.toLowerCase().includes(term)) &&
      (selectedStack === "all" || stack === selectedStack) &&
      (selectedStatus === "all" || status === selectedStatus)
    );
  };

  const cloudFiltered = projects.filter((p) => matchesFilters(p.name, p.slug, p.stack, p.status));
  const sortedCloud = [...cloudFiltered].sort(
    (a, b) => (starred.includes(b.id) ? 1 : 0) - (starred.includes(a.id) ? 1 : 0),
  );
  const localFiltered = engineProjects.filter((p: any) =>
    matchesFilters(p.name, p.name, p.stack ?? "auto", p.status ?? "active"),
  );

  const totalCount = projects.length + engineProjects.length;
  const empty = sortedCloud.length === 0 && localFiltered.length === 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            {totalCount} project{totalCount === 1 ? "" : "s"} · {engineProjects.length} running on this machine
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewLocal((s) => !s)}
            disabled={!health?.ok}
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Cpu className="h-4 w-4" /> New local project
          </button>
          <Link
            to="/new"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground glow-primary transition-all hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New project
          </Link>
        </div>
      </div>

      <EngineBar />

      {showNewLocal && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">New project on the local engine</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              placeholder="name"
              value={newProj.name}
              onChange={(e) => setNewProj({ ...newProj, name: e.target.value })}
              className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs"
            />
            <input
              placeholder="git URL or local path"
              value={newProj.source}
              onChange={(e) => setNewProj({ ...newProj, source: e.target.value })}
              className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs"
            />
            <input
              placeholder="build cmd (auto-detect if blank)"
              value={newProj.buildCmd}
              onChange={(e) => setNewProj({ ...newProj, buildCmd: e.target.value })}
              className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs"
            />
            <input
              placeholder="start cmd"
              value={newProj.startCmd}
              onChange={(e) => setNewProj({ ...newProj, startCmd: e.target.value })}
              className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs"
            />
            <select
              value={newProj.target}
              onChange={(e) => setNewProj({ ...newProj, target: e.target.value })}
              className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs"
            >
              <option value="process">Process</option>
              <option value="docker">Docker</option>
            </select>
            <button
              onClick={createLocalProject}
              className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        {sys ? (
          <>
            <Metric label="CPU" value={`${sys.cpu.percent}%`} sub={`${sys.cpu.cores} cores`} />
            <Metric label="Memory" value={`${sys.memory.percent}%`} sub={`${sys.memory.used_mb}/${sys.memory.total_mb} MB`} />
            <Metric label="Disk" value={`${sys.disk.percent}%`} sub={`${sys.disk.used_gb}/${sys.disk.total_gb} GB`} />
            <Metric label="Host" value={sys.hostname} sub={sys.platform} />
          </>
        ) : (
          <>
            <Metric label="Projects" value={String(totalCount)} sub="cloud + local" />
            <Metric label="Deployments" value={String(stats?.deployments ?? "—")} sub="all time" />
            <Metric label="Success rate" value={`${stats?.successRate ?? "—"}%`} sub="deploy outcomes" accent />
            <Metric label="Databases" value={String(stats?.databases ?? "—")} sub="provisioned" />
          </>
        )}
      </div>

      {streamId && <EngineLogStream deploymentId={streamId} onClose={() => setStreamId(null)} />}

      <DeployFeed />

      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects by name or slug..."
            className="w-full rounded-md border border-input bg-input/40 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedStack}
            onChange={(e) => setSelectedStack(e.target.value)}
            className="rounded-md border border-input bg-input/40 px-3 py-2 text-xs outline-none focus:border-primary"
          >
            <option value="all">All stacks ({STACKS.length})</option>
            {STACKS.slice(1).map((s) => (
              <option key={s.id} value={s.id}>
                {s.icon} {s.name}
              </option>
            ))}
          </select>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="rounded-md border border-input bg-input/40 px-3 py-2 text-xs outline-none focus:border-primary"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="building">Building</option>
            <option value="failed">Failed</option>
            <option value="sleeping">Sleeping</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse rounded-lg border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Loading projects...
        </div>
      ) : empty ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-lg font-medium">No projects found</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Connect your local engine above, or point HosteraX at any git repo to auto-detect and deploy.
          </p>
          <Link
            to="/new"
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            <Plus className="h-4 w-4" /> Create project
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {localFiltered.map((p: any) => (
            <div
              key={"local-" + p.name}
              className="flex flex-col justify-between rounded-xl border border-primary/30 bg-card p-5"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2">
                      <Cpu className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{p.name}</div>
                      <div className="text-xs text-muted-foreground">Local · {p.target}</div>
                    </div>
                  </div>
                  <span className="rounded bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase text-primary">
                    local
                  </span>
                </div>
                <div className="mt-4 truncate font-mono text-xs text-muted-foreground">{p.source}</div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
                <button
                  onClick={() => deployLocal(p.name)}
                  className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2.5 py-1 text-xs text-primary hover:bg-primary/25"
                >
                  <Rocket className="h-3 w-3" /> Deploy
                </button>
                <button
                  onClick={() => removeLocal(p.name)}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}

          {sortedCloud.map((p) => {
            const stack = STACKS.find((s) => s.id === p.stack);
            const isStarred = starred.includes(p.id);
            return (
              <Link
                key={p.id}
                to="/p/$slug"
                params={{ slug: p.slug }}
                className="group relative flex flex-col justify-between rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/50 hover:shadow-lg"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 font-mono text-xl">
                        {stack?.icon ?? "📦"}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-semibold transition-colors group-hover:text-primary">{p.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{stack?.name ?? p.stack}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={(e) => toggleStar(e, p.id)}
                        className={`rounded p-1 transition-colors ${isStarred ? "text-warning" : "text-muted-foreground/40 hover:text-warning"}`}
                        title={isStarred ? "Unstar project" : "Star project"}
                      >
                        <Star className={`h-4 w-4 ${isStarred ? "fill-warning" : ""}`} />
                      </button>
                      <StatusBadge status={p.status} />
                    </div>
                  </div>
                  <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
                    {p.subdomain && (
                      <div className="flex items-center gap-1.5 truncate text-foreground/80">
                        <Globe className="h-3.5 w-3.5 text-primary" />
                        <span className="truncate">{p.subdomain}.hosterax.app</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 font-mono">
                      <GitBranch className="h-3.5 w-3.5" />
                      <span>{p.branch}</span>
                      {p.target_type && (
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          {p.target_type}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                  <span>Updated {formatDistanceToNow(new Date(p.updated_at))} ago</span>
                  {p.current_version && <span className="font-mono font-medium text-primary">{p.current_version}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <OneClickApps />
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${accent ? "text-success" : "text-foreground"}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
