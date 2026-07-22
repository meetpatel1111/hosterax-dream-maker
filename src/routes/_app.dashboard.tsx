import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/hx/status-badge";
import { STACKS } from "@/lib/stacks";
import { Plus, Search, GitBranch, Globe } from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Projects — HosteraX" }] }),
  component: Dashboard,
});

function Dashboard() {
  const [q, setQ] = useState("");
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filtered = projects.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">{projects.length} project{projects.length === 1 ? "" : "s"} on this control plane</p>
        </div>
        <Link to="/new" className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> New project
        </Link>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects..."
          className="w-full rounded-md border border-input bg-input/40 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
        />
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Plus className="h-5 w-5" />
          </div>
          <h3 className="mt-4 text-lg font-medium">Deploy your first project</h3>
          <p className="mt-1 text-sm text-muted-foreground">Point HosteraX at any git repo. We handle build, SSL, and hosting.</p>
          <Link to="/new" className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            <Plus className="h-4 w-4" /> Create project
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const stack = STACKS.find((s) => s.id === p.stack);
            return (
              <Link
                key={p.id} to="/p/$slug" params={{ slug: p.slug }}
                className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-2 text-lg">{stack?.icon ?? "📦"}</div>
                    <div>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{stack?.name ?? p.stack}</div>
                    </div>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
                  {p.subdomain && (
                    <div className="flex items-center gap-1.5 truncate"><Globe className="h-3 w-3" /> {p.subdomain}.hosterax.app</div>
                  )}
                  <div className="flex items-center gap-1.5"><GitBranch className="h-3 w-3" /> {p.branch}</div>
                  <div>Updated {formatDistanceToNow(new Date(p.updated_at))} ago</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
