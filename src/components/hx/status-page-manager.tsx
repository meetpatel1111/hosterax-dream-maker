import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Activity,
  Globe,
  Radio,
  RefreshCw,
  ExternalLink,
  Layers,
  FileText,
  Copy,
  Plus,
  Server,
  Code,
  Lock,
  Trash2,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { useEngine, useEngineProjects, useActiveOrgId } from "../../lib/engine";
import { confirmAction } from "./confirm-modal";
import {
  generatePostMortemMarkdown,
  generateStatusBadgeMarkdown,
  type MonitoredComponent,
  type ServiceStatus,
  type Incident,
  type IncidentStage,
  type IncidentSeverity,
} from "../../utils/status-page";

type BackendStatusSettings = {
  id: string;
  title: string;
  custom_domain: string;
  public_enabled: number;
  subscribe_enabled: number;
  updated_at?: number;
};

type BackendStatusComponent = {
  id: string;
  name: string;
  description: string;
  group_name: string;
  target_url: string;
  project_name: string;
  status: string;
  latency_ms: number;
  uptime_pct: number;
  last_checked_at?: number | null;
  created_at: number;
};

type BackendStatusIncident = {
  id: string;
  title: string;
  status: string;
  impact: string;
  message: string;
  componentIds: string[];
  created_at: number;
  updated_at: number;
  resolved_at?: number | null;
};

type BackendStatusPage = {
  settings: BackendStatusSettings;
  components: BackendStatusComponent[];
  incidents: BackendStatusIncident[];
};

function mapComponentStatus(s: string): ServiceStatus {
  switch (s) {
    case "degraded_performance":
    case "degraded":
      return "degraded_performance";
    case "partial_outage":
      return "partial_outage";
    case "major_outage":
    case "outage":
      return "major_outage";
    case "under_maintenance":
    case "maintenance":
      return "under_maintenance";
    default:
      return "operational";
  }
}

function mapComponentGroup(g?: string): MonitoredComponent["group"] {
  if (
    g === "Edge & Ingress" ||
    g === "Core Microservices" ||
    g === "Storage & Databases" ||
    g === "Third-Party & APIs"
  ) {
    return g;
  }
  return "Core Microservices";
}

