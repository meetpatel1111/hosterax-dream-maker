import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/hx/status-badge";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, HeartPulse, PlusCircle, Rocket, Search, Shield } from "lucide-react";
import { useState } from "react";
import { useEngine, useEngineProjects } from "@/lib/engine";

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
  const engine = useEngine();
  const { data: engineProjects = [] } = useEngineProjects();

  const { data: feed, isPending } = useQuery<ActivityFeed>({
    queryKey: ["activity-feed", engine.url, engine.token, engineProjects.map((p) => p.name)],
    queryFn: async ({ signal }) => {
      const results = await Promise.allSettled([
        engine.call<any[]>("GET", "/api/deployments?limit=100", undefined, { signal }),
        engine.call<any[]>("GET", "/api/self-heal/events?limit=100", undefined, { signal }),
        engine.call<any[]>("GET", "/api/auth/events?limit=100", undefined, { signal }),
      ]);
      if (signal.aborted) throw new DOMException("Activity request aborted", "AbortError");
      const unavailableSources: string[] = [];
      const sourceRows = (index: number, source: string) => {
        const result = results[index];
        if (result.status === "fulfilled" && Array.isArray(result.value)) return result.value;
        unavailableSources.push(source);
        return [];
      };
      const [deployments, healEvents, authEvents] = [
        sourceRows(0, "deployments"),
        sourceRows(1, "self-healing"),
        sourceRows(2, "authentication"),
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
          status: event.status === "error" ? "failed" : event.status === "warning" ? "warning" : "success",
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
    { id: "project", label: "Projects" },
    { id: "deploy", label: "Deployments" },
    { id: "heal", label: "Self-Healing" },
    { id: "auth", label: "Authentication" },
  ];

  const filtered = (feed?.events || []).filter((event) => {
    const query = q.trim().toLowerCase();
    const matchQuery =
      !query ||
      event.label.toLowerCase().includes(query) ||
      event.user.toLowerCase().includes(query) ||
      event.ip?.toLowerCase().includes(query);
    const matchKind =
      filterKind === "all" ||
      (filterKind === "project" && event.kind.startsWith("project")) ||
      (filterKind === "deploy" && event.kind.startsWith("deploy")) ||
      (filterKind === "heal" && (event.kind.startsWith("heal") || event.kind.startsWith("guard"))) ||
      (filterKind === "auth" && event.kind.startsWith("auth"));
    return matchQuery && matchKind;
  });

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit Log & Activity</h1>
          <p className="text-sm text-muted-foreground">
            Recent project, deployment, self-healing, and authentication events from the engine.
          </p>
        </div>
      </div>

      {!!feed?.unavailableSources.length && (
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

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Search activity"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search events, actors, projects..."
            className="w-full rounded-md border border-input bg-input/40 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1" role="group" aria-label="Filter activity by type">
          {kinds.map((kind) => (
            <button
              key={kind.id}
              type="button"
              aria-pressed={filterKind === kind.id}
              onClick={() => setFilterKind(kind.id)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${filterKind === kind.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {kind.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {isPending ? (
          <div className="p-12 text-center text-sm text-muted-foreground" role="status">
            Loading activity…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No activity matches your filters.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((event) => (
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
                    <div className="break-words text-sm font-medium text-foreground">{event.label}</div>
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
                    {event.at ? formatDistanceToNow(new Date(event.at), { addSuffix: true }) : "Time unavailable"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
