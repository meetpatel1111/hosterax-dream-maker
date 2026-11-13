// src/routes/_app.containers.tsx
// HosteraX Container & Pods Fleet Manager — Real-time OCI & Docker Engine Controller

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useDeferredValue, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Play,
  Square,
  RotateCw,
  Trash2,
  Terminal,
  FileText,
  Info,
  Plus,
  RefreshCw,
  Search,
  ExternalLink,
  Copy,
  Check,
  Layers,
  Cpu,
  Activity,
  Globe,
  Radio,
  Sparkles,
  X,
  Send,
  Sliders,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { useEngine, useEngineProjects } from "@/lib/engine";
import { confirmAction } from "@/components/hx/confirm-modal";
import {
  filterContainers,
  calculateContainerFleetMetrics,
  formatContainerName,
  formatShortId,
  formatPortMappings,
  getContainerBadgeColor,
  isSystemContainer,
  detectProjectAssociation,
  type ContainerItem,
} from "@/utils/containers-manager";

export const Route = createFileRoute("/_app/containers")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Containers & Pods Fleet — HosteraX" },
      {
        name: "description",
        content:
          "Real-time OCI and Docker Engine controller. Monitor, exec, stream logs, and control containers live.",
      },
    ],
  }),
  component: ContainersFleetPage,
});

