import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/hx/status-badge";
import { format } from "date-fns";

export const Route = createFileRoute("/_app/deployments")({
  head: () => ({ meta: [{ title: "Deployments — HosteraX" }] }),
  component: DeploymentsPage,
});

function DeploymentsPage() {
  const { data = [] } = useQuery({
    queryKey: ["all-deployments"],
    queryFn: async () => {
      const { data } = await supabase
        .from("deployments")
        .select("*, projects(name, slug)")
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
    refetchInterval: 3000,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Deployments</h1>
        <p className="text-sm text-muted-foreground">Last 50 builds across all projects.</p>
      </div>
      <div className="rounded-lg border border-border bg-card">
        {data.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No deployments yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {data.map((d: any) => (
              <Link key={d.id} to="/p/$slug" params={{ slug: d.projects?.slug ?? "" }} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-accent">
                <div className="flex items-center gap-3">
                  <StatusBadge status={d.status} />
                  <div>
                    <div className="text-sm font-medium">
                      {d.projects?.name} <span className="text-muted-foreground">/ {d.commit_message ?? "—"}</span>
                      {d.version && <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">{d.version}</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{d.commit_sha}</span>
                      <span>·</span><span>{d.branch}</span>
                      <span>·</span><span className="rounded bg-surface-2 px-1.5 py-0.5">{d.environment}</span>
                      <span>·</span><span className="uppercase tracking-wide">{d.trigger_type}</span>
                      {d.phase && <><span>·</span><span>phase: {d.phase}</span></>}
                      <span>·</span><span>{format(new Date(d.created_at), "MMM d, HH:mm")}</span>
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {d.duration_ms ? `${(d.duration_ms / 1000).toFixed(1)}s` : "—"}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
