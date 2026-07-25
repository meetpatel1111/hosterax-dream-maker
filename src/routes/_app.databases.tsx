import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/hx/status-badge";
import { BackupWizardModal } from "@/components/hx/backup-wizard";
import { useState } from "react";
import { Plus, Database as DbIcon, Search, MoreHorizontal, Terminal, Activity, ArrowRight, Settings } from "lucide-react";
import { useEngine } from "@/lib/engine";

export const Route = createFileRoute("/_app/databases")({
  head: () => ({ meta: [{ title: "Databases — HosteraX" }] }),
  component: DatabasesPage,
});

function DatabasesPage() {
  const engine = useEngine();
  const [showBackupModal, setShowBackupModal] = useState(false);
  const { data = [] } = useQuery({
    queryKey: ["databases", engine.url],
    queryFn: async () => {
      try {
        const res = await engine.call<any[]>("GET", "/api/databases");
        return res ?? [];
      } catch (e) {
        return [];
      }
    },
    refetchInterval: 3000,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Databases</h1>
          <p className="text-sm text-muted-foreground">Managed database instances & automated backups across projects.</p>
        </div>
        <button
          onClick={() => setShowBackupModal(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground glow-primary hover:opacity-90 transition-all"
        >
          <Database className="h-4 w-4" /> Backup & Restore Wizard
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {data.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary mb-3">
              <Database className="h-5 w-5" />
            </div>
            No database instances provisioned yet.
            <div className="mt-1 text-xs">Open any project → Databases tab to provision Postgres, MySQL, Mongo, or Redis.</div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.map((d: any) => (
              <Link key={d.id} to="/p/$slug" params={{ slug: d.projects?.slug ?? "" }} className="flex items-center gap-4 p-4 hover:bg-accent/40 transition-colors">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 font-mono text-xs uppercase font-semibold text-primary">{d.engine.slice(0, 2)}</div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-foreground">{d.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{d.projects?.name} · {d.engine} · {d.size_mb} MB</div>
                </div>
                <StatusBadge status={d.status} />
              </Link>
            ))}
          </div>
        )}
      </div>

      {showBackupModal && <BackupWizardModal onClose={() => setShowBackupModal(false)} />}
    </div>
  );
}


