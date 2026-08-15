import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/hx/status-badge";
import { Activity, Terminal, ExternalLink, X, RotateCcw, Clock, Layers } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useEngine } from "@/lib/engine";

type DeployItem = {
  id: string;
  project_id: string;
  commit_sha: string;
  commit_message: string | null;
  branch: string;
  status: string;
  phase: string | null;
  version: string | null;
  environment: string;
  trigger_type: string;
  duration_ms: number | null;
  created_at: string;
  projects?: { name: string; slug: string; stack: string } | null;
};

export function DeployFeed() {
  const engine = useEngine();
  const [selectedDeploy, setSelectedDeploy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "failed">("all");

  const { data: deployments = [] } = useQuery({
    queryKey: ["deploy-feed-sqlite", engine.url],
    queryFn: async () => {
      try {
        const deps = await engine.call<any[]>("GET", "/api/deployments?limit=25");
        if (deps && Array.isArray(deps)) {
          return deps.map((d: any) => ({
            id: d.id,
            project_id: d.project,
            commit_sha: d.commit_sha || d.id.slice(0, 8),
            commit_message: d.commit_message || `Release ${d.version}`,
            branch: d.branch || "main",
            status: d.phase === "ready" ? "success" : d.phase === "failed" ? "failed" : "building",
            phase: d.phase,
            version: d.version,
            environment: d.environment || "production",
            trigger_type: d.trigger || "manual",
            duration_ms: d.finished_at && d.started_at ? d.finished_at - d.started_at : null,
            created_at: d.started_at ? new Date(d.started_at).toISOString() : new Date().toISOString(),
            projects: { name: d.project, slug: d.project, stack: "auto" },
          })) as DeployItem[];
        }
      } catch {}
      return [];
    },
    refetchInterval: 2500,
  });

  const filtered = deployments.filter((d) => {
    if (filter === "active")
      return d.status === "building" || d.status === "queued" || d.phase === "deploying";
    if (filter === "failed") return d.status === "failed";
    return true;
  });

  const activeCount = deployments.filter(
    (d) => d.status === "building" || d.status === "queued",
  ).length;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 bg-surface/50">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Live Deployment Feed</h3>
            <p className="text-xs text-muted-foreground">
              Real-time build pipeline across all projects in SQLite
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-mono font-medium text-primary border border-primary/30">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              {activeCount} active build{activeCount === 1 ? "" : "s"}
            </span>
          )}

          <div className="flex rounded-md border border-border bg-background/60 p-0.5 text-xs">
            {(["all", "active", "failed"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded px-2.5 py-1 font-medium capitalize transition-colors ${
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Feed List */}
      <div className="divide-y divide-border/60 max-h-[380px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            No deployments matching <span className="font-mono text-foreground">"{filter}"</span>{" "}
            filter.
          </div>
        ) : (
          filtered.map((d) => (
            <div
              key={d.id}
              onClick={() => setSelectedDeploy(d.id)}
              className="group flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-accent/40 cursor-pointer"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <StatusBadge status={d.status} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate text-foreground group-hover:text-primary transition-colors">
                      {d.projects?.name ?? "Project"}
                    </span>
                    <span className="text-muted-foreground/60">/</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {d.commit_message || d.commit_sha}
                    </span>
                    {d.version && (
                      <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                        {d.version}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{d.commit_sha}</span>
                    <span>·</span>
                    <span>{d.branch}</span>
                    <span>·</span>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-mono uppercase">
                      {d.environment}
                    </span>
                    <span>·</span>
                    <span className="uppercase text-[10px] tracking-wide">{d.trigger_type}</span>
                    {d.phase && (
                      <>
                        <span>·</span>
                        <span className="text-primary font-mono">phase: {d.phase}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                <div className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  <span>{formatDistanceToNow(new Date(d.created_at))} ago</span>
                </div>
                <span className="font-mono text-foreground/80">
                  {d.duration_ms ? `${(d.duration_ms / 1000).toFixed(1)}s` : "completed"}
                </span>
                <Terminal className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Log Drawer Modal */}
      {selectedDeploy && (
        <DeployLogModal deploymentId={selectedDeploy} onClose={() => setSelectedDeploy(null)} />
      )}
    </div>
  );
}

function DeployLogModal({ deploymentId, onClose }: { deploymentId: string; onClose: () => void }) {
  const engine = useEngine();
  const [logText, setLogText] = useState<string>("");

  useEffect(() => {
    fetch(`${engine.url}/api/deployments/${deploymentId}/logs`, {
      headers: { Authorization: `Bearer ${engine.token}` },
    })
      .then((r) => r.text())
      .then((t) => setLogText(t))
      .catch(() => setLogText("Logs stream unavailable"));
  }, [deploymentId, engine.url, engine.token]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex h-[80vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-border bg-surface px-5 py-3.5">
          <div className="flex items-center gap-2 font-mono text-sm">
            <Terminal className="h-4 w-4 text-primary" />
            <span className="font-semibold text-foreground">Build Logs</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">{deploymentId}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-black/80 p-5 font-mono text-xs leading-relaxed space-y-1">
          {!logText ? (
            <div className="text-muted-foreground">Waiting for build logs stream…</div>
          ) : (
            <pre className="whitespace-pre-wrap text-foreground/90 font-mono">{logText}</pre>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-surface px-5 py-2.5 text-xs text-muted-foreground">
          <span>Captured from HosteraX SQLite Engine</span>
          <button
            onClick={onClose}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
