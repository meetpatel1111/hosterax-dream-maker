import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Clock,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Terminal,
  Globe,
  Database,
  Calendar,
  Layers,
  ChevronRight,
  Copy,
  Check,
  Zap,
} from "lucide-react";
import {
  useCronJobs,
  useJobRuns,
  useEngineProjects,
  useEngine,
  type CronJob,
  type JobRun,
} from "@/lib/engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/jobs")({
  component: JobsPage,
});

const CRON_PRESETS = [
  { label: "Every Minute", expr: "* * * * *", desc: "Runs every single minute" },
  { label: "Every 5 Minutes", expr: "*/5 * * * *", desc: "Runs every 5 minutes" },
  { label: "Every 15 Minutes", expr: "*/15 * * * *", desc: "Runs every quarter hour" },
  { label: "Hourly", expr: "0 * * * *", desc: "Runs at the start of every hour" },
  { label: "Daily (Midnight)", expr: "0 0 * * *", desc: "Runs every day at 00:00 UTC" },
  { label: "Daily (3 AM)", expr: "0 3 * * *", desc: "Runs every day at 03:00 UTC (off-peak)" },
  { label: "Weekly (Sunday)", expr: "0 0 * * 0", desc: "Runs once a week on Sunday midnight" },
  { label: "Monthly (1st)", expr: "0 0 1 * *", desc: "Runs on the 1st of every month" },
];

function humanizeCron(expr: string): string {
  const match = CRON_PRESETS.find((p) => p.expr === expr.trim());
  if (match) return match.label;
  if (expr === "*/10 * * * *") return "Every 10 minutes";
  if (expr === "*/30 * * * *") return "Every 30 minutes";
  return expr;
}

