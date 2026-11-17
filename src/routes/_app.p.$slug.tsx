import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { StatusBadge } from "@/components/hx/status-badge";
import { STACKS, ENVIRONMENTS } from "@/lib/stacks";
import {
  useEngine,
  useMagicDnsSettings,
  useNetworkInterfaces,
  formatMagicDnsUrl,
  usePRPreviews,
  useProjectWebhookConfig,
  useScaleToZero,
  useServerNodes,
} from "@/lib/engine";
import { DeploymentDiffModal } from "@/components/hx/deployment-diff";
import { HealthMetrics } from "@/components/hx/health-metrics";
import { ServiceTopologyGraph } from "@/components/hx/service-topology-graph";
import { MagicDnsSelector } from "@/components/hx/magic-dns-selector";
import { DeleteProjectModal } from "@/components/hx/delete-project-modal";
import { AiTroubleshootModal } from "@/components/hx/ai-troubleshoot-modal";
import { ProjectGateCard } from "@/components/hx/project-gate-card";
import { ContainerTerminal } from "@/components/hx/container-terminal";
import { confirmAction } from "@/components/hx/confirm-modal";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  GitBranch,
  Globe,
  Plus,
  Rocket,
  RotateCcw,
  Trash2,
  FileCode,
  Cpu,
  ShieldCheck,
  Webhook,
  GitPullRequest,
  Check,
  Radio,
  Wifi,
  Smartphone,
  Share2,
  Moon,
  Sun,
  Zap,
  Sparkles,
  Server,
  Box,
  Code2,
  Download,
  Database,
  Eye,
  EyeOff,
  HardDrive,
  Lock,
  RefreshCw,
  Star,
  Table2,
  X,
} from "lucide-react";
import { SelfHealingPanel } from "@/components/hx/self-healing-panel";
import { parseDotEnvText, formatDotEnvText } from "@/utils/env-parser";
import { sanitizeDatabaseName, type ManagedDbEngine } from "@/utils/dependency-analyzer";
import {
  DB_ENGINE_SPECS,
  DB_STORAGE_OPTIONS_MB,
  buildInternalHostHint,
  formatDbStorageLabel,
  normalizeManualDbName,
  resolveDbEnvUpserts,
  summarizeDomainStatus,
} from "@/utils/project-db";
import {
  BUILD_PACK_OPTIONS,
  clampReplicas,
  normalizePlacementNodes,
  type BuildPackId,
} from "@/utils/project-scaling";
import {
  WEBHOOK_PROVIDER_SPECS,
  getWebhookProviderSpec,
  buildPublicWebhookUrl,
  type GitWebhookProvider,
} from "@/utils/webhooks-multi";

export const Route = createFileRoute("/_app/p/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} — HosteraX` },
      { name: "description", content: `Manage ${params.slug} deployments, env, and settings.` },
    ],
  }),
  component: ProjectPage,
});

type Tab =
  | "overview"
  | "terminal"
  | "deployments"
  | "webhooks"
  | "self-heal"
  | "logs"
  | "env"
  | "domains"
  | "databases"
  | "settings";

