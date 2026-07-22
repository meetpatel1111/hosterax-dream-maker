import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/hx/status-badge";

export const Route = createFileRoute("/_app/databases")({
  head: () => ({ meta: [{ title: "Databases — HosteraX" }] }),
  component: DBs,
});

function DBs() {
  const { data = [] } = useQuery({
    queryKey: ["all-dbs"],
    queryFn: async () => {
      const { data } = await supabase.from("databases").select("*, projects(name, slug)").order("created_at", { ascending: false });
      return data ?? [];
    },
    refetchInterval: 3000,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Databases</h1>
        <p className="text-sm text-muted-foreground">Managed database instances across all projects.</p>
      </div>
      <div className="rounded-lg border border-border bg-card">
        {data.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No databases. Open a project → Databases tab to provision Postgres, MySQL, Mongo, or Redis.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.map((d: any) => (
              <Link key={d.id} to="/p/$slug" params={{ slug: d.projects?.slug ?? "" }} className="flex items-center gap-3 p-4 hover:bg-accent">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-2 font-mono text-xs uppercase text-primary">{d.engine.slice(0, 2)}</div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{d.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{d.projects?.name} · {d.engine} · {d.size_mb} MB</div>
                </div>
                <StatusBadge status={d.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
