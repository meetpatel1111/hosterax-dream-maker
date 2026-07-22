import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/hx/status-badge";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_app/activity")({
  head: () => ({ meta: [{ title: "Activity — HosteraX" }] }),
  component: Activity,
});

function Activity() {
  const { data = [] } = useQuery({
    queryKey: ["activity"],
    queryFn: async () => {
      const [{ data: deps }, { data: projs }] = await Promise.all([
        supabase.from("deployments").select("*, projects(name)").order("created_at", { ascending: false }).limit(30),
        supabase.from("projects").select("*").order("created_at", { ascending: false }).limit(10),
      ]);
      const events: any[] = [];
      (projs ?? []).forEach((p: any) => events.push({ id: `p-${p.id}`, kind: "project.created", label: `Created project ${p.name}`, at: p.created_at }));
      (deps ?? []).forEach((d: any) => events.push({ id: `d-${d.id}`, kind: `deploy.${d.status}`, label: `Deploy · ${d.projects?.name} · ${d.commit_sha}`, at: d.created_at, status: d.status }));
      return events.sort((a, b) => +new Date(b.at) - +new Date(a.at));
    },
    refetchInterval: 3000,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">Recent events across your control plane.</p>
      </div>
      <div className="rounded-lg border border-border bg-card">
        {data.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No activity yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {data.map((e: any) => (
              <div key={e.id} className="flex items-center gap-3 p-3 text-sm">
                {e.status ? <StatusBadge status={e.status} /> : <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs">event</span>}
                <span className="flex-1">{e.label}</span>
                <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(e.at))} ago</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