function ProjectPage() {
  const { slug } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [environment, setEnvironment] = useState<"production" | "preview" | "development">(
    "production",
  );
  const [isTroubleshootOpen, setIsTroubleshootOpen] = useState(false);
  const engine = useEngine();
  const { data: magicDns } = useMagicDnsSettings();
  const { data: netInfo } = useNetworkInterfaces();
  const primaryLanIp =
    netInfo?.primaryIp && netInfo.primaryIp !== "127.0.0.1" ? netInfo.primaryIp : null;

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", slug, engine.url, engine.token],
    queryFn: async () => {
      // Query Local SQLite Engine by slug or name
      try {
        const ep = await engine.call<any>("GET", `/api/projects/${slug}`);
        if (ep) {
          return {
            id: ep.id || `eng-${ep.name}`,
            name: ep.name,
            slug: ep.slug || ep.name,
            stack: ep.stack || "auto",
            status: ep.status === "ready" ? "active" : ep.status || "active",
            repo_url: ep.source || "",
            branch: ep.branch || "main",
            region: "local",
            subdomain: ep.slug || ep.name,
            build_command: ep.build_cmd || null,
            start_command: ep.start_cmd || null,
            port: ep.port || ep.route?.upstream_port || 3000,
            target_type: ep.target || "process",
            builder: ep.builder || "auto",
            replicas: Number(ep.replicas) || 1,
            placement_nodes: Array.isArray(ep.placement_nodes) ? ep.placement_nodes : [],
            server_name:
              ep.serverId && ep.serverId !== "local" ? ep.serverName || ep.serverId : null,
            health_path: ep.health_path || ep.healthPath || "/",
            workspace_type: "none",
            build_timeout_minutes: 30,
            created_at: ep.created_at
              ? new Date(ep.created_at).toISOString()
              : new Date().toISOString(),
            updated_at: ep.updated_at
              ? new Date(ep.updated_at).toISOString()
              : new Date().toISOString(),
            isLocal: true,
          };
        }
      } catch {}

      // Fallback: Search in SQLite Engine list
      try {
        const list = await engine.call<any[]>("GET", "/api/projects");
        const found = list?.find(
          (p) => (p.slug || p.name).toLowerCase() === slug.toLowerCase() || p.name === slug,
        );
        if (found) {
          return {
            id: found.id || `eng-${found.name}`,
            name: found.name,
            slug: found.slug || found.name,
            stack: found.stack || "auto",
            status: found.status === "ready" ? "active" : found.status || "active",
            repo_url: found.source || "",
            branch: found.branch || "main",
            region: "local",
            subdomain: found.slug || found.name,
            build_command: found.build_cmd || null,
            start_command: found.start_cmd || null,
            port: found.port || 3000,
            health_path: found.health_path || found.healthPath || "/",
            target_type: found.target || "process",
            builder: found.builder || "auto",
            replicas: Number(found.replicas) || 1,
            placement_nodes: Array.isArray(found.placement_nodes) ? found.placement_nodes : [],
            workspace_type: "none",
            build_timeout_minutes: 30,
            created_at: found.created_at
              ? new Date(found.created_at).toISOString()
              : new Date().toISOString(),
            updated_at: found.updated_at
              ? new Date(found.updated_at).toISOString()
              : new Date().toISOString(),
            isLocal: true,
          };
        }
      } catch {}

      return null;
    },
    refetchInterval: 5000,
  });

  const stack = project ? STACKS.find((s) => s.id === project.stack) : undefined;

  async function deploy(trigger: "manual" | "git" | "upload" | "url" | "cli" | "api" = "manual") {
    try {
      await engine.call("POST", `/api/projects/${project!.name}/deploy`, { trigger });
      toast.success(`Deploy queued on Local Engine`);
      setTab("logs");
      qc.invalidateQueries({ queryKey: ["local-deployments"] });
      qc.invalidateQueries({ queryKey: ["deployments"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Deploy failed");
    }
  }

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  async function handleConfirmDelete(permanent: boolean) {
    try {
      await engine.call(
        "DELETE",
        `/api/projects/${encodeURIComponent(project!.name)}${permanent ? "?permanent=true" : ""}`,
      );
      toast.success(
        permanent
          ? `✨ Project ${project!.name} purged permanently`
          : `📦 Project ${project!.name} archived & disk space freed (0 MB)`,
      );
      await qc.invalidateQueries({ queryKey: ["engine-projects"] });
      await qc.invalidateQueries({ queryKey: ["engine-projects-archived"] });
      await qc.invalidateQueries({ queryKey: ["projects"] });
      await qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      await qc.refetchQueries({ queryKey: ["engine-projects"] });
      setDeleteModalOpen(false);
      nav({ to: "/dashboard" });
    } catch (e: any) {
      toast.error(e.message || "Failed to delete project");
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "terminal", label: "Terminal & Docker Exec" },
    { id: "deployments", label: "Deployments" },
    { id: "webhooks", label: "Git & PR Previews" },
    { id: "self-heal", label: "Self-Healing & Health" },
    { id: "logs", label: "Logs" },
    { id: "env", label: "Env vars" },
    { id: "domains", label: "Domains" },
    { id: "databases", label: "Databases" },
    { id: "settings", label: "Settings" },
  ];

  if (isLoading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-sm text-muted-foreground animate-pulse">
        Loading project workspace...
      </div>
    );
  }

  if (!project) {
    return (
      <div className="mx-auto max-w-xl rounded-lg border border-border bg-card p-8 text-center">
        <h2 className="text-lg font-medium">Project not found</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Could not find project "{slug}" on the HosteraX control plane.
        </p>
        <Link to="/dashboard" className="mt-4 inline-block text-sm text-primary hover:underline">
          ← back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> All projects
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface-2 text-xl">
            {stack?.icon ?? <Cpu className="h-6 w-6 text-primary" />}
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatusBadge status={project.status} />
              {(project.replicas ?? 1) > 1 && (
                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary font-mono">
                  {project.replicas}x replicas
                </span>
              )}
              {"server_name" in project && project.server_name && (
                <span
                  className="flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5"
                  title="This project runs on a remote server over SSH"
                >
                  <Server className="h-3 w-3" /> {project.server_name}
                </span>
              )}
              <span className="flex items-center gap-1">
                <GitBranch className="h-3 w-3" /> {project.branch || "main"}
              </span>
              <a
                href={`https://${formatMagicDnsUrl(project.name, magicDns?.activeProvider || "sslip.io")}`}
                target="_blank"
                rel="noreferrer"
                title="Open on Local Machine"
                className="flex items-center gap-1 hover:text-primary transition-colors text-primary font-medium font-mono"
              >
                <Globe className="h-3 w-3" /> https://
                {formatMagicDnsUrl(project.name, magicDns?.activeProvider || "sslip.io")}{" "}
                <ExternalLink className="h-3 w-3" />
              </a>

              {primaryLanIp && (
                <a
                  href={`http://${primaryLanIp}:${project.port || 8080}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open on Local Network (Phone / Tablet on same Wi-Fi)"
                  className="flex items-center gap-1.5 hover:bg-emerald-950/60 transition-colors text-emerald-400 font-medium font-mono bg-emerald-950/30 border border-emerald-800/40 px-2 py-0.5 rounded text-xs"
                >
                  <Wifi className="h-3 w-3 text-emerald-400" />
                  <span>
                    http://{primaryLanIp}:{project.port || 8080}
                  </span>
                  <span className="text-[10px] uppercase font-sans text-emerald-500 font-semibold ml-0.5 px-1 py-0.2 bg-emerald-900/50 rounded">
                    Wi-Fi
                  </span>
                  <ExternalLink className="h-2.5 w-2.5 opacity-70" />
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
            {ENVIRONMENTS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.icon} {e.name}
              </option>
            ))}
          </select>
          <Link
            to="/containers"
            search={{ q: project.name } as any}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-accent transition-colors shadow-sm"
            title="Inspect raw OCI container and runtime process in Fleet Manager"
          >
            <Box className="h-3.5 w-3.5 text-primary" />
            <span>Fleet Container</span>
          </Link>
          <button
            onClick={() => setIsTroubleshootOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 border border-primary/30 px-3.5 py-2 text-xs font-semibold text-primary hover:bg-primary/25 transition-all shadow-sm active:scale-95"
            title="Open Autonomous AI Troubleshooter"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>AI Troubleshoot</span>
          </button>
          <button
            onClick={() => deploy("manual")}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 shadow-sm"
          >
            <Rocket className="h-4 w-4" /> Deploy
          </button>
        </div>
      </div>

      <div className="border-b border-border">
        <div className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm transition-colors ${tab === t.id ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && (
        <Overview
          project={project}
          activeProvider={magicDns?.activeProvider}
          lanIp={primaryLanIp}
        />
      )}
      {tab === "terminal" && <ContainerTerminal projectName={project.name} />}
      {tab === "deployments" && (
        <DeploymentsTab projectId={project.id} projectName={project.name} />
      )}
      {tab === "webhooks" && <WebhooksTab projectName={project.name} project={project} />}
      {tab === "self-heal" && <SelfHealingPanel projectName={project.name} />}
      {tab === "logs" && <LiveLogs projectName={project.name} />}
      {tab === "env" && (
        <EnvVars projectId={project.id} projectName={project.name} environment={environment} />
      )}
      {tab === "domains" && (
        <ProjectDomains projectId={project.id} projectName={project.name} project={project} />
      )}
      {tab === "databases" && (
        <DatabasesTab
          projectId={project.id}
          projectName={project.name}
          project={project}
          environment={environment}
        />
      )}
      {tab === "settings" && (
        <Settings project={project} onDelete={() => setDeleteModalOpen(true)} />
      )}

      <DeleteProjectModal
        isOpen={deleteModalOpen}
        projectName={project.name}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
      />

      <AiTroubleshootModal
        projectName={project?.name || slug}
        isOpen={isTroubleshootOpen}
        onClose={() => setIsTroubleshootOpen(false)}
      />
    </div>
  );
}

function Overview({
  project,
  activeProvider = "sslip.io",
  lanIp,
}: {
  project: any;
  activeProvider?: string;
  lanIp?: string | null;
}) {
  const engine = useEngine();
  const { data: recent = [] } = useQuery({
    queryKey: ["overview-deployments", project.name, engine.url],
    queryFn: async () => {
      // 1. Check Engine deployments
      try {
        const engDeps = await engine.call<any[]>(
          "GET",
          `/api/projects/${project.name}/deployments`,
        );
        if (engDeps && engDeps.length > 0) {
          return engDeps.slice(0, 5).map((d) => ({
            id: d.id,
            commit_message: d.commit_message || `Release ${d.version}`,
            commit_sha: d.commit_sha || d.id.slice(0, 8),
            status: d.phase === "ready" ? "success" : d.phase === "failed" ? "error" : "building",
            created_at: d.started_at
              ? new Date(d.started_at).toISOString()
              : new Date().toISOString(),
            version: d.version,
          }));
        }
      } catch {}
      return [];
    },
    refetchInterval: 3000,
  });

  return (
    <div className="space-y-6">
      <HealthMetrics projectId={project.id} projectName={project.name} status={project.status} />

      {/* Visual Service Topology & Dependency Mesh (Aspire v2 Benchmark) */}
      <ServiceTopologyGraph project={project} activeProvider={activeProvider} lanIp={lanIp} />

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="font-semibold text-sm">Recent Deployments Feed</div>
          <div className="text-xs text-muted-foreground">Showing last releases</div>
        </div>
        {recent.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No deployments recorded yet. Click "Deploy" to trigger your first build.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recent.map((d: any) => (
              <div
                key={d.id}
                className="flex items-center justify-between p-4 hover:bg-accent/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <StatusBadge status={d.status} />
                  <div>
                    <div className="text-sm font-medium">{d.commit_message ?? "Deployment"}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      <span className="font-mono">{d.commit_sha}</span>
                      {d.version && (
                        <span className="ml-2 font-mono text-primary">{d.version}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(d.created_at))} ago
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DeploymentsTab({ projectId, projectName }: { projectId: string; projectName: string }) {
  const engine = useEngine();
  const qc = useQueryClient();
  const [showDiff, setShowDiff] = useState(false);
  const [diffBaseId, setDiffBaseId] = useState<string | undefined>();

  const { data: deployments = [] } = useQuery({
    queryKey: ["deployments-merged", projectId, projectName, engine.url],
    queryFn: async () => {
      try {
        const engDeps = await engine.call<any[]>("GET", `/api/projects/${projectName}/deployments`);
        if (engDeps) {
          return engDeps.map((d: any) => ({
            id: d.id,
            commit_message: d.commit_message || `Release ${d.version}`,
            commit_sha: d.commit_sha || d.id.slice(0, 8),
            version: d.version,
            branch: d.branch || "main",
            environment: d.environment || "production",
            trigger_type: d.trigger || "manual",
            phase: d.phase,
            status:
              d.phase === "ready"
                ? "success"
                : d.phase === "failed"
                  ? "failed"
                  : d.phase || "building",
            created_at: d.started_at
              ? new Date(d.started_at).toISOString()
              : new Date().toISOString(),
          }));
        }
      } catch {}
      return [];
    },
    refetchInterval: 3000,
  });

  async function doRollback(dep: any) {
    const ok = await confirmAction({
      title: `Rollback to ${dep.version ?? dep.commit_sha ?? "Snapshot"}`,
      description: `A new build will be queued from ${dep.version ?? dep.commit_sha ?? "this release snapshot"}.`,
      confirmLabel: "Queue Rollback",
      variant: "warning",
    });
    if (!ok) return;
    try {
      // Replays this exact deployment (its working copy + frozen build settings) as a new release.
      await engine.call("POST", `/api/deployments/${dep.id}/rollback`);
      toast.success("Rollback queued");
      qc.invalidateQueries({ queryKey: ["deployments-merged"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Rollback failed");
    }
  }

  return (
    <div className="space-y-4">
      {deployments.length >= 2 && (
        <div className="flex justify-end">
          <button
            onClick={() => {
              setDiffBaseId(undefined);
              setShowDiff(true);
            }}
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
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-accent/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <StatusBadge status={d.status} />
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {d.commit_message ?? "Deployment"}
                      {d.version && (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                          {d.version}
                        </span>
                      )}
                      {d.rollback_of && (
                        <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[10px] text-warning">
                          rollback
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{d.commit_sha}</span>
                      <span>·</span>
                      <span>{d.branch}</span>
                      <span>·</span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase">
                        {d.environment}
                      </span>
                      <span>·</span>
                      <span className="uppercase text-[10px]">{d.trigger_type}</span>
                      <span>·</span>
                      <span>phase: {d.phase ?? "ready"}</span>
                      <span>·</span>
                      <span>{format(new Date(d.created_at), "MMM d, HH:mm:ss")}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setDiffBaseId(d.id);
                      setShowDiff(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/60 hover:text-primary transition-colors"
                  >
                    <FileCode className="h-3 w-3" /> Diff
                  </button>

                  {d.status === "success" && idx !== 0 && (
                    <button
                      onClick={() => doRollback(d)}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:border-primary/60 hover:text-primary transition-colors"
                    >
                      <RotateCcw className="h-3 w-3" /> Rollback here
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showDiff && (
        <DeploymentDiffModal
          deployments={deployments}
          initialBaseId={diffBaseId}
          onClose={() => setShowDiff(false)}
        />
      )}
    </div>
  );
}

function LiveLogs({ projectName }: { projectName: string }) {
  const engine = useEngine();
  const [selected, setSelected] = useState<string | null>(null);

  const { data: deployments = [] } = useQuery({
    queryKey: ["local-deployments", projectName, engine.url, engine.token],
    queryFn: async () => {
      try {
        const data = await engine.call<any[]>("GET", `/api/projects/${projectName}/deployments`);
        return data ?? [];
      } catch {
        return [];
      }
    },
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const active = selected ?? deployments[0]?.id ?? null;

  const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => {
    if (!projectName) return;
    setLogs([]);

    if (active) {
      engine
        .call<{ lines: any[] }>("GET", `/api/projects/${projectName}/deployments/${active}/logs`)
        .then((res) => {
          if (res?.lines && res.lines.length > 0) {
            setLogs(res.lines.slice(-500));
          }
        })
        .catch(() => {});
    }

    const abortController = new AbortController();
    fetch(`${engine.url}/api/projects/${projectName}/logs/stream`, {
      headers: engine.token ? { Authorization: `Bearer ${engine.token}` } : {},
      signal: abortController.signal,
    })
      .then((res) => {
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const readChunk = () => {
          if (abortController.signal.aborted) return;
          reader
            .read()
            .then(({ done, value }) => {
              if (done || abortController.signal.aborted) return;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";
              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  try {
                    const payload = JSON.parse(line.slice(6));
                    if (payload?.text) {
                      setLogs((prev) => {
                        if (
                          prev.some(
                            (p) =>
                              p.text === payload.text &&
                              Math.abs((p.ts || 0) - (payload.ts || 0)) < 1500,
                          )
                        ) {
                          return prev;
                        }
                        const next = [...prev, payload];
                        return next.length > 500 ? next.slice(-500) : next;
                      });
                    }
                  } catch {}
                }
              }
              readChunk();
            })
            .catch(() => {});
        };
        readChunk();
      })
      .catch(() => {});
    return () => abortController.abort();
  }, [active, engine, engine.url, engine.token, projectName]);

  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
          Recent Builds
        </div>
        <div className="max-h-[500px] overflow-y-auto">
          {deployments.length === 0 && (
            <div className="p-4 text-xs text-muted-foreground">No builds yet</div>
          )}
          {deployments.map((d: any) => (
            <button
              key={d.id}
              onClick={() => setSelected(d.id)}
              className={`flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-xs hover:bg-accent ${active === d.id ? "bg-accent" : ""}`}
            >
              <StatusBadge
                status={
                  d.phase === "ready" ? "success" : d.phase === "failed" ? "error" : "building"
                }
              />
              <div className="ml-auto flex flex-col items-end">
                <span className="font-mono text-muted-foreground">{d.version}</span>
                <span className="text-[10px] text-muted-foreground/50">
                  {formatDistanceToNow(new Date(d.started_at))} ago
                </span>
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
          {!active && (
            <div className="text-muted-foreground">
              Trigger a deployment to see logs stream in real time.
            </div>
          )}
          {logs.map((l, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-muted-foreground/60">
                {format(new Date(l.ts || Date.now()), "HH:mm:ss")}
              </span>
              <span
                className={
                  l.stream === "stderr"
                    ? "text-destructive"
                    : l.stream === "system"
                      ? "text-primary/70"
                      : "text-foreground/85"
                }
              >
                {l.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type EnvRow = { key: string; value: string; isSecret: boolean };
type EnvDrift = {
  available: boolean;
  environment: string;
  reason?: string;
  deployedAt?: number;
  added?: string[];
  removed?: string[];
};

function EnvVars({
  projectId,
  projectName,
  environment,
}: {
  projectId: string;
  projectName: string;
  environment: string;
}) {
  const engine = useEngine();
  const qc = useQueryClient();
  const {
    data: vars = [],
    error: envError,
    refetch: refetchEnv,
  } = useQuery({
    queryKey: ["envs", projectName, environment, engine.url, engine.token],
    queryFn: ({ signal }) =>
      engine.call<EnvRow[]>(
        "GET",
        `/api/projects/${projectName}/env?environment=${encodeURIComponent(environment)}`,
        undefined,
        { signal },
      ),
    refetchInterval: 10000,
  });
  const {
    data: drift,
    error: driftError,
    refetch: refetchDrift,
  } = useQuery({
    queryKey: ["env-drift", projectName, environment, engine.url, engine.token],
    queryFn: ({ signal }) =>
      engine.call<EnvDrift>(
        "GET",
        `/api/projects/${projectName}/env-drift?environment=${encodeURIComponent(environment)}`,
        undefined,
        { signal },
      ),
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [secret, setSecret] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [savingBulk, setSavingBulk] = useState(false);

  const parsedBulk = useMemo(() => parseDotEnvText(bulkText), [bulkText]);

  function openDeveloperView() {
    setBulkText(formatDotEnvText(vars, { includeSecretPlaceholders: true }));
    setDevMode(true);
  }

  function downloadDotEnv() {
    const content = devMode
      ? bulkText
      : formatDotEnvText(vars, { includeSecretPlaceholders: true });
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${projectName}.${environment}.env`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${projectName}.${environment}.env`);
  }

  async function save(body: { upserts?: unknown[]; deletes?: string[] }, okMsg: string) {
    try {
      await engine.call("PATCH", `/api/projects/${projectName}/env`, { ...body, environment });
      toast.success(okMsg);
      qc.invalidateQueries({ queryKey: ["envs"] });
      qc.invalidateQueries({ queryKey: ["env-drift", projectName, environment] });
    } catch (e: any) {
      toast.error(e.message || "Failed to update variables");
    }
  }

  async function add() {
    const cleanKey = key.trim();
    if (!cleanKey) return;
    await save(
      { upserts: [{ key: cleanKey, value, isSecret: secret }] },
      `${cleanKey} saved — redeploy or restart for it to take effect`,
    );
    setKey("");
    setValue("");
  }

  async function saveBulkDotEnv() {
    if (parsedBulk.entries.length === 0) {
      toast.error("No valid KEY=VALUE pairs found to save");
      return;
    }
    setSavingBulk(true);
    try {
      const existingByKey = new Map(vars.map((v) => [v.key, v]));
      const upserts = parsedBulk.entries.map((entry) => ({
        key: entry.key,
        value: entry.value,
        isSecret: Boolean(existingByKey.get(entry.key)?.isSecret || entry.inferredSecret),
      }));
      await save(
        { upserts },
        `Saved ${upserts.length} variable(s) to ${environment} — redeploy for changes to take effect`,
      );
      setDevMode(false);
    } finally {
      setSavingBulk(false);
    }
  }

  return (
    <div className="space-y-4">
      {envError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          Environment variables could not be loaded: {envError.message}
          <button type="button" onClick={() => void refetchEnv()} className="underline">
            Retry
          </button>
        </div>
      )}
      {driftError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          Environment drift could not be checked: {driftError.message}
          <button type="button" onClick={() => void refetchDrift()} className="underline">
            Retry
          </button>
        </div>
      ) : drift?.available ? (
        drift.added?.length || drift.removed?.length ? (
          <div
            role="status"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200"
          >
            Environment keys changed since the last successful deployment.
            {drift.added?.length ? ` Added: ${drift.added.join(", ")}.` : ""}
            {drift.removed?.length ? ` Removed: ${drift.removed.join(", ")}.` : ""} Values are not
            stored for drift tracking.
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-300">
            Environment variable keys match the last successful deployment. Value changes are not
            checked.
          </div>
        )
      ) : drift?.reason ? (
        <div className="rounded-lg border border-border bg-surface/50 px-4 py-3 text-xs text-muted-foreground">
          {drift.reason}
        </div>
      ) : null}

      {/* Mode Switcher Bar: Normal View vs Developer .env View */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center rounded-lg border border-border bg-surface p-1">
          <button
            type="button"
            onClick={() => setDevMode(false)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              !devMode
                ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            List View ({vars.length})
          </button>
          <button
            type="button"
            onClick={openDeveloperView}
            className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
              devMode
                ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>Developer .env View</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const txt = devMode
                ? bulkText
                : formatDotEnvText(vars, { includeSecretPlaceholders: true });
              navigator.clipboard.writeText(txt);
              toast.success("Copied .env to clipboard");
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
          >
            <Copy className="h-3.5 w-3.5" />
            <span>Copy .env</span>
          </button>
          <button
            type="button"
            onClick={downloadDotEnv}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download .env</span>
          </button>
        </div>
      </div>

      {devMode ? (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">Bulk .env Editor ({environment})</div>
              <p className="text-xs text-muted-foreground">
                Paste standard <span className="font-mono">KEY=VALUE</span> lines. Commented secrets
                are preserved unless overwritten with a new line.
              </p>
            </div>
            <span className="text-xs font-mono text-muted-foreground">
              {parsedBulk.entries.length} valid key(s) detected
            </span>
          </div>

          <textarea
            aria-label="Bulk .env editor"
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={12}
            spellCheck={false}
            placeholder={"DATABASE_URL=postgres://...\nAPI_KEY=your_secret_key\nPORT=3000"}
            className="w-full rounded-md border border-input bg-[#0d1117] p-3 font-mono text-xs text-foreground outline-none focus:border-primary leading-relaxed"
          />

          {parsedBulk.errors.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              {parsedBulk.errors.slice(0, 3).join(" ")}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setDevMode(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveBulkDotEnv()}
              disabled={savingBulk || parsedBulk.entries.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              <span>
                {savingBulk ? "Saving..." : `Save Bulk .env (${parsedBulk.entries.length})`}
              </span>
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 text-sm font-medium">Add variable</div>
            <div className="flex flex-wrap gap-2">
              <input
                value={key}
                onChange={(e) => setKey(e.target.value.replace(/[^A-Za-z0-9_.-]/g, ""))}
                placeholder="KEY"
                className="flex-1 min-w-[160px] rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm outline-none focus:border-primary"
              />
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="value"
                className="flex-[2] min-w-[200px] rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm outline-none focus:border-primary"
              />
              <label className="flex items-center gap-2 rounded-md border border-border px-3 text-xs">
                <input
                  type="checkbox"
                  checked={secret}
                  onChange={(e) => setSecret(e.target.checked)}
                />{" "}
                Secret
              </label>
              <button
                onClick={add}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
              >
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Secret values are hidden after saving and can only be overwritten, not read back.
              </span>
              <Link to="/vault" className="text-primary hover:underline font-medium">
                Sync shared secret groups from Secrets Vault →
              </Link>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card">
            {vars.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No variables. Add API keys, connection strings, or switch to Developer .env View to
                paste a file.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {vars.map((v) => (
                  <div key={v.key} className="flex items-center gap-3 p-3 font-mono text-sm">
                    <span className="w-56 truncate text-primary font-semibold">{v.key}</span>
                    <span className="flex-1 truncate text-muted-foreground">
                      {v.isSecret ? "•••••••• (secret)" : v.value}
                    </span>
                    {!v.isSecret && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(v.value);
                          toast.success("Copied");
                        }}
                        aria-label={`Copy ${v.key}`}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => save({ deletes: [v.key] }, `${v.key} removed`)}
                      aria-label={`Delete ${v.key}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ProjectDomains({
  projectName,
  project,
}: {
  projectId: string;
  projectName: string;
  project?: any;
}) {
  const engine = useEngine();
  const qc = useQueryClient();
  const { data: netInfo } = useNetworkInterfaces();
  const [domainInput, setDomainInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const { data: domains = [] } = useQuery({
    queryKey: ["project-domains", projectName, engine.url],
    queryFn: async () => {
      try {
        const all = await engine.call<any[]>("GET", "/api/domains");
        return (all ?? []).filter(
          (d: any) => (d.project || "").toLowerCase() === projectName.toLowerCase(),
        );
      } catch {
        return [];
      }
    },
    refetchInterval: 3000,
  });

  function refreshDomains() {
    qc.invalidateQueries({ queryKey: ["project-domains"] });
    qc.invalidateQueries({ queryKey: ["all-domains"] });
  }

  async function addDomain() {
    const clean = domainInput.trim().toLowerCase();
    if (!clean) return;
    setAdding(true);
    try {
      await engine.call(
        "POST",
        `/api/projects/${encodeURIComponent(projectName)}/domains`,
        { hostname: clean },
        { suppressStatuses: [400, 404, 409, 500] },
      );
      toast.success(`Domain ${clean} registered and synced to Edge Gateway`);
      setDomainInput("");
      refreshDomains();
    } catch (e: any) {
      toast.error(e.message || "Failed to add domain");
    } finally {
      setAdding(false);
    }
  }

  async function verifyDomain(domain: any) {
    setBusyAction(`verify:${domain.id}`);
    try {
      const res = await engine.call<any>(
        "POST",
        `/api/domains/${encodeURIComponent(domain.id)}/verify`,
        undefined,
        { suppressStatuses: [400, 404, 500] },
      );
      if (res?.verified) {
        toast.success(res.message || `${domain.hostname} verified via DNS`);
      } else {
        toast.warning(res?.message || `DNS TXT record not yet visible for ${domain.hostname}`);
      }
      refreshDomains();
    } catch (e: any) {
      toast.error(e.message || "DNS verification failed");
    } finally {
      setBusyAction(null);
    }
  }

  async function provisionSsl(domain: any) {
    if (!domain.verified) {
      toast.error("Verify domain ownership before provisioning SSL");
      return;
    }
    setBusyAction(`ssl:${domain.id}`);
    try {
      await engine.call("POST", `/api/domains/${encodeURIComponent(domain.id)}/ssl`, undefined, {
        suppressStatuses: [400, 404, 500],
      });
      toast.success(`TLS certificate active for ${domain.hostname}`);
      refreshDomains();
    } catch (e: any) {
      toast.error(e.message || "SSL provisioning failed");
    } finally {
      setBusyAction(null);
    }
  }

  async function setPrimaryDomain(domain: any) {
    setBusyAction(`primary:${domain.id}`);
    try {
      await engine.call(
        "POST",
        `/api/domains/${encodeURIComponent(domain.id)}/primary`,
        undefined,
        { suppressStatuses: [400, 404, 500] },
      );
      toast.success(`${domain.hostname} set as primary domain`);
      refreshDomains();
    } catch (e: any) {
      toast.error(e.message || "Failed to set primary domain");
    } finally {
      setBusyAction(null);
    }
  }

  async function toggleForceHttps(domain: any, currentForceHttps: boolean, hstsEnabled: boolean) {
    setBusyAction(`https:${domain.id}`);
    try {
      await engine.call(
        "POST",
        `/api/domains/${encodeURIComponent(domain.id)}/security`,
        {
          force_https: !currentForceHttps,
          hsts_enabled: hstsEnabled,
        },
        { suppressStatuses: [400, 404, 500] },
      );
      toast.success(
        !currentForceHttps
          ? `Force HTTPS enabled for ${domain.hostname}`
          : `Force HTTPS disabled for ${domain.hostname}`,
      );
      refreshDomains();
    } catch (e: any) {
      toast.error(e.message || "Failed to update HTTPS policy");
    } finally {
      setBusyAction(null);
    }
  }

  async function removeDomain(domain: any) {
    const ok = await confirmAction({
      title: "Remove Custom Domain",
      description: `Remove ${domain.hostname} from the project routing configuration?`,
      confirmLabel: "Remove Domain",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await engine.call("DELETE", `/api/domains/${encodeURIComponent(domain.id)}`);
      toast.success(`Removed ${domain.hostname}`);
      refreshDomains();
    } catch (e: any) {
      toast.error(e.message || "Failed to delete domain");
    }
  }

  return (
    <div className="space-y-6">
      {/* Magic Wildcard DNS Provider Selector */}
      <MagicDnsSelector projectName={projectName} projectPort={project?.port || 3000} />

      {/* Local Network (LAN / Wi-Fi) Access */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-sm flex items-center gap-2">
              <Wifi className="h-4 w-4 text-emerald-400" />
              <span>Local Network (Wi-Fi / LAN) Access</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Access and test this project on smartphones, tablets, or other computers connected to
              the same local Wi-Fi.
            </p>
          </div>
        </div>

        {netInfo?.interfaces && netInfo.interfaces.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {netInfo.interfaces.map((iface) => {
              const url = `http://${iface.address}:${project?.port || 8080}`;
              return (
                <div
                  key={iface.address}
                  className="flex items-center justify-between p-3 rounded-lg border border-border/80 bg-background/50 text-xs font-mono"
                >
                  <div className="space-y-0.5 truncate mr-2">
                    <div className="text-[10px] text-muted-foreground uppercase font-sans font-semibold">
                      {iface.name}
                    </div>
                    <div className="text-emerald-400 font-medium truncate">{url}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(url);
                        toast.success("LAN URL copied to clipboard");
                      }}
                      aria-label={`Copy LAN URL ${url}`}
                      className="p-1.5 hover:bg-surface-2 rounded text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy LAN URL"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open LAN URL ${url}`}
                      className="p-1.5 hover:bg-surface-2 rounded text-muted-foreground hover:text-foreground transition-colors"
                      title="Open in new tab"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground py-2">
            No external Wi-Fi / LAN network interfaces detected. Loopback is active.
          </div>
        )}
      </div>

      {/* Custom Domains */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-semibold text-sm">Custom Domains</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connect production or preview custom domains, verify DNS ownership, and provision TLS
              certificates.
            </p>
          </div>
          <Link to="/domains" className="text-xs text-primary hover:underline">
            Global SSL &amp; Edge Middlewares →
          </Link>
        </div>
        <div className="flex gap-2">
          <input
            aria-label="Custom domain hostname"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addDomain();
              }
            }}
            placeholder="app.example.com or custom.127-0-0-1.sslip.io"
            className="flex-1 rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={() => void addDomain()}
            disabled={adding}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> {adding ? "Adding..." : "Add Domain"}
          </button>
        </div>

        <div className="divide-y divide-border pt-2">
          {domains.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No custom domains added yet. Your default wildcard DNS endpoint is active.
            </div>
          ) : (
            domains.map((d: any) => {
              const summary = summarizeDomainStatus(d);
              return (
                <div key={d.id || d.hostname} className="py-3.5 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 font-mono">
                      <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="font-medium text-foreground">{d.hostname}</span>
                      {summary.isPrimary && (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-sans font-semibold text-primary">
                          Primary
                        </span>
                      )}
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-sans font-medium ${
                          summary.verified
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-amber-500/15 text-amber-300"
                        }`}
                      >
                        {summary.verified ? "DNS Verified" : "Pending DNS"}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-sans font-medium ${
                          summary.sslStatus === "active"
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        SSL: {summary.sslStatus}
                      </span>
                      {summary.forceHttps && (
                        <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-sans text-sky-400">
                          HTTPS Enforced
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void verifyDomain(d)}
                        disabled={busyAction === `verify:${d.id}`}
                        className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2.5 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${busyAction === `verify:${d.id}` ? "animate-spin" : ""}`}
                        />
                        Verify DNS
                      </button>
                      {summary.canProvisionSsl && (
                        <button
                          type="button"
                          onClick={() => void provisionSsl(d)}
                          disabled={busyAction === `ssl:${d.id}`}
                          className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                        >
                          <ShieldCheck className="h-3 w-3" />
                          {busyAction === `ssl:${d.id}` ? "Provisioning..." : "Provision SSL"}
                        </button>
                      )}
                      {!summary.isPrimary && (
                        <button
                          type="button"
                          onClick={() => void setPrimaryDomain(d)}
                          disabled={busyAction === `primary:${d.id}`}
                          className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2.5 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
                        >
                          <Star className="h-3 w-3" />
                          Set Primary
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          void toggleForceHttps(d, summary.forceHttps, summary.hstsEnabled)
                        }
                        disabled={busyAction === `https:${d.id}`}
                        className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2.5 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
                        title="Toggle automatic HTTP -> HTTPS redirect"
                      >
                        <Lock className="h-3 w-3" />
                        {summary.forceHttps ? "HTTPS On" : "HTTPS Off"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeDomain(d)}
                        aria-label={`Remove ${d.hostname}`}
                        className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {!summary.verified && d.challenge_token && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-background/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      <span className="truncate">
                        TXT <strong className="text-foreground">_hosterax-challenge</strong> ={" "}
                        <span className="text-primary">{d.challenge_token}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(d.challenge_token);
                          toast.success("DNS challenge token copied");
                        }}
                        className="inline-flex items-center gap-1 text-foreground hover:text-primary font-sans"
                      >
                        <Copy className="h-3 w-3" /> Copy Token
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

interface ProvisionedCredentialNote {
  id: string;
  name: string;
  engine: ManagedDbEngine;
  port?: number;
  connectionString: string;
  internalConnectionString: string;
  injectedKeys: string[];
}

function DatabasesTab({
  projectName,
  project,
  environment,
}: {
  projectId: string;
  projectName: string;
  project?: any;
  environment: "production" | "preview" | "development";
}) {
  const engine = useEngine();
  const qc = useQueryClient();

  const [provisionOpen, setProvisionOpen] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState<ManagedDbEngine>("postgres");
  const [dbNameInput, setDbNameInput] = useState(() =>
    sanitizeDatabaseName(projectName, "postgres"),
  );
  const [nameEditedManually, setNameEditedManually] = useState(false);
  const [storageMb, setStorageMb] = useState<number>(1024);
  const [autoWireEnv, setAutoWireEnv] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [backingUpId, setBackingUpId] = useState<string | null>(null);
  const [sessionCreds, setSessionCreds] = useState<Record<string, ProvisionedCredentialNote>>({});
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});

  const databasesQuery = useQuery({
    queryKey: ["dbs", projectName, engine.url, engine.token],
    queryFn: ({ signal }) =>
      engine.call<any[]>(
        "GET",
        `/api/projects/${encodeURIComponent(projectName)}/databases`,
        undefined,
        { signal },
      ),
    refetchInterval: 10000,
    staleTime: 5000,
  });
  const dbs = databasesQuery.data || [];

  const normalizedDbName = useMemo(
    () => normalizeManualDbName(dbNameInput, selectedEngine),
    [dbNameInput, selectedEngine],
  );

  function openProvisionModal(engineType: ManagedDbEngine) {
    setSelectedEngine(engineType);
    setDbNameInput(sanitizeDatabaseName(projectName, engineType));
    setNameEditedManually(false);
    setStorageMb(1024);
    setAutoWireEnv(true);
    setProvisionOpen(true);
  }

  function handleEngineChange(nextEngine: ManagedDbEngine) {
    setSelectedEngine(nextEngine);
    if (!nameEditedManually) {
      setDbNameInput(sanitizeDatabaseName(projectName, nextEngine));
    }
  }

  useEffect(() => {
    if (!provisionOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !provisioning) setProvisionOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [provisionOpen, provisioning]);

  async function submitProvision(e: React.FormEvent) {
    e.preventDefault();
    const targetName = normalizeManualDbName(dbNameInput, selectedEngine);
    setProvisioning(true);
    try {
      const created = await engine.call<{
        ok: boolean;
        id: string;
        name: string;
        engine: string;
        port?: number;
        connection_string?: string;
        internal_connection_string?: string;
      }>(
        "POST",
        `/api/projects/${encodeURIComponent(projectName)}/databases`,
        {
          name: targetName,
          engine: selectedEngine,
          size_mb: storageMb,
        },
        { suppressStatuses: [400, 404, 409, 500, 503] },
      );

      let injectedKeys: string[] = [];
      const internalUri = created.internal_connection_string || created.connection_string || "";
      if (autoWireEnv && internalUri) {
        try {
          const existingEnv = await engine
            .call<Array<{ key: string }>>(
              "GET",
              `/api/projects/${encodeURIComponent(projectName)}/env?environment=${encodeURIComponent(environment)}`,
            )
            .catch(() => []);
          const resolved = resolveDbEnvUpserts({
            engine: selectedEngine,
            internalConnectionString: internalUri,
            existingKeys: (existingEnv || []).map((item) => item.key),
            projectImage: project?.repo_url || "",
          });
          if (resolved.upserts.length > 0) {
            await engine.call("PATCH", `/api/projects/${encodeURIComponent(projectName)}/env`, {
              upserts: resolved.upserts,
              environment,
            });
            injectedKeys = resolved.keys;
            qc.invalidateQueries({ queryKey: ["envs"] });
            qc.invalidateQueries({ queryKey: ["env-drift", projectName, environment] });
          }
        } catch (wireErr: any) {
          toast.warning(
            `Database created, but automatic env injection failed: ${wireErr?.message || "unknown error"}`,
          );
        }
      }

      if (created.id && (created.connection_string || created.internal_connection_string)) {
        setSessionCreds((prev) => ({
          ...prev,
          [created.id]: {
            id: created.id,
            name: created.name || targetName,
            engine: selectedEngine,
            port: created.port,
            connectionString: created.connection_string || internalUri,
            internalConnectionString: created.internal_connection_string || internalUri,
            injectedKeys,
          },
        }));
      }

      qc.invalidateQueries({ queryKey: ["dbs", projectName] });
      qc.invalidateQueries({ queryKey: ["databases"] });
      toast.success(
        injectedKeys.length > 0
          ? `${created.name || targetName} provisioned and wired to ${injectedKeys.join(", ")} (${environment})`
          : `${created.name || targetName} provisioned`,
      );
      setProvisionOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "Failed to provision database");
    } finally {
      setProvisioning(false);
    }
  }

  async function triggerBackup(dbRow: any) {
    setBackingUpId(dbRow.id);
    try {
      const res = await engine.call<{ sizeMb?: number }>(
        "POST",
        `/api/databases/${encodeURIComponent(dbRow.id)}/backup`,
        undefined,
        { suppressStatuses: [400, 404, 500, 503] },
      );
      toast.success(
        `Snapshot created for ${dbRow.name}${res?.sizeMb !== undefined ? ` (${res.sizeMb} MB)` : ""}`,
      );
      qc.invalidateQueries({ queryKey: ["backups"] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to create database snapshot");
    } finally {
      setBackingUpId(null);
    }
  }

  async function del(dbRow: any) {
    const ok = await confirmAction({
      title: "Delete Database Instance",
      description: `Permanently delete "${dbRow.name}" (${dbRow.engine}) and its persistent volume?`,
      confirmLabel: "Delete Database",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await engine.call("DELETE", `/api/databases/${encodeURIComponent(dbRow.id)}`);
      setSessionCreds((prev) => {
        const next = { ...prev };
        delete next[dbRow.id];
        return next;
      });
      qc.invalidateQueries({ queryKey: ["dbs", projectName] });
      qc.invalidateQueries({ queryKey: ["databases"] });
      toast.success(`Database ${dbRow.name} removed`);
    } catch (e: any) {
      toast.error(e.message || "Failed to delete database");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {DB_ENGINE_SPECS.map((spec) => (
            <button
              key={spec.id}
              type="button"
              onClick={() => openProvisionModal(spec.id)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm hover:border-primary/50 font-medium transition-colors"
            >
              <Plus className="h-4 w-4 text-primary" /> {spec.label}
            </button>
          ))}
        </div>
        <Link
          to="/databases"
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
        >
          <Table2 className="h-3.5 w-3.5" /> Open Database Studio
        </Link>
      </div>

      <div className="rounded-lg border border-border bg-card">
        {databasesQuery.isError && dbs.length > 0 && (
          <div role="status" className="border-b border-border px-4 py-2 text-xs text-amber-400">
            Could not refresh database instances. Showing the last loaded results.
          </div>
        )}
        {databasesQuery.isPending ? (
          <div className="p-8 text-center text-sm text-muted-foreground" role="status">
            Loading database instances…
          </div>
        ) : databasesQuery.isError && dbs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground" role="alert">
            Database instances could not be loaded. Retry to check the current state.
            <div>
              <button
                type="button"
                onClick={() => databasesQuery.refetch()}
                className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Retry
              </button>
            </div>
          </div>
        ) : dbs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No companion databases attached yet. Provision PostgreSQL, Redis, MySQL, MariaDB,
            MongoDB, ClickHouse, or LibSQL above and auto-wire credentials into{" "}
            <span className="font-mono">{environment}</span>.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {dbs.map((d: any) => {
              const cred = sessionCreds[d.id];
              const revealed = Boolean(revealedIds[d.id]);
              const internalHost = buildInternalHostHint(d.engine, d.port);
              const spec = DB_ENGINE_SPECS.find((s) => s.id === String(d.engine).toLowerCase());

              return (
                <div key={d.id} className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 font-mono text-xs font-semibold uppercase text-primary">
                      {spec?.shortTag || String(d.engine).slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium font-mono">{d.name}</span>
                        <StatusBadge status={d.status} />
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{spec?.label || d.engine}</span>
                        <span>·</span>
                        <span>{formatDbStorageLabel(d.size_mb)}</span>
                        <span>·</span>
                        <span className="font-mono text-[11px]">{internalHost}</span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(internalHost);
                            toast.success(`Copied ${internalHost}`);
                          }}
                          aria-label={`Copy internal host for ${d.name}`}
                          className="text-muted-foreground hover:text-foreground"
                          title="Copy container host:port"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void triggerBackup(d)}
                        disabled={backingUpId === d.id}
                        aria-label={`Backup ${d.name}`}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
                      >
                        <HardDrive className="h-3.5 w-3.5 text-primary" />
                        {backingUpId === d.id ? "Snapshotting..." : "Snapshot"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void del(d)}
                        aria-label={`Delete database ${d.name}`}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {cred && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium text-emerald-300 flex items-center gap-1.5">
                          <Check className="h-3.5 w-3.5" />
                          <span>
                            Connection credentials (shown once this session)
                            {cred.injectedKeys.length > 0
                              ? ` · Wired to ${cred.injectedKeys.join(", ")}`
                              : ""}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setRevealedIds((prev) => ({ ...prev, [d.id]: !prev[d.id] }))
                          }
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          {revealed ? (
                            <>
                              <EyeOff className="h-3 w-3" /> Hide URI
                            </>
                          ) : (
                            <>
                              <Eye className="h-3 w-3" /> Reveal URI
                            </>
                          )}
                        </button>
                      </div>

                      <div className="grid gap-2 md:grid-cols-2">
                        <div className="flex items-center justify-between gap-2 rounded border border-border/70 bg-background/60 px-2.5 py-1.5 font-mono text-[11px]">
                          <span className="truncate">
                            <span className="text-muted-foreground mr-1.5">Internal:</span>
                            {revealed ? cred.internalConnectionString : "••••••••••••••••••••••••"}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(cred.internalConnectionString);
                              toast.success("Internal container URI copied");
                            }}
                            aria-label={`Copy internal URI for ${d.name}`}
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-2 rounded border border-border/70 bg-background/60 px-2.5 py-1.5 font-mono text-[11px]">
                          <span className="truncate">
                            <span className="text-muted-foreground mr-1.5">Host:</span>
                            {revealed ? cred.connectionString : "••••••••••••••••••••••••"}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(cred.connectionString);
                              toast.success("Host connection URI copied");
                            }}
                            aria-label={`Copy host URI for ${d.name}`}
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {provisionOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && !provisioning) setProvisionOpen(false);
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="provision-db-title"
            onSubmit={submitProvision}
            className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl space-y-5"
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-primary" />
                <h3 id="provision-db-title" className="text-sm font-semibold">
                  Provision Companion Database
                </h3>
              </div>
              <button
                type="button"
                aria-label="Close database provisioning modal"
                disabled={provisioning}
                onClick={() => setProvisionOpen(false)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Engine</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {DB_ENGINE_SPECS.map((spec) => (
                    <button
                      key={spec.id}
                      type="button"
                      onClick={() => handleEngineChange(spec.id)}
                      className={`rounded-md border px-2.5 py-2 text-xs font-medium transition-colors ${
                        selectedEngine === spec.id
                          ? "border-primary bg-primary/15 text-foreground"
                          : "border-border bg-surface/60 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {spec.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label
                  htmlFor="provision-db-name"
                  className="mb-1.5 block text-xs font-medium text-muted-foreground"
                >
                  Instance Name
                </label>
                <input
                  id="provision-db-name"
                  value={dbNameInput}
                  onChange={(e) => {
                    setDbNameInput(e.target.value);
                    setNameEditedManually(true);
                  }}
                  placeholder="app_postgres"
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm outline-none focus:border-primary"
                />
                <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    Normalized ID:{" "}
                    <span className="font-mono text-primary">{normalizedDbName}</span>
                  </span>
                  <span>a-z, 0-9, _ (max 41 chars)</span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="provision-db-size"
                  className="mb-1.5 block text-xs font-medium text-muted-foreground"
                >
                  Volume Allocation
                </label>
                <select
                  id="provision-db-size"
                  value={storageMb}
                  onChange={(e) => setStorageMb(Number(e.target.value))}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
                >
                  {DB_STORAGE_OPTIONS_MB.map((mb) => (
                    <option key={mb} value={mb}>
                      {formatDbStorageLabel(mb)} persistent Docker volume
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-start gap-2.5 rounded-lg border border-border bg-surface/40 p-3 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoWireEnv}
                  onChange={(e) => setAutoWireEnv(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border"
                />
                <span>
                  <span className="block font-medium text-foreground">
                    Auto-inject connection URI into {environment} environment
                  </span>
                  <span className="block text-muted-foreground mt-0.5">
                    Saves{" "}
                    <span className="font-mono">
                      {DB_ENGINE_SPECS.find((s) => s.id === selectedEngine)?.primaryEnvKey}
                    </span>{" "}
                    (using <span className="font-mono">host.docker.internal</span>) as an encrypted
                    secret variable.
                  </span>
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                disabled={provisioning}
                onClick={() => setProvisionOpen(false)}
                className="rounded-md border border-border px-3.5 py-2 text-xs font-medium hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={provisioning}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Database className="h-3.5 w-3.5" />
                {provisioning ? "Provisioning Container..." : "Provision Database"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Settings({ project, onDelete }: { project: any; onDelete: () => void }) {
  const engine = useEngine();
  const qc = useQueryClient();
  const { data: scaleZero, refetch: refetchScaleZero } = useScaleToZero(project.name);
  const { data: serverNodes = [] } = useServerNodes();
  const [name, setName] = useState(project.name);
  const [branch, setBranch] = useState(project.branch || "main");
  const [builder, setBuilder] = useState<BuildPackId>((project.builder || "auto") as BuildPackId);
  const [buildCmd, setBuildCmd] = useState(project.build_command ?? "");
  const [startCmd, setStartCmd] = useState(project.start_command ?? "");
  const [port, setPort] = useState(project.port ?? 3000);
  const [healthPath, setHealthPath] = useState(project.health_path || "/");
  const [scaleZeroEnabled, setScaleZeroEnabled] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState(15);
  const [replicas, setReplicas] = useState<number>(clampReplicas(project.replicas ?? 1));
  const [placementNodes, setPlacementNodes] = useState<string[]>(
    normalizePlacementNodes(project.placement_nodes || []),
  );
  const [busy, setBusy] = useState(false);
  const [scalingBusy, setScalingBusy] = useState(false);

  useEffect(() => {
    if (scaleZero) {
      setScaleZeroEnabled(scaleZero.enabled);
      setIdleMinutes(scaleZero.idleTimeoutMinutes || 15);
    }
  }, [scaleZero]);

  useEffect(() => {
    setReplicas(clampReplicas(project.replicas ?? 1));
    setPlacementNodes(normalizePlacementNodes(project.placement_nodes || []));
    setBuilder((project.builder || "auto") as BuildPackId);
  }, [project.replicas, project.placement_nodes, project.builder]);

  function togglePlacementNode(nodeId: string) {
    setPlacementNodes((prev) =>
      prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId],
    );
  }

  async function applyScaling() {
    setScalingBusy(true);
    try {
      const targetReplicas = clampReplicas(replicas);
      const res = await engine.call<{ replicas: number; ports?: number[]; message?: string }>(
        "POST",
        `/api/projects/${encodeURIComponent(project.name)}/scale`,
        {
          replicas: targetReplicas,
          placementNodes: normalizePlacementNodes(placementNodes),
        },
      );
      toast.success(
        res?.message || `Scaled ${project.name} to ${res?.replicas ?? targetReplicas} replica(s)`,
      );
      await qc.invalidateQueries({ queryKey: ["project", project.slug] });
      await qc.invalidateQueries({ queryKey: ["engine-projects"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to apply horizontal scaling");
    } finally {
      setScalingBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await engine.call("PATCH", `/api/projects/${project.name}`, {
        name,
        branch,
        builder,
        build_command: buildCmd,
        start_command: startCmd,
        port: Number(port),
        health_path: healthPath,
      });

      await engine.call("POST", `/api/projects/${project.name}/scale-to-zero`, {
        enabled: scaleZeroEnabled,
        idleTimeoutMinutes: Number(idleMinutes),
      });

      refetchScaleZero();
      await qc.invalidateQueries({ queryKey: ["project", project.slug] });
      toast.success("Settings & Scale-to-Zero configuration saved");
    } catch (e: any) {
      toast.error(e.message || "Failed to update settings");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Horizontal Replicas & Cluster Node Placement */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              <span>Horizontal Replicas &amp; Node Placement</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Run multiple load-balanced container/process instances across your edge reverse proxy
              (Caddy &amp; OpenResty multi-upstream round-robin).
            </p>
          </div>
          <span className="rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-xs font-semibold text-primary">
            {replicas} {replicas === 1 ? "Replica" : "Replicas"}
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2 pt-2 border-t border-border/50">
          <Field label="Target Replica Count (1 – 10)">
            <div className="flex items-center gap-3">
              <input
                type="range"
                aria-label="Target replica count slider"
                min={1}
                max={10}
                value={replicas}
                onChange={(e) => setReplicas(clampReplicas(Number(e.target.value)))}
                className="flex-1 accent-primary"
              />
              <input
                type="number"
                aria-label="Target replica count"
                min={1}
                max={10}
                value={replicas}
                onChange={(e) => setReplicas(clampReplicas(Number(e.target.value)))}
                className="w-20 rounded-md border border-input bg-input/40 px-2.5 py-1.5 text-sm font-mono text-center outline-none focus:border-primary"
              />
            </div>
          </Field>

          <Field label="Preferred Placement Nodes">
            {serverNodes.length === 0 ? (
              <div className="rounded-md border border-border/60 bg-surface/40 px-3 py-2 text-xs text-muted-foreground">
                Local Engine Node (primary host)
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {serverNodes.map((node) => {
                  const active = placementNodes.includes(node.id);
                  return (
                    <button
                      key={node.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => togglePlacementNode(node.id)}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        active
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-surface/50 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Server className="h-3 w-3" />
                      <span>{node.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Field>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={applyScaling}
            disabled={scalingBusy}
            className="rounded-md border border-primary/40 bg-primary/15 px-4 py-2 text-xs font-semibold text-primary hover:bg-primary/25 disabled:opacity-50"
          >
            {scalingBusy ? "Scaling Replicas..." : "Apply Scaling"}
          </button>
        </div>
      </div>

      {/* Scale-to-Zero & Compute Optimization (Temps Benchmark) */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <Moon className="h-4 w-4 text-amber-400" />
              <span>Scale-to-Zero &amp; Compute Optimization</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automatically suspend idle preview/staging containers to reclaim 60–80% server RAM.
              Wakes in &lt;1.2s on HTTP request.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={scaleZeroEnabled}
              onChange={(e) => setScaleZeroEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-surface-2 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </div>

        {scaleZeroEnabled && (
          <div className="grid gap-4 md:grid-cols-2 pt-2 border-t border-border/50">
            <Field label="Inactivity Timeout Before Auto-Sleep">
              <select
                value={idleMinutes}
                onChange={(e) => setIdleMinutes(Number(e.target.value))}
                className={inputCls}
              >
                <option value={5}>5 minutes of inactivity</option>
                <option value={15}>15 minutes (Recommended)</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                <option value={120}>2 hours</option>
              </select>
            </Field>
            <div className="flex flex-col justify-center text-xs text-muted-foreground space-y-1">
              <div className="text-foreground font-medium flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-emerald-400" />
                <span>On-Demand HTTP Auto-Wake: Active</span>
              </div>
              <div>Incoming requests are held at edge proxy and container wakes in ~1.2s.</div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="text-sm font-medium">General</div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Project name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Branch">
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Build Pack">
            <select
              aria-label="Build Pack"
              value={builder}
              onChange={(e) => setBuilder(e.target.value as BuildPackId)}
              className={inputCls}
            >
              {BUILD_PACK_OPTIONS.map((bp) => (
                <option key={bp.id} value={bp.id}>
                  {bp.label} ({bp.badge})
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Build command">
          <input
            value={buildCmd}
            onChange={(e) => setBuildCmd(e.target.value)}
            placeholder="npm run build"
            className={inputCls + " font-mono"}
          />
        </Field>
        <Field label="Start command">
          <input
            value={startCmd}
            onChange={(e) => setStartCmd(e.target.value)}
            placeholder="npm start"
            className={inputCls + " font-mono"}
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Port">
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className={inputCls}
            />
          </Field>
          <Field label="Health check path">
            <input
              value={healthPath}
              onChange={(e) => setHealthPath(e.target.value)}
              placeholder="/"
              className={inputCls + " font-mono"}
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <button
            onClick={save}
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
      <ProjectGateCard projectName={project.name} />
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <div className="text-sm font-medium text-destructive">Danger zone</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Deletes the project, deployments, env variables, and virtual hosts.
        </p>
        <button
          onClick={onDelete}
          className="mt-3 inline-flex items-center gap-1 rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" /> Delete project
        </button>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function WebhooksTab({ projectName, project }: { projectName: string; project: any }) {
  const engine = useEngine();
  const { data: config, refetch: refetchConfig } = useProjectWebhookConfig(projectName);
  const { data: previews = [], refetch: refetchPreviews } = usePRPreviews(projectName);

  const [provider, setProvider] = useState<GitWebhookProvider>("github");
  const [trackedBranch, setTrackedBranch] = useState(
    config?.tracked_branch || project.branch || "main",
  );
  const [autoDeployPush, setAutoDeployPush] = useState(config?.auto_deploy_push !== 0);
  const [autoDeployPr, setAutoDeployPr] = useState(config?.auto_deploy_pr !== 0);
  const [saving, setSaving] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const providerSpec = getWebhookProviderSpec(provider);

  useEffect(() => {
    if (config) {
      setTrackedBranch(config.tracked_branch || "main");
      setAutoDeployPush(config.auto_deploy_push !== 0);
      setAutoDeployPr(config.auto_deploy_pr !== 0);
    }
  }, [config]);

  // Public, signature-verified endpoint for the selected Git provider
  const webhookUrl = buildPublicWebhookUrl(engine.url, provider, projectName);
  const webhookSecret = config?.secret || "Generating...";

  async function handleSaveConfig() {
    setSaving(true);
    try {
      await engine.call("POST", `/api/projects/${projectName}/webhook-config`, {
        tracked_branch: trackedBranch,
        auto_deploy_push: autoDeployPush ? 1 : 0,
        auto_deploy_pr: autoDeployPr ? 1 : 0,
      });
      toast.success("Git Webhook settings saved!");
      refetchConfig();
    } catch (e: any) {
      toast.error(e.message || "Failed to save webhook settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleDestroyPreview(prId: string, prNumber: number) {
    const ok = await confirmAction({
      title: `Tear Down PR #${prNumber}`,
      description: `Are you sure you want to tear down preview environment for PR #${prNumber}?`,
      confirmLabel: "Tear Down",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await engine.call("DELETE", `/api/previews/${prId}`);
      toast.success(`Ephemeral preview for PR #${prNumber} torn down.`);
      refetchPreviews();
    } catch (e: any) {
      toast.error(e.message || "Failed to tear down preview");
    }
  }

  function handleCopy(text: string, isSecret: boolean) {
    navigator.clipboard.writeText(text);
    if (isSecret) {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } else {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
    toast.success("Copied to clipboard!");
  }

  return (
    <div className="space-y-6">
      {/* Multi-Provider Git Webhook Configuration Card */}
      <div className="rounded-xl border bg-card/60 p-6 shadow-sm space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Webhook className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold">Git Webhooks &amp; Push-to-Deploy</h3>
              <p className="text-xs text-muted-foreground">
                Automatically trigger zero-downtime builds on push and spin up ephemeral PR/MR
                previews from GitHub, GitLab, Gitea/Forgejo, or Bitbucket.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
            <Radio className="w-3 h-3" /> Webhook Listener Active
          </span>
        </div>

        {/* Provider Switcher */}
        <div className="flex flex-wrap gap-2">
          {WEBHOOK_PROVIDER_SPECS.map((spec) => (
            <button
              key={spec.id}
              type="button"
              aria-pressed={provider === spec.id}
              onClick={() => setProvider(spec.id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                provider === spec.id
                  ? "border-primary bg-primary/15 text-primary font-semibold"
                  : "border-border bg-muted/20 text-muted-foreground hover:text-foreground"
              }`}
            >
              {spec.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {/* Payload URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Payload URL ({providerSpec.label} Webhook)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={webhookUrl}
                className="w-full font-mono text-xs rounded-md border border-input bg-muted/40 px-3 py-2 text-foreground"
              />
              <button
                type="button"
                aria-label="Copy Webhook URL"
                onClick={() => handleCopy(webhookUrl, false)}
                className="rounded-md border border-input bg-card p-2 hover:bg-muted"
                title="Copy Webhook URL"
              >
                {copiedUrl ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Webhook Secret */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Secret Token ({providerSpec.signatureHeader} · {providerSpec.signatureMethod})
            </label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                readOnly
                value={webhookSecret}
                className="w-full font-mono text-xs rounded-md border border-input bg-muted/40 px-3 py-2 text-foreground"
              />
              <button
                type="button"
                aria-label="Copy Webhook Secret"
                onClick={() => handleCopy(webhookSecret, true)}
                className="rounded-md border border-input bg-card p-2 hover:bg-muted"
                title="Copy Secret"
              >
                {copiedSecret ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
          <span>
            Events:{" "}
            <strong className="text-foreground">{providerSpec.defaultEvents.join(" · ")}</strong>
          </span>
          <span>
            Header: <code className="font-mono text-foreground">{providerSpec.eventHeader}</code>
          </span>
        </div>

        {/* Automation Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-border/40">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Tracked Production Branch
            </label>
            <input
              type="text"
              value={trackedBranch}
              onChange={(e) => setTrackedBranch(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono"
              placeholder="main"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/20">
            <div>
              <div className="text-xs font-medium">Auto-Deploy on Push</div>
              <div className="text-[11px] text-muted-foreground">
                Build on git push to {trackedBranch}
              </div>
            </div>
            <input
              type="checkbox"
              checked={autoDeployPush}
              onChange={(e) => setAutoDeployPush(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/20">
            <div>
              <div className="text-xs font-medium">Ephemeral PR Previews</div>
              <div className="text-[11px] text-muted-foreground">Auto-provision on PR open</div>
            </div>
            <input
              type="checkbox"
              checked={autoDeployPr}
              onChange={(e) => setAutoDeployPr(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={handleSaveConfig}
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 shadow-sm"
          >
            {saving ? "Saving..." : "Save Webhook Settings"}
          </button>
        </div>
      </div>

      {/* Ephemeral PR Previews Card */}
      <div className="rounded-xl border bg-card/60 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-border/40">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
              <GitPullRequest className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold">Active Ephemeral PR Previews</h3>
              <p className="text-xs text-muted-foreground">
                Isolated sandbox preview environments running for open GitHub Pull Requests.
              </p>
            </div>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {previews.filter((p) => p.status === "live").length} Live Previews
          </span>
        </div>

        {previews.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
            <GitPullRequest className="mb-2 h-10 w-10 opacity-20" />
            <p className="font-medium text-sm">No Active PR Previews</p>
            <p className="text-xs mt-1">
              Open a GitHub Pull Request or send a webhook to automatically spin up an ephemeral
              preview environment.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {previews.map((pr) => (
              <div
                key={pr.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 hover:bg-muted/20 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-primary">
                      PR #{pr.pr_number}
                    </span>
                    <span className="text-sm font-semibold">{pr.pr_title}</span>
                    {pr.status === "live" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-full">
                        Live
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                        {pr.status}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono flex items-center gap-3">
                    <span>branch: {pr.branch}</span>
                    <span>commit: {pr.commit_sha.slice(0, 7)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={pr.preview_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 border border-primary/20 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors font-mono"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    Open Preview <ExternalLink className="w-3 h-3 ml-0.5" />
                  </a>
                  <button
                    onClick={() => handleDestroyPreview(pr.id, pr.pr_number)}
                    className="inline-flex items-center gap-1 rounded-md border border-destructive/30 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Destroy
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
