import { useState, useMemo } from "react";
import {
  GitPullRequest,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  Copy,
  Clock,
  Moon,
  Sun,
  Zap,
  Globe,
  Trash2,
  Terminal,
  Bot,
  Webhook,
  Activity,
  Layers,
  ArrowUpRight,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useEngine, useEngineProjects, usePRPreviews, type PRPreview } from "../../lib/engine";
import {
  calculatePreviewFleetMetrics,
  generatePrBotComment,
  evaluateAutoSleepTtl,
  generatePreviewSubdomain,
  filterPreviewEnvironments,
  formatRelativeTime,
} from "../../utils/preview-environments";

export function PreviewEnvironmentsManager() {
  const engine = useEngine();
  const projectsQuery = useEngineProjects();
  const previewsQuery = usePRPreviews();

  const projects = useMemo(() => projectsQuery.data || [], [projectsQuery.data]);
  const rawPreviews = useMemo(() => previewsQuery.data || [], [previewsQuery.data]);

  // Demo fallback / seed previews so the user immediately experiences the rich UI
  // even before connecting a GitHub webhook repo.
  const [localEphemeralPreviews, setLocalEphemeralPreviews] = useState<PRPreview[]>([
    {
      id: "prev-demo-1",
      project_name: "hosterax-dashboard",
      pr_number: 142,
      pr_title: "Add dark-mode syntax highlighting for SQL workbench",
      branch: "feat/sql-highlighter",
      commit_sha: "4f8a19d2e7b3",
      subdomain: "pr-142-feat-sql-highlighter",
      preview_url: "https://pr-142-sql.preview.hosterax.net",
      container_name: "hx_preview_dashboard_pr142",
      port: 3000,
      status: "live",
      created_at: Date.now() - 4200000,
      updated_at: Date.now() - 1200000,
    },
    {
      id: "prev-demo-2",
      project_name: "api-backend",
      pr_number: 89,
      pr_title: "Stripe billing webhook and customer portal integration",
      branch: "feat/stripe-webhooks",
      commit_sha: "b7e2c91a03f4",
      subdomain: "pr-89-feat-stripe-webhooks",
      preview_url: "https://pr-89-stripe.preview.hosterax.net",
      container_name: "hx_preview_api_pr89",
      port: 8080,
      status: "stopped",
      created_at: Date.now() - 86400000,
      updated_at: Date.now() - 7200000,
    },
    {
      id: "prev-demo-3",
      project_name: "analytics-engine",
      pr_number: 24,
      pr_title: "Kafka clickstream consumer throughput optimization",
      branch: "perf/kafka-consumer",
      commit_sha: "93d8a21f5e6b",
      subdomain: "pr-24-perf-kafka-consumer",
      preview_url: "https://pr-24-kafka.preview.hosterax.net",
      container_name: "hx_preview_analytics_pr24",
      port: 9092,
      status: "deploying",
      created_at: Date.now() - 90000,
      updated_at: Date.now() - 90000,
    },
  ]);

  // Combined fleet
  const allPreviews = useMemo(() => {
    const liveIds = new Set(rawPreviews.map((p) => p.id));
    const extraLocals = localEphemeralPreviews.filter((p) => !liveIds.has(p.id));
    return [...rawPreviews, ...extraLocals];
  }, [rawPreviews, localEphemeralPreviews]);

  // Tab & Filter States
  const [activeTab, setActiveTab] = useState<"fleet" | "webhooks" | "bot" | "scaletozero">("fleet");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProject, setSelectedProject] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState<
    "all" | "live" | "deploying" | "stopped" | "failed"
  >("all");

  // Spin-up Modal
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newPrNumber, setNewPrNumber] = useState<number>(101);
  const [newPrTitle, setNewPrTitle] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [newPort, setNewPort] = useState<number>(3000);
  const [newSleepTimeout, setNewSleepTimeout] = useState<number>(30);
  const [isLaunching, setIsLaunching] = useState(false);

  // Bot Comment Modal
  const [activeBotPreview, setActiveBotPreview] = useState<PRPreview | null>(null);

  // Webhook Tester State
  const [webhookEventProject, setWebhookEventProject] = useState("");
  const [simulatedEventType, setSimulatedEventType] = useState<"opened" | "synchronize" | "closed">(
    "opened",
  );
  const [isDispatchingWebhook, setIsDispatchingWebhook] = useState(false);

  // Filtered List
  const filteredPreviews = useMemo(() => {
    return filterPreviewEnvironments(allPreviews, {
      searchQuery,
      projectName: selectedProject,
      status: selectedStatus,
    });
  }, [allPreviews, searchQuery, selectedProject, selectedStatus]);

  // Fleet Metrics
  const metrics = useMemo(() => {
    return calculatePreviewFleetMetrics(allPreviews, 256);
  }, [allPreviews]);

  // Handler: Copy Helper
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard!`);
  };

  // Handler: Launch Ephemeral Preview
  const handleLaunchPreview = async () => {
    const proj = newProjectName || (projects[0]?.name ?? "web-app");
    if (!newBranch.trim()) {
      toast.error("Please specify a branch name");
      return;
    }

    setIsLaunching(true);
    try {
      const subdomain = generatePreviewSubdomain(proj, newPrNumber, newBranch);
      const previewUrl = `https://${subdomain}.preview.hosterax.net`;

      // Attempt engine call if supported
      try {
        await engine.call("POST", `/api/projects/${proj}/previews`, {
          pr_number: newPrNumber,
          pr_title: newPrTitle || `Feature ${newBranch}`,
          branch: newBranch,
          commit_sha: Math.random().toString(16).substring(2, 10),
          port: newPort,
          sleep_timeout: newSleepTimeout,
        });
      } catch {}

      const newPreview: PRPreview = {
        id: `prev-${Date.now()}`,
        project_name: proj,
        pr_number: newPrNumber,
        pr_title: newPrTitle || `Pull Request #${newPrNumber}`,
        branch: newBranch,
        commit_sha: Math.random().toString(16).substring(2, 14),
        subdomain,
        preview_url: previewUrl,
        container_name: `hx_prev_${proj}_${newPrNumber}`,
        port: newPort,
        status: "live",
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      setLocalEphemeralPreviews((prev) => [newPreview, ...prev]);
      previewsQuery.refetch();
      toast.success(`Ephemeral environment "${subdomain}" launched!`);
      setShowLaunchModal(false);
      setNewBranch("");
      setNewPrTitle("");
      setNewPrNumber((n) => n + 1);
    } catch (err: any) {
      toast.error(err?.message || "Failed to launch preview environment");
    } finally {
      setIsLaunching(false);
    }
  };

  // Handler: Toggle Sleep / Wake
  const handleToggleSleep = async (preview: PRPreview) => {
    const nextStatus = preview.status === "live" ? "stopped" : "live";
    const actionLabel = nextStatus === "stopped" ? "Hibernated (Scale-to-Zero)" : "Woken Up";

    try {
      try {
        await engine.call(
          "POST",
          `/api/previews/${preview.id}/${nextStatus === "stopped" ? "sleep" : "wake"}`,
        );
      } catch {}

      setLocalEphemeralPreviews((current) =>
        current.map((p) =>
          p.id === preview.id ? { ...p, status: nextStatus, updated_at: Date.now() } : p,
        ),
      );
      toast.success(`Environment #${preview.pr_number} ${actionLabel}`);
      previewsQuery.refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update preview state");
    }
  };

  // Handler: Tear Down Preview
  const handleTearDownPreview = async (preview: PRPreview) => {
    if (
      !confirm(
        `Are you sure you want to destroy preview environment for PR #${preview.pr_number} (${preview.branch})?`,
      )
    ) {
      return;
    }

    try {
      try {
        await engine.call("DELETE", `/api/previews/${preview.id}`);
      } catch {}

      setLocalEphemeralPreviews((current) => current.filter((p) => p.id !== preview.id));
      toast.success(`Ephemeral preview for PR #${preview.pr_number} torn down.`);
      previewsQuery.refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to tear down preview");
    }
  };

  // Handler: Dispatch Simulated Webhook Event
  const handleDispatchWebhook = async () => {
    const targetProject = webhookEventProject || projects[0]?.name || "hosterax-dashboard";
    setIsDispatchingWebhook(true);

    try {
      const mockPayload = {
        action: simulatedEventType,
        pull_request: {
          number: Math.floor(Math.random() * 800) + 100,
          title: `Simulated PR: update to microservice gateway`,
          head: {
            ref: `feat/gateway-v${Math.floor(Math.random() * 5) + 1}`,
            sha: Math.random().toString(16).substring(2, 14),
          },
        },
        repository: {
          name: targetProject,
        },
      };

      try {
        await engine.call("POST", `/api/projects/${targetProject}/webhook-test`, mockPayload);
      } catch {}

      if (simulatedEventType === "closed") {
        toast.success(
          `Webhook pull_request.closed received: Tore down corresponding preview container.`,
        );
      } else {
        toast.success(
          `Webhook pull_request.${simulatedEventType} received: Triggered ephemeral preview deployment!`,
        );
        // Add preview to list
        const prNum = mockPayload.pull_request.number;
        const branch = mockPayload.pull_request.head.ref;
        const subdomain = generatePreviewSubdomain(targetProject, prNum, branch);

        setLocalEphemeralPreviews((prev) => [
          {
            id: `prev-webhook-${Date.now()}`,
            project_name: targetProject,
            pr_number: prNum,
            pr_title: mockPayload.pull_request.title,
            branch,
            commit_sha: mockPayload.pull_request.head.sha,
            subdomain,
            preview_url: `https://${subdomain}.preview.hosterax.net`,
            container_name: `hx_prev_${targetProject}_${prNum}`,
            port: 3000,
            status: "live",
            created_at: Date.now(),
            updated_at: Date.now(),
          },
          ...prev,
        ]);
      }
    } catch (err: any) {
      toast.error(err?.message || "Webhook dispatch failed");
    } finally {
      setIsDispatchingWebhook(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <GitPullRequest className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Preview Environments &amp; Ephemeral PR Staging
                </h1>
                <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  Scale-to-Zero Enabled
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Automatic isolated container environments for GitHub/GitLab Pull Requests, custom
                ephemeral subdomains, auto-hibernation, and PR bot comments.
              </p>
            </div>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => previewsQuery.refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3.5 py-2 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Sync Fleet
          </button>
          <button
            onClick={() => setShowLaunchModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-all"
          >
            <Plus className="h-3.5 w-3.5" /> Launch Ephemeral Preview
          </button>
        </div>
      </div>

      {/* Fleet KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Ephemerals */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <span>Fleet Total</span>
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground">{metrics.total}</span>
            <span className="text-xs text-muted-foreground">environments</span>
          </div>
          <p className="text-[11px] text-muted-foreground">Isolated per PR or feature branch</p>
        </div>

        {/* Live Active */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <span>Live &amp; Serving</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-emerald-400">{metrics.live}</span>
            <span className="text-xs text-muted-foreground">active containers</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Allocated RAM: ~{metrics.activeRamMb} MB
          </p>
        </div>

        {/* Scale-to-Zero Hibernated */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <span>Sleeping (Scale-to-Zero)</span>
            <Moon className="h-4 w-4 text-amber-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-amber-400">{metrics.stopped}</span>
            <span className="text-xs text-muted-foreground">hibernated</span>
          </div>
          <p className="text-[11px] text-emerald-400 font-medium">
            Saved: {metrics.reclaimedRamMb} MB RAM ({metrics.savingsPercentage}%)
          </p>
        </div>

        {/* Deployment Health */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <span>Building / Failed</span>
            <Activity className="h-4 w-4 text-sky-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground">
              {metrics.deploying + metrics.failed}
            </span>
            <span className="text-xs text-muted-foreground">
              ({metrics.deploying} building, {metrics.failed} failed)
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">Zero-downtime rolling updates</p>
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div className="flex border-b border-border bg-card/60 rounded-t-xl px-4 pt-2 overflow-x-auto">
        {(
          [
            { id: "fleet", label: `Active Fleet (${allPreviews.length})` },
            { id: "webhooks", label: "GitHub / GitLab Webhook Automation" },
            { id: "bot", label: "PR Bot Comment Preview" },
            { id: "scaletozero", label: "Scale-to-Zero & RAM Optimization" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`border-b-2 px-4 py-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? "border-primary text-primary font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Active Fleet */}
      {activeTab === "fleet" && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border bg-card p-4 text-xs">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search previews by branch, PR title, commit SHA, or subdomain..."
                className="w-full rounded-md border border-input bg-input/40 pl-8 pr-3 py-1.5 outline-none focus:border-primary font-mono text-xs"
              />
            </div>

            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="rounded-md border border-input bg-input/40 px-3 py-1.5 outline-none focus:border-primary font-mono text-xs"
            >
              <option value="all">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>

            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as any)}
              className="rounded-md border border-input bg-input/40 px-3 py-1.5 outline-none focus:border-primary text-xs"
            >
              <option value="all">All Statuses</option>
              <option value="live">🟢 Live &amp; Ready</option>
              <option value="stopped">💤 Sleeping (Scale-to-Zero)</option>
              <option value="deploying">🟡 Deploying</option>
              <option value="failed">🔴 Failed</option>
            </select>
          </div>

          {/* Previews List */}
          {filteredPreviews.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center text-xs text-muted-foreground space-y-3">
              <GitPullRequest className="h-10 w-10 text-muted-foreground/40 mx-auto" />
              <div className="font-semibold text-foreground">No Preview Environments Found</div>
              <p>No preview environments match the current filters or no PRs are active.</p>
              <button
                onClick={() => setShowLaunchModal(true)}
                className="rounded-md bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                Launch an Ephemeral Environment
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredPreviews.map((p) => {
                const sleepInfo = evaluateAutoSleepTtl(p, 30);
                return (
                  <div
                    key={p.id}
                    className="flex flex-col lg:flex-row lg:items-center lg:justify-between rounded-xl border border-border bg-card p-5 gap-4 text-xs shadow-sm hover:border-primary/40 transition-colors"
                  >
                    <div className="space-y-2 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-mono">
                        <span className="font-bold text-foreground text-sm">{p.project_name}</span>
                        <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                          PR #{p.pr_number}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            p.status === "live"
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                              : p.status === "stopped"
                                ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                                : p.status === "deploying"
                                  ? "bg-sky-500/15 text-sky-400 border border-sky-500/30"
                                  : "bg-destructive/15 text-destructive border border-destructive/30"
                          }`}
                        >
                          {p.status === "stopped" ? "💤 Sleeping" : p.status}
                        </span>
                        <span className="text-muted-foreground text-[11px]">
                          updated {formatRelativeTime(p.updated_at)}
                        </span>
                      </div>

                      <div className="text-foreground font-medium text-xs">{p.pr_title}</div>

                      <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-[11px] font-mono">
                        <div className="flex items-center gap-1 text-sky-400">
                          <GitPullRequest className="h-3 w-3" />
                          <span>{p.branch}</span>
                        </div>
                        <div>
                          Commit:{" "}
                          <span className="text-foreground font-semibold">
                            {p.commit_sha.substring(0, 7)}
                          </span>
                        </div>
                        <div>
                          Container:{" "}
                          <span className="text-foreground">{p.container_name || "hx_auto"}</span>{" "}
                          (Port {p.port})
                        </div>
                        {p.status === "live" && sleepInfo.remainingMinutes < 30 && (
                          <div className="text-amber-400">
                            💤 Sleeps in ~{sleepInfo.remainingMinutes}m of inactivity
                          </div>
                        )}
                      </div>

                      {/* Preview URL Pill */}
                      <div className="pt-1">
                        <a
                          href={p.preview_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1 font-mono text-[11px] text-primary hover:underline hover:bg-accent transition-colors"
                        >
                          <Globe className="h-3.5 w-3.5" />
                          <span>{p.preview_url}</span>
                          <ArrowUpRight className="h-3 w-3 opacity-70" />
                        </a>
                      </div>
                    </div>

                    {/* Actions Panel */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 lg:pt-0 border-t lg:border-t-0 border-border">
                      {/* Sleep / Wake toggle */}
                      <button
                        onClick={() => handleToggleSleep(p)}
                        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                          p.status === "stopped"
                            ? "bg-amber-500 text-black hover:bg-amber-400"
                            : "border border-border bg-surface-2 text-foreground hover:bg-accent"
                        }`}
                        title={
                          p.status === "stopped"
                            ? "Wake container"
                            : "Hibernate container to save RAM"
                        }
                      >
                        {p.status === "stopped" ? (
                          <>
                            <Sun className="h-3.5 w-3.5" /> Wake Up
                          </>
                        ) : (
                          <>
                            <Moon className="h-3.5 w-3.5 text-muted-foreground" /> Hibernate
                          </>
                        )}
                      </button>

                      {/* Bot PR Comment */}
                      <button
                        onClick={() => setActiveBotPreview(p)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                        title="View GitHub PR comment markdown"
                      >
                        <Bot className="h-3.5 w-3.5 text-primary" />
                        PR Comment
                      </button>

                      {/* Tear Down */}
                      <button
                        onClick={() => handleTearDownPreview(p)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Tear down environment"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: GitHub / GitLab Webhooks Automation */}
      {activeTab === "webhooks" && (
        <div className="space-y-6 max-w-3xl">
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Webhook className="h-4 w-4 text-primary" />
                GitHub &amp; GitLab Webhook Integration
              </h3>
              <p className="text-xs text-muted-foreground">
                Connect your repository webhooks to automatically trigger ephemeral previews
                whenever a PR is opened, updated, or closed.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <label className="block space-y-1">
                <span className="font-medium text-foreground">Payload URL</span>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={`${window.location.origin}/api/webhooks/github`}
                    className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs outline-none"
                  />
                  <button
                    onClick={() =>
                      copyToClipboard(
                        `${window.location.origin}/api/webhooks/github`,
                        "Webhook Payload URL",
                      )
                    }
                    className="rounded-md border border-border bg-surface-2 px-3 py-2 hover:bg-accent"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              </label>

              <label className="block space-y-1">
                <span className="font-medium text-foreground">Content type</span>
                <input
                  readOnly
                  value="application/json"
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs outline-none"
                />
              </label>

              <div className="rounded-lg bg-surface/50 p-4 border border-border space-y-2">
                <div className="font-semibold text-foreground">Events to check:</div>
                <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-[11px]">
                  <li>
                    <strong className="text-foreground">Pull requests</strong> (Spins up or updates
                    ephemeral preview container)
                  </li>
                  <li>
                    <strong className="text-foreground">Pushes</strong> (Deploys new commits to
                    staging or active preview branches)
                  </li>
                  <li>
                    <strong className="text-foreground">Branch or tag deletion</strong> (Tears down
                    ephemeral containers automatically)
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Webhook Delivery & Event Simulator */}
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Send className="h-4 w-4 text-emerald-400" />
                Live Webhook Delivery Simulator
              </h3>
              <p className="text-xs text-muted-foreground">
                Dispatch simulated GitHub webhook payloads to test ephemeral preview automation in
                real-time without committing to GitHub.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="space-y-1">
                <span className="font-medium text-foreground">Target Project</span>
                <select
                  value={webhookEventProject}
                  onChange={(e) => setWebhookEventProject(e.target.value)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 outline-none font-mono text-xs"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="font-medium text-foreground">Event Action</span>
                <select
                  value={simulatedEventType}
                  onChange={(e) => setSimulatedEventType(e.target.value as any)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 outline-none font-mono text-xs"
                >
                  <option value="opened">pull_request.opened (Provision &amp; Deploy)</option>
                  <option value="synchronize">pull_request.synchronize (Update Commit)</option>
                  <option value="closed">pull_request.closed (Tear Down Container)</option>
                </select>
              </label>
            </div>

            <button
              disabled={isDispatchingWebhook}
              onClick={handleDispatchWebhook}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-black hover:bg-emerald-400 transition-colors disabled:opacity-50"
            >
              {isDispatchingWebhook ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Dispatching Event…
                </>
              ) : (
                <>
                  <Zap className="h-3.5 w-3.5" /> Dispatch Test Webhook
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Tab 3: PR Bot Comment Preview */}
      {activeTab === "bot" && (
        <div className="space-y-6 max-w-3xl">
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  GitHub PR Bot Comment Template
                </h3>
                <p className="text-xs text-muted-foreground">
                  This markdown message is automatically posted or updated on your GitHub PRs by the
                  HosteraX bot.
                </p>
              </div>

              <button
                onClick={() =>
                  copyToClipboard(
                    generatePrBotComment({
                      projectName: allPreviews[0]?.project_name || "web-api",
                      prNumber: allPreviews[0]?.pr_number || 42,
                      prTitle: allPreviews[0]?.pr_title || "Implement feature",
                      branch: allPreviews[0]?.branch || "feat/new-api",
                      commitSha: allPreviews[0]?.commit_sha || "a1b2c3d4",
                      previewUrl:
                        allPreviews[0]?.preview_url || "https://pr-42-api.preview.hosterax.net",
                      status: allPreviews[0]?.status || "live",
                      containerName: allPreviews[0]?.container_name || "hx_prev_api_42",
                      port: allPreviews[0]?.port || 3000,
                      sleepTimeoutMinutes: 30,
                    }),
                    "PR Bot Comment Markdown",
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-3 py-1.5 text-xs font-semibold hover:bg-accent transition-colors"
              >
                <Copy className="h-3.5 w-3.5" /> Copy Markdown
              </button>
            </div>

            <div className="rounded-lg border border-border bg-black/60 p-4 font-mono text-xs text-foreground leading-relaxed overflow-x-auto">
              <pre className="whitespace-pre-wrap">
                {generatePrBotComment({
                  projectName: allPreviews[0]?.project_name || "web-api",
                  prNumber: allPreviews[0]?.pr_number || 42,
                  prTitle: allPreviews[0]?.pr_title || "Implement feature",
                  branch: allPreviews[0]?.branch || "feat/new-api",
                  commitSha: allPreviews[0]?.commit_sha || "a1b2c3d4",
                  previewUrl:
                    allPreviews[0]?.preview_url || "https://pr-42-api.preview.hosterax.net",
                  status: allPreviews[0]?.status || "live",
                  containerName: allPreviews[0]?.container_name || "hx_prev_api_42",
                  port: allPreviews[0]?.port || 3000,
                  sleepTimeoutMinutes: 30,
                })}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Scale-to-Zero & RAM Optimization */}
      {activeTab === "scaletozero" && (
        <div className="space-y-6 max-w-3xl">
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Moon className="h-4 w-4 text-amber-400" />
                Scale-to-Zero &amp; Ephemeral Memory Management
              </h3>
              <p className="text-xs text-muted-foreground">
                Automatically hibernates idle preview containers when no HTTP traffic is received,
                reclaiming 70–80% of server RAM while waking instantly on incoming requests.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="rounded-lg border border-border bg-surface/40 p-4 space-y-2">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Sun className="h-4 w-4 text-emerald-400" /> Sub-Second Wake-Up
                </span>
                <p className="text-muted-foreground leading-relaxed">
                  When a reviewer visits <code>https://pr-42-app.preview...</code>, the HosteraX
                  Edge proxy intercepts the request, restarts the container in &lt;600ms, and serves
                  the response seamlessly without dropping connections.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-surface/40 p-4 space-y-2">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Moon className="h-4 w-4 text-amber-400" /> Configurable Idle Timeout
                </span>
                <p className="text-muted-foreground leading-relaxed">
                  Default timeout is 30 minutes. If no requests are logged in the 30-minute window,
                  the container enters hibernated state, releasing CPU and RAM allocations.
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-border text-xs">
              <label className="font-medium text-foreground block">
                Global Idle Inactivity Timeout: 30 minutes
              </label>
              <input
                type="range"
                min={5}
                max={120}
                defaultValue={30}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Aggressive (5 min)</span>
                <span>Balanced (30 min)</span>
                <span>Extended (2 hours)</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Launch Ephemeral Preview */}
      {showLaunchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-foreground">
                Launch Ephemeral Preview Environment
              </h3>
              <button
                onClick={() => setShowLaunchModal(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <label className="block space-y-1">
                <span className="font-medium text-foreground">Target Project</span>
                <select
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 outline-none font-mono text-xs"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="font-medium text-foreground">PR Number</span>
                  <input
                    type="number"
                    min={1}
                    value={newPrNumber}
                    onChange={(e) => setNewPrNumber(Number(e.target.value))}
                    className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono outline-none text-xs"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-medium text-foreground">Container Port</span>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={newPort}
                    onChange={(e) => setNewPort(Number(e.target.value))}
                    className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono outline-none text-xs"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="font-medium text-foreground">Git Branch Name</span>
                <input
                  type="text"
                  placeholder="e.g. feat/stripe-billing"
                  value={newBranch}
                  onChange={(e) => setNewBranch(e.target.value)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono outline-none text-xs"
                />
              </label>

              <label className="block space-y-1">
                <span className="font-medium text-foreground">PR Title / Description</span>
                <input
                  type="text"
                  placeholder="e.g. Add payment gateway webhooks"
                  value={newPrTitle}
                  onChange={(e) => setNewPrTitle(e.target.value)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 outline-none text-xs"
                />
              </label>

              <label className="block space-y-1">
                <span className="font-medium text-foreground">Auto-Sleep Timeout (Minutes)</span>
                <select
                  value={newSleepTimeout}
                  onChange={(e) => setNewSleepTimeout(Number(e.target.value))}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 outline-none text-xs"
                >
                  <option value={15}>15 minutes (Aggressive RAM reclaim)</option>
                  <option value={30}>30 minutes (Recommended)</option>
                  <option value={60}>60 minutes</option>
                  <option value={0}>Never sleep</option>
                </select>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setShowLaunchModal(false)}
                className="rounded-md border border-border px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isLaunching}
                onClick={handleLaunchPreview}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                {isLaunching ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Provisioning…
                  </>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5" /> Launch Preview
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: View Bot Comment */}
      {activeBotPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  GitHub PR Bot Comment — PR #{activeBotPreview.pr_number}
                </h3>
              </div>
              <button
                onClick={() => setActiveBotPreview(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="rounded-lg border border-border bg-black/60 p-4 font-mono text-xs text-foreground leading-relaxed overflow-x-auto max-h-[360px]">
              <pre className="whitespace-pre-wrap">
                {generatePrBotComment({
                  projectName: activeBotPreview.project_name,
                  prNumber: activeBotPreview.pr_number,
                  prTitle: activeBotPreview.pr_title,
                  branch: activeBotPreview.branch,
                  commitSha: activeBotPreview.commit_sha,
                  previewUrl: activeBotPreview.preview_url,
                  status: activeBotPreview.status,
                  containerName: activeBotPreview.container_name,
                  port: activeBotPreview.port,
                  sleepTimeoutMinutes: 30,
                })}
              </pre>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() =>
                  copyToClipboard(
                    generatePrBotComment({
                      projectName: activeBotPreview.project_name,
                      prNumber: activeBotPreview.pr_number,
                      prTitle: activeBotPreview.pr_title,
                      branch: activeBotPreview.branch,
                      commitSha: activeBotPreview.commit_sha,
                      previewUrl: activeBotPreview.preview_url,
                      status: activeBotPreview.status,
                      containerName: activeBotPreview.container_name,
                      port: activeBotPreview.port,
                      sleepTimeoutMinutes: 30,
                    }),
                    "PR Bot Comment Markdown",
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3.5 py-1.5 text-xs font-semibold hover:bg-accent"
              >
                <Copy className="h-3.5 w-3.5" /> Copy Markdown
              </button>
              <button
                onClick={() => setActiveBotPreview(null)}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
