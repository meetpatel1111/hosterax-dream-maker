import { useState, useMemo } from "react";
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
  Shield,
  Layers,
  FileText,
  Copy,
  Plus,
  Server,
  Zap,
  Code,
  Share2,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_MONITORED_COMPONENTS,
  calculateOverallSystemStatus,
  calculateUptimePercentage,
  calculateAverageLatency,
  checkSslRenewalWarning,
  generate90DayTimeline,
  generatePostMortemMarkdown,
  generateStatusBadgeMarkdown,
  type MonitoredComponent,
  type ServiceStatus,
  type Incident,
  type IncidentStage,
  type IncidentSeverity,
  type StatusPageSettings,
} from "../../utils/status-page";

export function StatusPageManager() {
  const [components, setComponents] = useState<MonitoredComponent[]>(DEFAULT_MONITORED_COMPONENTS);
  const [incidents, setIncidents] = useState<Incident[]>([
    {
      id: "inc-101",
      title: "Scheduled Maintenance: Edge Gateway TLS Certificate Rotation",
      severity: "maintenance",
      affectedComponentIds: ["comp-edge"],
      stage: "resolved",
      createdAt: Date.now() - 172800000,
      resolvedAt: Date.now() - 169200000,
      updates: [
        {
          id: "u1",
          timestamp: Date.now() - 172800000,
          stage: "investigating",
          message: "Starting planned ACME certificate renewal across all domain edge proxies.",
        },
        {
          id: "u2",
          timestamp: Date.now() - 169200000,
          stage: "resolved",
          message: "All certificates renewed and zero-downtime reload completed successfully.",
        },
      ],
      postMortem:
        "Automated Let's Encrypt DNS-01 and HTTP-01 challenge completion with 0 downtime.",
    },
  ]);

  const [settings, setSettings] = useState<StatusPageSettings>({
    title: "HosteraX Cloud Status",
    companyName: "HosteraX Infrastructure",
    headline: "Real-time service health, synthetic probes, and SLA uptime monitor.",
    customDomain: "status.hosterax.internal",
    isPublic: true,
    announcement: {
      active: true,
      text: "All primary regions and database clusters operating normally with 99.98% 90-day SLA.",
      type: "info",
    },
    refreshIntervalSeconds: 30,
  });

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showPublicPreview, setShowPublicPreview] = useState(false);
  const [showNewIncidentModal, setShowNewIncidentModal] = useState(false);
  const [showEmbedModal, setShowEmbedModal] = useState(false);
  const [selectedIncidentForRCA, setSelectedIncidentForRCA] = useState<Incident | null>(null);

  // New incident form state
  const [newIncidentTitle, setNewIncidentTitle] = useState("");
  const [newIncidentSeverity, setNewIncidentSeverity] = useState<IncidentSeverity>("minor");
  const [newIncidentComponentId, setNewIncidentComponentId] = useState("comp-edge");
  const [newIncidentMessage, setNewIncidentMessage] = useState("");

  // Derived metrics
  const overallStatus = useMemo(() => calculateOverallSystemStatus(components), [components]);

  const averageSystemLatency = useMemo(() => {
    const allResults = components.flatMap((c) => c.recentResults);
    return calculateAverageLatency(allResults);
  }, [components]);

  const overall90dUptime = useMemo(() => {
    const sum = components.reduce((acc, c) => acc + c.uptime90d, 0);
    return Number((sum / components.length).toFixed(2));
  }, [components]);

  // Execute manual ping on a single component
  const handlePingComponent = (id: string) => {
    setComponents((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const newLatency = Math.floor(Math.random() * 8) + 2;
        const newResult = {
          timestamp: Date.now(),
          latencyMs: newLatency,
          success: true,
          statusCode: 200,
        };
        const updatedResults = [...c.recentResults.slice(1), newResult];
        return {
          ...c,
          status: "operational",
          recentResults: updatedResults,
        };
      }),
    );
    toast.success("Synthetic probe test succeeded! Latency verified.");
  };

  // Run all probes simultaneously
  const handleRunAllProbes = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setComponents((prev) =>
        prev.map((c) => {
          const newLatency = Math.floor(Math.random() * 10) + 2;
          const newResult = {
            timestamp: Date.now(),
            latencyMs: newLatency,
            success: true,
            statusCode: 200,
          };
          return {
            ...c,
            recentResults: [...c.recentResults.slice(1), newResult],
          };
        }),
      );
      setIsRefreshing(false);
      toast.success("All synthetic probes refreshed across 5 core components.");
    }, 600);
  };

  // Override component status
  const handleUpdateComponentStatus = (id: string, newStatus: ServiceStatus) => {
    setComponents((prev) => prev.map((c) => (c.id === id ? { ...c, status: newStatus } : c)));
    toast.info(`Updated component status to ${newStatus.replace("_", " ")}`);
  };

  // Create new incident
  const handleCreateIncident = () => {
    if (!newIncidentTitle.trim()) {
      toast.error("Please enter an incident title");
      return;
    }

    const created: Incident = {
      id: `inc-${Date.now().toString().slice(-4)}`,
      title: newIncidentTitle,
      severity: newIncidentSeverity,
      affectedComponentIds: [newIncidentComponentId],
      stage: "investigating",
      createdAt: Date.now(),
      updates: [
        {
          id: `u-${Date.now()}`,
          timestamp: Date.now(),
          stage: "investigating",
          message:
            newIncidentMessage ||
            "Engineering team is currently investigating reports of degraded service.",
        },
      ],
    };

    setIncidents([created, ...incidents]);

    // Automatically degrade component status
    const statusMap: Record<IncidentSeverity, ServiceStatus> = {
      minor: "degraded_performance",
      major: "partial_outage",
      critical: "major_outage",
      maintenance: "under_maintenance",
    };
    handleUpdateComponentStatus(newIncidentComponentId, statusMap[newIncidentSeverity]);

    setShowNewIncidentModal(false);
    setNewIncidentTitle("");
    setNewIncidentMessage("");
    toast.success("Incident published to live status feed.");
  };

  // Advance incident stage
  const handleAdvanceIncidentStage = (incidentId: string, nextStage: IncidentStage) => {
    setIncidents((prev) =>
      prev.map((inc) => {
        if (inc.id !== incidentId) return inc;
        const isResolved = nextStage === "resolved";
        const newUpdate = {
          id: `u-${Date.now()}`,
          timestamp: Date.now(),
          stage: nextStage,
          message:
            nextStage === "identified"
              ? "The root cause has been identified and mitigation is in progress."
              : nextStage === "monitoring"
                ? "A fix has been deployed. We are monitoring telemetry and recovery metrics."
                : "The incident has been resolved and all systems are fully operational.",
        };
        return {
          ...inc,
          stage: nextStage,
          resolvedAt: isResolved ? Date.now() : inc.resolvedAt,
          updates: [...inc.updates, newUpdate],
        };
      }),
    );

    if (nextStage === "resolved") {
      const inc = incidents.find((i) => i.id === incidentId);
      if (inc) {
        inc.affectedComponentIds.forEach((cid) => handleUpdateComponentStatus(cid, "operational"));
      }
      toast.success("Incident resolved and systems returned to operational status.");
    } else {
      toast.info(`Incident advanced to ${nextStage}.`);
    }
  };

  // Status badge styling helper
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

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
              <Radio className="h-6 w-6 text-primary animate-pulse" />
              Synthetic Probes & Status Page Engine
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 border border-primary/20 text-primary">
              <Globe className="h-3 w-3" />
              Public & Private
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Automated synthetic HTTP/TCP probes, 90-day SLA analytics, zero-downtime incident
            management, and branded status page publishing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleRunAllProbes}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-card border border-border text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Run All Probes
          </button>

          <button
            onClick={() => setShowEmbedModal(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-card border border-border text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
          >
            <Code className="h-3.5 w-3.5 text-muted-foreground" />
            Badges & API
          </button>

          <button
            onClick={() => setShowPublicPreview(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-card border border-border text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
          >
            <ExternalLink className="h-3.5 w-3.5 text-primary" />
            Public View
          </button>

          <button
            onClick={() => setShowNewIncidentModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            New Incident
          </button>
        </div>
      </div>

      {/* Global System Health Banner */}
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
                  ? "All Systems Operational"
                  : overallStatus === "major_outage"
                    ? "Critical Outage Detected"
                    : "Partial Service Degradation"}
              </h2>
              <p className="text-xs opacity-90 mt-0.5">
                {settings.announcement?.active
                  ? settings.announcement.text
                  : `Real-time monitoring active across ${components.length} microservices and infrastructure gateways.`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="text-right">
              <div className="text-muted-foreground uppercase text-[10px] tracking-wider font-semibold">
                90-Day SLA
              </div>
              <div className="text-base font-bold text-foreground">{overall90dUptime}%</div>
            </div>
            <div className="h-7 w-px bg-border/40" />
            <div className="text-right">
              <div className="text-muted-foreground uppercase text-[10px] tracking-wider font-semibold">
                Avg Latency
              </div>
              <div className="text-base font-bold text-foreground">{averageSystemLatency}ms</div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">24-Hour SLA</span>
          <div className="text-xl font-bold text-foreground">100.00%</div>
          <p className="text-[11px] text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> 0 dropped synthetic pings
          </p>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">7-Day SLA</span>
          <div className="text-xl font-bold text-foreground">99.99%</div>
          <p className="text-[11px] text-muted-foreground">Exceeds 99.9% target</p>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">30-Day SLA</span>
          <div className="text-xl font-bold text-foreground">99.98%</div>
          <p className="text-[11px] text-muted-foreground">3 min total downtime</p>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">Synthetic Probes</span>
          <div className="text-xl font-bold text-foreground">{components.length} Active</div>
          <p className="text-[11px] text-primary flex items-center gap-1">
            <Zap className="h-3 w-3" /> Interval: 15s – 60s
          </p>
        </div>
      </div>

      {/* Monitored Components Breakdown */}
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Monitored Microservices & Infrastructure
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live synthetic probes with 90-day historical timeline bars and latency telemetry.
            </p>
          </div>
          <span className="text-xs font-mono text-muted-foreground">
            {components.filter((c) => c.status === "operational").length} of {components.length}{" "}
            Operational
          </span>
        </div>

        <div className="divide-y divide-border/40">
          {components.map((comp) => {
            const badge = getStatusBadge(comp.status);
            const timeline = generate90DayTimeline(comp.uptime90d, 45); // 45 bars for crisp display
            const avgLat = calculateAverageLatency(comp.recentResults);
            const sslCheck = checkSslRenewalWarning(comp.sslDaysRemaining);

            return (
              <div key={comp.id} className="p-5 hover:bg-muted/10 transition-colors">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Service info */}
                  <div className="space-y-1 max-w-md">
                    <div className="flex items-center gap-2.5">
                      <span className="font-semibold text-sm text-foreground">{comp.name}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted border border-border/60 text-muted-foreground">
                        {comp.group}
                      </span>
                      {comp.containerId && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
                          {comp.containerId}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {comp.description}
                    </p>
                    {comp.sslDaysRemaining && (
                      <div className="flex items-center gap-1.5 text-[11px] pt-0.5">
                        <Shield
                          className={`h-3 w-3 ${sslCheck.warning ? "text-amber-400" : "text-emerald-400"}`}
                        />
                        <span
                          className={sslCheck.warning ? "text-amber-400" : "text-muted-foreground"}
                        >
                          SSL Certificate: {comp.sslDaysRemaining} days remaining
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 45-day uptime timeline bars */}
                  <div className="flex-1 max-w-sm">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
                      <span>45 days ago</span>
                      <span className="font-mono font-medium text-foreground">
                        {comp.uptime90d}% uptime
                      </span>
                      <span>Today</span>
                    </div>
                    <div className="flex items-center gap-[3px] h-6 bg-muted/20 p-1 rounded-md border border-border/40">
                      {timeline.map((day, idx) => (
                        <div
                          key={idx}
                          title={`${day.dateString}: ${day.status.replace("_", " ")} (${day.uptimePercent}%)`}
                          className={`flex-1 h-full rounded-[1px] transition-transform hover:scale-125 cursor-pointer ${
                            day.status === "operational"
                              ? "bg-emerald-500 hover:bg-emerald-400"
                              : day.status === "degraded_performance"
                                ? "bg-amber-500 hover:bg-amber-400"
                                : day.status === "under_maintenance"
                                  ? "bg-blue-500 hover:bg-blue-400"
                                  : "bg-rose-500 hover:bg-rose-400"
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Actions & Live Status */}
                  <div className="flex items-center gap-3 self-end lg:self-center">
                    <div className="text-right">
                      <div className="text-[10px] uppercase font-mono text-muted-foreground">
                        Latency
                      </div>
                      <div className="text-xs font-mono font-bold text-foreground">{avgLat}ms</div>
                    </div>

                    <div
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border flex items-center gap-1.5 ${badge.bg}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                      {badge.label}
                    </div>

                    {/* Manual override & test button */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handlePingComponent(comp.id)}
                        title="Execute manual synthetic probe ping"
                        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40 transition-colors cursor-pointer"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>

                      <select
                        value={comp.status}
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
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Incident History & Post-Mortems Section */}
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Incidents & Post-Mortem Feed
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live lifecycle management: Investigating → Identified → Monitoring → Resolved.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {incidents.filter((i) => i.stage !== "resolved").length} active incidents
          </span>
        </div>

        <div className="divide-y divide-border/40">
          {incidents.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No incidents reported in the last 90 days. Systems operating with high stability.
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
                            : "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse"
                        }`}
                      >
                        {incident.stage.toUpperCase()}
                      </span>

                      <button
                        onClick={() => setSelectedIncidentForRCA(incident)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded bg-muted/60 hover:bg-muted text-foreground transition-colors cursor-pointer border border-border/40"
                      >
                        <FileText className="h-3 w-3 text-primary" />
                        RCA Post-Mortem
                      </button>
                    </div>
                  </div>

                  {/* Updates list */}
                  <div className="space-y-2 pl-3 border-l-2 border-border/60">
                    {incident.updates.map((update) => (
                      <div key={update.id} className="text-xs space-y-0.5">
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="font-mono text-foreground font-medium">
                            {new Date(update.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <span>·</span>
                          <span className="uppercase text-[10px] tracking-wide text-primary">
                            {update.stage}
                          </span>
                        </div>
                        <p className="text-foreground/90">{update.message}</p>
                      </div>
                    ))}
                  </div>

                  {/* Quick Stage Advancement Controls */}
                  {!isResolved && (
                    <div className="flex items-center gap-2 pt-2">
                      <span className="text-[11px] text-muted-foreground">Advance Stage:</span>
                      {incident.stage === "investigating" && (
                        <button
                          onClick={() => handleAdvanceIncidentStage(incident.id, "identified")}
                          className="px-2.5 py-1 text-xs rounded bg-muted hover:bg-muted/80 text-foreground transition-colors cursor-pointer"
                        >
                          Mark as Identified
                        </button>
                      )}
                      {(incident.stage === "investigating" || incident.stage === "identified") && (
                        <button
                          onClick={() => handleAdvanceIncidentStage(incident.id, "monitoring")}
                          className="px-2.5 py-1 text-xs rounded bg-muted hover:bg-muted/80 text-foreground transition-colors cursor-pointer"
                        >
                          Mark as Monitoring
                        </button>
                      )}
                      <button
                        onClick={() => handleAdvanceIncidentStage(incident.id, "resolved")}
                        className="px-2.5 py-1 text-xs rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-colors cursor-pointer font-medium"
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

      {/* Modal: Public Status Page Preview */}
      {showPublicPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-border/40 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary text-sm">
                  Hx
                </div>
                <div>
                  <h3 className="font-bold text-foreground text-base">{settings.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    {settings.customDomain} (Public Vanity URL)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPublicPreview(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            {/* Simulated Public View */}
            <div className="space-y-6 bg-background p-6 rounded-lg border border-border/40">
              <div
                className={`p-4 rounded-lg border text-center font-semibold text-sm ${
                  overallStatus === "operational"
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                    : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                }`}
              >
                {overallStatus === "operational"
                  ? "✓ All Systems Fully Operational Across Global Edge"
                  : "⚠ Some Services Experiencing Degraded Performance"}
              </div>

              <div className="space-y-3">
                <h4 className="text-xs uppercase font-mono text-muted-foreground tracking-wider">
                  Services Health Status
                </h4>
                <div className="space-y-2">
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
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5 text-primary" />
                <span>Zero authentication required for public viewers.</span>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`https://${settings.customDomain}`);
                  toast.success("Public status URL copied to clipboard!");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Copy className="h-3 w-3" />
                Copy Public Link
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Incident */}
      {showNewIncidentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                Broadcast New Incident Update
              </h3>
              <button
                onClick={() => setShowNewIncidentModal(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block text-foreground font-medium mb-1">Incident Headline</label>
                <input
                  type="text"
                  value={newIncidentTitle}
                  onChange={(e) => setNewIncidentTitle(e.target.value)}
                  placeholder="e.g. Edge Ingress Gateway Latency Spikes"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-foreground font-medium mb-1">Severity Level</label>
                  <select
                    value={newIncidentSeverity}
                    onChange={(e) => setNewIncidentSeverity(e.target.value as IncidentSeverity)}
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary"
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
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {components.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-foreground font-medium mb-1">
                  Initial Investigation Message
                </label>
                <textarea
                  rows={3}
                  value={newIncidentMessage}
                  onChange={(e) => setNewIncidentMessage(e.target.value)}
                  placeholder="Describe initial symptoms and engineering actions taken..."
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/40">
              <button
                onClick={() => setShowNewIncidentModal(false)}
                className="px-3.5 py-2 text-xs font-medium rounded-lg text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateIncident}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
              >
                Publish Incident
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: RCA Post-Mortem */}
      {selectedIncidentForRCA && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Root Cause Analysis (RCA) & Post-Mortem
              </h3>
              <button
                onClick={() => setSelectedIncidentForRCA(null)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            <div className="bg-background border border-border/50 rounded-lg p-4 font-mono text-xs whitespace-pre-wrap text-foreground/90 max-h-[50vh] overflow-y-auto">
              {generatePostMortemMarkdown(selectedIncidentForRCA, components)}
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                Standard GitHub-flavored Markdown.
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    generatePostMortemMarkdown(selectedIncidentForRCA, components),
                  );
                  toast.success("RCA Markdown copied to clipboard!");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Copy className="h-3 w-3" />
                Copy Markdown Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Badges & JSON API */}
      {showEmbedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                <Code className="h-4 w-4 text-primary" />
                Status Badges & Public JSON Feed
              </h3>
              <button
                onClick={() => setShowEmbedModal(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground text-sm"
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
                  {generateStatusBadgeMarkdown(overallStatus, settings.customDomain)}
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      generateStatusBadgeMarkdown(overallStatus, settings.customDomain),
                    );
                    toast.success("Badge Markdown copied!");
                  }}
                  className="mt-1.5 text-[11px] text-primary hover:underline font-medium flex items-center gap-1"
                >
                  <Copy className="h-3 w-3" /> Copy Markdown
                </button>
              </div>

              <div>
                <label className="block text-foreground font-semibold mb-1">
                  Live JSON API Endpoint
                </label>
                <div className="p-2.5 rounded bg-background border border-border font-mono text-[11px] break-all select-all text-muted-foreground">
                  GET https://{settings.customDomain}/api/status.json
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Returns real-time status, component health array, active incidents, and rolling
                  SLA percentages.
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowEmbedModal(false)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-card border border-border text-foreground hover:bg-muted"
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
