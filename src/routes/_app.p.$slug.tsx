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
} from "@/lib/engine";
import { DeploymentDiffModal } from "@/components/hx/deployment-diff";
import { HealthMetrics } from "@/components/hx/health-metrics";
import { ServiceTopologyGraph } from "@/components/hx/service-topology-graph";
import { MagicDnsSelector } from "@/components/hx/magic-dns-selector";
import { DeleteProjectModal } from "@/components/hx/delete-project-modal";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
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
} from "lucide-react";
import { SelfHealingPanel } from "@/components/hx/self-healing-panel";

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
  const engine = useEngine();
  const { data: magicDns } = useMagicDnsSettings();
  const { data: netInfo } = useNetworkInterfaces();
  const primaryLanIp = netInfo?.primaryIp && netInfo.primaryIp !== "127.0.0.1" ? netInfo.primaryIp : null;

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
                  <span>http://{primaryLanIp}:{project.port || 8080}</span>
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
      {tab === "deployments" && (
        <DeploymentsTab projectId={project.id} projectName={project.name} />
      )}
      {tab === "webhooks" && <WebhooksTab projectName={project.name} project={project} />}
      {tab === "self-heal" && <SelfHealingPanel projectName={project.name} />}
      {tab === "logs" && <LiveLogs projectName={project.name} />}
      {tab === "env" && <EnvVars projectId={project.id} projectName={project.name} />}
      {tab === "domains" && (
        <ProjectDomains projectId={project.id} projectName={project.name} project={project} />
      )}
      {tab === "databases" && <DatabasesTab projectId={project.id} projectName={project.name} />}
      {tab === "settings" && (
        <Settings project={project} onDelete={() => setDeleteModalOpen(true)} />
      )}

      <DeleteProjectModal
        isOpen={deleteModalOpen}
        projectName={project.name}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
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
    if (
      !confirm(
        `Rollback to ${dep.version ?? dep.commit_sha}? A new build will be queued from this snapshot.`,
      )
    )
      return;
    try {
      await engine.call("POST", `/api/projects/${projectName}/deploy`, {
        trigger: "rollback",
      });
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
    refetchInterval: 3000,
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
            setLogs(res.lines);
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
                        return [...prev, payload];
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
  }, [active, engine.url, engine.token, projectName]);

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

