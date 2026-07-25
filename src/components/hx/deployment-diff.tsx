import { useState } from "react";
import { FileCode, X } from "lucide-react";

type Dep = {
  id: string;
  version?: string | null;
  commit_sha?: string | null;
  commit_message?: string | null;
  branch?: string | null;
  environment?: string | null;
  trigger_type?: string | null;
  status?: string | null;
  duration_ms?: number | null;
};

type Props = {
  deployments: Dep[];
  initialBaseId?: string;
  onClose: () => void;
};

export function DeploymentDiffModal({ deployments, initialBaseId, onClose }: Props) {
  const [baseId, setBaseId] = useState<string>(initialBaseId ?? deployments[1]?.id ?? deployments[0]?.id ?? "");
  const [compareId, setCompareId] = useState<string>(deployments[0]?.id ?? "");

  const base = deployments.find((d) => d.id === baseId);
  const compare = deployments.find((d) => d.id === compareId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
      <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <FileCode className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Deployment Diff</h3>
              <p className="text-xs text-muted-foreground">Compare two releases</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-4 border-b border-border bg-surface/50 p-4 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-[11px] font-mono uppercase text-muted-foreground">Base (A)</label>
            <select value={baseId} onChange={(e) => setBaseId(e.target.value)} className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs outline-none focus:border-primary">
              {deployments.map((d) => (
                <option key={d.id} value={d.id}>{d.version || d.id.slice(0, 8)} · {d.commit_sha ?? ""}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-mono uppercase text-muted-foreground">Target (B)</label>
            <select value={compareId} onChange={(e) => setCompareId(e.target.value)} className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs outline-none focus:border-primary">
              {deployments.map((d) => (
                <option key={d.id} value={d.id}>{d.version || d.id.slice(0, 8)} · {d.commit_sha ?? ""}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <div className="grid gap-6 md:grid-cols-2">
            {[base, compare].map((d, i) => (
              <div key={i} className="space-y-3 rounded-xl border border-border/80 bg-surface/30 p-5">
                <div className="flex items-center justify-between border-b border-border/60 pb-3">
                  <span className="font-mono text-sm font-semibold text-primary">{d?.version || (i === 0 ? "Release A" : "Release B")}</span>
                  <span className="rounded bg-surface-2 px-2 py-0.5 font-mono text-xs uppercase text-muted-foreground">{d?.status ?? "—"}</span>
                </div>
                <Row k="Commit" v={d?.commit_sha ?? "—"} mono />
                <Row k="Message" v={d?.commit_message ?? "—"} />
                <Row k="Branch" v={d?.branch ?? "—"} mono />
                <Row k="Environment" v={(d?.environment ?? "—").toUpperCase()} />
                <Row k="Trigger" v={d?.trigger_type ?? "—"} />
                <Row k="Duration" v={d?.duration_ms ? `${(d.duration_ms / 1000).toFixed(1)}s` : "—"} mono />
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border bg-surface px-6 py-3 text-xs">
          <span className="text-muted-foreground">Release comparison</span>
          <button onClick={onClose} className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">Close</button>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between border-b border-border/40 py-1 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className={`max-w-[220px] truncate text-foreground ${mono ? "font-mono" : ""}`}>{v}</span>
    </div>
  );
}
