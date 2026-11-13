import { useState, useMemo, useEffect } from "react";
import {
  GitPullRequest,
  Plus,
  RefreshCw,
  Search,
  CheckCircle2,
  Copy,
  Moon,
  Sun,
  Zap,
  Globe,
  Trash2,
  Bot,
  Webhook,
  Activity,
  Layers,
  ArrowUpRight,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { useEngine, useEngineProjects, usePRPreviews, type PRPreview } from "../../lib/engine";
import { confirmAction } from "./confirm-modal";
import {
  calculatePreviewFleetMetrics,
  generatePrBotComment,
  evaluateAutoSleepTtl,
  filterPreviewEnvironments,
  formatRelativeTime,
} from "../../utils/preview-environments";

function isHibernated(status: string) {
  return status === "stopped" || status === "sleeping";
}

export function PreviewEnvironmentsManager() {
  const engine = useEngine();
  const projectsQuery = useEngineProjects();
  const previewsQuery = usePRPreviews();

  const projects = useMemo(() => projectsQuery.data || [], [projectsQuery.data]);
  const allPreviews = useMemo(() => previewsQuery.data || [], [previewsQuery.data]);

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
  const [newCommitSha, setNewCommitSha] = useState("HEAD");
  const [isLaunching, setIsLaunching] = useState(false);

  // Bot Comment Modal
  const [activeBotPreview, setActiveBotPreview] = useState<PRPreview | null>(null);

  // Webhook Tester State
  const [webhookEventProject, setWebhookEventProject] = useState("");
  const [simulatedEventType, setSimulatedEventType] = useState<"opened" | "synchronize" | "closed">(
    "opened",
  );
  const [webhookPrNumber, setWebhookPrNumber] = useState<number>(201);
  const [webhookBranch, setWebhookBranch] = useState("feat/preview-smoke");
  const [isDispatchingWebhook, setIsDispatchingWebhook] = useState(false);

  useEffect(() => {
    if (projects.length > 0 && !newProjectName) {
      setNewProjectName(projects[0].name);
    }
    if (projects.length > 0 && !webhookEventProject) {
      setWebhookEventProject(projects[0].name);
    }
  }, [projects, newProjectName, webhookEventProject]);

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
    const proj = newProjectName || projects[0]?.name || "";
    if (!proj) {
      toast.error("Create or select a project first");
      return;
    }
    if (!newBranch.trim()) {
      toast.error("Please specify a branch name");
      return;
    }

    setIsLaunching(true);
    try {
      const created = await engine.call<PRPreview>(
        "POST",
        `/api/projects/${encodeURIComponent(proj)}/previews`,
        {
          prNumber: newPrNumber,
          prTitle: newPrTitle.trim() || `Pull Request #${newPrNumber}`,
          branch: newBranch.trim(),
          commitSha: newCommitSha.trim() || "HEAD",
        },
      );

      await previewsQuery.refetch();
      toast.success(
        `Ephemeral environment "${created.subdomain || `PR #${newPrNumber}`}" provisioned.`,
      );
      setShowLaunchModal(false);
      setNewBranch("");
      setNewPrTitle("");
      setNewCommitSha("HEAD");
      setNewPrNumber((n) => n + 1);
    } catch (err: any) {
      toast.error(err?.message || "Failed to launch preview environment");
    } finally {
      setIsLaunching(false);
    }
  };

  // Handler: Toggle Sleep / Wake
  const handleToggleSleep = async (preview: PRPreview) => {
    const hibernated = isHibernated(preview.status);
    const endpoint = hibernated ? "wake" : "sleep";
    const actionLabel = hibernated ? "Woken Up" : "Hibernated (Scale-to-Zero)";

    try {
      await engine.call(
        "POST",
        `/api/previews/${encodeURIComponent(preview.id)}/${endpoint}`,
      );
      toast.success(`Environment #${preview.pr_number} ${actionLabel}`);
      await previewsQuery.refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update preview state");
    }
  };

  // Handler: Tear Down Preview
  const handleTearDownPreview = async (preview: PRPreview) => {
    const confirmed = await confirmAction({
      title: `Tear Down PR #${preview.pr_number}`,
      description: `Destroy preview environment for PR #${preview.pr_number} (${preview.branch})? Its container and ephemeral route will be removed.`,
      confirmLabel: "Destroy Preview",
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      await engine.call("DELETE", `/api/previews/${encodeURIComponent(preview.id)}`);
      toast.success(`Ephemeral preview for PR #${preview.pr_number} torn down.`);
      await previewsQuery.refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to tear down preview");
    }
  };

  // Handler: Dispatch GitHub Webhook Event to Real Project Webhook Receiver
  const handleDispatchWebhook = async () => {
    const targetProject = webhookEventProject || projects[0]?.name || "";
    if (!targetProject) {
      toast.error("Create or select a target project first");
      return;
    }
    const prNumber = Number(webhookPrNumber) || 201;
    const branch = webhookBranch.trim() || `preview-pr-${prNumber}`;
    setIsDispatchingWebhook(true);

    try {
      const payload = {
        action: simulatedEventType,
        number: prNumber,
        pull_request: {
          number: prNumber,
          title: `PR #${prNumber}: ${branch}`,
          head: {
            ref: branch,
            sha: "HEAD",
          },
        },
        repository: {
          name: targetProject,
        },
      };

      const res = await engine.call<{ action?: string }>(
        "POST",
        `/api/projects/${encodeURIComponent(targetProject)}/webhooks/github`,
        payload,
        { headers: { "x-github-event": "pull_request" } },
      );

      await previewsQuery.refetch();
      toast.success(
        `Webhook pull_request.${simulatedEventType} processed${res?.action ? ` (${res.action})` : ""}.`,
      );
      if (simulatedEventType === "opened") {
        setWebhookPrNumber((n) => n + 1);
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
                              : isHibernated(p.status)
                                ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                                : p.status === "deploying"
                                  ? "bg-sky-500/15 text-sky-400 border border-sky-500/30"
                                  : "bg-destructive/15 text-destructive border border-destructive/30"
                          }`}
                        >
                          {isHibernated(p.status) ? "💤 Sleeping" : p.status}
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
                          isHibernated(p.status)
                            ? "bg-amber-500 text-black hover:bg-amber-400"
                            : "border border-border bg-surface-2 text-foreground hover:bg-accent"
                        }`}
                        title={
                          isHibernated(p.status)
                            ? "Wake container"
                            : "Hibernate container to save RAM"
                        }
                      >
                        {isHibernated(p.status) ? (
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
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

              <label className="space-y-1">
                <span className="font-medium text-foreground">PR Number</span>
                <input
                  type="number"
                  min={1}
                  value={webhookPrNumber}
                  onChange={(e) => setWebhookPrNumber(Number(e.target.value))}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs outline-none"
                />
              </label>

              <label className="space-y-1">
                <span className="font-medium text-foreground">Branch</span>
                <input
                  type="text"
                  value={webhookBranch}
                  onChange={(e) => setWebhookBranch(e.target.value)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs outline-none"
                />
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

            <div className="rounded-lg border border-border bg-surface/40 p-4 text-xs text-muted-foreground">
              Containers running preview branches can be hibernated manually from the fleet list or
              automatically when PRs are closed via webhook events.
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
                  <span className="font-medium text-foreground">Commit SHA / Ref</span>
                  <input
                    type="text"
                    placeholder="HEAD"
                    value={newCommitSha}
                    onChange={(e) => setNewCommitSha(e.target.value)}
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
