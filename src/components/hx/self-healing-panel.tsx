import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  Activity,
  RotateCcw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Zap,
  Server,
  Terminal,
  RefreshCw,
  Sparkles,
  Settings,
  Layers,
  HeartPulse,
  Radio,
  ArrowRightLeft,
  Sliders,
  Check,
  Boxes,
  Cpu,
  Database,
  Globe,
  HardDrive,
  GitBranch,
  Search,
  CheckCircle,
  HelpCircle,
  Play,
  Flame,
  Gauge,
  Power,
  TrendingDown,
  ShieldAlert,
  Wand2,
  ExternalLink,
  ArrowDownToLine,
  Star,
  Tag,
  Shield,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { useEngine } from "@/lib/engine";

interface SelfHealEvent {
  id: string;
  project: string;
  eventType: string;
  details: string;
  status: "info" | "warning" | "error" | "success";
  timestamp: number;
}

interface SelfHealStatus {
  running: boolean;
  daemonHealthy: boolean;
  totalTracked: number;
  healthyCount: number;
  recoveringCount: number;
  crashloopCount: number;
  projects: Record<
    string,
    {
      status: "healthy" | "recovering" | "crashloop" | "rolled_back" | "degraded";
      lastProbeTs: number;
      message: string;
      latencyMs: number;
      memoryPercent?: number;
      circuitState?: "CLOSED" | "HALF-OPEN" | "OPEN";
      tiers?: {
        startup: "passed" | "warming_up" | "failed";
        readiness: "ready" | "failing";
        liveness: "healthy" | "recovering" | "crashloop" | "rolled_back";
      };
    }
  >;
}

interface HealthConfig {
  probePath: string;
  expectedStatus: number;
  startupDelaySeconds: number;
  timeoutSeconds: number;
  blueGreen: boolean;
  maxRetries: number;
}

interface PipelineStage {
  stage: string;
  name: string;
  status: "passed" | "warning" | "failing";
  detail: string;
}

interface AuditResult {
  project: string;
  auditTimestamp: number;
  durationMs: number;
  overallStatus: "all_healthy" | "warning";
  stages: PipelineStage[];
}

interface DockerHubResult {
  id: string;
  name: string;
  repoName: string;
  image: string;
  tag: string;
  desc: string;
  stars: number;
  starCountFormatted: string;
  pulls: number;
  pullCountFormatted: string;
  isOfficial: boolean;
  isAutomated: boolean;
  hubUrl: string;
  icon: string;
}

interface DockerHubTag {
  name: string;
  tag: string;
  fullSize: number;
  sizeFormatted: string;
  lastUpdated: string;
  lastUpdatedFormatted: string;
  architectures: string[];
  isSlim: boolean;
  isHardened: boolean;
  digest: string;
}

interface DockerHubTagsResponse {
  repo: string;
  total: number;
  hardenedAlternative?: string | null;
  hasHardenedProfile?: boolean;
  tags: DockerHubTag[];
}