function EnvVars({ projectId, projectName }: { projectId: string; projectName: string }) {
  const engine = useEngine();
  const qc = useQueryClient();
  const { data: vars = [] } = useQuery({
    queryKey: ["envs", projectName, engine.url],
    queryFn: async () => {
      try {
        const engEnv = await engine.call<any>("GET", `/api/projects/${projectName}/env`);
        if (engEnv && typeof engEnv === "object") {
          return Object.entries(engEnv).map(([k, v]) => ({
            id: `env-${k}`,
            key: k,
            value: String(v),
            is_secret:
              k.toLowerCase().includes("secret") ||
              k.toLowerCase().includes("key") ||
              k.toLowerCase().includes("token") ||
              k.toLowerCase().includes("pass"),
          }));
        }
      } catch {}
      return [];
    },
    refetchInterval: 5000,
  });

  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [secret, setSecret] = useState(true);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});

  async function add() {
    if (!key.trim()) return;
    const cleanKey = key.trim();

    try {
      await engine.call("POST", `/api/projects/${projectName}/env`, {
        key: cleanKey,
        value,
      });
      toast.success(`Environment variable ${cleanKey} saved to database`);
      setKey("");
      setValue("");
      qc.invalidateQueries({ queryKey: ["envs"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to add variable");
    }
  }

  async function del(vKey: string) {
    try {
      await engine.call("DELETE", `/api/projects/${projectName}/env/${vKey}`);
      toast.success(`Variable ${vKey} removed from database`);
      qc.invalidateQueries({ queryKey: ["envs"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to delete variable");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 text-sm font-medium">Add variable</div>
        <div className="flex flex-wrap gap-2">
          <input
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
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
            <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />{" "}
            Secret
          </label>
          <button
            onClick={add}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card">
        {vars.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No variables. Add API keys, connection strings, or configuration variables.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {vars.map((v: any) => (
              <div key={v.id} className="flex items-center gap-3 p-3 font-mono text-sm">
                <span className="w-56 truncate text-primary font-semibold">{v.key}</span>
                <span className="flex-1 truncate text-muted-foreground">
                  {v.is_secret && !reveal[v.id]
                    ? "•".repeat(Math.min(v.value?.length || 8, 16))
                    : v.value}
                </span>
                {v.is_secret && (
                  <button
                    onClick={() => setReveal({ ...reveal, [v.id]: !reveal[v.id] })}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {reveal[v.id] ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(v.value);
                    toast.success("Copied");
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => del(v.key)}
                  className="text-muted-foreground hover:text-destructive"
                >
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

function ProjectDomains({
  projectId,
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

  async function addDomain() {
    if (!domainInput.trim()) return;
    setAdding(true);
    try {
      await engine.call("POST", `/api/projects/${projectName}/domains`, {
        hostname: domainInput.trim().toLowerCase(),
      });
      toast.success(`Domain ${domainInput.trim()} saved to database`);
      setDomainInput("");
      qc.invalidateQueries({ queryKey: ["project-domains"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to add domain");
    } finally {
      setAdding(false);
    }
  }

  async function removeDomain(domainId: string) {
    if (!confirm("Remove this domain from SQLite database?")) return;
    try {
      await engine.call("DELETE", `/api/domains/${domainId}`);
      toast.success("Domain removed from database");
      qc.invalidateQueries({ queryKey: ["project-domains"] });
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
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 rounded-full">
                Auto-Discovered
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Access and test this project on smartphones, tablets, or other computers connected to the same local Wi-Fi.
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
                      onClick={() => {
                        navigator.clipboard.writeText(url);
                        toast.success("LAN URL copied to clipboard");
                      }}
                      className="p-1.5 hover:bg-surface-2 rounded text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy LAN URL"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
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
        <div>
          <div className="font-semibold text-sm">Custom Domains</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Connect production or preview custom domains to this project.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            placeholder="app.example.com or custom.127-0-0-1.sslip.io"
            className="flex-1 rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm outline-none focus:border-primary"
          />
          <button
            onClick={addDomain}
            disabled={adding}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add Domain
          </button>
        </div>

        <div className="divide-y divide-border pt-2">
          {domains.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No custom domains added yet. Your default wildcard DNS endpoint is active.
            </div>
          ) : (
            domains.map((d: any) => (
              <div
                key={d.id || d.hostname}
                className="flex items-center justify-between py-3 font-mono text-xs"
              >
                <div className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-primary" />
                  <span className="font-medium text-foreground">{d.hostname}</span>
                  {d.is_primary && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      primary
                    </span>
                  )}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {d.ssl_status || "edge-ready"}
                  </span>
                </div>
                <button
                  onClick={() => removeDomain(d.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function DatabasesTab({ projectId, projectName }: { projectId: string; projectName: string }) {
  const engine = useEngine();
  const qc = useQueryClient();
  const { data: dbs = [] } = useQuery({
    queryKey: ["dbs", projectName, engine.url],
    queryFn: async () => {
      try {
        const data = await engine.call<any[]>("GET", `/api/projects/${projectName}/databases`);
        return data ?? [];
      } catch {
        return [];
      }
    },
    refetchInterval: 3000,
  });

  async function provision(engineType: string) {
    const name = prompt(`Name for ${engineType} instance?`, `${engineType}-main`);
    if (!name) return;
    try {
      await engine.call("POST", `/api/projects/${projectName}/databases`, {
        name,
        engine: engineType,
        size_mb: 1024,
      });
      qc.invalidateQueries({ queryKey: ["dbs", projectName] });
      toast.success(`${engineType} database provisioning started in SQLite engine`);
    } catch (e: any) {
      toast.error(e.message || "Failed to provision database");
    }
  }

  async function del(id: string) {
    if (!confirm("Delete this database?")) return;
    try {
      await engine.call("DELETE", `/api/databases/${id}`);
      qc.invalidateQueries({ queryKey: ["dbs", projectName] });
      toast.success("Database removed from SQLite database");
    } catch (e: any) {
      toast.error(e.message || "Failed to delete database");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {["postgres", "mysql", "mongodb", "redis"].map((e) => (
          <button
            key={e}
            onClick={() => provision(e)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm hover:border-primary/40 capitalize font-medium"
          >
            <Plus className="h-4 w-4" /> {e}
          </button>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card">
        {dbs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No databases attached. Provision one above.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {dbs.map((d: any) => (
              <div key={d.id} className="flex items-center gap-3 p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-2 font-mono text-xs uppercase text-primary">
                  {d.engine.slice(0, 2)}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{d.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {d.engine} · {d.size_mb} MB
                    {d.connection_string && (
                      <>
                        {" "}
                        ·{" "}
                        <span className="font-mono">
                          {d.connection_string.replace(/:[^:@]+@/, ":••••@")}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <StatusBadge status={d.status} />
                <button
                  onClick={() => del(d.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Settings({ project, onDelete }: { project: any; onDelete: () => void }) {
  const engine = useEngine();
  const { data: scaleZero, refetch: refetchScaleZero } = useScaleToZero(project.name);
  const [name, setName] = useState(project.name);
  const [branch, setBranch] = useState(project.branch || "main");
  const [buildCmd, setBuildCmd] = useState(project.build_command ?? "");
  const [startCmd, setStartCmd] = useState(project.start_command ?? "");
  const [port, setPort] = useState(project.port ?? 3000);
  const [healthPath, setHealthPath] = useState(project.health_path || "/");
  const [scaleZeroEnabled, setScaleZeroEnabled] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState(15);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (scaleZero) {
      setScaleZeroEnabled(scaleZero.enabled);
      setIdleMinutes(scaleZero.idleTimeoutMinutes || 15);
    }
  }, [scaleZero]);

  async function save() {
    setBusy(true);
    try {
      await engine.call("PATCH", `/api/projects/${project.name}`, {
        name,
        branch,
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
      toast.success("Settings & Scale-to-Zero configuration saved");
    } catch (e: any) {
      toast.error(e.message || "Failed to update settings");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Scale-to-Zero & Compute Optimization (Temps Benchmark) */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <Moon className="h-4 w-4 text-amber-400" />
              <span>Scale-to-Zero & Compute Optimization</span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 bg-amber-950/60 border border-amber-800/60 text-amber-300 rounded-full">
                Temps v2 Engine
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automatically suspend idle preview/staging containers to reclaim 60–80% server RAM. Wakes in &lt;1.2s on HTTP request.
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
        <div className="grid gap-4 md:grid-cols-2">
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

  const [trackedBranch, setTrackedBranch] = useState(
    config?.tracked_branch || project.branch || "main",
  );
  const [autoDeployPush, setAutoDeployPush] = useState(config?.auto_deploy_push !== 0);
  const [autoDeployPr, setAutoDeployPr] = useState(config?.auto_deploy_pr !== 0);
  const [saving, setSaving] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  useEffect(() => {
    if (config) {
      setTrackedBranch(config.tracked_branch || "main");
      setAutoDeployPush(config.auto_deploy_push !== 0);
      setAutoDeployPr(config.auto_deploy_pr !== 0);
    }
  }, [config]);

  const webhookUrl = `${engine.url}/api/projects/${projectName}/webhooks/github`;
  const webhookSecret = config?.secret || "Generating...";

  async function handleSaveConfig() {
    setSaving(true);
    try {
      await engine.call("POST", `/api/projects/${projectName}/webhook-config`, {
        tracked_branch: trackedBranch,
        auto_deploy_push: autoDeployPush ? 1 : 0,
        auto_deploy_pr: autoDeployPr ? 1 : 0,
      });
      toast.success("GitHub Webhook settings saved!");
      refetchConfig();
    } catch (e: any) {
      toast.error(e.message || "Failed to save webhook settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleDestroyPreview(prId: string, prNumber: number) {
    if (!confirm(`Are you sure you want to tear down preview environment for PR #${prNumber}?`))
      return;
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
      {/* GitHub Webhook Configuration Card */}
      <div className="rounded-xl border bg-card/60 p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Webhook className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold">GitHub Webhook & Push-to-Deploy</h3>
              <p className="text-xs text-muted-foreground">
                Automatically trigger zero-downtime builds on git push and spin up ephemeral PR
                previews.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
            <Radio className="w-3 h-3 animate-pulse" /> Webhook Listener Active
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {/* Payload URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Payload URL (GitHub Webhook)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={webhookUrl}
                className="w-full font-mono text-xs rounded-md border border-input bg-muted/40 px-3 py-2 text-foreground"
              />
              <button
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
              Secret Token (HMAC-SHA256)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                readOnly
                value={webhookSecret}
                className="w-full font-mono text-xs rounded-md border border-input bg-muted/40 px-3 py-2 text-foreground"
              />
              <button
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