function ContainersFleetPage() {
  const engine = useEngine();
  const queryClient = useQueryClient();
  const { q: initialQuery } = Route.useSearch();

  const [search, setSearch] = useState(initialQuery || "");
  useEffect(() => {
    if (initialQuery) setSearch(initialQuery);
  }, [initialQuery]);
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "stopped" | "system">("all");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

  // Modals state
  const [execTarget, setExecTarget] = useState<ContainerItem | null>(null);
  const [execCmd, setExecCmd] = useState("uname -a");
  const [execOutput, setExecOutput] = useState<string>("");
  const [isExecRunning, setIsExecRunning] = useState(false);

  const [logsTarget, setLogsTarget] = useState<ContainerItem | null>(null);
  const [inspectTarget, setInspectTarget] = useState<ContainerItem | null>(null);
  const [inspectData, setInspectData] = useState<any>(null);
  const [isInspectLoading, setIsInspectLoading] = useState(false);

  const [showDeployModal, setShowDeployModal] = useState(false);
  const [deployImage, setDeployImage] = useState("alpine:latest");
  const [deployName, setDeployName] = useState("");
  const [deployHostPort, setDeployHostPort] = useState("8080");
  const [deployContainerPort, setDeployContainerPort] = useState("80");
  const [deployEnv, setDeployEnv] = useState("PORT=80\nENV=production");

  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 1. Fetch live containers from Docker API
  const containersQuery = useQuery({
    queryKey: ["docker-containers", engine.url, engine.token],
    queryFn: async ({ signal }) => {
      try {
        return await engine.call<ContainerItem[]>(
          "GET",
          "/api/docker/containers?all=1",
          undefined,
          { signal },
        );
      } catch (err: any) {
        toast.error(`Containers error: ${err.message}`);
        return [];
      }
    },
    refetchInterval: 5000,
  });

  const { data: engineProjects = [] } = useEngineProjects();
  const knownProjectSlugs = engineProjects.map((p: any) => p.name || p.id).filter(Boolean);

  const containers = containersQuery.data || [];
  const metrics = calculateContainerFleetMetrics(containers);
  const filtered = filterContainers(containers, deferredSearch, statusFilter);

  // 2. Container Actions Mutations
  const startMutation = useMutation({
    mutationFn: (name: string) =>
      engine.call("POST", `/api/docker/containers/${encodeURIComponent(name)}/start`),
    onSuccess: (_, name) => {
      toast.success(`Container ${name} started`);
      queryClient.invalidateQueries({ queryKey: ["docker-containers"] });
    },
    onError: (err: any) => toast.error(`Failed to start: ${err.message}`),
  });

  const stopMutation = useMutation({
    mutationFn: (name: string) =>
      engine.call("POST", `/api/docker/containers/${encodeURIComponent(name)}/stop`, {
        timeout: 5,
      }),
    onSuccess: (_, name) => {
      toast.success(`Container ${name} stopped`);
      queryClient.invalidateQueries({ queryKey: ["docker-containers"] });
    },
    onError: (err: any) => toast.error(`Failed to stop: ${err.message}`),
  });

  const restartMutation = useMutation({
    mutationFn: (name: string) =>
      engine.call("POST", `/api/docker/containers/${encodeURIComponent(name)}/restart`, {
        timeout: 5,
      }),
    onSuccess: (_, name) => {
      toast.success(`Container ${name} restarted`);
      queryClient.invalidateQueries({ queryKey: ["docker-containers"] });
    },
    onError: (err: any) => toast.error(`Failed to restart: ${err.message}`),
  });

  const removeMutation = useMutation({
    mutationFn: (name: string) =>
      engine.call("DELETE", `/api/docker/containers/${encodeURIComponent(name)}`),
    onSuccess: (_, name) => {
      toast.success(`Container ${name} removed`);
      queryClient.invalidateQueries({ queryKey: ["docker-containers"] });
    },
    onError: (err: any) => toast.error(`Failed to remove: ${err.message}`),
  });

  const deployMutation = useMutation({
    mutationFn: async () => {
      const envArray = deployEnv
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      return engine.call("POST", "/api/docker/containers/run", {
        image: deployImage.trim(),
        name: deployName.trim() || undefined,
        hostPort: deployHostPort ? Number(deployHostPort) : undefined,
        containerPort: deployContainerPort ? Number(deployContainerPort) : undefined,
        env: envArray,
      });
    },
    onSuccess: (res: any) => {
      toast.success(`Container ${res.name || "deployed"} started successfully!`);
      setShowDeployModal(false);
      setDeployName("");
      queryClient.invalidateQueries({ queryKey: ["docker-containers"] });
    },
    onError: (err: any) => toast.error(`Deployment failed: ${err.message}`),
  });

  // Handle in-container Exec
  const handleRunExec = async (cmdToRun?: string) => {
    if (!execTarget) return;
    const command = cmdToRun || execCmd;
    if (!command.trim()) return;

    setIsExecRunning(true);
    const containerName = formatContainerName(execTarget.Names);
    try {
      const res = await engine.call<any>(
        "POST",
        `/api/docker/containers/${encodeURIComponent(containerName)}/exec`,
        {
          cmd: command.split(" "),
        },
      );
      setExecOutput(res.output || res.stdout || JSON.stringify(res, null, 2));
    } catch (err: any) {
      setExecOutput(`Error executing command: ${err.message}`);
    } finally {
      setIsExecRunning(false);
    }
  };

  // Handle deep inspect
  const handleInspect = async (c: ContainerItem) => {
    setInspectTarget(c);
    setIsInspectLoading(true);
    const containerName = formatContainerName(c.Names);
    try {
      const data = await engine.call<any>(
        "GET",
        `/api/docker/containers/${encodeURIComponent(containerName)}/inspect`,
      );
      setInspectData(data);
    } catch (err: any) {
      setInspectData({ error: err.message });
    } finally {
      setIsInspectLoading(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-primary uppercase tracking-wider">
            <Box className="h-3.5 w-3.5" />
            <span>Docker Engine & OCI Runtime Controller</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">Containers & Pods Fleet</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Monitor, exec, stream logs, and control containers live across your HosteraX node.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => containersQuery.refetch()}
            disabled={containersQuery.isFetching}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${containersQuery.isFetching ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>

          <button
            onClick={() => setShowDeployModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground hover:opacity-90 shadow-sm transition-all"
            title="Launch standalone OCI/Docker container without Git repo or CI/CD setup"
          >
            <Plus className="h-4 w-4" />
            <span>Run Ad-hoc Image</span>
          </button>
        </div>
      </div>

      {/* Scope Clarification & Architecture Banner */}
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3.5 flex items-start justify-between gap-3 text-xs">
        <div className="flex items-start gap-2.5">
          <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold text-foreground">Fleet &amp; Process Scope:</span>
            <p className="text-muted-foreground">
              This controller manages low-level Docker &amp; OCI container processes running on this
              host (including reverse proxies, database engines, and background tasks). To manage
              Git repositories, custom domains, and automated CI/CD builds, visit{" "}
              <Link to="/dashboard" className="text-primary hover:underline font-medium">
                Projects
              </Link>{" "}
              or view release history in{" "}
              <Link to="/deployments" className="text-primary hover:underline font-medium">
                Deployments
              </Link>
              .
            </p>
          </div>
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex items-center gap-3.5">
          <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
            <Box className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground">Total Containers</div>
            <div className="text-xl font-bold font-mono tracking-tight mt-0.5">{metrics.total}</div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex items-center gap-3.5">
          <div className="h-10 w-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
            <Radio className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground">Active & Running</div>
            <div className="text-xl font-bold font-mono tracking-tight text-emerald-400 mt-0.5">
              {metrics.running}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex items-center gap-3.5">
          <div className="h-10 w-10 rounded-lg bg-zinc-500/10 border border-zinc-500/20 flex items-center justify-center text-zinc-400 shrink-0">
            <Square className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground">Exited / Stopped</div>
            <div className="text-xl font-bold font-mono tracking-tight text-muted-foreground mt-0.5">
              {metrics.stopped}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex items-center gap-3.5">
          <div className="h-10 w-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground">Published Ports</div>
            <div className="text-xl font-bold font-mono tracking-tight text-blue-400 mt-0.5">
              {metrics.exposedPortsCount}
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card p-3 rounded-xl border border-border shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[260px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by container name, image, or port..."
              className="w-full pl-9 pr-3 py-1.5 bg-background border border-border rounded-lg text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center gap-1 bg-background p-1 rounded-lg border border-border">
            {(["all", "running", "stopped", "system"] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setStatusFilter(filter)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                  statusFilter === filter
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {filter === "all" ? `All (${metrics.total})` : filter}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5 border border-border bg-background p-1 rounded-lg">
          <button
            onClick={() => setViewMode("grid")}
            className={`p-1.5 rounded-md text-xs transition-colors ${
              viewMode === "grid"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="Grid View"
          >
            <Layers className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setViewMode("table")}
            className={`p-1.5 rounded-md text-xs transition-colors ${
              viewMode === "table"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="Table View"
          >
            <Sliders className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Main Containers List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center bg-card/50">
          <Box className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-foreground">No containers matching criteria</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Try adjusting your search query or launch a new container using the deploy button above.
          </p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => {
            const name = formatContainerName(c.Names);
            const shortId = formatShortId(c.Id);
            const isRunning = String(c.State).toLowerCase() === "running";
            const badge = getContainerBadgeColor(c.State);
            const ports = formatPortMappings(c.Ports);
            const isSys = isSystemContainer(name);
            const associatedProject = detectProjectAssociation(c, knownProjectSlugs);

            return (
              <div
                key={c.Id}
                className="rounded-xl border border-border bg-card p-4 shadow-sm hover:border-primary/40 transition-all flex flex-col justify-between gap-4"
              >
                <div>
                  {/* Top Bar: Name, Status Badge, System tag */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-sm truncate text-foreground">
                          {name}
                        </span>
                        {associatedProject ? (
                          <Link
                            to="/p/$slug"
                            params={{ slug: associatedProject }}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
                            title={`Open Project "${associatedProject}" dashboard`}
                          >
                            <span>Project: {associatedProject}</span>
                            <ArrowRight className="h-2.5 w-2.5" />
                          </Link>
                        ) : isSys ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                            Core Edge
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                            Standalone
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 text-[11px] font-mono text-muted-foreground">
                        <span>{shortId}</span>
                        <button
                          onClick={() => copyToClipboard(c.Id, c.Id)}
                          className="hover:text-foreground"
                          title="Copy Full Container ID"
                        >
                          {copiedId === c.Id ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${badge.badgeClass}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${badge.dotClass}`} />
                      <span>{badge.label}</span>
                    </div>
                  </div>

                  {/* Image & Status info */}
                  <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground/80">
                        Image
                      </span>
                      <span className="font-mono text-foreground font-medium truncate max-w-[200px]">
                        {c.Image}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground/80">
                        Uptime
                      </span>
                      <span className="font-mono text-xs">{c.Status || "Unknown"}</span>
                    </div>
                  </div>

                  {/* Port mappings */}
                  {ports.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/60">
                      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">
                        Forwarded Endpoints
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {ports.map((p) => (
                          <a
                            key={p.hostPort}
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-accent/60 border border-border text-[11px] font-mono text-primary hover:bg-accent transition-colors"
                          >
                            <span>
                              {p.hostPort}:{p.containerPort}
                            </span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Container Action Controls */}
                <div className="flex items-center justify-between gap-1 pt-3 border-t border-border/80">
                  <div className="flex items-center gap-1">
                    {isRunning ? (
                      <button
                        onClick={() => stopMutation.mutate(name)}
                        disabled={stopMutation.isPending}
                        className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive border border-transparent hover:border-destructive/20 transition-all"
                        title="Stop Container"
                      >
                        <Square className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => startMutation.mutate(name)}
                        disabled={startMutation.isPending}
                        className="p-1.5 rounded-md hover:bg-emerald-500/10 text-emerald-400 border border-transparent hover:border-emerald-500/20 transition-all"
                        title="Start Container"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    )}

                    <button
                      onClick={() => restartMutation.mutate(name)}
                      disabled={restartMutation.isPending}
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Restart Container"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </button>

                    <button
                      onClick={() => {
                        setExecTarget(c);
                        setExecOutput("");
                      }}
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Quick In-Container Exec"
                    >
                      <Terminal className="h-3.5 w-3.5" />
                    </button>

                    <Link
                      to="/terminal"
                      search={{ container: name } as any}
                      className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-muted text-[10px] font-mono text-muted-foreground hover:text-primary transition-colors"
                      title="Open in full multi-tab Web Terminal Studio"
                    >
                      <span>Shell</span>
                      <ExternalLink className="h-2.5 w-2.5" />
                    </Link>

                    <button
                      onClick={() => setLogsTarget(c)}
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Stream Container Logs"
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </button>

                    <button
                      onClick={() => handleInspect(c)}
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title="Inspect Metadata & Config"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <button
                    onClick={async () => {
                      const ok = await confirmAction({
                        title: `Remove Container "${name}"`,
                        description: `Force remove container "${name}" and release its ephemeral container state?`,
                        confirmLabel: "Remove Container",
                        variant: "destructive",
                      });
                      if (ok) removeMutation.mutate(name);
                    }}
                    disabled={removeMutation.isPending}
                    className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="Remove Container"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50 border-b border-border text-muted-foreground uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-4 py-3">Container</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Image</th>
                  <th className="px-4 py-3">Ports</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((c) => {
                  const name = formatContainerName(c.Names);
                  const isRunning = String(c.State).toLowerCase() === "running";
                  const badge = getContainerBadgeColor(c.State);
                  const ports = formatPortMappings(c.Ports);

                  return (
                    <tr key={c.Id} className="hover:bg-accent/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-mono font-semibold text-foreground">{name}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">
                          {formatShortId(c.Id)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${badge.badgeClass}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${badge.dotClass}`} />
                          <span>{badge.label}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-muted-foreground">{c.Image}</td>
                      <td className="px-4 py-3">
                        {ports.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {ports.map((p) => (
                              <a
                                key={p.hostPort}
                                href={p.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent border border-border text-[10px] font-mono text-primary"
                              >
                                {p.hostPort}:{p.containerPort}
                              </a>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          {isRunning ? (
                            <button
                              onClick={() => stopMutation.mutate(name)}
                              className="p-1 rounded hover:bg-destructive/10 text-destructive"
                              title="Stop"
                            >
                              <Square className="h-3 w-3" />
                            </button>
                          ) : (
                            <button
                              onClick={() => startMutation.mutate(name)}
                              className="p-1 rounded hover:bg-emerald-500/10 text-emerald-400"
                              title="Start"
                            >
                              <Play className="h-3 w-3" />
                            </button>
                          )}
                          <button
                            onClick={() => restartMutation.mutate(name)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            title="Restart"
                          >
                            <RotateCw className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => {
                              setExecTarget(c);
                              setExecOutput("");
                            }}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            title="Exec"
                          >
                            <Terminal className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => setLogsTarget(c)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            title="Logs"
                          >
                            <FileText className="h-3 w-3" />
                          </button>
                          <button
                            onClick={async () => {
                              const ok = await confirmAction({
                                title: `Remove Container "${name}"`,
                                description: `Force remove container "${name}" and release its ephemeral container state?`,
                                confirmLabel: "Remove Container",
                                variant: "destructive",
                              });
                              if (ok) removeMutation.mutate(name);
                            }}
                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Deploy Container Modal */}
      {showDeployModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/80 pb-3">
              <div className="flex items-center gap-2">
                <Box className="h-5 w-5 text-primary" />
                <div>
                  <h2 className="text-base font-semibold">Run Ad-hoc OCI Container</h2>
                  <p className="text-[11px] text-muted-foreground">
                    Direct Docker run on daemon without Git repository or CI/CD pipeline setup.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDeployModal(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-foreground mb-1">
                  Docker Image <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={deployImage}
                  onChange={(e) => setDeployImage(e.target.value)}
                  placeholder="e.g. nginx:alpine, redis:alpine, node:20-alpine"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">
                  Container Name (Optional)
                </label>
                <input
                  type="text"
                  value={deployName}
                  onChange={(e) => setDeployName(e.target.value)}
                  placeholder="e.g. my_web_app"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1">Host Port</label>
                  <input
                    type="number"
                    value={deployHostPort}
                    onChange={(e) => setDeployHostPort(e.target.value)}
                    placeholder="e.g. 8080"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block font-medium text-foreground mb-1">Container Port</label>
                  <input
                    type="number"
                    value={deployContainerPort}
                    onChange={(e) => setDeployContainerPort(e.target.value)}
                    placeholder="e.g. 80"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">
                  Environment Variables (One per line)
                </label>
                <textarea
                  rows={3}
                  value={deployEnv}
                  onChange={(e) => setDeployEnv(e.target.value)}
                  placeholder="KEY=VALUE"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/80">
              <button
                onClick={() => setShowDeployModal(false)}
                className="px-3.5 py-1.5 rounded-lg border border-border bg-card text-xs font-medium hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => deployMutation.mutate()}
                disabled={deployMutation.isPending || !deployImage.trim()}
                className="px-4 py-1.5 rounded-lg bg-primary text-xs font-semibold text-primary-foreground hover:opacity-90 shadow-sm"
              >
                {deployMutation.isPending ? "Deploying..." : "Run Container"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exec Terminal Modal */}
      {execTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/80 pb-3">
              <div className="flex items-center gap-2">
                <Terminal className="h-5 w-5 text-primary" />
                <div>
                  <h2 className="text-sm font-semibold">
                    In-Container Exec:{" "}
                    <span className="font-mono text-primary">
                      {formatContainerName(execTarget.Names)}
                    </span>
                  </h2>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    {execTarget.Image} • {formatShortId(execTarget.Id)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setExecTarget(null)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Quick snippet chips */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-[10px] text-muted-foreground uppercase font-mono mr-1">
                Quick:
              </span>
              {["uname -a", "cat /etc/os-release", "ps aux", "df -h", "env", "ls -la /"].map(
                (snippet) => (
                  <button
                    key={snippet}
                    onClick={() => {
                      setExecCmd(snippet);
                      handleRunExec(snippet);
                    }}
                    className="px-2 py-0.5 rounded bg-accent/60 border border-border font-mono text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    {snippet}
                  </button>
                ),
              )}
            </div>

            {/* Command Input */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-primary text-xs">
                  $
                </span>
                <input
                  type="text"
                  value={execCmd}
                  onChange={(e) => setExecCmd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRunExec();
                  }}
                  placeholder="Enter command (e.g. cat /etc/hosts)..."
                  className="w-full pl-7 pr-3 py-2 bg-background border border-border rounded-lg font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <button
                onClick={() => handleRunExec()}
                disabled={isExecRunning || !execCmd.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-all"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Run</span>
              </button>
            </div>

            {/* Output Display */}
            <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-3.5 font-mono text-xs text-zinc-300 min-h-[180px] max-h-[300px] overflow-y-auto whitespace-pre-wrap">
              {isExecRunning ? (
                <div className="text-zinc-500 animate-pulse">
                  Executing command inside container...
                </div>
              ) : execOutput ? (
                execOutput
              ) : (
                <div className="text-zinc-600">Command output will be displayed here.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Logs Modal */}
      {logsTarget && (
        <ContainerLogsModal container={logsTarget} onClose={() => setLogsTarget(null)} />
      )}

      {/* Inspect Modal */}
      {inspectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-5 shadow-xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-border/80 pb-3">
              <div className="flex items-center gap-2">
                <Info className="h-5 w-5 text-primary" />
                <h2 className="text-sm font-semibold">
                  Inspect:{" "}
                  <span className="font-mono text-primary">
                    {formatContainerName(inspectTarget.Names)}
                  </span>
                </h2>
              </div>
              <button
                onClick={() => setInspectTarget(null)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto rounded-lg bg-zinc-950 border border-zinc-800 p-3.5 font-mono text-xs text-zinc-300 whitespace-pre-wrap">
              {isInspectLoading ? (
                <div className="text-zinc-500 animate-pulse">Loading inspection data...</div>
              ) : (
                JSON.stringify(inspectData, null, 2)
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Subcomponent for container logs
function ContainerLogsModal({
  container,
  onClose,
}: {
  container: ContainerItem;
  onClose: () => void;
}) {
  const engine = useEngine();
  const name = formatContainerName(container.Names);

  const logsQuery = useQuery({
    queryKey: ["docker-logs", name, engine.url, engine.token],
    queryFn: async ({ signal }) => {
      const res = await engine.call<any>(
        "GET",
        `/api/docker/containers/${encodeURIComponent(name)}/logs?tail=200`,
        undefined,
        { signal },
      );
      return res.logs || "";
    },
    refetchInterval: 3000,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="w-full max-w-3xl rounded-xl border border-border bg-card p-5 shadow-xl space-y-3.5 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-border/80 pb-3">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-sm font-semibold">
                Live Logs: <span className="font-mono text-primary">{name}</span>
              </h2>
              <p className="text-[11px] text-muted-foreground font-mono">
                Auto-refreshing every 3s • {container.Image}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(logsQuery.data || "");
                toast.success("Logs copied to clipboard");
              }}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Copy Logs"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto rounded-lg bg-zinc-950 border border-zinc-800 p-3.5 font-mono text-xs text-zinc-300 whitespace-pre-wrap min-h-[300px]">
          {logsQuery.isLoading ? (
            <div className="text-zinc-500 animate-pulse">Streaming logs from Docker daemon...</div>
          ) : logsQuery.data ? (
            logsQuery.data
          ) : (
            <div className="text-zinc-500">No output recorded for this container.</div>
          )}
        </div>
      </div>
    </div>
  );
}