export function StatusPageManager() {
  const engine = useEngine();
  const orgId = useActiveOrgId();
  const qc = useQueryClient();
  const { data: projects = [] } = useEngineProjects();

  const { data: statusData, isLoading } = useQuery<BackendStatusPage>({
    queryKey: ["status-page", engine.url, engine.token, orgId],
    queryFn: () => engine.call<BackendStatusPage>("GET", "/api/status-page"),
    refetchInterval: 15000,
  });

  const componentsRaw = statusData?.components || [];
  const incidentsRaw = statusData?.incidents || [];
  const settingsRaw = statusData?.settings;

  const components: MonitoredComponent[] = useMemo(
    () =>
      componentsRaw.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description || c.target_url || c.project_name || "HTTP Probe",
        group: mapComponentGroup(c.group_name),
        status: mapComponentStatus(c.status),
        probe: {
          id: c.id,
          name: c.name,
          target: c.target_url || c.project_name || "",
          type: "http",
          intervalSeconds: 30,
          timeoutMs: 3000,
          expectedStatus: 200,
          enabled: true,
        },
        uptime90d: Number(c.uptime_pct ?? 100),
        recentResults: c.last_checked_at
          ? [
              {
                timestamp: c.last_checked_at,
                latencyMs: Number(c.latency_ms ?? 0),
                success: mapComponentStatus(c.status) === "operational",
              },
            ]
          : [],
      })),
    [componentsRaw],
  );

  const incidents: Incident[] = useMemo(
    () =>
      incidentsRaw.map((i) => ({
        id: i.id,
        title: i.title,
        severity: (i.impact as IncidentSeverity) || "minor",
        affectedComponentIds: i.componentIds || [],
        stage: (i.status as IncidentStage) || "investigating",
        createdAt: i.created_at,
        resolvedAt: i.resolved_at ?? undefined,
        updates: [
          {
            id: `${i.id}-latest`,
            timestamp: i.updated_at || i.created_at,
            stage: (i.status as IncidentStage) || "investigating",
            message: i.message || "Incident logged on status feed.",
          },
        ],
      })),
    [incidentsRaw],
  );

  const [titleInput, setTitleInput] = useState("HosteraX Cloud Status");
  const [domainInput, setDomainInput] = useState("");
  const [publicEnabledInput, setPublicEnabledInput] = useState(true);
  const [probingAll, setProbingAll] = useState(false);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [showPublicPreview, setShowPublicPreview] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAddComponentModal, setShowAddComponentModal] = useState(false);
  const [showNewIncidentModal, setShowNewIncidentModal] = useState(false);
  const [showEmbedModal, setShowEmbedModal] = useState(false);
  const [selectedIncidentForRCA, setSelectedIncidentForRCA] = useState<Incident | null>(null);

  // Add component form
  const [compName, setCompName] = useState("");
  const [compDesc, setCompDesc] = useState("");
  const [compGroup, setCompGroup] = useState("Core Infrastructure");
  const [compTargetUrl, setCompTargetUrl] = useState("");
  const [compProjectName, setCompProjectName] = useState("");

  // New incident form state
  const [newIncidentTitle, setNewIncidentTitle] = useState("");
  const [newIncidentSeverity, setNewIncidentSeverity] = useState<IncidentSeverity>("minor");
  const [newIncidentComponentId, setNewIncidentComponentId] = useState("");
  const [newIncidentMessage, setNewIncidentMessage] = useState("");

  useEffect(() => {
    if (settingsRaw) {
      setTitleInput(settingsRaw.title || "HosteraX Cloud Status");
      setDomainInput(settingsRaw.custom_domain || "");
      setPublicEnabledInput(Boolean(settingsRaw.public_enabled));
    }
  }, [settingsRaw]);

  const overallStatus: ServiceStatus = useMemo(() => {
    if (components.some((c) => c.status === "major_outage")) return "major_outage";
    if (components.some((c) => c.status === "partial_outage")) return "partial_outage";
    if (components.some((c) => c.status === "degraded_performance")) return "degraded_performance";
    return "operational";
  }, [components]);

  const avgLatencyMs = useMemo(() => {
    const measured = componentsRaw.filter((c) => c.last_checked_at && c.latency_ms > 0);
    if (measured.length === 0) return null;
    return Math.round(measured.reduce((a, b) => a + b.latency_ms, 0) / measured.length);
  }, [componentsRaw]);

  const avgUptimePct = useMemo(() => {
    if (componentsRaw.length === 0) return null;
    const sum = componentsRaw.reduce((a, c) => a + Number(c.uptime_pct ?? 100), 0);
    return Number((sum / componentsRaw.length).toFixed(2));
  }, [componentsRaw]);

  const handlePingComponent = async (comp: BackendStatusComponent) => {
    setProbingId(comp.id);
    try {
      const res: any = await engine.call(
        "POST",
        `/api/status-page/probe/${encodeURIComponent(comp.id)}`,
        {},
      );
      await qc.invalidateQueries({ queryKey: ["status-page"] });
      toast.success(
        `Probe "${comp.name}": ${res.status || "checked"} (${res.latencyMs ?? 0}ms)`,
      );
    } finally {
      setProbingId(null);
    }
  };

  const handleRunAllProbes = async () => {
    setProbingAll(true);
    try {
      const res = await engine.call<{ ok: boolean; probedCount: number }>(
        "POST",
        "/api/status-page/probe-all",
        {},
      );
      await qc.invalidateQueries({ queryKey: ["status-page"] });
      toast.success(`Executed ${res.probedCount} synthetic HTTP/TCP probe(s)`);
    } finally {
      setProbingAll(false);
    }
  };

  const handleUpdateComponentStatus = async (id: string, newStatus: ServiceStatus) => {
    await engine.call("PATCH", `/api/status-page/components/${encodeURIComponent(id)}`, {
      status: newStatus,
    });
    await qc.invalidateQueries({ queryKey: ["status-page"] });
    toast.success(`Updated component status to ${newStatus.replace("_", " ")}`);
  };

  const handleCreateComponent = async () => {
    if (!compName.trim()) return toast.error("Component name is required");
    await engine.call("POST", "/api/status-page/components", {
      name: compName.trim(),
      description: compDesc.trim(),
      groupName: compGroup.trim() || "Core Infrastructure",
      targetUrl: compTargetUrl.trim(),
      projectName: compProjectName.trim(),
    });
    await qc.invalidateQueries({ queryKey: ["status-page"] });
    setShowAddComponentModal(false);
    setCompName("");
    setCompDesc("");
    setCompTargetUrl("");
    setCompProjectName("");
    toast.success("Status component added and probed");
  };

  const handleImportProjectProbes = async () => {
    const existingProjects = new Set(componentsRaw.map((c) => c.project_name).filter(Boolean));
    const missing = projects.filter((p: any) => !existingProjects.has(p.name));
    if (missing.length === 0) {
      toast.info("All active projects are already monitored");
      return;
    }
    for (const p of missing) {
      await engine.call("POST", "/api/status-page/components", {
        name: `App: ${p.name}`,
        description: p.domain ? `Domain: ${p.domain}` : `Project ${p.name}`,
        groupName: "Applications",
        projectName: p.name,
        targetUrl: p.domain ? `https://${p.domain}` : "",
      });
    }
    await qc.invalidateQueries({ queryKey: ["status-page"] });
    toast.success(`Added ${missing.length} project probe(s)`);
  };

  const handleDeleteComponent = async (comp: BackendStatusComponent) => {
    const ok = await confirmAction({
      title: `Remove Component "${comp.name}"`,
      description: "Delete this component and stop monitoring it on the status page?",
      variant: "destructive",
      confirmLabel: "Remove Component",
    });
    if (!ok) return;
    await engine.call("DELETE", `/api/status-page/components/${encodeURIComponent(comp.id)}`);
    await qc.invalidateQueries({ queryKey: ["status-page"] });
    toast.success(`Removed "${comp.name}"`);
  };

  const handleSaveSettings = async () => {
    await engine.call("PUT", "/api/status-page", {
      title: titleInput.trim() || "HosteraX Cloud Status",
      customDomain: domainInput.trim(),
      publicEnabled: publicEnabledInput,
    });
    await qc.invalidateQueries({ queryKey: ["status-page"] });
    setShowSettingsModal(false);
    toast.success("Status page settings saved");
  };

  const handleCreateIncident = async () => {
    if (!newIncidentTitle.trim()) return toast.error("Please enter an incident title");
    await engine.call("POST", "/api/status-page/incidents", {
      title: newIncidentTitle.trim(),
      impact: newIncidentSeverity,
      status: "investigating",
      message:
        newIncidentMessage.trim() ||
        "Engineering team is investigating degraded service telemetry.",
      componentIds: newIncidentComponentId ? [newIncidentComponentId] : [],
    });
    await qc.invalidateQueries({ queryKey: ["status-page"] });
    setShowNewIncidentModal(false);
    setNewIncidentTitle("");
    setNewIncidentMessage("");
    toast.success("Incident published to status feed");
  };

  const handleAdvanceIncidentStage = async (incident: Incident, nextStage: IncidentStage) => {
    const msg =
      nextStage === "identified"
        ? "Root cause identified and mitigation is underway."
        : nextStage === "monitoring"
          ? "Mitigation applied; monitoring recovery telemetry."
          : "Incident resolved and services restored.";
    await engine.call("PATCH", `/api/status-page/incidents/${encodeURIComponent(incident.id)}`, {
      status: nextStage,
      message: msg,
    });
    await qc.invalidateQueries({ queryKey: ["status-page"] });
    toast.success(`Incident marked as ${nextStage}`);
  };

  const handleDeleteIncident = async (incident: Incident) => {
    const ok = await confirmAction({
      title: `Delete Incident "${incident.title}"`,
      description: "Permanently remove this incident record from the status page?",
      variant: "destructive",
      confirmLabel: "Delete Incident",
    });
    if (!ok) return;
    await engine.call("DELETE", `/api/status-page/incidents/${encodeURIComponent(incident.id)}`);
    await qc.invalidateQueries({ queryKey: ["status-page"] });
    toast.success("Incident deleted");
  };

  const getStatusBadge = (status: ServiceStatus) => {
    switch (status) {
      case "operational":
        return {
          label: "Operational",
          bg: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
          dot: "bg-emerald-400",
          icon: CheckCircle2,
        };
      case "degraded_performance":
        return {
          label: "Degraded",
          bg: "bg-amber-500/10 border-amber-500/20 text-amber-400",
          dot: "bg-amber-400",
          icon: AlertTriangle,
        };
      case "partial_outage":
        return {
          label: "Partial Outage",
          bg: "bg-orange-500/10 border-orange-500/20 text-orange-400",
          dot: "bg-orange-400",
          icon: AlertTriangle,
        };
      case "major_outage":
        return {
          label: "Major Outage",
          bg: "bg-rose-500/10 border-rose-500/20 text-rose-400",
          dot: "bg-rose-400",
          icon: XCircle,
        };
      case "under_maintenance":
        return {
          label: "Maintenance",
          bg: "bg-blue-500/10 border-blue-500/20 text-blue-400",
          dot: "bg-blue-400",
          icon: Clock,
        };
    }
  };

  const currentBadge = getStatusBadge(overallStatus);
  const displayDomain = settingsRaw?.custom_domain || "status.hosterax.internal";

  return (
    <div className="space-y-6" data-testid="status-page-manager">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
              <Radio className="h-6 w-6 text-primary" />
              {settingsRaw?.title || "Synthetic Probes & Status Page"}
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 border border-primary/20 text-primary">
              <Globe className="h-3 w-3" />
              {settingsRaw?.public_enabled ? "Public Feed Active" : "Private"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Server-executed HTTP/TCP probes, real response latency telemetry, and persisted incident
            post-mortems.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-card border border-border text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
          >
            <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
            Page Settings
          </button>

          <button
            type="button"
            data-testid="btn-probe-all"
            onClick={handleRunAllProbes}
            disabled={probingAll || componentsRaw.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-card border border-border text-foreground hover:bg-muted/70 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${probingAll ? "animate-spin" : ""}`} />
            Run All Probes
          </button>

          <button
            type="button"
            onClick={() => setShowEmbedModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-card border border-border text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
          >
            <Code className="h-3.5 w-3.5 text-muted-foreground" />
            Badges &amp; API
          </button>

          <button
            type="button"
            onClick={() => setShowPublicPreview(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-card border border-border text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
          >
            <ExternalLink className="h-3.5 w-3.5 text-primary" />
            Public View
          </button>

          <button
            type="button"
            data-testid="btn-add-status-component"
            onClick={() => setShowAddComponentModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Component / Probe
          </button>

          <button
            type="button"
            data-testid="btn-new-incident"
            onClick={() => setShowNewIncidentModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            New Incident
          </button>
        </div>
      </div>

      <div
        className={`rounded-xl border p-5 transition-all ${
          overallStatus === "operational"
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
            : overallStatus === "major_outage"
              ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
              : "bg-amber-500/10 border-amber-500/20 text-amber-400"
        }`}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 rounded-lg bg-background/50 border border-current/20">
              <currentBadge.icon className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold">
                {overallStatus === "operational"
                  ? "All Monitored Systems Operational"
                  : overallStatus === "major_outage"
                    ? "Critical Outage Detected"
                    : "Partial Service Degradation"}
              </h2>
              <p className="text-xs opacity-90 mt-0.5">
                {componentsRaw.length === 0
                  ? "Add a component or import deployed projects to begin probing."
                  : `Monitoring ${componentsRaw.length} persisted endpoint(s) and service component(s).`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="text-right">
              <div className="text-muted-foreground uppercase text-[10px] tracking-wider font-semibold">
                Measured Uptime
              </div>
              <div className="text-base font-bold text-foreground">
                {avgUptimePct !== null ? `${avgUptimePct}%` : "N/A"}
              </div>
            </div>
            <div className="h-7 w-px bg-border/40" />
            <div className="text-right">
              <div className="text-muted-foreground uppercase text-[10px] tracking-wider font-semibold">
                Avg Latency
              </div>
              <div className="text-base font-bold text-foreground">
                {avgLatencyMs !== null ? `${avgLatencyMs}ms` : "Unprobed"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border/40 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Monitored Services &amp; Synthetic Probes
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Engine-executed HTTP checks and component statuses persisted in SQLite.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {projects.length > 0 && (
              <button
                type="button"
                onClick={handleImportProjectProbes}
                className="text-xs px-2.5 py-1 rounded border border-border bg-muted/40 hover:bg-muted text-foreground cursor-pointer"
              >
                Import Deployed Projects
              </button>
            )}
            <span className="text-xs font-mono text-muted-foreground">
              {components.filter((c) => c.status === "operational").length} / {components.length}{" "}
              Operational
            </span>
          </div>
        </div>

        <div className="divide-y divide-border/40">
          {isLoading ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Loading status page components...
            </div>
          ) : componentsRaw.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Server className="h-6 w-6" />
              </div>
              <h4 className="text-sm font-semibold text-foreground">
                No Monitored Components Registered
              </h4>
              <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                Add an HTTP target URL or link an active HosteraX project to start real synthetic
                monitoring.
              </p>
              <button
                type="button"
                onClick={() => setShowAddComponentModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                <Plus className="h-3.5 w-3.5" /> Add Component / Probe
              </button>
            </div>
          ) : (
            componentsRaw.map((comp) => {
              const mappedStatus = mapComponentStatus(comp.status);
              const badge = getStatusBadge(mappedStatus);

              return (
                <div key={comp.id} className="p-5 hover:bg-muted/10 transition-colors">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1 max-w-xl">
                      <div className="flex items-center flex-wrap gap-2.5">
                        <span className="font-semibold text-sm text-foreground">{comp.name}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted border border-border/60 text-muted-foreground">
                          {comp.group_name}
                        </span>
                        {comp.project_name && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
                            project:{comp.project_name}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {comp.description || comp.target_url || "Custom service check"}
                      </p>
                      {comp.target_url && (
                        <div className="text-[11px] font-mono text-primary/80">
                          Target: {comp.target_url}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center flex-wrap gap-3 self-end lg:self-center">
                      <div className="text-right">
                        <div className="text-[10px] uppercase font-mono text-muted-foreground">
                          Latency / Uptime
                        </div>
                        <div className="text-xs font-mono font-bold text-foreground">
                          {comp.last_checked_at ? `${comp.latency_ms}ms` : "Pending"} ·{" "}
                          {Number(comp.uptime_pct ?? 100).toFixed(2)}%
                        </div>
                      </div>

                      <div
                        className={`px-2.5 py-1 rounded-md text-xs font-medium border flex items-center gap-1.5 ${badge.bg}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                        {badge.label}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={probingId === comp.id}
                          onClick={() => handlePingComponent(comp)}
                          title="Run server-side HTTP probe"
                          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${probingId === comp.id ? "animate-spin" : ""}`}
                          />
                        </button>

                        <select
                          value={mappedStatus}
                          onChange={(e) =>
                            handleUpdateComponentStatus(comp.id, e.target.value as ServiceStatus)
                          }
                          className="text-[11px] bg-background border border-border rounded-md px-2 py-1 text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          <option value="operational">Operational</option>
                          <option value="degraded_performance">Degraded</option>
                          <option value="partial_outage">Partial Outage</option>
                          <option value="major_outage">Major Outage</option>
                          <option value="under_maintenance">Maintenance</option>
                        </select>

                        <button
                          type="button"
                          onClick={() => handleDeleteComponent(comp)}
                          title="Remove component"
                          className="p-1.5 rounded-md text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Incidents &amp; Post-Mortem Feed
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Persisted lifecycle: Investigating → Identified → Monitoring → Resolved.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {incidents.filter((i) => i.stage !== "resolved").length} active incidents
          </span>
        </div>

        <div className="divide-y divide-border/40">
          {incidents.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No incidents recorded. Systems operating cleanly.
            </div>
          ) : (
            incidents.map((incident) => {
              const isResolved = incident.stage === "resolved";
              return (
                <div key={incident.id} className="p-5 space-y-3 hover:bg-muted/5 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                          incident.severity === "critical"
                            ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
                            : incident.severity === "major"
                              ? "bg-orange-500/10 border-orange-500/20 text-orange-400"
                              : incident.severity === "maintenance"
                                ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                                : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                        }`}
                      >
                        {incident.severity}
                      </span>
                      <h4 className="font-semibold text-sm text-foreground">{incident.title}</h4>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                          isResolved
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        }`}
                      >
                        {incident.stage.toUpperCase()}
                      </span>

                      <button
                        type="button"
                        onClick={() => setSelectedIncidentForRCA(incident)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded bg-muted/60 hover:bg-muted text-foreground transition-colors cursor-pointer border border-border/40"
                      >
                        <FileText className="h-3 w-3 text-primary" />
                        RCA
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteIncident(incident)}
                        className="p-1 rounded text-muted-foreground hover:text-rose-400"
                        title="Delete incident"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-foreground/90 pl-3 border-l-2 border-border/60">
                    {incident.updates[0]?.message}
                  </p>

                  {!isResolved && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[11px] text-muted-foreground">Advance:</span>
                      {incident.stage === "investigating" && (
                        <button
                          type="button"
                          onClick={() => handleAdvanceIncidentStage(incident, "identified")}
                          className="px-2.5 py-1 text-xs rounded bg-muted hover:bg-muted/80 text-foreground cursor-pointer"
                        >
                          Identified
                        </button>
                      )}
                      {(incident.stage === "investigating" || incident.stage === "identified") && (
                        <button
                          type="button"
                          onClick={() => handleAdvanceIncidentStage(incident, "monitoring")}
                          className="px-2.5 py-1 text-xs rounded bg-muted hover:bg-muted/80 text-foreground cursor-pointer"
                        >
                          Monitoring
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleAdvanceIncidentStage(incident, "resolved")}
                        className="px-2.5 py-1 text-xs rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 cursor-pointer font-medium"
                      >
                        Resolve Incident
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {showAddComponentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="font-bold text-foreground text-base">
                Add Status Component &amp; HTTP Probe
              </h3>
              <button
                type="button"
                onClick={() => setShowAddComponentModal(false)}
                className="p-1 text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium mb-1">Component Name *</label>
                <input
                  value={compName}
                  onChange={(e) => setCompName(e.target.value)}
                  placeholder="e.g. Public API Gateway"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Group Name</label>
                  <input
                    value={compGroup}
                    onChange={(e) => setCompGroup(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Linked Project (optional)</label>
                  <select
                    value={compProjectName}
                    onChange={(e) => setCompProjectName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border"
                  >
                    <option value="">None (external URL)</option>
                    {projects.map((p: any) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-medium mb-1">Target Probe URL</label>
                <input
                  value={compTargetUrl}
                  onChange={(e) => setCompTargetUrl(e.target.value)}
                  placeholder="http://127.0.0.1:7777/health"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border font-mono"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Description</label>
                <input
                  value={compDesc}
                  onChange={(e) => setCompDesc(e.target.value)}
                  placeholder="Primary edge ingress health endpoint"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-border/40">
              <button
                type="button"
                onClick={() => setShowAddComponentModal(false)}
                className="px-3.5 py-2 text-xs text-muted-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="btn-save-status-component"
                onClick={handleCreateComponent}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground"
              >
                Add &amp; Probe
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="font-bold text-foreground text-base">Status Page Settings</h3>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="p-1 text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium mb-1">Page Title</label>
                <input
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Custom Domain</label>
                <input
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  placeholder="status.example.com"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border font-mono"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={publicEnabledInput}
                  onChange={(e) => setPublicEnabledInput(e.target.checked)}
                />
                <span>Expose unauthenticated public feed at /api/public/status</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-border/40">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-3 py-2 text-xs text-muted-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {showPublicPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-border/40 pb-4">
              <div>
                <h3 className="font-bold text-foreground text-base">
                  {settingsRaw?.title || "HosteraX Cloud Status"}
                </h3>
                <p className="text-xs text-muted-foreground">Public endpoint: /api/public/status</p>
              </div>
              <button
                type="button"
                onClick={() => setShowPublicPreview(false)}
                className="p-1 text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 bg-background p-5 rounded-lg border border-border/40">
              {components.map((c) => {
                const b = getStatusBadge(c.status);
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between p-3 rounded-md bg-card border border-border/40 text-xs"
                  >
                    <span className="font-medium text-foreground">{c.name}</span>
                    <div
                      className={`px-2 py-0.5 rounded text-[11px] font-medium border flex items-center gap-1.5 ${b.bg}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${b.dot}`} />
                      {b.label}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5 text-primary" />
                <span>Served publicly at {engine.url}/api/public/status</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(`${engine.url}/api/public/status`);
                  toast.success("Public status API URL copied!");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-primary text-primary-foreground"
              >
                <Copy className="h-3 w-3" /> Copy Feed URL
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewIncidentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                Broadcast New Incident Update
              </h3>
              <button
                type="button"
                onClick={() => setShowNewIncidentModal(false)}
                className="p-1 text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block text-foreground font-medium mb-1">Incident Headline *</label>
                <input
                  type="text"
                  value={newIncidentTitle}
                  onChange={(e) => setNewIncidentTitle(e.target.value)}
                  placeholder="e.g. Edge Ingress Gateway Latency Spikes"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-foreground font-medium mb-1">Severity Level</label>
                  <select
                    value={newIncidentSeverity}
                    onChange={(e) => setNewIncidentSeverity(e.target.value as IncidentSeverity)}
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground text-xs"
                  >
                    <option value="minor">Minor Degradation</option>
                    <option value="major">Major Outage</option>
                    <option value="critical">Critical Downtime</option>
                    <option value="maintenance">Scheduled Maintenance</option>
                  </select>
                </div>

                <div>
                  <label className="block text-foreground font-medium mb-1">
                    Affected Component
                  </label>
                  <select
                    value={newIncidentComponentId}
                    onChange={(e) => setNewIncidentComponentId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground text-xs"
                  >
                    <option value="">Platform-wide</option>
                    {components.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-foreground font-medium mb-1">Message</label>
                <textarea
                  rows={3}
                  value={newIncidentMessage}
                  onChange={(e) => setNewIncidentMessage(e.target.value)}
                  placeholder="Describe symptoms and mitigation steps..."
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/40">
              <button
                type="button"
                onClick={() => setShowNewIncidentModal(false)}
                className="px-3.5 py-2 text-xs font-medium rounded-lg text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateIncident}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground"
              >
                Publish Incident
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedIncidentForRCA && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Root Cause Analysis (RCA) &amp; Post-Mortem
              </h3>
              <button
                type="button"
                onClick={() => setSelectedIncidentForRCA(null)}
                className="p-1 text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>
            <div className="bg-background border border-border/50 rounded-lg p-4 font-mono text-xs whitespace-pre-wrap text-foreground/90 max-h-[50vh] overflow-y-auto">
              {generatePostMortemMarkdown(selectedIncidentForRCA, components)}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(
                    generatePostMortemMarkdown(selectedIncidentForRCA, components),
                  );
                  toast.success("RCA Markdown copied!");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-primary text-primary-foreground"
              >
                <Copy className="h-3 w-3" /> Copy Markdown Report
              </button>
            </div>
          </div>
        </div>
      )}

      {showEmbedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                <Code className="h-4 w-4 text-primary" />
                Status Badges &amp; Public JSON Feed
              </h3>
              <button
                type="button"
                onClick={() => setShowEmbedModal(false)}
                className="p-1 text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-foreground font-semibold mb-1">
                  GitHub README Status Badge
                </label>
                <div className="p-2.5 rounded bg-background border border-border font-mono text-[11px] break-all select-all text-muted-foreground">
                  {generateStatusBadgeMarkdown(overallStatus, displayDomain)}
                </div>
              </div>
              <div>
                <label className="block text-foreground font-semibold mb-1">
                  Public JSON Status Feed
                </label>
                <div className="p-2.5 rounded bg-background border border-border font-mono text-[11px] break-all select-all text-muted-foreground">
                  GET {engine.url}/api/public/status
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowEmbedModal(false)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-card border border-border text-foreground"
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
