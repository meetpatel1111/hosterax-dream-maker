import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/hx/status-badge";
import { DeployFeed } from "@/components/hx/deploy-feed";
import { STACKS, REGIONS } from "@/lib/stacks";
import { Plus, Search, GitBranch, Globe, Star, Filter, SlidersHorizontal, Sparkles } from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Projects — HosteraX" }] }),
  component: Dashboard,
});

function Dashboard() {
  const [q, setQ] = useState("");
  const [selectedStack, setSelectedStack] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [starred, setStarred] = useState<string[]>(() => {
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
      const [proj, dep, dbs] = await Promise.all([
        supabase.from("projects").select("id", { count: "exact", head: true }),
        supabase.from("deployments").select("id, status"),
        supabase.from("databases").select("id", { count: "exact", head: true })
      ]);
      const totalDeployments = dep.data?.length || 0;
      const successDeployments = dep.data?.filter(d => d.status === "success").length || 0;
      const successRate = totalDeployments > 0 ? ((successDeployments / totalDeployments) * 100).toFixed(1) : "0.0";
      return {
        projects: proj.count || 0,
        deployments: totalDeployments,
        successRate,
        databases: dbs.count || 0
      };
    },
    refetchInterval: 10000,
  });

  const filtered = projects.filter((p) => {
    const matchesQ = p.name.toLowerCase().includes(q.toLowerCase()) || p.slug.toLowerCase().includes(q.toLowerCase());
    const matchesStack = selectedStack === "all" || p.stack === selectedStack;
    const matchesStatus = selectedStatus === "all" || p.status === selectedStatus;
    return matchesQ && matchesStack && matchesStatus;
  });

  // Sort starred projects to the top
  const sorted = [...filtered].sort((a, b) => {
    const aStar = starred.includes(a.id) ? 1 : 0;
    const bStar = starred.includes(b.id) ? 1 : 0;
    return bStar - aStar;
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            {projects.length} project{projects.length === 1 ? "" : "s"} deployed on this control plane
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/new"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground glow-primary hover:opacity-90 transition-all"
          >
            <Plus className="h-4 w-4" /> New project
          </Link>
        </div>
      </div>

      {/* Analytics Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Total Projects</div>
          <div className="text-2xl font-semibold text-foreground">{stats?.projects ?? "—"}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Deployments</div>
          <div className="text-2xl font-semibold text-foreground">{stats?.deployments ?? "—"}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Success Rate</div>
          <div className="text-2xl font-semibold text-success">{stats?.successRate ?? "—"}%</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Active Databases</div>
          <div className="text-2xl font-semibold text-foreground">{stats?.databases ?? "—"}</div>
        </div>
      </div>

      {/* Live Deploy Feed Component */}
      <DeployFeed />

      {/* Filters Bar */}
      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
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

      {/* Projects Grid */}
      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center text-sm text-muted-foreground animate-pulse">
          Loading projects...
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-lg font-medium">No projects found</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
            {q || selectedStack !== "all" || selectedStatus !== "all"
              ? "No projects match your active search filters."
              : "Point HosteraX at any git repo to auto-detect and deploy your first app."}
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
          {sorted.map((p) => {
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
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 text-xl font-mono">
                        {stack?.icon ?? "📦"}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                          {p.name}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{stack?.name ?? p.stack}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={(e) => toggleStar(e, p.id)}
                        className={`rounded p-1 transition-colors ${
                          isStarred ? "text-warning" : "text-muted-foreground/40 hover:text-warning"
                        }`}
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
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">
                          {p.target_type}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                  <span>Updated {formatDistanceToNow(new Date(p.updated_at))} ago</span>
                  {p.current_version && (
                    <span className="font-mono text-primary font-medium">{p.current_version}</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
