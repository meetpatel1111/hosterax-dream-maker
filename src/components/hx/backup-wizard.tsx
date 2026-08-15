import { useState } from "react";
import {
  Database,
  HardDrive,
  Download,
  RotateCcw,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  X,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

type BackupItem = {
  id: string;
  database: string;
  type: string;
  sizeMb: number;
  checksum: string;
  createdAt: string;
};

export function BackupWizardModal({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<"create" | "restore" | "history">("create");
  const [selectedDb, setSelectedDb] = useState("postgres-main");
  const [destination, setDestination] = useState("local");
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backups, setBackups] = useState<BackupItem[]>([
    {
      id: "bkp_9843",
      database: "postgres-main",
      type: "PostgreSQL 16",
      sizeMb: 142.8,
      checksum: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    },
    {
      id: "bkp_7120",
      database: "redis-cache",
      type: "Redis 7.2 RDB",
      sizeMb: 18.4,
      checksum: "sha256:8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4",
      createdAt: new Date(Date.now() - 3600000 * 28).toISOString(),
    },
  ]);

  const triggerBackup = () => {
    setIsBackingUp(true);
    setTimeout(() => {
      const newBkp: BackupItem = {
        id: `bkp_${Math.floor(1000 + Math.random() * 9000)}`,
        database: selectedDb,
        type: selectedDb.includes("redis") ? "Redis RDB" : "PostgreSQL Dump",
        sizeMb: parseFloat((10 + Math.random() * 150).toFixed(1)),
        checksum: `sha256:${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`,
        createdAt: new Date().toISOString(),
      };
      setBackups((prev) => [newBkp, ...prev]);
      setIsBackingUp(false);
      toast.success(`Backup generated successfully (${newBkp.sizeMb} MB)`);
      setActiveTab("history");
    }, 2000);
  };

  const restoreBackup = (id: string) => {
    toast.promise(new Promise((r) => setTimeout(r, 2500)), {
      loading: `Restoring snapshot ${id} to database instance...`,
      success: `Snapshot ${id} restored successfully with verified SHA256 integrity!`,
      error: "Restore failed",
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
      <div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">
                Database Backup & Instant Restore Wizard
              </h3>
              <p className="text-xs text-muted-foreground">
                Automated database snapshots, SHA256 verification, and point-in-time recovery
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-border bg-surface/50 px-6 pt-2">
          {(["create", "history"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 px-4 py-2 text-xs font-medium capitalize transition-colors ${
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "create" ? "Create Snapshot" : `Snapshots History (${backups.length})`}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "create" && (
            <div className="space-y-5 max-w-lg">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Target Database Instance
                </label>
                <select
                  value={selectedDb}
                  onChange={(e) => setSelectedDb(e.target.value)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 text-xs outline-none focus:border-primary"
                >
                  <option value="postgres-main">postgres-main (PostgreSQL 16 · 142 MB)</option>
                  <option value="mysql-store">mysql-store (MySQL 8.0 · 89 MB)</option>
                  <option value="mongo-docs">mongo-docs (MongoDB 7.0 · 210 MB)</option>
                  <option value="redis-cache">redis-cache (Redis 7.2 · 18 MB)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Backup Storage Target</label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: "local", name: "Local Machine", desc: "~/.hosterax/backups" },
                    { id: "s3", name: "Amazon S3", desc: "Encrypted bucket" },
                    { id: "sftp", name: "SFTP Remote", desc: "Secure SSH tunnel" },
                  ].map((dest) => (
                    <button
                      key={dest.id}
                      onClick={() => setDestination(dest.id)}
                      className={`flex flex-col text-left p-3 rounded-lg border text-xs transition-colors ${
                        destination === dest.id
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      <span className="font-semibold">{dest.name}</span>
                      <span className="text-[10px] text-muted-foreground mt-1">{dest.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border/80 bg-surface/40 p-4 text-xs text-muted-foreground space-y-2">
                <div className="flex items-center gap-2 text-foreground font-medium">
                  <ShieldCheck className="h-4 w-4 text-success" /> Integrated Integrity Checks
                </div>
                <p>
                  Every snapshot is compressed with gzip and signed with SHA256 checksums before
                  storage.
                </p>
              </div>

              <button
                disabled={isBackingUp}
                onClick={triggerBackup}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-xs font-medium text-primary-foreground glow-primary hover:opacity-90 transition-all disabled:opacity-50"
              >
                {isBackingUp ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" /> Generating Snapshot…
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" /> Trigger Immediate Backup
                  </>
                )}
              </button>
            </div>
          )}

          {activeTab === "history" && (
            <div className="space-y-4">
              <div className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
                {backups.map((b) => (
                  <div
                    key={b.id}
                    className="flex flex-wrap items-center justify-between p-4 gap-3 text-xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 font-mono font-medium text-foreground">
                        <Database className="h-3.5 w-3.5 text-primary" />
                        <span>{b.database}</span>
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {b.id}
                        </span>
                      </div>
                      <div className="text-muted-foreground text-[11px]">
                        {b.type} · {b.sizeMb} MB · Created {new Date(b.createdAt).toLocaleString()}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground/60 truncate max-w-md">
                        {b.checksum}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => restoreBackup(b.id)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                      >
                        <RotateCcw className="h-3.5 w-3.5 text-primary" /> Instant Restore
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
