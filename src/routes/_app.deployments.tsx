import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/hx/status-badge";
import { format } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEngine } from "@/lib/engine";

export const Route = createFileRoute("/_app/deployments")({
  head: () => ({ meta: [{ title: "Deployments — HosteraX" }] }),
  component: DeploymentsPage,
});

const PAGE_SIZE = 50;

type DeploymentRow = {
  id: string;
  project: string;
  version?: string;
  phase: string;
  trigger?: string;
  started_at?: number | null;
  finished_at?: number | null;
  environment?: string;
  commit_message?: string;
  commit_sha?: string;
  branch?: string;
};

type DeploymentCursor = { startedAt: number; id: string };
type DeploymentPage = { items: DeploymentRow[]; nextCursor: DeploymentCursor | null };

function DeploymentsPage() {
  const engine = useEngine();
  const [olderDeployments, setOlderDeployments] = useState<DeploymentRow[]>([]);
  const [olderCursor, setOlderCursor] = useState<DeploymentCursor | null>(null);
  const [hasLoadedOlder, setHasLoadedOlder] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [loadOlderError, setLoadOlderError] = useState("");
  const olderRequest = useRef<AbortController | null>(null);
  const latestRows = useRef<DeploymentRow[]>([]);

  const deploymentsQuery = useQuery({
    queryKey: ["deployment-history", engine.url, engine.token],
    queryFn: ({ signal }) =>
      engine.call<DeploymentPage>("GET", `/api/deployments/page?limit=${PAGE_SIZE}`, undefined, {
        signal,
      }),
    refetchInterval: 10000,
    staleTime: 5000,
  });

  useEffect(() => {
    olderRequest.current?.abort();
    latestRows.current = [];
    setOlderDeployments([]);
    setOlderCursor(null);
    setHasLoadedOlder(false);
    setLoadOlderError("");
    setIsLoadingOlder(false);
    return () => olderRequest.current?.abort();
  }, [engine.url, engine.token]);

  const latestDeployments = deploymentsQuery.data?.items || [];
  const nextCursor = hasLoadedOlder ? olderCursor : deploymentsQuery.data?.nextCursor || null;
  const canLoadOlder = Boolean(nextCursor);

  useEffect(() => {
    const previous = latestRows.current;
    if (hasLoadedOlder && previous.length) {
      const currentIds = new Set(latestDeployments.map((deployment) => deployment.id));
      const displaced = previous.filter((deployment) => !currentIds.has(deployment.id));
      if (displaced.length) {
        setOlderDeployments((current) => {
          const knownIds = new Set([...latestDeployments, ...current].map((deployment) => deployment.id));
          return [
            ...displaced.filter((deployment) => !knownIds.has(deployment.id)),
            ...current,
          ];
        });
      }
    }
    latestRows.current = latestDeployments;
  }, [latestDeployments, hasLoadedOlder]);

  const loadOlder = async () => {
    if (!nextCursor || isLoadingOlder) return;
    const controller = new AbortController();
    olderRequest.current = controller;
    setIsLoadingOlder(true);
    setLoadOlderError("");

    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      beforeStartedAt: String(nextCursor.startedAt),
      beforeId: nextCursor.id,
    });

    try {
      const page = await engine.call<DeploymentPage>(
        "GET",
        `/api/deployments/page?${params.toString()}`,
        undefined,
        { signal: controller.signal },
      );
      setOlderDeployments((current) => {
        const currentIds = new Set(
          [...latestDeployments, ...current].map((deployment) => deployment.id),
        );
        return [...current, ...page.items.filter((deployment) => !currentIds.has(deployment.id))];
      });
      setOlderCursor(page.nextCursor);
      setHasLoadedOlder(true);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setLoadOlderError(error instanceof Error ? error.message : "Could not load older deployments.");
      }
    } finally {
      if (olderRequest.current === controller) {
        olderRequest.current = null;
        setIsLoadingOlder(false);
      }
    }
  };

  const data = [...latestDeployments, ...olderDeployments].map((deployment) => {
    const startedAt = deployment.started_at ? new Date(deployment.started_at) : null;
    const createdAt = startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt : null;
    return {
      id: deployment.id,
      project: deployment.project,
      commitMessage: deployment.commit_message || `Release ${deployment.version}`,
      commitSha: deployment.commit_sha || deployment.id.slice(0, 8),
      version: deployment.version,
      branch: deployment.branch || "main",
      environment: deployment.environment || "production",
      trigger: deployment.trigger || "manual",
      status:
        deployment.phase === "ready"
          ? "success"
          : deployment.phase === "failed"
            ? "failed"
            : deployment.phase || "building",
      createdAt,
      durationMs:
        deployment.finished_at && deployment.started_at
          ? deployment.finished_at - deployment.started_at
          : undefined,
    };
  });

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Deployments</h1>
          <p className="text-sm text-muted-foreground">
            Recent builds and releases tracked in the HosteraX engine.
          </p>
        </div>
        <div className="text-xs text-muted-foreground" aria-live="polite">
          Showing {data.length} deployment{data.length === 1 ? "" : "s"}
        </div>
      </div>

      {deploymentsQuery.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <span className="flex items-center gap-2 text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            {data.length
              ? "Could not refresh the latest deployments. Showing the last loaded results."
              : "Could not load deployments."}
          </span>
          <button
            type="button"
            onClick={() => deploymentsQuery.refetch()}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            Retry
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {deploymentsQuery.isPending ? (
          <div className="p-8 text-center text-sm text-muted-foreground" role="status">
            Loading deployments…
          </div>
        ) : deploymentsQuery.isError && !deploymentsQuery.data ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Deployment history is unavailable.
          </div>
        ) : data.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No deployments yet.</div>
        ) : (
          <>
            <div className="divide-y divide-border">
              {data.map((deployment) => (
                <Link
                  key={deployment.id}
                  to="/p/$slug"
                  params={{ slug: deployment.project }}
                  className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-accent"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <StatusBadge status={deployment.status} />
                    <div className="min-w-0">
                      <div className="break-words text-sm font-medium">
                        {deployment.project}{" "}
                        <span className="text-muted-foreground">/ {deployment.commitMessage}</span>
                        {deployment.version && (
                          <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                            {deployment.version}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{deployment.commitSha}</span>
                        <span>·</span>
                        <span>{deployment.environment}</span>
                        <span>·</span>
                        <span>{deployment.trigger}</span>
                        {deployment.durationMs !== undefined && (
                          <>
                            <span>·</span>
                            <span>{(deployment.durationMs / 1000).toFixed(1)}s</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs font-mono text-muted-foreground">
                    {deployment.createdAt
                      ? format(deployment.createdAt, "yyyy-MM-dd HH:mm:ss")
                      : "Time unavailable"}
                  </div>
                </Link>
              ))}
            </div>

            {loadOlderError && (
              <div role="alert" className="border-t border-border px-4 py-3 text-sm text-destructive">
                {loadOlderError}
              </div>
            )}
            {canLoadOlder && (
              <div className="flex justify-center border-t border-border p-4">
                <button
                  type="button"
                  disabled={isLoadingOlder}
                  onClick={loadOlder}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60"
                >
                  {isLoadingOlder ? "Loading…" : "Load older deployments"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
