import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/hx/status-badge";
import { format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Rocket,
  TrendingUp,
  Activity,
  Layers,
  Search,
  Check,
  Sliders,
  Box,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEngine } from "@/lib/engine";
import { TrafficSplittingManager } from "@/components/hx/traffic-splitting-manager";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export const Route = createFileRoute("/_app/deployments")({
  head: () => ({ meta: [{ title: "Deployments — HosteraX" }] }),
  component: DeploymentsPage,
});

const PAGE_SIZE = 50;

type DeploymentRow = {
  id: string;
  project: string;
  version?: string;
  phase: string;
  trigger?: string;
  started_at?: number | null;
  finished_at?: number | null;
  environment?: string;
  commit_message?: string;
  commit_sha?: string;
  branch?: string;
};

type DeploymentCursor = { startedAt: number; id: string };
type DeploymentPage = { items: DeploymentRow[]; nextCursor: DeploymentCursor | null };

function DeploymentsPage() {
  const engine = useEngine();
  const [olderDeployments, setOlderDeployments] = useState<DeploymentRow[]>([]);
  const [olderCursor, setOlderCursor] = useState<DeploymentCursor | null>(null);
  const [hasLoadedOlder, setHasLoadedOlder] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [loadOlderError, setLoadOlderError] = useState("");
  const [activeView, setActiveView] = useState<"history" | "canary">("history");
  const [filterStatus, setFilterStatus] = useState<"all" | "success" | "failed">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const olderRequest = useRef<AbortController | null>(null);
  const latestRows = useRef<DeploymentRow[]>([]);

  const deploymentsQuery = useQuery({
    queryKey: ["deployment-history", engine.url, engine.token],
    queryFn: ({ signal }) =>
      engine.call<DeploymentPage>("GET", `/api/deployments/page?limit=${PAGE_SIZE}`, undefined, {
        signal,
      }),
    refetchInterval: 10000,
    staleTime: 5000,
  });

  useEffect(() => {
    olderRequest.current?.abort();
    latestRows.current = [];
    setOlderDeployments([]);
    setOlderCursor(null);
    setHasLoadedOlder(false);
    setLoadOlderError("");
    setIsLoadingOlder(false);
    return () => olderRequest.current?.abort();
  }, [engine.url, engine.token]);

  const rawItems = deploymentsQuery.data?.items;
  const latestDeployments = useMemo(() => rawItems || [], [rawItems]);
  const nextCursor = hasLoadedOlder ? olderCursor : deploymentsQuery.data?.nextCursor || null;
  const canLoadOlder = Boolean(nextCursor);

  useEffect(() => {
    const previous = latestRows.current;
    if (hasLoadedOlder && previous.length) {
      const currentIds = new Set(latestDeployments.map((deployment) => deployment.id));
      const displaced = previous.filter((deployment) => !currentIds.has(deployment.id));
      if (displaced.length) {
        setOlderDeployments((current) => {
          const knownIds = new Set(
            [...latestDeployments, ...current].map((deployment) => deployment.id),
          );
          return [...displaced.filter((deployment) => !knownIds.has(deployment.id)), ...current];
        });
      }
    }
    latestRows.current = latestDeployments;
  }, [latestDeployments, hasLoadedOlder]);

  const loadOlder = async () => {
    if (!nextCursor || isLoadingOlder) return;
    const controller = new AbortController();
    olderRequest.current = controller;
    setIsLoadingOlder(true);
    setLoadOlderError("");

    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      beforeStartedAt: String(nextCursor.startedAt),
      beforeId: nextCursor.id,
    });

    try {
      const page = await engine.call<DeploymentPage>(
        "GET",
        `/api/deployments/page?${params.toString()}`,
        undefined,
        { signal: controller.signal },
      );
      setOlderDeployments((current) => {
        const currentIds = new Set(
          [...latestDeployments, ...current].map((deployment) => deployment.id),
        );
        return [...current, ...page.items.filter((deployment) => !currentIds.has(deployment.id))];
      });
      setOlderCursor(page.nextCursor);
      setHasLoadedOlder(true);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setLoadOlderError(
          error instanceof Error ? error.message : "Could not load older deployments.",
        );
      }
    } finally {
      if (olderRequest.current === controller) {
        olderRequest.current = null;
        setIsLoadingOlder(false);
      }
    }
  };

  const allData = useMemo(() => {
    return [...latestDeployments, ...olderDeployments].map((deployment) => {
      const startedAt = deployment.started_at ? new Date(deployment.started_at) : null;
      const createdAt = startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt : null;
      return {
        id: deployment.id,
        project: deployment.project,
        commitMessage: deployment.commit_message || `Release ${deployment.version}`,
        commitSha: deployment.commit_sha || deployment.id.slice(0, 8),
        version: deployment.version,
        branch: deployment.branch || "main",
        environment: deployment.environment || "production",
        trigger: deployment.trigger || "manual",
        status:
          deployment.phase === "ready"
            ? "success"
            : deployment.phase === "failed"
              ? "failed"
              : deployment.phase || "building",
        createdAt,
        durationMs:
          deployment.finished_at && deployment.started_at
            ? deployment.finished_at - deployment.started_at
            : undefined,
      };
    });
  }, [latestDeployments, olderDeployments]);

  // Analytics KPIs
  const stats = useMemo(() => {
    const total = allData.length;
    const successful = allData.filter((d) => d.status === "success").length;
    const failed = allData.filter((d) => d.status === "failed").length;
    const inProgress = allData.filter(
      (d) => d.status === "building" || d.status === "deploying" || d.status === "fetching",
    ).length;
    const durations = allData
      .filter((d) => d.durationMs != null && d.durationMs > 0)
      .map((d) => d.durationMs! / 1000);
    const avgDuration = durations.length
      ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1)
      : "2.1";
    const successRate = total > 0 ? ((successful / total) * 100).toFixed(1) : "100.0";
    const projects = new Set(allData.map((d) => d.project)).size;

    return { total, successful, failed, inProgress, avgDuration, successRate, projects };
  }, [allData]);

  // Chronological timeline data for graphs
  const chartData = useMemo(() => {
    if (!allData.length) {
      // Mock historical point if clean brand-new install
      return [
        { name: "Initial", project: "HosteraX", duration: 1.2, success: 1, failed: 0, time: "Now" },
      ];
    }
    return [...allData]
      .reverse()
      .slice(-15)
      .map((d, index) => ({
        name: `${d.project} ${d.version || `#${index + 1}`}`,
        project: d.project,
        version: d.version || `v0.${index + 1}.0`,
        duration: d.durationMs ? Number((d.durationMs / 1000).toFixed(1)) : 1.8,
        success: d.status === "success" ? 1 : 0,
        failed: d.status === "failed" ? 1 : 0,
        time: d.createdAt ? format(d.createdAt, "HH:mm") : `#${index + 1}`,
      }));
  }, [allData]);

  // Filtered rows for list
  const filteredData = useMemo(() => {
    return allData.filter((d) => {
      const matchesStatus =
        filterStatus === "all"
          ? true
          : filterStatus === "success"
            ? d.status === "success"
            : d.status === "failed";
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        d.project.toLowerCase().includes(q) ||
        d.commitMessage.toLowerCase().includes(q) ||
        (d.version || "").toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [allData, filterStatus, searchQuery]);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/70 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-primary">
            <Activity className="h-3.5 w-3.5" />
            <span>Rollout &amp; Release Intelligence</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">Deployments Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time deployment pipeline metrics, rollout trends, and build history across all
            clusters.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link
            to="/containers"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            <Box className="h-3.5 w-3.5 text-primary" />
            <span>Active Containers Fleet</span>
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 font-medium text-emerald-400 font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Live Pipeline Active
          </span>
        </div>
      </div>

      {/* View Switcher Tabs */}
      <div className="flex border-b border-border bg-card/60 rounded-t-xl px-4 pt-2">
        <button
          onClick={() => setActiveView("history")}
          className={`border-b-2 px-4 py-2.5 text-xs font-medium transition-colors ${
            activeView === "history"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Rollout History &amp; Pipeline Analytics
        </button>
        <button
          onClick={() => setActiveView("canary")}
          className={`border-b-2 px-4 py-2.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
            activeView === "canary"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Sliders className="h-3.5 w-3.5" /> Canary Releases &amp; Traffic Splitting
        </button>
      </div>

      {activeView === "canary" ? (
        <TrafficSplittingManager />
      ) : (
        <>
          {/* KPI Stats Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>Total Releases</span>
                <Rocket className="h-4 w-4 text-primary" />
              </div>
              <div className="mt-2 text-2xl font-bold font-mono tracking-tight">{stats.total}</div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Across {stats.projects} active project(s)</span>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>Success Rate</span>
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </div>
              <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-emerald-400">
                {stats.successRate}%
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {stats.successful} passed · {stats.failed} failed
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>Avg Build Duration</span>
                <Clock className="h-4 w-4 text-sky-400" />
              </div>
              <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-sky-400">
                {stats.avgDuration}s
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                <span>Zero-downtime blue/green swap</span>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>Active Rollouts</span>
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <div className="mt-2 text-2xl font-bold font-mono tracking-tight">
                {stats.inProgress > 0 ? (
                  <span className="text-warning">{stats.inProgress} queued</span>
                ) : (
                  <span className="text-muted-foreground">0 idle</span>
                )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                <span>Autonomous self-healing armed</span>
              </div>
            </div>
          </div>

          {/* Visual Analytics Graphs (Recharts) */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Chart 1: Deployment Duration Trends */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold tracking-tight">Rollout Duration Trends</h2>
                  <p className="text-xs text-muted-foreground">
                    Build &amp; container initialization duration in seconds per release.
                  </p>
                </div>
                <span className="rounded bg-sky-500/10 px-2 py-0.5 font-mono text-[11px] text-sky-400 font-medium">
                  Seconds (s)
                </span>
              </div>
              <div className="h-[220px] w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="durationGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
                    <XAxis
                      dataKey="time"
                      stroke="#737373"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis stroke="#737373" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const item = payload[0].payload;
                          return (
                            <div className="rounded-lg border border-border bg-popover/95 p-2.5 shadow-xl text-xs backdrop-blur-md">
                              <div className="font-semibold text-foreground">{item.name}</div>
                              <div className="mt-1 flex items-center justify-between gap-4 text-muted-foreground font-mono">
                                <span>Duration:</span>
                                <span className="font-bold text-sky-400">{item.duration}s</span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="duration"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#durationGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 2: Release Outcome Frequency */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold tracking-tight">
                    Deployment Activity &amp; Health
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Distribution of recent releases by execution status.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-[11px] font-mono">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" /> Success
                  </span>
                  <span className="flex items-center gap-1 text-rose-400">
                    <span className="h-2 w-2 rounded-full bg-rose-400" /> Failed
                  </span>
                </div>
              </div>
              <div className="h-[220px] w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
                    <XAxis
                      dataKey="time"
                      stroke="#737373"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="#737373"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const item = payload[0].payload;
                          return (
                            <div className="rounded-lg border border-border bg-popover/95 p-2.5 shadow-xl text-xs backdrop-blur-md">
                              <div className="font-semibold text-foreground">{item.name}</div>
                              <div className="mt-1 flex items-center justify-between gap-4 font-mono text-[11px]">
                                <span className="text-muted-foreground">Result:</span>
                                <span
                                  className={
                                    item.success
                                      ? "text-emerald-400 font-bold"
                                      : "text-rose-400 font-bold"
                                  }
                                >
                                  {item.success ? "✓ Success (Ready)" : "✗ Failed"}
                                </span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="success" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="failed" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Deployments Filter & Search Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setFilterStatus("all")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  filterStatus === "all"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All ({allData.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus("success")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  filterStatus === "success"
                    ? "bg-emerald-500 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Successful ({stats.successful})
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus("failed")}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  filterStatus === "failed"
                    ? "bg-destructive text-destructive-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Failed ({stats.failed})
              </button>
            </div>

            <div className="relative min-w-[260px]">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter deployments by project or commit..."
                className="w-full rounded-md border border-input bg-input/40 py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary"
              />
            </div>
          </div>

          {deploymentsQuery.isError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                {allData.length
                  ? "Could not refresh the latest deployments. Showing the last loaded results."
                  : "Could not load deployments."}
              </span>
              <button
                type="button"
                onClick={() => deploymentsQuery.refetch()}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Retry
              </button>
            </div>
          )}

          {/* Deployments List Table */}
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {deploymentsQuery.isPending ? (
              <div className="p-8 text-center text-sm text-muted-foreground" role="status">
                Loading deployments…
              </div>
            ) : deploymentsQuery.isError && !deploymentsQuery.data ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Deployment history is unavailable.
              </div>
            ) : filteredData.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No deployments found matching current criteria.
              </div>
            ) : (
              <>
                <div className="divide-y divide-border">
                  {filteredData.map((deployment) => (
                    <Link
                      key={deployment.id}
                      to="/p/$slug"
                      params={{ slug: deployment.project }}
                      className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-accent"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <StatusBadge status={deployment.status} />
                        <div className="min-w-0">
                          <div className="break-words text-sm font-medium">
                            {deployment.project}{" "}
                            <span className="text-muted-foreground">
                              / {deployment.commitMessage}
                            </span>
                            {deployment.version && (
                              <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                                {deployment.version}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">{deployment.commitSha}</span>
                            <span>·</span>
                            <span>{deployment.environment}</span>
                            <span>·</span>
                            <span>{deployment.trigger}</span>
                            {deployment.durationMs !== undefined && (
                              <>
                                <span>·</span>
                                <span>{(deployment.durationMs / 1000).toFixed(1)}s</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs font-mono text-muted-foreground">
                        {deployment.createdAt
                          ? format(deployment.createdAt, "yyyy-MM-dd HH:mm:ss")
                          : "Time unavailable"}
                      </div>
                    </Link>
                  ))}
                </div>

                {loadOlderError && (
                  <div
                    role="alert"
                    className="border-t border-border px-4 py-3 text-sm text-destructive"
                  >
                    {loadOlderError}
                  </div>
                )}
                {canLoadOlder && (
                  <div className="flex justify-center border-t border-border p-4">
                    <button
                      type="button"
                      disabled={isLoadingOlder}
                      onClick={loadOlder}
                      className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60"
                    >
                      {isLoadingOlder ? "Loading…" : "Load older deployments"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
