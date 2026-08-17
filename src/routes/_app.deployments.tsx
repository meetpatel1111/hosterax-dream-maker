import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/hx/status-badge";
import { format } from "date-fns";
import { useEngine } from "@/lib/engine";

export const Route = createFileRoute("/_app/deployments")({
  head: () => ({ meta: [{ title: "Deployments — HosteraX" }] }),
  component: DeploymentsPage,
});

function DeploymentsPage() {
  const engine = useEngine();

  const { data = [] } = useQuery({
    queryKey: ["all-deployments-sqlite", engine.url],
    queryFn: async () => {
      try {
        const deps = await engine.call<any[]>("GET", "/api/deployments?limit=100");
        if (deps && Array.isArray(deps)) {
          return deps.map((d: any) => ({
            id: d.id,
            projects: { name: d.project, slug: d.project },
            commit_message: d.commit_message || `Release ${d.version}`,
            commit_sha: d.commit_sha || d.id.slice(0, 8),
            version: d.version,
            branch: d.branch || "main",
            environment: d.environment || "production",
            trigger_type: d.trigger || "manual",
            phase: d.phase,
            status: d.phase === "ready" ? "success" : d.phase === "failed" ? "error" : "building",
            created_at: d.started_at
              ? new Date(d.started_at).toISOString()
              : new Date().toISOString(),
            duration_ms: d.finished_at && d.started_at ? d.finished_at - d.started_at : undefined,
          }));
        }
      } catch {}
      return [];
    },
    refetchInterval: 3000,
  });

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Deployments</h1>
        <p className="text-sm text-muted-foreground">
          All builds and releases tracked in HosteraX SQLite database.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card">
        {data.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No deployments yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {data.map((d: any) => (
              <Link
                key={d.id}
                to="/p/$slug"
                params={{ slug: d.projects?.slug ?? "" }}
                className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-3">
                  <StatusBadge status={d.status} />
                  <div>
                    <div className="text-sm font-medium">
                      {d.projects?.name}{" "}
                      <span className="text-muted-foreground">/ {d.commit_message ?? "—"}</span>
                      {d.version && (
                        <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                          {d.version}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{d.commit_sha}</span>
                      <span>·</span>
                      <span>{d.environment}</span>
                      <span>·</span>
                      <span>{d.trigger_type}</span>
                      {d.duration_ms && (
                        <>
                          <span>·</span>
                          <span>{(d.duration_ms / 1000).toFixed(1)}s</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  {format(new Date(d.created_at), "yyyy-MM-dd HH:mm:ss")}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
