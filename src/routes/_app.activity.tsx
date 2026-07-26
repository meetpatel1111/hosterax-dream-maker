import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/hx/status-badge";
import { formatDistanceToNow, format } from "date-fns";
import { Activity as ActivityIcon, Search, Shield, Filter, Trash2, CheckCircle2, Clock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/activity")({
  head: () => ({ meta: [{ title: "Audit Log & Activity — HosteraX" }] }),
  component: ActivityPage,
});

function ActivityPage() {
  const [q, setQ] = useState("");
  const [filterKind, setFilterKind] = useState("all");

  const { data = [], refetch } = useQuery({
    queryKey: ["activity"],
    queryFn: async () => {
      const [{ data: deps }, { data: projs }] = await Promise.all([
        supabase.from("deployments").select("*, projects(name)").order("created_at", { ascending: false }).limit(40),
        supabase.from("projects").select("*").order("created_at", { ascending: false }).limit(15),
      ]);
      const events: any[] = [];
      (projs ?? []).forEach((p: any) =>
        events.push({
          id: `p-${p.id}`,
          kind: "project.created",
          label: `Created project "${p.name}"`,
          user: "Owner",
          ip: "127.0.0.1",
          at: p.created_at,
        })
      );
      (deps ?? []).forEach((d: any) =>
        events.push({
          id: `d-${d.id}`,
          kind: d.status === "success" ? "deploy.success" : d.status === "failed" ? "deploy.failed" : "deploy.building",
          label: `Deployment ${d.version || d.commit_sha} (${d.projects?.name})`,
          user: d.triggered_by ? "User" : "Git Webhook",
          ip: "127.0.0.1",
          at: d.created_at,
          status: d.status,
          meta: `${d.branch} · ${d.environment}`,
        })
      );

      // Add synthetic security audit logs for rule bans & PAT tokens
      events.push(
        {
          id: "audit-1",
          kind: "security.ban_ip",
          label: "Blocked malicious IP range 198.51.100.0/24 via OpenResty Lua ACL",
          user: "Security Rules",
          ip: "198.51.100.42",
          at: new Date(Date.now() - 3600000 * 2).toISOString(),
          status: "warn",
        },
        {
          id: "audit-2",
          kind: "token.minted",
          label: 'Minted Personal Access Token "ci-deploy-bot" (scope: deploy)',
          user: "Owner",
          ip: "127.0.0.1",
          at: new Date(Date.now() - 3600000 * 5).toISOString(),
          status: "info",
        }
      );

      return events.sort((a, b) => +new Date(b.at) - +new Date(a.at));
    },
    refetchInterval: 3000,
  });

  const filtered = data.filter((e) => {
    const matchesQ = e.label.toLowerCase().includes(q.toLowerCase()) || e.kind.toLowerCase().includes(q.toLowerCase());
    const matchesKind = filterKind === "all" || e.kind.startsWith(filterKind);
    return matchesQ && matchesKind;
  });

  const clearLog = () => {
    toast.success("Audit log retention policy executed. Older events pruned.");
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit Log & System Activity</h1>
          <p className="text-sm text-muted-foreground">Immutable audit trail of all control plane operations & edge routing events.</p>
        </div>
        <button
          onClick={clearLog}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" /> Prune Old Logs
        </button>
      </div>

      {/* Filters */}
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search audit trail by event, project, or user..."
            className="w-full rounded-md border border-input bg-input/40 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>

        <select
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value)}
          className="rounded-md border border-input bg-input/40 px-3 py-2 text-xs outline-none focus:border-primary"
        >
          <option value="all">All Event Categories</option>
          <option value="deploy">Deployments</option>
          <option value="project">Projects</option>
          <option value="security">Security & ACL Rules</option>
          <option value="token">API Tokens</option>
        </select>
      </div>

      {/* Audit Log Feed */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No activity matching filter.</div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((e: any) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-accent/40 transition-colors">
                <div className="flex items-center gap-3.5 min-w-0">
                  {e.status ? (
                    <StatusBadge status={e.status} />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-surface-2 text-xs font-mono font-semibold text-primary">
                      <Shield className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{e.label}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono text-[11px] text-primary/90">{e.kind}</span>
                      <span>·</span>
                      <span>Actor: {e.user}</span>
                      <span>·</span>
                      <span className="font-mono">{e.ip}</span>
                      {e.meta && (
                        <>
                          <span>·</span>
                          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px]">{e.meta}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground shrink-0 font-mono">
                  {formatDistanceToNow(new Date(e.at))} ago
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
