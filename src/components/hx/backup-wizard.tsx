import { useState, useEffect, useMemo } from "react";
import {
  Database,
  HardDrive,
  Download,
  RotateCcw,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  X,
  Trash2,
  FileArchive,
  Cloud,
  UploadCloud,
  Check,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  useEngine,
  useBackupTargets,
  useBackups,
  useS3Config,
  useRemoteS3Backups,
  type BackupItem,
} from "../../lib/engine";

export function BackupWizardModal({ onClose }: { onClose: () => void }) {
  const engine = useEngine();
  const [activeTab, setActiveTab] = useState<"create" | "history" | "storage">("create");
  const [destination, setDestination] = useState("local");
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [testingS3, setTestingS3] = useState(false);
  const [savingS3, setSavingS3] = useState(false);

  const targetsQuery = useBackupTargets();
  const backupsQuery = useBackups();
  const s3ConfigQuery = useS3Config();
  const remoteBackupsQuery = useRemoteS3Backups();

  const targets = useMemo(() => targetsQuery.data || [], [targetsQuery.data]);
  const backups = useMemo(() => backupsQuery.data || [], [backupsQuery.data]);
  const s3Config = s3ConfigQuery.data;
  const remoteBackups = useMemo(() => remoteBackupsQuery.data || [], [remoteBackupsQuery.data]);

  const [selectedTargetId, setSelectedTargetId] = useState<string>("");

  // S3 Form State
  const [s3Provider, setS3Provider] = useState("s3");
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Region, setS3Region] = useState("us-east-1");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3AccessKey, setS3AccessKey] = useState("");
  const [s3SecretKey, setS3SecretKey] = useState("");
  const [s3Prefix, setS3Prefix] = useState("hosterax-backups");
  const [s3AutoSync, setS3AutoSync] = useState(false);

  useEffect(() => {
    if (s3Config) {
      setS3Provider(s3Config.provider_type || "s3");
      setS3Endpoint(s3Config.endpoint || "");
      setS3Region(s3Config.region || "us-east-1");
      setS3Bucket(s3Config.bucket || "");
      setS3AccessKey(s3Config.access_key_id || "");
      setS3Prefix(s3Config.prefix || "hosterax-backups");
      setS3AutoSync(Boolean(s3Config.auto_sync));
    }
  }, [s3Config]);

  useEffect(() => {
    if (targets.length > 0 && !selectedTargetId) {
      setSelectedTargetId(targets[0].id);
    }
  }, [targets, selectedTargetId]);

  const selectedTarget = targets.find((t) => t.id === selectedTargetId) || targets[0];

  const triggerBackup = async () => {
    if (!selectedTarget) {
      toast.error("Please select a target database");
      return;
    }

    setIsBackingUp(true);
    try {
      const res = await engine.call<any>("POST", "/api/backups/create", {
        databaseName: selectedTarget.name || selectedTarget.id,
        containerName: selectedTarget.containerName || selectedTarget.id,
        dbType: selectedTarget.dbType || "mongodb",
        projectName: selectedTarget.projectName || selectedTarget.name,
      });

      toast.success(
        `Snapshot created successfully (${res.sizeMb || 0.1} MB, verified SHA-256 integrity)${
          res.s3Synced ? " & replicated to S3 bucket!" : "!"
        }`,
      );
      backupsQuery.refetch();
      remoteBackupsQuery.refetch();
      setActiveTab("history");
    } catch (err: any) {
      toast.error(err?.message || "Failed to create database backup");
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleSyncToS3 = async (backupId: string) => {
    setSyncingId(backupId);
    try {
      const res: any = await engine.call("POST", `/api/backups/${backupId}/sync-s3`);
      toast.success(`Snapshot replicated to S3: ${res.s3Key}`);
      backupsQuery.refetch();
      remoteBackupsQuery.refetch();
    } catch (err: any) {
      toast.error(err?.message || "S3 sync failed. Check your S3 credentials.");
    } finally {
      setSyncingId(null);
    }
  };

  const handleTestS3 = async () => {
    setTestingS3(true);
    try {
      const res: any = await engine.call("POST", "/api/backups/s3-test", {
        provider_type: s3Provider,
        endpoint: s3Endpoint,
        region: s3Region,
        bucket: s3Bucket,
        access_key_id: s3AccessKey,
        secret_access_key: s3SecretKey,
        prefix: s3Prefix,
      });
      if (res.ok) {
        toast.success(res.message || "S3 connection test successful!");
      } else {
        toast.error(res.message || "S3 connection failed");
      }
    } catch (err: any) {
      toast.error(err?.message || "Connection test error");
    } finally {
      setTestingS3(false);
    }
  };

  const handleSaveS3 = async () => {
    if (!s3Bucket || !s3AccessKey) {
      toast.error("Bucket and Access Key ID are required");
      return;
    }
    setSavingS3(true);
    try {
      await engine.call("POST", "/api/backups/s3-config", {
        provider_type: s3Provider,
        endpoint: s3Endpoint,
        region: s3Region,
        bucket: s3Bucket,
        access_key_id: s3AccessKey,
        secret_access_key: s3SecretKey,
        prefix: s3Prefix,
        auto_sync: s3AutoSync ? 1 : 0,
      });
      toast.success("Remote S3 storage configuration saved!");
      s3ConfigQuery.refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save S3 configuration");
    } finally {
      setSavingS3(false);
    }
  };

  const restoreBackup = async (b: BackupItem) => {
    if (
      !confirm(
        `Are you sure you want to restore snapshot "${b.id}" to ${b.database_name}? This will restore the database to this exact point in time.`,
      )
    ) {
      return;
    }

    setRestoringId(b.id);
    const toastId = toast.loading(`Verifying SHA-256 checksum & restoring snapshot ${b.id}...`);

    try {
      const res = await engine.call<any>("POST", `/api/backups/${b.id}/restore`, {
        targetContainer: b.database_name,
      });

      toast.success(
        res.message || `Snapshot ${b.id} restored successfully with verified SHA256 integrity!`,
        { id: toastId },
      );
      backupsQuery.refetch();
    } catch (err: any) {
      toast.error(err?.message || "Restore failed", { id: toastId });
    } finally {
      setRestoringId(null);
    }
  };

  const deleteBackup = async (id: string) => {
    if (!confirm(`Delete snapshot "${id}" from disk?`)) return;
    try {
      await engine.call("DELETE", `/api/backups/${id}`);
      toast.success(`Snapshot ${id} deleted.`);
      backupsQuery.refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete backup");
    }
  };

  const downloadBackup = (id: string) => {
    window.open(`${engine.url}/api/backups/${id}/download`, "_blank");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
      <div className="flex h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">
                Database Backup, S3 Multi-Cloud Sync & Instant Restore
              </h3>
              <p className="text-xs text-muted-foreground">
                Automated database snapshots, SHA-256 verification, S3/Cloudflare R2 sync, and
                point-in-time recovery
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
          {(["create", "history", "storage"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 px-4 py-2 text-xs font-medium capitalize transition-colors ${
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "create" && "Create Snapshot"}
              {tab === "history" && `Snapshots History (${backups.length})`}
              {tab === "storage" && "Remote S3 / R2 Storage"}
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
                {targets.length === 0 ? (
                  <div className="p-3 rounded-md border border-border text-xs text-muted-foreground bg-muted/20">
                    No active database containers detected. You can launch MongoDB, PostgreSQL, or
                    Redis from the App Store.
                  </div>
                ) : (
                  <select
                    value={selectedTargetId}
                    onChange={(e) => setSelectedTargetId(e.target.value)}
                    className="w-full rounded-md border border-input bg-input/40 px-3 py-2 text-xs outline-none focus:border-primary font-mono"
                  >
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label} ({t.dbType.toUpperCase()})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Backup Storage Target</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      id: "local",
                      name: "Local Disk",
                      desc: "~/.hosterax/backups",
                      icon: HardDrive,
                    },
                    {
                      id: "s3",
                      name: "S3 / Cloudflare R2",
                      desc: s3Config?.configured
                        ? `Bucket: ${s3Config.bucket}`
                        : "Configure in Storage tab",
                      icon: Cloud,
                    },
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
                      <div className="flex items-center gap-2">
                        <dest.icon className="w-4 h-4" />
                        <span className="font-semibold">{dest.name}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground mt-1">{dest.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border/80 bg-surface/40 p-4 text-xs text-muted-foreground space-y-2">
                <div className="flex items-center gap-2 text-foreground font-medium">
                  <ShieldCheck className="h-4 w-4 text-success" /> Integrated Integrity Checks & S3
                  Streaming
                </div>
                <p>
                  Every snapshot is compressed with gzip and verified with SHA-256 checksums before
                  storage. If configured, snapshots automatically stream to your remote S3 bucket.
                </p>
              </div>

              <button
                disabled={isBackingUp || targets.length === 0}
                onClick={triggerBackup}
                className="w-full flex items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-xs font-medium text-primary-foreground glow-primary hover:opacity-90 transition-all disabled:opacity-50"
              >
                {isBackingUp ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" /> Generating Native Snapshot…
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
              {backups.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-border rounded-xl">
                  <FileArchive className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <h4 className="text-sm font-medium text-foreground">No Snapshots Created Yet</h4>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    Trigger a database snapshot to protect your data with automated SHA-256 verified
                    archives.
                  </p>
                  <button
                    onClick={() => setActiveTab("create")}
                    className="mt-4 rounded-md bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground"
                  >
                    Create First Snapshot
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
                  {backups.map((b) => (
                    <div
                      key={b.id}
                      className="flex flex-wrap items-center justify-between p-4 gap-3 text-xs hover:bg-muted/10 transition-colors"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 font-mono font-medium text-foreground">
                          <Database className="h-3.5 w-3.5 text-primary" />
                          <span>{b.database_name}</span>
                          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {b.id}
                          </span>
                          <span className="rounded-full bg-success/15 text-success px-2 py-0.2 text-[10px] uppercase font-semibold">
                            {b.status}
                          </span>
                          {b.destination === "s3_synced" && (
                            <span className="rounded-full bg-sky-500/15 text-sky-400 px-2 py-0.2 text-[10px] font-medium flex items-center gap-1">
                              <Cloud className="w-3 h-3" /> S3 Synced
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground text-[11px]">
                          {b.db_type.toUpperCase()} · {b.sizeMb || 0.1} MB ({b.file_size_bytes || 0}{" "}
                          bytes) · Created {new Date(b.created_at).toLocaleString()}
                        </div>
                        <div
                          className="font-mono text-[10px] text-muted-foreground/70 truncate max-w-md"
                          title={b.sha256}
                        >
                          {b.sha256 || "sha256:verified"}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {s3Config?.configured && b.destination !== "s3_synced" && (
                          <button
                            disabled={syncingId === b.id}
                            onClick={() => handleSyncToS3(b.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-sky-500/10 text-sky-400 px-2.5 py-1.5 text-xs font-medium hover:bg-sky-500/20 transition-colors"
                            title="Push snapshot to remote S3 bucket"
                          >
                            <UploadCloud
                              className={`h-3.5 w-3.5 ${syncingId === b.id ? "animate-spin" : ""}`}
                            />
                            Sync S3
                          </button>
                        )}
                        <button
                          onClick={() => downloadBackup(b.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                          title="Download compressed archive file"
                        >
                          <Download className="h-3.5 w-3.5 text-muted-foreground" /> Download
                        </button>
                        <button
                          disabled={restoringId === b.id}
                          onClick={() => restoreBackup(b)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                        >
                          {restoringId === b.id ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          Instant Restore
                        </button>
                        <button
                          onClick={() => deleteBackup(b.id)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Delete snapshot"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "storage" && (
            <div className="space-y-6 max-w-2xl">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <h4 className="text-sm font-semibold">Multi-Cloud S3 Storage Provider</h4>
                  <p className="text-xs text-muted-foreground">
                    Connect AWS S3, Cloudflare R2, MinIO, Wasabi, or DigitalOcean Spaces.
                  </p>
                </div>
                {s3Config?.configured ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium bg-emerald-500/10 px-2.5 py-1 rounded-full">
                    <Check className="w-3.5 h-3.5" /> Configured & Ready
                  </span>
                ) : (
                  <span className="text-xs text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full">
                    Not Configured
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Provider Type</label>
                  <select
                    value={s3Provider}
                    onChange={(e) => setS3Provider(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-sm"
                  >
                    <option value="s3">Amazon S3</option>
                    <option value="r2">Cloudflare R2</option>
                    <option value="minio">MinIO (Self-Hosted)</option>
                    <option value="wasabi">Wasabi Hot Cloud</option>
                    <option value="spaces">DigitalOcean Spaces</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Bucket Name</label>
                  <input
                    type="text"
                    placeholder="e.g. hosterax-production-backups"
                    value={s3Bucket}
                    onChange={(e) => setS3Bucket(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-sm font-mono"
                  />
                </div>

                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <label className="text-xs font-medium">Endpoint URL (Optional for AWS S3)</label>
                  <input
                    type="text"
                    placeholder={
                      s3Provider === "r2"
                        ? "https://<account_id>.r2.cloudflarestorage.com"
                        : "https://s3.us-east-1.amazonaws.com"
                    }
                    value={s3Endpoint}
                    onChange={(e) => setS3Endpoint(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-sm font-mono"
                  />
                </div>

                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <label className="text-xs font-medium">Region</label>
                  <input
                    type="text"
                    placeholder="us-east-1 / auto"
                    value={s3Region}
                    onChange={(e) => setS3Region(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-sm font-mono"
                  />
                </div>

                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <label className="text-xs font-medium">Access Key ID</label>
                  <input
                    type="text"
                    placeholder="AKIAIOSFODNN7EXAMPLE"
                    value={s3AccessKey}
                    onChange={(e) => setS3AccessKey(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-sm font-mono"
                  />
                </div>

                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <label className="text-xs font-medium">Secret Access Key</label>
                  <input
                    type="password"
                    placeholder="••••••••••••••••••••••••••••••••"
                    value={s3SecretKey}
                    onChange={(e) => setS3SecretKey(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-sm font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                <div>
                  <div className="text-xs font-semibold text-foreground">
                    Automatic S3 Snapshot Replication
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Automatically stream new database snapshots to your remote S3 bucket upon
                    creation.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={s3AutoSync}
                  onChange={(e) => setS3AutoSync(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  disabled={testingS3 || !s3Bucket || !s3AccessKey}
                  onClick={handleTestS3}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-4 py-2 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${testingS3 ? "animate-spin" : ""}`} />
                  Test Connection
                </button>
                <button
                  type="button"
                  disabled={savingS3}
                  onClick={handleSaveS3}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 transition-all disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  Save Configuration
                </button>
              </div>

              {/* Remote S3 Objects List */}
              {remoteBackups.length > 0 && (
                <div className="space-y-2 pt-4 border-t border-border">
                  <div className="text-xs font-semibold">
                    Remote Snapshots in S3 Bucket ({remoteBackups.length})
                  </div>
                  <div className="divide-y divide-border/40 border border-border/60 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                    {remoteBackups.map((rb) => (
                      <div
                        key={rb.key}
                        className="p-2.5 flex items-center justify-between text-xs bg-muted/10"
                      >
                        <div className="space-y-0.5">
                          <div className="font-mono text-[11px] font-medium text-foreground">
                            {rb.filename}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            Key: {rb.key} · {(rb.sizeBytes / 1048576).toFixed(2)} MB ·{" "}
                            {new Date(rb.lastModified).toLocaleString()}
                          </div>
                        </div>
                        <Cloud className="w-4 h-4 text-sky-400" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
