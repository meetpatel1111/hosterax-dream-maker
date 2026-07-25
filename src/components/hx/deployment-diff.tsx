import { useState } from "react";
import { ChevronRight, FileCode, CheckCircle, XCircle, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEngine } from "@/lib/engine";

type DeploymentDiffProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  deploymentId: string;
};

export function DeploymentDiffModal({ open, onOpenChange, deploymentId }: DeploymentDiffProps) {
  const engine = useEngine();
  const { data: diff, isLoading } = useQuery({
    queryKey: ["deploy-diff", deploymentId, engine.url],
    queryFn: async () => engine.call<any>("GET", `/api/deployments/${deploymentId}/diff`),
    enabled: open,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
      <div className="flex h-[85vh] w-full max-w-5xl flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <FileCode className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Deployment Diff & Release Comparison</h3>
              <p className="text-xs text-muted-foreground">Compare configurations, variables, and specs between releases</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Selection Bar */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-border bg-surface/50 p-4">
          {/* Base Release */}
          <div className="space-y-1">
            <label className="text-[11px] font-mono text-muted-foreground uppercase">Base Release (A)</label>
            <select
              value={baseId}
              onChange={(e) => setBaseId(e.target.value)}
              className="w-full rounded-md border border-input bg-input/40 px-3 py-2 text-xs font-mono outline-none focus:border-primary"
            >
              {deployments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.version || "v1.0.0"} · {d.commit_sha} ({d.commit_message || d.branch})
                </option>
              ))}
            </select>
          </div>

          {/* Target Release */}
          <div className="space-y-1">
            <label className="text-[11px] font-mono text-muted-foreground uppercase">Target Release (B)</label>
            <select
              value={compareId}
              onChange={(e) => setCompareId(e.target.value)}
              className="w-full rounded-md border border-input bg-input/40 px-3 py-2 text-xs font-mono outline-none focus:border-primary"
            >
              {deployments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.version || "v1.0.0"} · {d.commit_sha} ({d.commit_message || d.branch})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Side-by-side comparison body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Base Column */}
            <div className="space-y-4 rounded-xl border border-border/80 bg-surface/30 p-5">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <span className="font-mono text-sm font-semibold text-primary">{base?.version || "Release A"}</span>
                <span className="rounded bg-surface-2 px-2 py-0.5 text-xs font-mono uppercase text-muted-foreground">
                  {base?.status}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Commit SHA</span>
                  <span className="font-mono text-foreground">{base?.commit_sha}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Message</span>
                  <span className="truncate max-w-[200px] text-foreground">{base?.commit_message || "—"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Branch</span>
                  <span className="font-mono text-foreground">{base?.branch}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Environment</span>
                  <span className="uppercase text-foreground">{base?.environment}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Trigger</span>
                  <span className="text-foreground">{base?.trigger_type}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Build Duration</span>
                  <span className="font-mono text-foreground">
                    {base?.duration_ms ? `${(base.duration_ms / 1000).toFixed(1)}s` : "N/A"}
                  </span>
                </div>
              </div>
            </div>

            {/* Target Column */}
            <div className="space-y-4 rounded-xl border border-border/80 bg-surface/30 p-5">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <span className="font-mono text-sm font-semibold text-primary">{compare?.version || "Release B"}</span>
                <span className="rounded bg-surface-2 px-2 py-0.5 text-xs font-mono uppercase text-muted-foreground">
                  {compare?.status}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Commit SHA</span>
                  <span className="font-mono text-foreground">{compare?.commit_sha}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Message</span>
                  <span className="truncate max-w-[200px] text-foreground">{compare?.commit_message || "—"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Branch</span>
                  <span className="font-mono text-foreground">{compare?.branch}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Environment</span>
                  <span className="uppercase text-foreground">{compare?.environment}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Trigger</span>
                  <span className="text-foreground">{compare?.trigger_type}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Build Duration</span>
                  <span className="font-mono text-foreground">
                    {compare?.duration_ms ? `${(compare.duration_ms / 1000).toFixed(1)}s` : "N/A"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Config Delta Summary */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <h4 className="text-xs font-semibold tracking-tight uppercase text-muted-foreground">
              Configuration Diff Summary
            </h4>
            <div className="space-y-2 font-mono text-xs">
              <div className="flex items-center gap-2 text-success">
                <span>+</span>
                <span>NODE_ENV=production</span>
              </div>
              <div className="flex items-center gap-2 text-destructive">
                <span>-</span>
                <span>DEBUG=true</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <span>~</span>
                <span>PORT: 3000 (unchanged)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border bg-surface px-6 py-3 text-xs">
          <span className="text-muted-foreground">Side-by-side spec comparison engine</span>
          <button
            onClick={onClose}
            className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Close Diff
          </button>
        </div>
      </div>
    </div>
  );
}


