import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/hx/status-badge";
import { BackupWizardModal } from "@/components/hx/backup-wizard";
import { useState } from "react";
import { AlertTriangle, Database, Search, Table as TableIcon, ShieldCheck } from "lucide-react";
import { useEngine } from "@/lib/engine";
import { DatabaseStudio } from "@/components/hx/database-studio";

export const Route = createFileRoute("/_app/databases")({
  head: () => ({ meta: [{ title: "Databases — HosteraX" }] }),
  component: DatabasesPage,
});

type ManagedDatabaseSummary = {
  id: string;
  project: string;
  name: string;
  engine: string;
  size_mb: number;
  status: string;
};

function DatabasesPage() {
  const engine = useEngine();
  const [activeTab, setActiveTab] = useState<"instances" | "studio">("instances");
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [search, setSearch] = useState("");
  const databasesQuery = useQuery({
    queryKey: ["databases", engine.url, engine.token],
    queryFn: ({ signal }) =>
      engine.call<ManagedDatabaseSummary[]>("GET", "/api/databases", undefined, { signal }),
    refetchInterval: 15000,
    staleTime: 10000,
  });
  const data = databasesQuery.data || [];
  const query = search.trim().toLowerCase();
  const filtered = data.filter((database) =>
    [database.name, database.project, database.engine].some((value) =>
      value.toLowerCase().includes(query),
    ),
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Databases</h1>
          <p className="text-sm text-muted-foreground">
            Managed database instances, automated backups, and visual SQL studio.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/backups"
            className="inline-flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-all"
          >
            <ShieldCheck className="h-4 w-4" /> Disaster Recovery &amp; Drills Hub
          </Link>
          <button
            type="button"
            onClick={() => setShowBackupModal(true)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground glow-primary transition-all hover:opacity-90"
          >
            <Database className="h-4 w-4" /> Quick Backup Modal
          </button>
        </div>
      </div>

      {/* Subtabs Switcher */}
      <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-lg border border-border/60 text-xs font-medium w-fit">
        <button
          type="button"
          data-testid="tab-db-instances"
          onClick={() => setActiveTab("instances")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all ${
            activeTab === "instances"
              ? "bg-background text-foreground shadow-xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Database className="h-3.5 w-3.5 text-primary" />
          <span>Managed Instances</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-muted font-mono">
            {data.length}
          </span>
        </button>

        <button
          type="button"
          data-testid="tab-db-studio"
          onClick={() => setActiveTab("studio")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all ${
            activeTab === "studio"
              ? "bg-background text-foreground shadow-xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <TableIcon className="h-3.5 w-3.5 text-cyan-400" />
          <span>Database Studio &amp; SQL</span>
        </button>
      </div>

      {activeTab === "studio" && <DatabaseStudio databases={data} />}

      {activeTab === "instances" && (
        <div className="space-y-6">
          {data.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="relative block min-w-[240px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  aria-label="Search databases"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by database, project, or engine..."
                  className="w-full rounded-md border border-input bg-input/40 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
                />
              </label>
              <span className="text-xs text-muted-foreground" aria-live="polite">
                Showing {filtered.length} of {data.length} database{data.length === 1 ? "" : "s"}
              </span>
            </div>
          )}

          {databasesQuery.isError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                {data.length
                  ? "Could not refresh databases. Showing the last loaded results."
                  : "Could not load databases."}
              </span>
              <button
                type="button"
                onClick={() => databasesQuery.refetch()}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Retry
              </button>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {databasesQuery.isPending ? (
              <div className="p-12 text-center text-sm text-muted-foreground" role="status">
                Loading database instances…
              </div>
            ) : databasesQuery.isError && data.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                Database inventory is unavailable.
              </div>
            ) : data.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Database className="h-5 w-5" />
                </div>
                No database instances provisioned yet.
                <div className="mt-1 text-xs">
                  Open any project → Databases tab to provision Postgres, MySQL, Mongo, or Redis.
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">
                No databases match “{search}”.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filtered.map((database) => (
                  <Link
                    key={database.id}
                    to="/p/$slug"
                    params={{ slug: database.project }}
                    className="flex items-center gap-4 p-4 transition-colors hover:bg-accent/40"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-xs font-semibold uppercase text-primary">
                      {database.engine.slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-sm font-medium text-foreground">
                        {database.name}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {database.project} · {database.engine} · {database.size_mb} MB
                      </div>
                    </div>
                    <StatusBadge status={database.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showBackupModal && <BackupWizardModal onClose={() => setShowBackupModal(false)} />}
    </div>
  );
}
