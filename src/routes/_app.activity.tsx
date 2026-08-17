import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/hx/status-badge";
import { formatDistanceToNow } from "date-fns";
import { Search, Shield, Trash2, Activity, HeartPulse, Rocket, PlusCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useEngine, useEngineProjects } from "@/lib/engine";

export const Route = createFileRoute("/_app/activity")({
  head: () => ({ meta: [{ title: "Audit Log & Activity — HosteraX" }] }),
  component: ActivityPage,
});

function ActivityPage() {
  const [q, setQ] = useState("");
  const [filterKind, setFilterKind] = useState("all");
  const engine = useEngine();
  const { data: engineProjects = [] } = useEngineProjects();

  const { data = [] } = useQuery({
    queryKey: ["activity-sqlite", engine.url, engineProjects.map((p) => p.name).join(",")],
    queryFn: async () => {
      const events: any[] = [];

      // 1. Projects
      for (const p of engineProjects) {
        events.push({
          id: `eng-p-${p.name}`,
          kind: "project.created",
          label: `Project "${p.name}" initialized on HosteraX Engine`,
          user: "Local Admin",
          ip: "127.0.0.1",
          at: p.created_at ? new Date(p.created_at).toISOString() : new Date().toISOString(),
        });
      }

      // 2. Deployments from SQLite
      try {
        const deps = await engine.call<any[]>("GET", "/api/deployments?limit=50");
        if (deps && Array.isArray(deps)) {
          for (const d of deps) {
            events.push({
              id: `dep-${d.id}`,
              kind:
                d.phase === "ready"
                  ? "deploy.success"
                  : d.phase === "failed"
                    ? "deploy.failed"
                    : "deploy.building",
              label: `Deployment ${d.version || d.id.slice(0, 8)} (${d.project})`,
              user: d.trigger === "git" ? "Git Webhook" : "Local Admin",
              ip: "127.0.0.1",
              at: d.started_at ? new Date(d.started_at).toISOString() : new Date().toISOString(),
              status: d.phase === "ready" ? "success" : d.phase === "failed" ? "error" : "building",
              meta: `${d.branch || "main"} · ${d.environment || "production"}`,
            });
          }
        }
      } catch {}

      // 3. Self-Healing & Resilience events from SQLite
      try {
        const healEvents = await engine.call<any[]>("GET", "/api/self-heal/events");
        if (healEvents && Array.isArray(healEvents)) {
          for (const h of healEvents) {
            events.push({
              id: `heal-${h.id}`,
              kind:
                h.action === "circuit_breaker_opened" ? "guard.circuit_breaker" : "heal.remediated",
              label: `AutoHeal: ${h.action} on ${h.project} (${h.reason})`,
              user: "AutoHeal v7 Watchdog",
              ip: "127.0.0.1",
              at: h.created_at ? new Date(h.created_at).toISOString() : new Date().toISOString(),
              status: h.action === "circuit_breaker_opened" ? "warning" : "success",
              meta: `Attempt ${h.attempt || 1}`,
            });
          }
        }
      } catch {}

      return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    },
    refetchInterval: 3000,
  });

  const kinds = [
    { id: "all", label: "All events" },
    { id: "project", label: "Projects" },
    { id: "deploy", label: "Deployments" },
    { id: "heal", label: "Self-Healing" },
  ];

  const filtered = data.filter((e) => {
    const matchQ =
      !q ||
      e.label.toLowerCase().includes(q.toLowerCase()) ||
      e.user.toLowerCase().includes(q.toLowerCase());
    const matchKind =
      filterKind === "all" ||
      (filterKind === "project" && e.kind.startsWith("project")) ||
      (filterKind === "deploy" && e.kind.startsWith("deploy")) ||
      (filterKind === "heal" && (e.kind.startsWith("heal") || e.kind.startsWith("guard")));
    return matchQ && matchKind;
  });

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit Log & Activity</h1>
          <p className="text-sm text-muted-foreground">
            Complete immutable audit trail of deployments, self-healing events, and configuration
            changes from SQLite.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search events, actors, projects..."
            className="w-full rounded-md border border-input bg-input/40 pl-9 pr-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          {kinds.map((k) => (
            <button
              key={k.id}
              onClick={() => setFilterKind(k.id)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${filterKind === k.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No activity matches your filters.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((e: any) => (
              <div
                key={e.id}
                className="flex items-center justify-between p-4 hover:bg-accent/40 transition-colors"
              >
                <div className="flex items-center gap-3.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground">
                    {e.kind.startsWith("deploy") ? (
                      <Rocket className="h-4 w-4 text-primary" />
                    ) : e.kind.startsWith("heal") || e.kind.startsWith("guard") ? (
                      <HeartPulse className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <PlusCircle className="h-4 w-4 text-amber-500" />
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">{e.label}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{e.user}</span>
                      <span>·</span>
                      <span className="font-mono">{e.ip}</span>
                      {e.meta && (
                        <>
                          <span>·</span>
                          <span>{e.meta}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  {e.status && (
                    <div className="mb-1 flex justify-end">
                      <StatusBadge status={e.status} />
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(e.at), { addSuffix: true })}
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
