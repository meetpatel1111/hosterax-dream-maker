import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { StatusBadge } from "@/components/hx/status-badge";
import { EngineBar } from "@/components/hx/engine-panel";
import { STACKS } from "@/lib/stacks";
import {
  Plus,
  Rocket,
  Search,
  Star,
  GitBranch,
  Globe,
  Sparkles,
  Trash2,
  Cpu,
  Layers,
  Activity,
  Archive,
  RotateCcw,
  Wifi,
} from "lucide-react";
import { DeleteProjectModal } from "@/components/hx/delete-project-modal";
import {
  useEngine,
  useEngineProjects,
  useEngineSystem,
  useEngineHealth,
  useMagicDnsSettings,
  useNetworkInterfaces,
  formatMagicDnsUrl,
} from "@/lib/engine";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Projects — HosteraX" },
      {
        name: "description",
        content: "Deploy and manage self-hosted projects and containers from one control plane.",
      },
      { property: "og:title", content: "Projects — HosteraX" },
      {
        property: "og:description",
        content: "Deploy and manage self-hosted projects and containers from one control plane.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const [q, setQ] = useState("");
  const [selectedStack, setSelectedStack] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [viewTab, setViewTab] = useState<"active" | "archived">("active");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const eng = useEngine();
  const qc = useQueryClient();
  const { data: health } = useEngineHealth();
  const { data: engineProjects = [], isLoading: isActiveLoading } = useEngineProjects();
  const { data: archivedProjects = [], isLoading: isArchivedLoading } = useQuery({
    queryKey: ["engine-projects-archived", eng.url, eng.token],
    queryFn: async () => {
      try {
        const res = await eng.call<any[]>("GET", "/api/projects?archived=true");
        return res || [];
      } catch {
        return [];
      }
    },
    refetchInterval: 5000,
  });

  const { data: sys } = useEngineSystem();
  const { data: magicDns } = useMagicDnsSettings();
  const { data: netInfo } = useNetworkInterfaces();
  const primaryLanIp = netInfo?.primaryIp && netInfo.primaryIp !== "127.0.0.1" ? netInfo.primaryIp : null;

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

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats", eng.url],
    queryFn: async () => {
      try {
        const s = await eng.call<any>("GET", "/api/stats");
        return {
          deployments: s?.deployments?.total ?? 0,
          successRate: s?.deployments?.success_rate ?? "100.0",
          databases: s?.databases ?? 0,
        };
      } catch {
        return { deployments: 0, successRate: "100.0", databases: 0 };
      }
    },
    refetchInterval: 5000,
  });

  async function deployProject(e: React.MouseEvent, name: string) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await eng.call<{ id: string }>("POST", `/api/projects/${name}/deploy`, {
        trigger: "manual",
      });
      toast.success(`Deploy queued for ${name}`);
      qc.invalidateQueries({ queryKey: ["engine-projects"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to trigger deploy");
    }
  }

  async function restoreProject(e: React.MouseEvent, name: string) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await eng.call("POST", `/api/projects/${encodeURIComponent(name)}/restore`);
      toast.success(`✨ Project ${name} restored! Ready to deploy.`);
      await qc.invalidateQueries({ queryKey: ["engine-projects"] });
      await qc.invalidateQueries({ queryKey: ["engine-projects-archived"] });
      await qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to restore project");
    }
  }

  async function handleConfirmDelete(permanent: boolean) {
    if (!deleteTarget) return;
    try {
      await eng.call(
        "DELETE",
        `/api/projects/${encodeURIComponent(deleteTarget)}${permanent ? "?permanent=true" : ""}`,
      );
      toast.success(
        permanent
          ? `✨ Project ${deleteTarget} permanently purged`
          : `📦 Project ${deleteTarget} archived & disk space freed (0 MB)`,
      );
      setDeleteTarget(null);
      await qc.invalidateQueries({ queryKey: ["engine-projects"] });
      await qc.invalidateQueries({ queryKey: ["engine-projects-archived"] });
      await qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to delete project");
    }
  }

  const rawProjects = viewTab === "active" ? engineProjects : archivedProjects;
  const isLoading = viewTab === "active" ? isActiveLoading : isArchivedLoading;

  // Unified projects directly from SQLite engine
  const unifiedProjects = rawProjects.map((ep: any) => ({
    id: ep.id || `eng-${ep.name}`,
    name: ep.name,
    slug: ep.slug || ep.name,
    stack: ep.stack || "auto",
    status: ep.status || "active",
    repo_url: ep.source || ep.repo_url || "",
    branch: ep.branch || "main",
    target_type: ep.target || "local",
    subdomain: ep.slug || ep.name,
    port: ep.port || ep.route?.upstream_port || 3000,
    updated_at: ep.updated_at ? new Date(ep.updated_at).toISOString() : new Date().toISOString(),
    deleted_at: ep.deleted_at || ep.deletedAt || null,
    current_version: ep.version || "v0.1.0",
    isLocal: true,
    isArchived: ep.status === "archived" || viewTab === "archived",
  }));

  const matchesFilters = (p: any) => {
    const term = q.toLowerCase();
    const matchesQuery =
      p.name.toLowerCase().includes(term) || (p.slug || "").toLowerCase().includes(term);
    const matchesStack = selectedStack === "all" || p.stack === selectedStack;
    const matchesStatus = selectedStatus === "all" || p.status === selectedStatus;
    return matchesQuery && matchesStack && matchesStatus;
  };

  const filtered = unifiedProjects.filter(matchesFilters);
  const sorted = [...filtered].sort(
    (a, b) => (starred.includes(b.id) ? 1 : 0) - (starred.includes(a.id) ? 1 : 0),
  );

  const totalCount = unifiedProjects.length;
  const empty = sorted.length === 0;

  return (
    <div className="mx-auto w-full max-w-[1720px] 2xl:max-w-none space-y-6 transition-all duration-200">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Services & Projects</h1>
            {/* View Mode Toggle: Active vs Archived */}
            <div className="flex items-center gap-1 rounded-xl bg-surface-2/80 p-1 border border-border">
              <button
                onClick={() => setViewTab("active")}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  viewTab === "active"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Activity className="h-3.5 w-3.5" />
                <span>Active Services</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-background/20 font-mono">
                  {engineProjects.length}
                </span>
              </button>
              <button
                onClick={() => setViewTab("archived")}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  viewTab === "archived"
                    ? "bg-amber-500 text-black font-bold shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Archive className="h-3.5 w-3.5" />
                <span>Archived</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/15 font-mono">
                  {archivedProjects.length}
                </span>
              </button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {viewTab === "active"
              ? `${engineProjects.length} active service${engineProjects.length === 1 ? "" : "s"} running on local engine`
              : `${archivedProjects.length} archived service${archivedProjects.length === 1 ? "" : "s"} (0 MB disk space used · 1-click restore)`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/new"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground glow-primary transition-all hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New project
          </Link>
        </div>
      </div>

      <EngineBar />

      <div className="grid gap-4 md:grid-cols-4">
        {sys ? (
          <>
            <Metric
              label="CPU Usage"
              value={`${sys.cpu.percent}%`}
              sub={`${sys.cpu.cores} cores`}
            />
            <Metric
              label="Memory"
              value={`${sys.memory.percent}%`}
              sub={`${sys.memory.used_mb}/${sys.memory.total_mb} MB`}
            />
            <Metric
              label="Disk"
              value={`${sys.disk.percent}%`}
              sub={`${sys.disk.used_gb}/${sys.disk.total_gb} GB`}
            />
            <Metric label="Host" value={sys.hostname} sub={`${sys.platform} (${sys.arch})`} />
          </>
        ) : (
          <>
            <Metric label="Projects" value={String(totalCount)} sub="control plane" />
            <Metric label="Deployments" value={String(stats?.deployments ?? "—")} sub="all time" />
            <Metric
              label="Success rate"
              value={`${stats?.successRate ?? "100"}%`}
              sub="deploy outcomes"
              accent
            />
            <Metric label="Databases" value={String(stats?.databases ?? "—")} sub="provisioned" />
          </>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search projects by name, repo, or slug..."
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
            <option value="ready">Ready</option>
            <option value="failed">Failed</option>
            <option value="stopped">Stopped</option>
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
            {viewTab === "archived" ? (
              <Archive className="h-6 w-6 text-amber-400" />
            ) : (
              <Sparkles className="h-6 w-6" />
            )}
          </div>
          <h3 className="mt-4 text-lg font-medium">
            {viewTab === "archived" ? "No archived projects" : "No active projects found"}
          </h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {viewTab === "archived"
              ? "When you delete projects with 'Archive & Free Disk Space', their configuration will appear here for 1-click restore."
              : "Point HosteraX at any Git repo or local folder to auto-detect stack, build, and deploy."}
          </p>
          {viewTab === "active" && (
            <Link
              to="/new"
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> Create project
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sorted.map((p) => {
            const stack = STACKS.find((s) => s.id === p.stack);
            const isStarred = starred.includes(p.id);
            return (
              <div
                key={p.id}
                className={`group relative flex flex-col justify-between rounded-xl border p-5 transition-all ${
                  p.isArchived
                    ? "border-amber-500/30 bg-card/60 opacity-90 hover:opacity-100 hover:border-amber-500/60"
                    : "border-border bg-card hover:border-primary/50 hover:shadow-lg"
                }`}
              >
                <Link to="/p/$slug" params={{ slug: p.slug }} className="block">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 font-mono text-xl">
                        {stack?.icon ?? <Cpu className="h-5 w-5 text-primary" />}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-semibold transition-colors group-hover:text-primary">
                          {p.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {stack?.name ?? p.stack} {p.target_type ? `· ${p.target_type}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {!p.isArchived && (
                        <button
                          onClick={(e) => toggleStar(e, p.id)}
                          className={`rounded p-1 transition-colors ${isStarred ? "text-warning" : "text-muted-foreground/40 hover:text-warning"}`}
                          title={isStarred ? "Unstar project" : "Star project"}
                        >
                          <Star className={`h-4 w-4 ${isStarred ? "fill-warning" : ""}`} />
                        </button>
                      )}
                      {p.isArchived ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                          <Archive className="h-3 w-3" /> Archived (0 MB)
                        </span>
                      ) : (
                        <StatusBadge status={p.status === "ready" ? "success" : p.status} />
                      )}
                    </div>
                  </div>

                  <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5 truncate text-foreground/80 font-mono">
                      <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="truncate">
                        {formatMagicDnsUrl(
                          p.name || p.subdomain,
                          magicDns?.activeProvider || "sslip.io",
                        )}
                      </span>
                    </div>
                    {primaryLanIp && p.port ? (
                      <div className="flex items-center gap-1.5 truncate text-emerald-400 font-mono">
                        <Wifi className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span className="truncate">http://{primaryLanIp}:{p.port}</span>
                        <span className="text-[9px] uppercase font-sans text-emerald-500 font-semibold px-1 bg-emerald-950/40 rounded border border-emerald-800/30">
                          Wi-Fi
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 font-mono truncate">
                        <GitBranch className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{p.repo_url || p.branch || "local"}</span>
                      </div>
                    )}
                  </div>
                </Link>

                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                  {p.isArchived ? (
                    <div className="flex items-center gap-2 w-full justify-between">
                      <button
                        onClick={(e) => restoreProject(e, p.name)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/30 transition-all"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Restore & Redeploy
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDeleteTarget(p.name);
                        }}
                        className="rounded p-1 text-muted-foreground/60 hover:text-destructive transition-colors"
                        title="Purge permanently"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => deployProject(e, p.name)}
                          className="inline-flex items-center gap-1 rounded bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/25"
                        >
                          <Rocket className="h-3 w-3" /> Deploy
                        </button>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDeleteTarget(p.name);
                          }}
                          className="rounded p-1 text-muted-foreground/60 hover:text-destructive transition-colors"
                          title="Delete / Archive project"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {p.current_version && (
                        <span className="font-mono font-medium text-primary">
                          {p.current_version}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete / Archive Confirmation Modal */}
      <DeleteProjectModal
        isOpen={!!deleteTarget}
        projectName={deleteTarget || ""}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />

      {/* App Store & Catalog Discovery Banner */}
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-surface to-background p-6 shadow-sm flex flex-wrap items-center justify-between gap-6">
        <div className="space-y-1.5 max-w-2xl">
          <div className="flex items-center gap-2 font-semibold text-base text-foreground">
            <Sparkles className="h-5 w-5 text-primary" />
            <span>App Store & 1-Click Software Catalog</span>
            <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-mono font-medium text-primary">
              2,550+ Apps
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Browse 112+ curated categories from awesome-selfhosted.net, sysadmin, and selfh.st.
            Launch Nextcloud, Vaultwarden, Immich, Uptime Kuma, WordPress, and 42+ framework starter
            templates in 1 click.
          </p>
        </div>
        <Link
          to="/apps"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md glow-primary hover:opacity-90 transition-all shrink-0"
        >
          <span>Explore App Store & Templates</span>
          <span>→</span>
        </Link>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`text-2xl font-semibold ${accent ? "text-success" : "text-foreground"}`}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