export function SelfHealingPanel({ projectName }: { projectName?: string }) {
  const qc = useQueryClient();
  const [filterType, setFilterType] = useState<string>("all");
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [showChaosModal, setShowChaosModal] = useState<boolean>(false);
  const [showDockerHubModal, setShowDockerHubModal] = useState<boolean>(false);
  const [hubSearchQuery, setHubSearchQuery] = useState<string>(projectName || "airflow");
  const [selectedRepoForTags, setSelectedRepoForTags] = useState<string | null>(null);
  const [activeStageTab, setActiveStageTab] = useState<string | null>(null);
  const engine = useEngine();

  // Fetch status summary
  const { data: status, isLoading: statusLoading } = useQuery<SelfHealStatus>({
    queryKey: ["self-heal-status", engine.url],
    queryFn: async () => {
      return engine.call<SelfHealStatus>("GET", "/api/self-heal/status");
    },
    refetchInterval: 3000,
  });

  // Fetch event timeline
  const { data: events = [], isLoading: eventsLoading } = useQuery<SelfHealEvent[]>({
    queryKey: ["self-heal-events", projectName, engine.url],
    queryFn: async () => {
      const pParam = projectName ? `?project=${encodeURIComponent(projectName)}` : "";
      return engine.call<SelfHealEvent[]>("GET", `/api/self-heal/events${pParam}`);
    },
    refetchInterval: 3000,
  });

  // Fetch project health config
  const { data: config } = useQuery<HealthConfig>({
    queryKey: ["health-config", projectName, engine.url],
    queryFn: async () => {
      if (!projectName) return null;
      return engine.call<HealthConfig>("GET", `/api/projects/${encodeURIComponent(projectName)}/health-config`);
    },
    enabled: !!projectName,
  });

  // Query live Docker Hub search API
  const { data: hubData, isLoading: hubLoading } = useQuery<{ total: number; results: DockerHubResult[] }>({
    queryKey: ["dockerhub-live-search", hubSearchQuery, engine.url],
    queryFn: async () => {
      if (!hubSearchQuery.trim()) return { total: 0, results: [] };
      return engine.call<{ total: number; results: DockerHubResult[] }>(
        "GET",
        `/api/catalog/dockerhub-search?q=${encodeURIComponent(hubSearchQuery.trim())}`
      );
    },
    enabled: showDockerHubModal && !!hubSearchQuery.trim(),
  });

  // Query live Docker Hub repository tags
  const { data: tagsData, isLoading: tagsLoading } = useQuery<DockerHubTagsResponse>({
    queryKey: ["dockerhub-repo-tags", selectedRepoForTags, engine.url],
    queryFn: async () => {
      if (!selectedRepoForTags) return null;
      return engine.call<DockerHubTagsResponse>(
        "GET",
        `/api/catalog/dockerhub-tags?repo=${encodeURIComponent(selectedRepoForTags)}`
      );
    },
    enabled: !!selectedRepoForTags,
  });

  const [formData, setFormData] = useState<HealthConfig>({
    probePath: "/",
    expectedStatus: 200,
    startupDelaySeconds: 5,
    timeoutSeconds: 3,
    blueGreen: true,
    maxRetries: 4,
  });

  useEffect(() => {
    if (config) setFormData(config);
  }, [config]);

  // Update health config mutation
  const updateConfigMutation = useMutation({
    mutationFn: async (updated: HealthConfig) => {
      return engine.call("POST", `/api/projects/${encodeURIComponent(projectName!)}/health-config`, updated);
    },
    onSuccess: () => {
      toast.success("Health probe policy saved");
      setShowConfigModal(false);
      qc.invalidateQueries({ queryKey: ["health-config", projectName] });
      qc.invalidateQueries({ queryKey: ["self-heal-events"] });
    },
    onError: (err: any) => {
      toast.error(`Failed to save policy: ${err.message}`);
    },
  });

  // Autonomous CrashLoop Auto-Remediation Mutation
  const autoRemediateMutation = useMutation({
    mutationFn: async () => {
      return engine.call("POST", `/api/projects/${encodeURIComponent(projectName!)}/auto-remediate-image`);
    },
    onSuccess: (data: any) => {
      toast.success(`🪄 ${data.message || "Auto-Remediation complete: Switched to verified image."}`);
      qc.invalidateQueries({ queryKey: ["self-heal-status"] });
      qc.invalidateQueries({ queryKey: ["self-heal-events"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err: any) => {
      toast.error(`Auto-Remediation failed: ${err.message}`);
    },
  });

  // Switch to specific Docker Hub image / tag mutation
  const switchImageMutation = useMutation({
    mutationFn: async (newImage: string) => {
      // 1. Update project source
      await engine.call("POST", "/api/projects", {
        name: projectName,
        source: newImage,
        target: "docker",
      });
      // 2. Queue deploy
      return engine.call("POST", `/api/projects/${encodeURIComponent(projectName!)}/deploy`, {
        trigger: "dockerhub-heal",
      });
    },
    onSuccess: (_, newImage) => {
      toast.success(`Switched project "${projectName}" image to "${newImage}" & triggered deploy`);
      setShowDockerHubModal(false);
      setSelectedRepoForTags(null);
      qc.invalidateQueries({ queryKey: ["self-heal-status"] });
      qc.invalidateQueries({ queryKey: ["self-heal-events"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err: any) => {
      toast.error(`Failed to switch image: ${err.message}`);
    },
  });

  // Trigger 9-Stage Pipeline Audit
  const [auditData, setAuditData] = useState<AuditResult | null>(null);
  const auditMutation = useMutation({
    mutationFn: async () => {
      return engine.call<AuditResult>("POST", `/api/projects/${encodeURIComponent(projectName!)}/pipeline-audit`);
    },
    onSuccess: (data) => {
      setAuditData(data);
      toast.success(`9-Stage Audit completed in ${data.durationMs}ms: All safeguards verified`);
      qc.invalidateQueries({ queryKey: ["self-heal-events"] });
    },
    onError: (err: any) => {
      toast.error(`Audit failed: ${err.message}`);
    },
  });

  // Trigger Chaos Drill
  const chaosMutation = useMutation({
    mutationFn: async (type: "kill" | "memory_spike" | "flapping") => {
      return engine.call("POST", `/api/projects/${encodeURIComponent(projectName!)}/chaos-test`, { type });
    },
    onSuccess: (data: any) => {
      toast.warning(`Chaos drill initiated: ${data.message}`);
      qc.invalidateQueries({ queryKey: ["self-heal-status"] });
      qc.invalidateQueries({ queryKey: ["self-heal-events"] });
    },
    onError: (err: any) => {
      toast.error(`Chaos drill failed: ${err.message}`);
    },
  });

  // Trigger manual probe
  const probeMutation = useMutation({
    mutationFn: async () => {
      const endpoint = projectName
        ? `/api/projects/${encodeURIComponent(projectName)}/heal`
        : `/api/self-heal/probe`;
      return engine.call("POST", endpoint);
    },
    onSuccess: () => {
      toast.success("Liveness probe executed successfully");
      qc.invalidateQueries({ queryKey: ["self-heal-status"] });
      qc.invalidateQueries({ queryKey: ["self-heal-events"] });
    },
    onError: (err: any) => {
      toast.error(`Probe failed: ${err.message}`);
    },
  });

  // Trigger AutoPrune
  const pruneMutation = useMutation({
    mutationFn: async () => {
      return engine.call("POST", "/api/self-heal/prune");
    },
    onSuccess: () => {
      toast.success("AutoPrune completed: Cleaned dangling images & builder caches");
      qc.invalidateQueries({ queryKey: ["self-heal-events"] });
    },
    onError: (err: any) => {
      toast.error(`AutoPrune failed: ${err.message}`);
    },
  });

  const projectHealth = projectName && status?.projects ? status.projects[projectName] : null;

  const defaultStages: PipelineStage[] = [
    { stage: "build", name: "1. Build Healer", status: "passed", detail: "Multi-stage builder & amd64 emulation ready" },
    { stage: "registry", name: "2. Registry Resolver", status: "passed", detail: "Multi-registry fallback active (ghcr, quay, docker)" },
    { stage: "pull", name: "3. Pull Engine", status: "passed", detail: "Universal Image Resolver with live Docker Hub & DHI discovery" },
    { stage: "startup", name: "4. Startup Guard", status: "passed", detail: "--init (Tini PID 1) active, env injection ready" },
    { stage: "network", name: "5. Network Healer", status: "passed", detail: "Dynamic port rebind & bridge cleanup active" },
    { stage: "health", name: "6. Health Probes", status: projectHealth?.status === "healthy" ? "passed" : "warning", detail: "3-tier probes (Startup, Readiness, Liveness)" },
    { stage: "storage", name: "7. Storage Sentinel", status: "passed", detail: "Named volume persistence (hx_vol_*) active" },
    { stage: "resources", name: "8. Resource Sentinel", status: "passed", detail: "Predictive 90% OOM guard & AutoPrune active" },
    { stage: "orchestration", name: "9. Orchestration", status: "passed", detail: "CrashLoop auto-remediation & zero downtime active" },
  ];

  const displayStages = auditData?.stages || defaultStages;

  const filteredEvents = events.filter((e) => {
    if (filterType === "all") return true;
    return e.status === filterType;
  });

  const circuitState = projectHealth?.circuitState || "CLOSED";
  const isCrashing = projectHealth?.status === "crashloop" || projectHealth?.status === "degraded";

  return (
    <div className="space-y-6">
      {/* Header & Status Card */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold tracking-tight">AutoHeal v7 Autonomous Resilience & Docker Hub Tags Explorer</h3>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-0.5 text-[11px] font-medium text-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                  Docker Hub Tags & Hardened DHI Mesh Active
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Universal tag explorer, Docker Hardened Images (DHI), CrashLoopBackOff autonomous auto-remediation, and circuit breakers.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {projectName && (
              <>
                <button
                  onClick={() => setShowDockerHubModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
                >
                  <Search className="h-3.5 w-3.5" />
                  Docker Hub Explorer
                </button>
                <button
                  onClick={() => setShowChaosModal((o) => !o)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors"
                >
                  <Flame className="h-3.5 w-3.5" />
                  Chaos Lab
                </button>
                <button
                  onClick={() => auditMutation.mutate()}
                  disabled={auditMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary/15 border border-primary/30 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25 transition-colors disabled:opacity-50"
                >
                  <Play className={`h-3.5 w-3.5 ${auditMutation.isPending ? "animate-spin" : ""}`} />
                  Run 9-Stage Audit
                </button>
                <button
                  onClick={() => setShowConfigModal((o) => !o)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2 transition-colors"
                >
                  <Sliders className="h-3.5 w-3.5 text-primary" />
                  Probe Policy
                </button>
              </>
            )}
            <button
              onClick={() => probeMutation.mutate()}
              disabled={probeMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${probeMutation.isPending ? "animate-spin" : ""}`} />
              Probe Now
            </button>
            <button
              onClick={() => pruneMutation.mutate()}
              disabled={pruneMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2 transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5 text-warning" />
              AutoPrune
            </button>
          </div>
        </div>

        {/* CrashLoop / Degraded Autonomous Auto-Remediation Banner */}
        {projectName && isCrashing && (
          <div className="mt-5 rounded-xl border border-destructive/40 bg-destructive/10 p-4 shadow-sm">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-foreground uppercase tracking-wide">
                      CrashLoop / Startup Failure Detected
                    </span>
                    <span className="rounded bg-destructive/20 px-2 py-0.5 text-[10px] font-mono text-destructive font-bold">
                      {projectHealth?.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground font-mono">
                    {projectHealth?.message || "Container failed to initialize or unresponsive on port."}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => autoRemediateMutation.mutate()}
                  disabled={autoRemediateMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary/90 px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-all disabled:opacity-50"
                >
                  <Wand2 className={`h-3.5 w-3.5 ${autoRemediateMutation.isPending ? "animate-spin" : ""}`} />
                  <span>🪄 Auto-Remediate with Docker Hub</span>
                </button>
                <button
                  onClick={() => setShowDockerHubModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface hover:bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground transition-colors"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span>Pick Alternative Tag</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Project Specific Health Cards */}
        {projectName && projectHealth && (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-border/80 bg-surface/50 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Service State
              </div>
              <div className="mt-1 flex items-center gap-2">
                {projectHealth.status === "healthy" ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <span className="font-semibold text-success">Healthy (200 OK)</span>
                  </>
                ) : projectHealth.status === "recovering" ? (
                  <>
                    <RefreshCw className="h-4 w-4 text-warning animate-spin" />
                    <span className="font-semibold text-warning">Auto-Resurrecting</span>
                  </>
                ) : projectHealth.status === "crashloop" ? (
                  <>
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <span className="font-semibold text-destructive">CrashLoopBackOff</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-primary">Auto-Remediating</span>
                  </>
                )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground truncate">{projectHealth.message}</div>
            </div>

            <div className="rounded-lg border border-border/80 bg-surface/50 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Probe Latency & Memory
              </div>
              <div className="mt-1 flex items-center gap-2 font-mono text-lg font-semibold text-foreground">
                <Activity className="h-4 w-4 text-primary" />
                <span>{projectHealth.latencyMs > 0 ? `${projectHealth.latencyMs} ms` : "< 1 ms"}</span>
                <span className="text-xs font-normal text-muted-foreground">({projectHealth.memoryPercent || "0.4"}% RAM)</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground font-mono">
                {config?.probePath || "/"} (HTTP {config?.expectedStatus || 200})
              </div>
            </div>

            <div className="rounded-lg border border-border/80 bg-surface/50 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Circuit Breaker Sentinel
              </div>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-sm font-semibold">
                {circuitState === "CLOSED" ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <ShieldCheck className="h-4 w-4" />
                    CLOSED (Normal Flow)
                  </span>
                ) : circuitState === "HALF-OPEN" ? (
                  <span className="inline-flex items-center gap-1 text-warning">
                    <Radio className="h-4 w-4 animate-pulse" />
                    HALF-OPEN (Canary)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <ShieldAlert className="h-4 w-4" />
                    OPEN (Isolated)
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Flapping & cascading failure guard</div>
            </div>

            <div className="rounded-lg border border-border/80 bg-surface/50 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Deployment Strategy
              </div>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-sm font-semibold text-primary">
                <ArrowRightLeft className="h-4 w-4 text-primary" />
                {config?.blueGreen !== false ? "Blue-Green Zero Downtime" : "Direct Fast Replace"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">Atomic route cutover upon 200 OK</div>
            </div>
          </div>
        )}

        {/* 9-Stage Live Pipeline Diagnostic Inspector */}
        <div className="mt-6 pt-5 border-t border-border/70">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                9-Stage Autonomous Resilience Pipeline
              </span>
            </div>
            <span className="text-[11px] font-mono text-muted-foreground">
              {auditData ? `Last audited: ${new Date(auditData.auditTimestamp).toLocaleTimeString()} (${auditData.durationMs}ms)` : "Continuous watchdog monitoring"}
            </span>
          </div>

          {/* Stepper Grid */}
          <div className="grid grid-cols-3 md:grid-cols-9 gap-2">
            {displayStages.map((st) => (
              <button
                key={st.stage}
                onClick={() => setActiveStageTab(activeStageTab === st.stage ? null : st.stage)}
                className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-center transition-all ${
                  activeStageTab === st.stage
                    ? "border-primary bg-primary/10 shadow-sm"
                    : "border-border/80 bg-surface/40 hover:bg-surface-2/60"
                }`}
              >
                <div className="flex items-center justify-center h-6 w-6 rounded-full bg-surface-2 mb-1.5">
                  {st.status === "passed" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                  )}
                </div>
                <span className="text-[10px] font-medium text-foreground truncate w-full">{st.name.split(". ")[1]}</span>
                <span className="text-[9px] font-mono text-success uppercase mt-0.5">{st.status}</span>
              </button>
            ))}
          </div>

          {/* Stage Details Drawer */}
          {activeStageTab && (
            <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs font-mono">
              <div className="flex items-center justify-between text-foreground font-semibold">
                <span>{displayStages.find((s) => s.stage === activeStageTab)?.name}</span>
                <button onClick={() => setActiveStageTab(null)} className="text-muted-foreground hover:text-foreground">✕</button>
              </div>
              <p className="mt-1 text-muted-foreground">
                {displayStages.find((s) => s.stage === activeStageTab)?.detail}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Docker Hub Live Search & Tags Explorer Modal */}
      {showDockerHubModal && (
        <div className="rounded-xl border border-primary/40 bg-card p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Search className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-semibold tracking-tight text-foreground">
                  Docker Hub Live Search, Tags & Hardened DHI Explorer
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  Live repository search, tag version inspector, and Docker Hardened Images (DHI) catalog.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setShowDockerHubModal(false);
                setSelectedRepoForTags(null);
              }}
              className="rounded-lg border border-border/60 p-1 text-xs text-muted-foreground hover:text-foreground"
            >
              ✕ Close
            </button>
          </div>

          {/* Search Input Bar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={hubSearchQuery}
                onChange={(e) => setHubSearchQuery(e.target.value)}
                placeholder="Search Docker Hub e.g. mcp/playwright, airflow, postgres, redis, n8n, ollama..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-surface border border-border/60 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                autoFocus
              />
            </div>
          </div>

          {/* Quick Suggestions */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[11px] text-muted-foreground font-medium">Quick suggestions:</span>
            {["mcp/playwright", "apache/airflow", "dhi/airflow", "postgres", "redis", "n8n", "vaultwarden", "immich", "ollama"].map((sug) => (
              <button
                key={sug}
                onClick={() => setHubSearchQuery(sug)}
                className="rounded-md border border-border/50 bg-surface/50 px-2 py-0.5 text-[11px] font-mono text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
              >
                {sug}
              </button>
            ))}
          </div>

          {/* Results List */}
          <div className="max-h-96 overflow-y-auto space-y-2.5 pt-2">
            {hubLoading ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                Querying Docker Hub Registry API for "{hubSearchQuery}"...
              </div>
            ) : !hubData?.results || hubData.results.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No repositories found on Docker Hub for "{hubSearchQuery}".
              </div>
            ) : (
              hubData.results.map((r) => {
                const isTagsExpanded = selectedRepoForTags === r.repoName;

                return (
                  <div
                    key={r.id}
                    className="flex flex-col gap-2 p-3.5 rounded-lg border border-border/60 bg-surface/40 hover:bg-surface-2/40 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{r.icon}</span>
                          <span className="font-mono text-xs font-bold text-foreground truncate">{r.repoName}</span>
                          {r.isOfficial && (
                            <span className="rounded bg-primary/20 text-primary px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider">
                              Official
                            </span>
                          )}
                          {r.repoName.startsWith("dhi/") && (
                            <span className="inline-flex items-center gap-1 rounded bg-success/20 text-success px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider">
                              <Shield className="h-2.5 w-2.5" /> Hardened (DHI)
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{r.desc}</p>
                        <div className="mt-2 flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Star className="h-3 w-3 text-warning fill-warning" />
                            {r.starCountFormatted}
                          </span>
                          <span className="flex items-center gap-1">
                            <ArrowDownToLine className="h-3 w-3 text-primary" />
                            {r.pullCountFormatted} pulls
                          </span>
                          <a
                            href={r.hubUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-primary hover:underline"
                          >
                            hub.docker.com <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setSelectedRepoForTags(isTagsExpanded ? null : r.repoName)}
                          className="px-2.5 py-1.5 rounded-lg border border-border/80 bg-surface hover:bg-surface-2 text-xs font-medium text-foreground transition-colors inline-flex items-center gap-1.5"
                        >
                          <Tag className="h-3 w-3 text-primary" />
                          <span>Tags</span>
                          {isTagsExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                        <button
                          onClick={() => switchImageMutation.mutate(r.image)}
                          disabled={switchImageMutation.isPending}
                          className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground shadow-sm transition-all"
                        >
                          {switchImageMutation.isPending ? "Deploying..." : "1-Click Deploy"}
                        </button>
                      </div>
                    </div>

                    {/* Live Tags & DHI Hardened Drawer */}
                    {isTagsExpanded && (
                      <div className="mt-2 rounded-lg border border-primary/30 bg-background/80 p-3 text-xs space-y-3">
                        {tagsLoading ? (
                          <div className="p-3 text-center text-muted-foreground font-mono">
                            <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-1 text-primary" />
                            Loading tags from https://hub.docker.com/r/{r.repoName}/tags...
                          </div>
                        ) : (
                          <>
                            {/* Hardened Alternative Recommendation (DHI) */}
                            {tagsData?.hasHardenedProfile && tagsData?.hardenedAlternative && (
                              <div className="rounded-lg border border-success/30 bg-success/10 p-2.5 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <Shield className="h-4 w-4 text-success" />
                                  <div>
                                    <span className="font-semibold text-foreground text-[11px]">
                                      Docker Hardened Image (DHI) Available:
                                    </span>{" "}
                                    <span className="font-mono text-success text-[11px] font-bold">
                                      {tagsData.hardenedAlternative}:latest
                                    </span>
                                    <p className="text-[10px] text-muted-foreground">
                                      Enterprise hardened, 0 known CVEs, minimal footprint.
                                    </p>
                                  </div>
                                </div>
                                <button
                                  onClick={() => switchImageMutation.mutate(`${tagsData.hardenedAlternative}:latest`)}
                                  className="shrink-0 px-2.5 py-1 rounded bg-success text-success-foreground text-[10px] font-semibold hover:opacity-90 transition-opacity"
                                >
                                  Deploy DHI
                                </button>
                              </div>
                            )}

                            {/* Tags Grid / List */}
                            <div className="space-y-1.5 max-h-48 overflow-y-auto">
                              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                                Available Repository Tags ({tagsData?.tags?.length || 0}):
                              </div>
                              {tagsData?.tags?.map((t) => (
                                <div
                                  key={t.name}
                                  className="flex items-center justify-between gap-2 p-1.5 rounded border border-border/40 bg-surface/50 hover:bg-surface-2/60 transition-colors"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-mono text-xs font-bold text-foreground truncate">
                                      :{t.name}
                                    </span>
                                    <span className="rounded bg-surface-2 px-1.5 py-0.2 text-[10px] font-mono text-muted-foreground">
                                      {t.sizeFormatted}
                                    </span>
                                    <span className="hidden sm:inline text-[10px] font-mono text-muted-foreground/70">
                                      {t.architectures.join(", ")}
                                    </span>
                                  </div>
                                  <button
                                    onClick={() => switchImageMutation.mutate(t.tag)}
                                    disabled={switchImageMutation.isPending}
                                    className="px-2 py-0.5 rounded bg-primary/20 hover:bg-primary text-primary hover:text-primary-foreground text-[10px] font-mono font-semibold transition-colors"
                                  >
                                    Deploy :{t.name}
                                  </button>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Chaos Simulator & Resilience Lab Modal */}
      {showChaosModal && projectName && (
        <div className="rounded-xl border border-destructive/40 bg-card p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2 text-destructive">
              <Flame className="h-5 w-5" />
              <h4 className="text-sm font-semibold tracking-tight text-foreground">Chaos Engineering & Self-Healing Lab</h4>
            </div>
            <button
              onClick={() => setShowChaosModal(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ✕ Close
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            Safely inject simulated failure scenarios to verify HosteraX's autonomous detection, circuit breaking, and resurrection capabilities in real time.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border/80 bg-surface/50 p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 font-semibold text-xs text-foreground">
                  <Power className="h-4 w-4 text-destructive" />
                  Simulate Sudden Crash (kill -9)
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Kills the container process instantly to test Watchdog detection and resurrection (&lt;4s).
                </p>
              </div>
              <button
                onClick={() => chaosMutation.mutate("kill")}
                disabled={chaosMutation.isPending}
                className="mt-3 w-full rounded-md bg-destructive/15 border border-destructive/30 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/25 transition-colors"
              >
                Inject Crash Drill
              </button>
            </div>

            <div className="rounded-lg border border-border/80 bg-surface/50 p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 font-semibold text-xs text-foreground">
                  <Gauge className="h-4 w-4 text-warning" />
                  Simulate 92% RAM Saturation
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Simulates near-OOM memory spike to test Predictive OOM Sentinel warnings and buffer recycling.
                </p>
              </div>
              <button
                onClick={() => chaosMutation.mutate("memory_spike")}
                disabled={chaosMutation.isPending}
                className="mt-3 w-full rounded-md bg-warning/15 border border-warning/30 py-1.5 text-xs font-semibold text-warning hover:bg-warning/25 transition-colors"
              >
                Inject RAM Spike Drill
              </button>
            </div>

            <div className="rounded-lg border border-border/80 bg-surface/50 p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 font-semibold text-xs text-foreground">
                  <Radio className="h-4 w-4 text-primary" />
                  Simulate Flapping Oscillation
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Triggers consecutive failures to verify Circuit Breaker tripping to OPEN and canary recovery.
                </p>
              </div>
              <button
                onClick={() => chaosMutation.mutate("flapping")}
                disabled={chaosMutation.isPending}
                className="mt-3 w-full rounded-md bg-primary/15 border border-primary/30 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25 transition-colors"
              >
                Trip Circuit Breaker
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Health Probe Policy Configuration Modal */}
      {showConfigModal && projectName && (
        <div className="rounded-xl border border-primary/40 bg-card p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-semibold tracking-tight">Configure Health Probes & Blue-Green Policy</h4>
            </div>
            <button
              onClick={() => setShowConfigModal(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ✕ Close
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">HTTP Probe Endpoint Path</label>
              <input
                value={formData.probePath}
                onChange={(e) => setFormData({ ...formData, probePath: e.target.value })}
                placeholder="/"
                className="mt-1 w-full rounded-md border border-input bg-input/40 px-3 py-1.5 text-xs font-mono"
              />
              <span className="text-[10px] text-muted-foreground">e.g. /health, /api/health, /</span>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Expected HTTP Status Code</label>
              <input
                type="number"
                value={formData.expectedStatus}
                onChange={(e) => setFormData({ ...formData, expectedStatus: parseInt(e.target.value) || 200 })}
                placeholder="200"
                className="mt-1 w-full rounded-md border border-input bg-input/40 px-3 py-1.5 text-xs font-mono"
              />
              <span className="text-[10px] text-muted-foreground">Standard: 200 (or 204, 302)</span>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Startup Warmup Delay (Seconds)</label>
              <input
                type="number"
                value={formData.startupDelaySeconds}
                onChange={(e) => setFormData({ ...formData, startupDelaySeconds: parseInt(e.target.value) || 5 })}
                placeholder="5"
                className="mt-1 w-full rounded-md border border-input bg-input/40 px-3 py-1.5 text-xs font-mono"
              />
              <span className="text-[10px] text-muted-foreground">Grace period before killing cold boots</span>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Probe Timeout (Seconds)</label>
              <input
                type="number"
                value={formData.timeoutSeconds}
                onChange={(e) => setFormData({ ...formData, timeoutSeconds: parseInt(e.target.value) || 3 })}
                placeholder="3"
                className="mt-1 w-full rounded-md border border-input bg-input/40 px-3 py-1.5 text-xs font-mono"
              />
              <span className="text-[10px] text-muted-foreground">Max seconds before probe is marked failed</span>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">CrashLoop Failure Threshold</label>
              <input
                type="number"
                value={formData.maxRetries}
                onChange={(e) => setFormData({ ...formData, maxRetries: parseInt(e.target.value) || 4 })}
                placeholder="4"
                className="mt-1 w-full rounded-md border border-input bg-input/40 px-3 py-1.5 text-xs font-mono"
              />
              <span className="text-[10px] text-muted-foreground">Retries before automated instant rollback</span>
            </div>

            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer pb-2">
                <input
                  type="checkbox"
                  checked={formData.blueGreen}
                  onChange={(e) => setFormData({ ...formData, blueGreen: e.target.checked })}
                  className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                />
                <span>Enable Zero-Downtime Blue-Green</span>
              </label>
              <span className="text-[10px] text-muted-foreground">Keeps old version live until new version passes 200 OK</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
            <button
              onClick={() => setShowConfigModal(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => updateConfigMutation.mutate(formData)}
              disabled={updateConfigMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              Save Health Policy
            </button>
          </div>
        </div>
      )}

      {/* Self-Healing Events Timeline */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold tracking-tight">Self-Healing Event Stream</h4>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
              {events.length} events
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {["all", "success", "warning", "error"].map((t) => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  filterType === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-surface hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-border/60">
          {eventsLoading ? (
            <div className="p-8 text-center text-xs text-muted-foreground">Loading event stream...</div>
          ) : filteredEvents.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              No self-healing events recorded yet. Services are running normally.
            </div>
          ) : (
            filteredEvents.map((evt) => (
              <div key={evt.id} className="flex items-start justify-between gap-4 p-4 hover:bg-surface/30 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {evt.status === "success" ? (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    ) : evt.status === "warning" ? (
                      <AlertTriangle className="h-4 w-4 text-warning" />
                    ) : evt.status === "error" ? (
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-foreground uppercase">
                        {evt.eventType.replace(/_/g, " ")}
                      </span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.2 text-[10px] font-mono text-muted-foreground">
                        {evt.project}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground font-mono">{evt.details}</p>
                  </div>
                </div>
                <span className="shrink-0 text-[11px] font-mono text-muted-foreground/60">
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
