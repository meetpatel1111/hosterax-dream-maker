import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/hx/status-badge";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  HeartPulse,
  PlusCircle,
  Rocket,
  Search,
  Shield,
  Activity,
  Terminal,
  MousePointer,
  ExternalLink,
  Trash2,
  Radio,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useEngine, useEngineProjects } from "@/lib/engine";
import { appLogger, filterLogs, type LogEntry } from "@/utils/app-logger";
import { SiemForwarderStudio } from "@/components/hx/siem-forwarder-studio";
import { toast } from "sonner";
import { confirmAction } from "@/components/hx/confirm-modal";

export const Route = createFileRoute("/_app/activity")({
  head: () => ({ meta: [{ title: "Audit Log & Activity — HosteraX" }] }),
  component: ActivityPage,
});

type ActivityEvent = {
  id: string;
  kind: string;
  label: string;
  user: string;
  ip?: string | null;
  at?: string | null;
  status?: "success" | "failed" | "warning" | "building";
  meta?: string | null;
};

type ActivityFeed = { events: ActivityEvent[]; unavailableSources: string[] };

function eventTime(value?: string | number | null) {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function ActivityPage() {
  const [q, setQ] = useState("");
  const [filterKind, setFilterKind] = useState("all");
  const [viewMode, setViewMode] = useState<"engine" | "client" | "siem">("engine");
  const [clientLogs, setClientLogs] = useState<LogEntry[]>(() => appLogger.getLogs());
  const engine = useEngine();
  const { data: engineProjects = [] } = useEngineProjects();

  useEffect(() => {
    return appLogger.subscribe((entry) => {
      setClientLogs((prev) => [entry, ...prev].slice(0, 500));
    });
  }, []);

  const clearClientLogs = async () => {
    const ok = await confirmAction({
      title: "Clear Telemetry Logs",
      description: "Are you sure you want to purge all in-memory client and API telemetry logs?",
      variant: "destructive",
      confirmLabel: "Purge Logs",
    });
    if (ok) {
      appLogger.clear();
      setClientLogs([]);
      toast.success("Telemetry logs cleared");
    }
  };

  const { data: feed, isPending } = useQuery<ActivityFeed>({
    queryKey: ["activity-feed", engine.url, engine.token, engineProjects.map((p) => p.name)],
    queryFn: async ({ signal }) => {
      const results = await Promise.allSettled([
        engine.call<any[]>("GET", "/api/deployments?limit=100", undefined, { signal }),
        engine.call<any[]>("GET", "/api/self-heal/events?limit=100", undefined, { signal }),
        engine.call<any[]>("GET", "/api/auth/events?limit=100", undefined, { signal }),
        engine.call<any[]>("GET", "/api/audit-logs?limit=100", undefined, { signal }),
      ]);
      if (signal.aborted) throw new DOMException("Activity request aborted", "AbortError");
      const unavailableSources: string[] = [];
      const sourceRows = (index: number, source: string) => {
        const result = results[index];
        if (result.status === "fulfilled" && Array.isArray(result.value)) return result.value;
        unavailableSources.push(source);
        return [];
      };
      const [deployments, healEvents, authEvents, auditLogs] = [
        sourceRows(0, "deployments"),
        sourceRows(1, "self-healing"),
        sourceRows(2, "authentication"),
        sourceRows(3, "audit-logs"),
      ];

      const events: ActivityEvent[] = engineProjects.map((project) => ({
        id: `project-${project.id || project.name}`,
        kind: "project.created",
        label: `Project "${project.name}" created`,
        user: "HosteraX Engine",
        at: eventTime(project.created_at),
      }));

      for (const deployment of deployments) {
        const phase = String(deployment.phase || "").toLowerCase();
        events.push({
          id: `deployment-${deployment.id}`,
          kind:
            phase === "ready"
              ? "deploy.success"
              : phase === "failed"
                ? "deploy.failed"
                : "deploy.building",
          label: `Deployment ${deployment.version || String(deployment.id).slice(0, 8)} (${deployment.project})`,
          user: deployment.trigger === "git" ? "Git Webhook" : "Local Admin",
          at: eventTime(deployment.started_at),
          status: phase === "ready" ? "success" : phase === "failed" ? "failed" : "building",
          meta: `${deployment.branch || "main"} · ${deployment.environment || "production"}`,
        });
      }

      for (const event of healEvents) {
        const eventType = String(event.eventType || "self_healing");
        events.push({
          id: `heal-${event.id}`,
          kind: eventType.includes("circuit") ? "guard.circuit_breaker" : `heal.${eventType}`,
          label: `${event.details || eventType} (${event.project})`,
          user: "AutoHeal Watchdog",
          at: eventTime(event.timestamp),
          status:
            event.status === "error"
              ? "failed"
              : event.status === "warning"
                ? "warning"
                : "success",
        });
      }

      for (const event of authEvents) {
        const eventName = String(event.event || "authentication event");
        const failed = /fail|denied|locked/i.test(eventName);
        events.push({
          id: `auth-${event.id}`,
          kind: `auth.${eventName}`,
          label: `Authentication ${eventName.replaceAll("_", " ")}`,
          user: event.email || event.user_id || "Unknown user",
          ip: event.ip || null,
          at: eventTime(event.ts),
          status: failed ? "failed" : "success",
          meta: event.detail || null,
        });
      }

      for (const audit of auditLogs) {
        events.push({
          id: `audit-${audit.id}`,
          kind: `audit.${audit.action || "event"}`,
          label: `${audit.action || "audit.event"}${audit.resource_id ? ` (${audit.resource_id})` : ""}`,
          user: audit.actor_email || "System",
          ip: audit.ip || null,
          at: eventTime(audit.created_at),
          status: "success",
          meta: audit.resource_type || audit.org_id || null,
        });
      }

      events.sort((a, b) => {
        const timeA = a.at ? new Date(a.at).getTime() : 0;
        const timeB = b.at ? new Date(b.at).getTime() : 0;
        return timeB - timeA;
      });
      return { events, unavailableSources };
    },
    refetchInterval: 10000,
  });

  const kinds = [
    { id: "all", label: "All events" },
    { id: "audit", label: "Audit Trail" },
    { id: "project", label: "Projects" },
    { id: "deploy", label: "Deployments" },
    { id: "heal", label: "Self-Healing" },
    { id: "auth", label: "Authentication" },
  ];

  const clientCategories = [
    { id: "all", label: "All Categories" },
    { id: "api", label: "API Requests" },
    { id: "ui", label: "UI Interactions" },
    { id: "security", label: "Security & Auth" },
    { id: "system", label: "System & Engine" },
  ];

  const filteredEngine = (feed?.events || []).filter((event) => {
    const query = q.trim().toLowerCase();
    const matchQuery =
      !query ||
      event.label.toLowerCase().includes(query) ||
      event.user.toLowerCase().includes(query) ||
      event.ip?.toLowerCase().includes(query) ||
      event.kind.toLowerCase().includes(query);
    const matchKind =
      filterKind === "all" ||
      (filterKind === "audit" && event.kind.startsWith("audit")) ||
      (filterKind === "project" && event.kind.startsWith("project")) ||
      (filterKind === "deploy" && event.kind.startsWith("deploy")) ||
      (filterKind === "heal" &&
        (event.kind.startsWith("heal") || event.kind.startsWith("guard"))) ||
      (filterKind === "auth" && event.kind.startsWith("auth"));
    return matchQuery && matchKind;
  });

  const filteredClient = filterLogs(clientLogs, {
    searchQuery: q,
    category:
      filterKind === "api" ||
      filterKind === "ui" ||
      filterKind === "security" ||
      filterKind === "system"
        ? (filterKind as any)
        : "all",
  });

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit Log & Activity</h1>
          <p className="text-sm text-muted-foreground">
            {viewMode === "engine"
              ? "Recent project, deployment, self-healing, and authentication events from the engine."
              : viewMode === "client"
                ? "Live client-side telemetry: API latency, UI interactions, navigation, and security events."
                : "Real-time log forwarding to external SIEM systems, Datadog, Splunk, and Syslog daemons."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-card p-1 shadow-xs">
            <button
              type="button"
              onClick={() => {
                setViewMode("engine");
                setFilterKind("all");
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "engine"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Engine Audit Feed
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("client");
                setFilterKind("all");
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "client"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Live Telemetry & Client Logs ({clientLogs.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("siem");
                setFilterKind("all");
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                viewMode === "siem"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Radio className="h-3.5 w-3.5" />
              <span>SIEM & Syslog Forwarding</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("hx:open-telemetry"))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-card px-3 py-1.5 text-xs font-mono font-medium text-foreground hover:bg-muted/80 transition-colors shadow-xs"
            title="Open Live Inspector Drawer (Shift+L)"
          >
            <Activity className="h-3.5 w-3.5 text-primary" />
            <span>Inspector</span>
            <span className="text-[10px] text-muted-foreground">⇧L</span>
          </button>
          {viewMode === "client" && clientLogs.length > 0 && (
            <button
              type="button"
              onClick={clearClientLogs}
              className="inline-flex items-center gap-1 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors"
              title="Purge in-memory telemetry logs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {viewMode === "engine" && !!feed?.unavailableSources.length && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>
            Could not load {feed.unavailableSources.join(", ")} events. Other available events are
            still shown.
          </span>
        </div>
      )}

      {viewMode === "siem" ? (
        <SiemForwarderStudio />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label="Search activity"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder={
                  viewMode === "engine"
                    ? "Search events, actors, projects..."
                    : "Search method, endpoint, action, message..."
                }
                className="w-full rounded-md border border-input bg-input/40 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
              />
            </div>
            <div
              className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
              role="group"
              aria-label="Filter activity by type"
            >
              {(viewMode === "engine" ? kinds : clientCategories).map((kind) => (
                <button
                  key={kind.id}
                  type="button"
                  aria-pressed={filterKind === kind.id}
                  onClick={() => setFilterKind(kind.id)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    filterKind === kind.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {kind.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {viewMode === "engine" ? (
              isPending ? (
                <div className="p-12 text-center text-sm text-muted-foreground" role="status">
                  Loading activity…
                </div>
              ) : filteredEngine.length === 0 ? (
                <div className="p-12 text-center text-sm text-muted-foreground">
                  No activity matches your filters.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredEngine.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-accent/40"
                    >
                      <div className="flex min-w-0 items-center gap-3.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground">
                          {event.kind.startsWith("deploy") ? (
                            <Rocket className="h-4 w-4 text-primary" />
                          ) : event.kind.startsWith("heal") || event.kind.startsWith("guard") ? (
                            <HeartPulse className="h-4 w-4 text-emerald-500" />
                          ) : event.kind.startsWith("auth") ? (
                            <Shield className="h-4 w-4 text-sky-500" />
                          ) : (
                            <PlusCircle className="h-4 w-4 text-amber-500" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="break-words text-sm font-medium text-foreground">
                            {event.label}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{event.user}</span>
                            {event.ip && (
                              <>
                                <span>·</span>
                                <span className="font-mono">{event.ip}</span>
                              </>
                            )}
                            {event.meta && (
                              <>
                                <span>·</span>
                                <span>{event.meta}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {event.status && (
                          <div className="mb-1 flex justify-end">
                            <StatusBadge status={event.status} />
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground">
                          {event.at
                            ? formatDistanceToNow(new Date(event.at), { addSuffix: true })
                            : "Time unavailable"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : filteredClient.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                No client telemetry recorded yet matching your filters. Interactions will appear
                here in real-time.
              </div>
            ) : (
              <div className="divide-y divide-border font-mono text-xs">
                {filteredClient.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-accent/40"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        {entry.category === "api" ? (
                          <Terminal className="h-4 w-4 text-primary" />
                        ) : entry.category === "ui" ? (
                          <MousePointer className="h-4 w-4 text-emerald-400" />
                        ) : entry.category === "security" ? (
                          <Shield className="h-4 w-4 text-amber-400" />
                        ) : (
                          <Activity className="h-4 w-4 text-sky-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 truncate">
                          {entry.method && (
                            <span className="font-bold text-primary">{entry.method}</span>
                          )}
                          <span className="font-semibold text-foreground truncate">
                            {entry.action}
                          </span>
                          {entry.status !== undefined && (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                entry.status >= 200 && entry.status < 300
                                  ? "bg-emerald-500/15 text-emerald-400"
                                  : entry.status >= 400
                                    ? "bg-rose-500/15 text-rose-400"
                                    : "bg-amber-500/15 text-amber-400"
                              }`}
                            >
                              {entry.status}
                            </span>
                          )}
                          {entry.durationMs !== undefined && (
                            <span className="text-[10px] text-muted-foreground">
                              {Math.round(entry.durationMs)}ms
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-muted-foreground truncate font-sans text-xs">
                          {entry.message}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                      {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                    </div>
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