function formatRelativeTime(ts?: number | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  if (diff < 0) {
    const futureSec = Math.floor(-diff / 1000);
    if (futureSec < 60) return `in ${futureSec}s`;
    const futureMin = Math.floor(futureSec / 60);
    if (futureMin < 60) return `in ${futureMin}m`;
    const futureHours = Math.floor(futureMin / 60);
    if (futureHours < 24) return `in ${futureHours}h`;
    return `in ${Math.floor(futureHours / 24)}d`;
  }
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function JobsPage() {
  const eng = useEngine();
  const { data: jobs = [], refetch: refetchJobs, isLoading: loadingJobs } = useCronJobs();
  const { data: allRuns = [], refetch: refetchRuns } = useJobRuns();
  const { data: projects = [] } = useEngineProjects();

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<CronJob | null>(null);
  const [logSheetJob, setLogSheetJob] = useState<CronJob | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);

  // Form State
  const [formName, setFormName] = useState("");
  const [formProject, setFormProject] = useState("");
  const [formCron, setFormCron] = useState("0 0 * * *");
  const [formType, setFormType] = useState<"command" | "http" | "backup">("command");
  const [formCommand, setFormCommand] = useState("");
  const [formTargetContainer, setFormTargetContainer] = useState("");
  const [formHttpUrl, setFormHttpUrl] = useState("");
  const [formHttpMethod, setFormHttpMethod] = useState("GET");
  const [formTimeout, setFormTimeout] = useState("300");

  const totalJobs = jobs.length;
  const activeJobs = jobs.filter((j) => j.enabled).length;
  const totalExecutions = allRuns.length;
  const successfulRuns = allRuns.filter((r) => r.status === "success").length;
  const successRate = totalExecutions > 0 ? Math.round((successfulRuns / totalExecutions) * 100) : 100;

  function openCreateModal() {
    setSelectedJob(null);
    setFormName("");
    setFormProject("");
    setFormCron("0 0 * * *");
    setFormType("command");
    setFormCommand("");
    setFormTargetContainer("");
    setFormHttpUrl("");
    setFormHttpMethod("GET");
    setFormTimeout("300");
    setCreateOpen(true);
  }

  async function handleSaveJob() {
    if (!formName.trim()) {
      toast.error("Job name is required");
      return;
    }
    if (!formCron.trim()) {
      toast.error("Cron expression is required");
      return;
    }

    try {
      if (selectedJob) {
        await eng.call("PATCH", `/api/jobs/${selectedJob.id}`, {
          name: formName,
          project_name: formProject || null,
          cron_expression: formCron,
          job_type: formType,
          command: formCommand,
          target_container: formTargetContainer || null,
          http_url: formHttpUrl,
          http_method: formHttpMethod,
          timeout_seconds: Number(formTimeout) || 300,
        });
        toast.success(`Job "${formName}" updated successfully`);
      } else {
        await eng.call("POST", "/api/jobs", {
          name: formName,
          project_name: formProject || null,
          cron_expression: formCron,
          job_type: formType,
          command: formCommand,
          target_container: formTargetContainer || null,
          http_url: formHttpUrl,
          http_method: formHttpMethod,
          timeout_seconds: Number(formTimeout) || 300,
        });
        toast.success(`Job "${formName}" created successfully`);
      }
      setCreateOpen(false);
      refetchJobs();
    } catch (err: any) {
      toast.error(err.message || "Failed to save job");
    }
  }

  async function handleRunNow(job: CronJob) {
    setExecutingId(job.id);
    try {
      const res: any = await eng.call("POST", `/api/jobs/${job.id}/run`);
      if (res.status === "success") {
        toast.success(`Job "${job.name}" executed successfully in ${res.duration_ms}ms`);
      } else {
        toast.error(`Job "${job.name}" execution failed: ${res.error_message || "Non-zero exit code"}`);
      }
      refetchJobs();
      refetchRuns();
    } catch (err: any) {
      toast.error(err.message || "Failed to trigger job execution");
    } finally {
      setExecutingId(null);
    }
  }

  async function handleToggleEnabled(job: CronJob, enabled: boolean) {
    try {
      await eng.call("PATCH", `/api/jobs/${job.id}`, { enabled: enabled ? 1 : 0 });
      toast.success(`Job "${job.name}" ${enabled ? "enabled" : "paused"}`);
      refetchJobs();
    } catch (err: any) {
      toast.error(err.message || "Failed to toggle job state");
    }
  }

  async function handleDeleteJob(job: CronJob) {
    if (!confirm(`Are you sure you want to delete scheduled job "${job.name}"?`)) return;
    try {
      await eng.call("DELETE", `/api/jobs/${job.id}`);
      toast.success(`Job "${job.name}" deleted`);
      refetchJobs();
      refetchRuns();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete job");
    }
  }

  const jobRuns = logSheetJob ? allRuns.filter((r) => r.job_id === logSheetJob.id) : allRuns;

  return (
    <div className="space-y-8 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/50 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs font-mono">
              <Zap className="w-3 h-3 mr-1" /> Phase 1 Parity
            </Badge>
            <span className="text-xs text-muted-foreground">CRON & Scheduled Automation</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
            Jobs & Scheduled Automation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Autonomous in-engine 5-field CRON scheduler, container execution runner, HTTP webhooks, and database backup triggers.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => { refetchJobs(); refetchRuns(); }}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm" onClick={openCreateModal}>
            <Plus className="w-4 h-4 mr-2" />
            Create Scheduled Job
          </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Schedules</span>
            <Clock className="w-4 h-4 text-primary" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono">{activeJobs}</span>
            <span className="text-xs text-muted-foreground">/ {totalJobs} total</span>
          </div>
        </div>

        <div className="rounded-xl border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Executions</span>
            <Play className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono">{totalExecutions}</span>
            <span className="text-xs text-muted-foreground">runs recorded</span>
          </div>
        </div>

        <div className="rounded-xl border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Success Rate</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-emerald-400">{successRate}%</span>
            <span className="text-xs text-muted-foreground">reliability</span>
          </div>
        </div>

        <div className="rounded-xl border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Engine Protocol</span>
            <Calendar className="w-4 h-4 text-sky-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-base font-bold font-mono text-sky-400">5-Field CRON</span>
            <span className="text-xs text-muted-foreground">Zero Dependency</span>
          </div>
        </div>
      </div>

      {/* Jobs Table Section */}
      <div className="rounded-xl border bg-card/50 overflow-hidden shadow-sm backdrop-blur-sm">
        <div className="p-4 border-b border-border/50 flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">Configured Cron Schedules</h2>
            <Badge variant="secondary" className="text-xs font-mono">{jobs.length}</Badge>
          </div>
        </div>

        {jobs.length === 0 ? (
          <div className="text-center py-16 px-4">
            <Clock className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <h3 className="font-semibold text-base">No Scheduled Jobs Configured</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1 mb-5">
              Create your first scheduled task to run periodic database maintenance, container scripts, or HTTP webhook triggers.
            </p>
            <Button onClick={openCreateModal} size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Create First Job
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/10 text-xs text-muted-foreground font-medium">
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Job Name & Schedule</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Target / Command</th>
                  <th className="py-3 px-4">Last Run</th>
                  <th className="py-3 px-4">Next Run</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-4">
                      <Switch
                        checked={Boolean(job.enabled)}
                        onCheckedChange={(val) => handleToggleEnabled(job, val)}
                      />
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-foreground">{job.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground">
                          {job.cron_expression}
                        </code>
                        <span className="text-xs text-muted-foreground">({humanizeCron(job.cron_expression)})</span>
                      </div>
                      {job.project_name && (
                        <Badge variant="outline" className="mt-1 text-[10px] py-0 px-1.5 font-normal">
                          {job.project_name}
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {job.job_type === "command" && (
                        <Badge variant="outline" className="bg-sky-500/10 text-sky-400 border-sky-500/20 text-xs">
                          <Terminal className="w-3 h-3 mr-1" /> Exec
                        </Badge>
                      )}
                      {job.job_type === "http" && (
                        <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-xs">
                          <Globe className="w-3 h-3 mr-1" /> HTTP
                        </Badge>
                      )}
                      {job.job_type === "backup" && (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">
                          <Database className="w-3 h-3 mr-1" /> Backup
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="max-w-xs truncate font-mono text-xs text-muted-foreground" title={job.command || job.http_url || "Automated DB Snapshot"}>
                        {job.command || job.http_url || "Automated Snapshot"}
                      </div>
                      {job.target_container && (
                        <span className="text-[10px] text-muted-foreground/70">Container: {job.target_container}</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {job.last_status ? (
                        <div className="flex items-center gap-1.5">
                          {job.last_status === "success" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                          {job.last_status === "failed" && <XCircle className="w-3.5 h-3.5 text-rose-400" />}
                          {job.last_status === "running" && <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin" />}
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(job.last_run_at)} {job.last_duration_ms ? `(${job.last_duration_ms}ms)` : ""}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">Never run</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-xs font-mono text-muted-foreground">
                        {formatRelativeTime(job.next_run_at)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs hover:text-emerald-400"
                          disabled={executingId === job.id}
                          onClick={() => handleRunNow(job)}
                          title="Run Job Now"
                        >
                          <Play className={`w-3.5 h-3.5 mr-1 ${executingId === job.id ? "animate-spin" : ""}`} />
                          Run
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => setLogSheetJob(job)}
                          title="View Execution Logs"
                        >
                          <Terminal className="w-3.5 h-3.5 mr-1" />
                          Logs
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteJob(job)}
                          title="Delete Job"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Execution History Table */}
      <div className="rounded-xl border bg-card/50 overflow-hidden shadow-sm backdrop-blur-sm">
        <div className="p-4 border-b border-border/50 flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">Recent Execution Runs</h2>
            <Badge variant="secondary" className="text-xs font-mono">{allRuns.length}</Badge>
          </div>
        </div>

        {allRuns.length === 0 ? (
          <div className="text-center py-10 px-4 text-sm text-muted-foreground">
            No execution history records available yet.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-background/95 backdrop-blur border-b border-border/50 text-muted-foreground font-medium">
                <tr>
                  <th className="py-2.5 px-4">Run ID</th>
                  <th className="py-2.5 px-4">Job Name</th>
                  <th className="py-2.5 px-4">Trigger</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Started</th>
                  <th className="py-2.5 px-4">Duration</th>
                  <th className="py-2.5 px-4">Exit Code</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20 font-mono">
                {allRuns.slice(0, 25).map((run) => (
                  <tr key={run.id} className="hover:bg-muted/20">
                    <td className="py-2 px-4 text-muted-foreground">{run.id}</td>
                    <td className="py-2 px-4 font-sans font-medium text-foreground">{run.job_name}</td>
                    <td className="py-2 px-4">
                      <span className="text-muted-foreground capitalize">{run.trigger_type}</span>
                    </td>
                    <td className="py-2 px-4">
                      {run.status === "success" && (
                        <span className="text-emerald-400 flex items-center gap-1 font-sans">
                          <CheckCircle2 className="w-3 h-3" /> success
                        </span>
                      )}
                      {run.status === "failed" && (
                        <span className="text-rose-400 flex items-center gap-1 font-sans">
                          <XCircle className="w-3 h-3" /> failed
                        </span>
                      )}
                      {run.status === "running" && (
                        <span className="text-sky-400 flex items-center gap-1 font-sans">
                          <RefreshCw className="w-3 h-3 animate-spin" /> running
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-muted-foreground">{formatRelativeTime(run.started_at)}</td>
                    <td className="py-2 px-4 text-muted-foreground">{run.duration_ms !== null ? `${run.duration_ms}ms` : "-"}</td>
                    <td className="py-2 px-4 text-muted-foreground">{run.exit_code ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Job Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{selectedJob ? "Edit Scheduled Job" : "Create Scheduled Job"}</DialogTitle>
            <DialogDescription>
              Configure autonomous periodic execution schedules inside containers or via HTTP webhooks.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label>Job Name</Label>
                <Input
                  placeholder="e.g. Daily DB Backup / Cache Flush"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label>Associated Project (Optional)</Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  value={formProject}
                  onChange={(e) => setFormProject(e.target.value)}
                >
                  <option value="">None / Host Level</option>
                  {projects.map((p: any) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Schedule Presets */}
            <div className="space-y-1.5">
              <Label>CRON Expression</Label>
              <div className="flex gap-2">
                <Input
                  className="font-mono"
                  placeholder="0 0 * * *"
                  value={formCron}
                  onChange={(e) => setFormCron(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {CRON_PRESETS.slice(0, 6).map((preset) => (
                  <Button
                    key={preset.expr}
                    type="button"
                    variant={formCron === preset.expr ? "default" : "outline"}
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={() => setFormCron(preset.expr)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Job Type Selector */}
            <div className="space-y-1.5">
              <Label>Job Execution Type</Label>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant={formType === "command" ? "default" : "outline"}
                  size="sm"
                  className="text-xs"
                  onClick={() => setFormType("command")}
                >
                  <Terminal className="w-3.5 h-3.5 mr-1.5" /> Shell Command
                </Button>
                <Button
                  type="button"
                  variant={formType === "http" ? "default" : "outline"}
                  size="sm"
                  className="text-xs"
                  onClick={() => setFormType("http")}
                >
                  <Globe className="w-3.5 h-3.5 mr-1.5" /> HTTP Webhook
                </Button>
                <Button
                  type="button"
                  variant={formType === "backup" ? "default" : "outline"}
                  size="sm"
                  className="text-xs"
                  onClick={() => setFormType("backup")}
                >
                  <Database className="w-3.5 h-3.5 mr-1.5" /> Auto Backup
                </Button>
              </div>
            </div>

            {/* Conditional Type Config */}
            {formType === "command" && (
              <div className="space-y-3 p-3 rounded-lg border bg-muted/20">
                <div className="space-y-1.5">
                  <Label className="text-xs">Shell Command</Label>
                  <Input
                    className="font-mono text-xs"
                    placeholder="e.g. npm run cleanup && rm -rf /tmp/cache"
                    value={formCommand}
                    onChange={(e) => setFormCommand(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Target Container Name (Optional)</Label>
                  <Input
                    className="font-mono text-xs"
                    placeholder="e.g. hx_postgres / hx_redis (leave empty for host)"
                    value={formTargetContainer}
                    onChange={(e) => setFormTargetContainer(e.target.value)}
                  />
                </div>
              </div>
            )}

            {formType === "http" && (
              <div className="space-y-3 p-3 rounded-lg border bg-muted/20">
                <div className="grid grid-cols-4 gap-2">
                  <div className="col-span-1 space-y-1.5">
                    <Label className="text-xs">Method</Label>
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
                      value={formHttpMethod}
                      onChange={(e) => setFormHttpMethod(e.target.value)}
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="DELETE">DELETE</option>
                    </select>
                  </div>
                  <div className="col-span-3 space-y-1.5">
                    <Label className="text-xs">Webhook URL</Label>
                    <Input
                      className="font-mono text-xs"
                      placeholder="https://api.domain.com/v1/cron-trigger"
                      value={formHttpUrl}
                      onChange={(e) => setFormHttpUrl(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {formType === "backup" && (
              <div className="p-3 rounded-lg border bg-muted/20 text-xs text-muted-foreground">
                <p>
                  Automatically triggers a point-in-time database snapshot for the associated project on schedule.
                  Snapshots are verified with SHA-256 and will automatically stream to configured S3/R2 storage.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Timeout (Seconds)</Label>
              <Input
                type="number"
                value={formTimeout}
                onChange={(e) => setFormTimeout(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveJob}>Save Schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log Inspector Sheet */}
      <Sheet open={!!logSheetJob} onOpenChange={(open) => !open && setLogSheetJob(null)}>
        <SheetContent className="sm:max-w-2xl w-full overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-border/50">
            <SheetTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-primary" />
              Execution Logs: {logSheetJob?.name}
            </SheetTitle>
            <SheetDescription>
              Review output streams, stdout, stderr, and exit codes for this scheduled job.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {jobRuns.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No runs recorded for this job yet. Click "Run" to test execution.
              </div>
            ) : (
              jobRuns.map((run) => (
                <div key={run.id} className="rounded-lg border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs border-b border-border/30 pb-2">
                    <div className="flex items-center gap-2">
                      {run.status === "success" && <Badge className="bg-emerald-500/10 text-emerald-400">Success</Badge>}
                      {run.status === "failed" && <Badge variant="destructive">Failed</Badge>}
                      {run.status === "running" && <Badge className="bg-sky-500/10 text-sky-400">Running</Badge>}
                      <span className="font-mono text-muted-foreground">{run.id}</span>
                    </div>
                    <span className="text-muted-foreground">{new Date(run.started_at).toLocaleString()}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs font-mono bg-muted/20 p-2 rounded">
                    <div>Duration: <span className="text-foreground">{run.duration_ms}ms</span></div>
                    <div>Exit Code: <span className="text-foreground">{run.exit_code ?? 0}</span></div>
                    <div>Trigger: <span className="text-foreground capitalize">{run.trigger_type}</span></div>
                  </div>

                  {run.stdout && (
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium text-muted-foreground">Standard Output:</span>
                      <pre className="p-2.5 rounded bg-muted/40 text-emerald-400 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap max-h-40">
                        {run.stdout}
                      </pre>
                    </div>
                  )}

                  {run.stderr && (
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium text-rose-400">Standard Error:</span>
                      <pre className="p-2.5 rounded bg-rose-950/20 border border-rose-900/30 text-rose-400 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap max-h-40">
                        {run.stderr}
                      </pre>
                    </div>
                  )}

                  {run.error_message && (
                    <div className="text-xs text-rose-400 bg-rose-950/30 p-2 rounded">
                      Error: {run.error_message}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
