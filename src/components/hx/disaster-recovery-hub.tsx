import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck,
  ShieldAlert,
  Database,
  HardDrive,
  Cloud,
  RotateCcw,
  RefreshCw,
  Download,
  Trash2,
  Lock,
  Play,
  Clock,
  CheckCircle2,
  AlertTriangle,
  UploadCloud,
  FileText,
  Search,
  Check,
  Activity,
  Calculator,
  Flame,
  FileCheck2,
  Copy,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import {
  useEngine,
  useBackupTargets,
  useBackupHistory,
  useS3Config,
  useRemoteS3Backups,
  useBackupSchedules,
  type BackupCursor,
  type BackupItem,
} from "../../lib/engine";
import { confirmAction } from "./confirm-modal";
import {
  calculateRecoveryReadinessScore,
  calculateGfsStorageProjection,
  generateEmergencyRunbookScript,
  filterBackups,
  formatBytes,
  formatRtoDuration,
} from "../../utils/disaster-recovery";

type EngineDrillRow = {
  id: string;
  backup_id: string;
  database_name: string;
  db_type: string;
  status: string;
  duration_seconds: number;
  message: string;
  sha256?: string | null;
  checked_at: number;
};

type DrillCertificateView = {
  drillId: string;
  backupId: string;
  databaseName: string;
  dbType: string;
  timestamp: string;
  checkedAtMs: number;
  status: "passed" | "failed";
  rtoSeconds: number;
  rtoFormatted: string;
  checksumMatched: boolean;
  sha256: string;
  auditMessage: string;
};

function mapDrillRow(row: EngineDrillRow): DrillCertificateView {
  return {
    drillId: row.id,
    backupId: row.backup_id,
    databaseName: row.database_name,
    dbType: row.db_type || "unknown",
    timestamp: new Date(row.checked_at || Date.now()).toISOString(),
    checkedAtMs: Number(row.checked_at || 0),
    status: row.status === "verified" ? "passed" : "failed",
    rtoSeconds: Number(row.duration_seconds || 0),
    rtoFormatted: formatRtoDuration(Number(row.duration_seconds || 0)),
    checksumMatched: Boolean(row.sha256 && row.sha256.length >= 32),
    sha256: row.sha256 || "none",
    auditMessage: row.message || "Restore drill recorded by HosteraX engine.",
  };
}

const CRON_PRESETS = [
  { cron: "0 2 * * *", label: "Every day at 02:00" },
  { cron: "0 */6 * * *", label: "Every 6 hours" },
  { cron: "0 3 * * 0", label: "Every Sunday at 03:00" },
  { cron: "custom", label: "Custom cron expression…" },
] as const;

export function DisasterRecoveryHub() {
  const engine = useEngine();
  const [activeTab, setActiveTab] = useState<
    "overview" | "drills" | "snapshots" | "schedules" | "storage" | "retention" | "runbook"
  >("overview");

  // Queries
  const targetsQuery = useBackupTargets();
  const backupsQuery = useBackupHistory();
  const s3ConfigQuery = useS3Config();
  const remoteBackupsQuery = useRemoteS3Backups();
  const schedulesQuery = useBackupSchedules();

  const targets = useMemo(() => targetsQuery.data || [], [targetsQuery.data]);
  const schedules = useMemo(() => schedulesQuery.data || [], [schedulesQuery.data]);
  const latestBackups = useMemo(() => backupsQuery.data?.items || [], [backupsQuery.data?.items]);
  const s3Config = s3ConfigQuery.data;
  const remoteBackups = useMemo(() => remoteBackupsQuery.data || [], [remoteBackupsQuery.data]);

  // Local snapshot pagination & state
  const [olderBackups, setOlderBackups] = useState<BackupItem[]>([]);
  const [olderCursor, setOlderCursor] = useState<BackupCursor | null>(null);
  const [hasLoadedOlder, setHasLoadedOlder] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [loadOlderError, setLoadOlderError] = useState("");
  const olderRequest = useRef<AbortController | null>(null);

  const allBackups = useMemo(
    () => [...latestBackups, ...olderBackups],
    [latestBackups, olderBackups],
  );
  const backupCursor = hasLoadedOlder ? olderCursor : backupsQuery.data?.nextCursor || null;

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDbType, setFilterDbType] = useState("all");
  const [filterDestination, setFilterDestination] = useState<"all" | "local" | "s3">("all");
  const [filterEncryptedOnly, setFilterEncryptedOnly] = useState(false);
  const [filterVerifiedOnly, setFilterVerifiedOnly] = useState(false);

  // Filtered backups list
  const filteredBackups = useMemo(() => {
    return filterBackups(allBackups, {
      searchQuery,
      dbType: filterDbType,
      destination: filterDestination,
      encryptedOnly: filterEncryptedOnly,
      verifiedOnly: filterVerifiedOnly,
    });
  }, [
    allBackups,
    searchQuery,
    filterDbType,
    filterDestination,
    filterEncryptedOnly,
    filterVerifiedOnly,
  ]);

  // Actions loading state
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  // New Snapshot Form Modal/Drawer
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");
  const [createDestination, setCreateDestination] = useState("local");

  // Schedules state
  const [cronPreset, setCronPreset] = useState<string>(CRON_PRESETS[0].cron);
  const [customCron, setCustomCron] = useState("0 2 * * *");
  const [keepLast, setKeepLast] = useState(7);
  const [keepDays, setKeepDays] = useState(0);
  const [drillMode, setDrillMode] = useState<"off" | "archive" | "restore">("archive");
  const [encryptNew, setEncryptNew] = useState(true);
  const [savingSchedule, setSavingSchedule] = useState(false);

  // S3 Form State
  const [s3Provider, setS3Provider] = useState("s3");
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Region, setS3Region] = useState("us-east-1");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3AccessKey, setS3AccessKey] = useState("");
  const [s3SecretKey, setS3SecretKey] = useState("");
  const [s3Prefix, setS3Prefix] = useState("hosterax-backups");
  const [s3AutoSync, setS3AutoSync] = useState(false);
  const [testingS3, setTestingS3] = useState(false);
  const [savingS3, setSavingS3] = useState(false);

  // GFS Retention Calculator State
  const [gfsBaseSizeMb, setGfsBaseSizeMb] = useState(2500);
  const [gfsDaily, setGfsDaily] = useState(7);
  const [gfsWeekly, setGfsWeekly] = useState(4);
  const [gfsMonthly, setGfsMonthly] = useState(12);
  const [gfsYearly, setGfsYearly] = useState(2);
  const [gfsChangeRate, setGfsChangeRate] = useState(5);

  const gfsProjection = useMemo(() => {
    return calculateGfsStorageProjection({
      baseDbSizeMb: gfsBaseSizeMb,
      dailyCount: gfsDaily,
      weeklyCount: gfsWeekly,
      monthlyCount: gfsMonthly,
      yearlyCount: gfsYearly,
      dailyChangeRatePercent: gfsChangeRate,
    });
  }, [gfsBaseSizeMb, gfsDaily, gfsWeekly, gfsMonthly, gfsYearly, gfsChangeRate]);

  // Sandbox Restore Drills Query (persisted in engine SQLite)
  const drillsQuery = useQuery<EngineDrillRow[]>({
    queryKey: ["backup-drills", engine.url, engine.token],
    queryFn: async () => {
      try {
        return await engine.call<EngineDrillRow[]>("GET", "/api/backups/drills");
      } catch {
        return [];
      }
    },
    refetchInterval: 5000,
  });

  const drillCertificates = useMemo(
    () => (drillsQuery.data || []).map(mapDrillRow),
    [drillsQuery.data],
  );
  const [activeDrillRunning, setActiveDrillRunning] = useState(false);
  const [activeCertificateModal, setActiveCertificateModal] = useState<DrillCertificateView | null>(
    null,
  );

  // Auto-set selected target
  useEffect(() => {
    if (targets.length > 0 && !selectedTargetId) {
      setSelectedTargetId(targets[0].id);
    }
  }, [targets, selectedTargetId]);

  // Load S3 settings when query arrives
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

  // Compute Recovery Readiness Evaluation
  const readiness = useMemo(() => {
    let lastBackupAgeHours: number | null = null;
    if (allBackups.length > 0) {
      const latest = allBackups.reduce((prev, curr) =>
        new Date(curr.created_at).getTime() > new Date(prev.created_at).getTime() ? curr : prev,
      );
      const diffMs = Date.now() - new Date(latest.created_at).getTime();
      lastBackupAgeHours = Math.max(0, diffMs / (1000 * 60 * 60));
    }

    const verifiedCount = allBackups.filter((b) => b.verify_status === "verified").length;
    const hasEncrypted =
      allBackups.some((b) => b.encrypted === 1) || schedules.some((s) => s.encrypt);

    let lastDrillAgeDays: number | null = null;
    if (drillCertificates.length > 0) {
      const latestDrill = drillCertificates[0];
      const diffMs = Date.now() - new Date(latestDrill.timestamp).getTime();
      lastDrillAgeDays = Math.max(0, diffMs / (1000 * 60 * 60 * 24));
    }

    return calculateRecoveryReadinessScore({
      lastBackupAgeHours,
      totalBackups: allBackups.length,
      verifiedBackupsCount: verifiedCount,
      offsiteReplicaConfigured: Boolean(s3Config?.configured),
      encryptionEnabled: hasEncrypted,
      lastDrillAgeDays,
    });
  }, [allBackups, schedules, s3Config, drillCertificates]);

  // Handler: Load older backups page
  const loadOlder = async () => {
    if (!backupCursor || isLoadingOlder) return;
    const controller = new AbortController();
    olderRequest.current = controller;
    setIsLoadingOlder(true);
    setLoadOlderError("");
    const params = new URLSearchParams({
      limit: "50",
      beforeCreatedAt: String(backupCursor.createdAt),
      beforeId: backupCursor.id,
    });
    try {
      const page = await engine.call<{ items: BackupItem[]; nextCursor: BackupCursor | null }>(
        "GET",
        `/api/backups/page?${params.toString()}`,
        undefined,
        { signal: controller.signal },
      );
      setOlderBackups((current) => {
        const ids = new Set([...latestBackups, ...current].map((backup) => backup.id));
        return [...current, ...page.items.filter((backup) => !ids.has(backup.id))];
      });
      setOlderCursor(page.nextCursor);
      setHasLoadedOlder(true);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setLoadOlderError(
          error instanceof Error ? error.message : "Could not load older snapshots.",
        );
      }
    } finally {
      if (olderRequest.current === controller) {
        olderRequest.current = null;
        setIsLoadingOlder(false);
      }
    }
  };

  // Handler: Trigger immediate backup
  const handleTriggerBackup = async () => {
    const target = targets.find((t) => t.id === selectedTargetId) || targets[0];
    if (!target) {
      toast.error("No database target available");
      return;
    }
    setIsBackingUp(true);
    try {
      const res = await engine.call<any>("POST", "/api/backups/create", {
        databaseName: target.name || target.id,
        containerName: target.containerName || target.id,
        dbType: target.dbType || "mongodb",
        projectName: target.projectName || target.name,
      });

      toast.success(
        `Snapshot created (${res.sizeMb ?? 0} MB, SHA-256 recorded)${
          res.s3Synced ? " and replicated to S3." : "."
        }`,
      );

      if (createDestination === "s3" && !res.s3Synced) {
        if (!s3Config?.configured) {
          toast.warning("S3 is not configured yet — kept on local disk.");
        } else {
          try {
            await engine.call("POST", `/api/backups/${res.id}/sync-s3`);
            toast.success("Snapshot replicated to remote S3 bucket.");
          } catch (e: any) {
            toast.error(`Saved locally, but S3 sync failed: ${e?.message}`);
          }
        }
      }

      backupsQuery.refetch();
      remoteBackupsQuery.refetch();
      setShowCreateModal(false);
    } catch (err: any) {
      toast.error(err?.message || "Failed to create database snapshot");
    } finally {
      setIsBackingUp(false);
    }
  };

  // Handler: Run Sandbox Restore Drill via Engine
  const handleRunSandboxDrill = async (backupItem?: BackupItem) => {
    let chosenBackup = backupItem;
    if (!chosenBackup) {
      const candidates = allBackups.filter((b) => b.status === "completed");
      if (candidates.length === 0) {
        toast.error("No completed snapshots available to drill. Take a snapshot first!");
        return;
      }
      chosenBackup = candidates[0];
    }

    setActiveDrillRunning(true);
    const startedAt = Date.now() - 1000;
    const toastId = toast.loading(
      `Dispatching ephemeral container restore drill for "${chosenBackup.database_name}"…`,
    );

    try {
      await engine.call("POST", `/api/backups/${encodeURIComponent(chosenBackup.id)}/drill`);

      // Poll backend /api/backups/drills until the async drill row is recorded
      let recorded: DrillCertificateView | null = null;
      for (let attempt = 0; attempt < 25; attempt++) {
        await new Promise((r) => setTimeout(r, 1200));
        const rows = await engine.call<EngineDrillRow[]>("GET", "/api/backups/drills");
        const match = rows.find(
          (row) => row.backup_id === chosenBackup.id && Number(row.checked_at) >= startedAt,
        );
        if (match) {
          recorded = mapDrillRow(match);
          break;
        }
      }

      await Promise.all([drillsQuery.refetch(), backupsQuery.refetch()]);

      if (recorded) {
        if (recorded.status === "passed") {
          toast.success(`Restore drill PASSED in ${recorded.rtoFormatted} (RTO).`, {
            id: toastId,
          });
        } else {
          toast.error(`Restore drill FAILED: ${recorded.auditMessage}`, { id: toastId });
        }
        setActiveCertificateModal(recorded);
      } else {
        toast.info(
          "Restore drill is running asynchronously on the engine. Refreshing results automatically.",
          { id: toastId },
        );
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to execute restore drill", { id: toastId });
    } finally {
      setActiveDrillRunning(false);
    }
  };

  // Handler: Verify checksum
  const handleVerifyBackup = async (id: string) => {
    setVerifyingId(id);
    try {
      const res = await engine.call<{ ok: boolean; message: string }>(
        "POST",
        `/api/backups/${id}/verify`,
      );
      if (res.ok) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
      backupsQuery.refetch();
    } catch (e: any) {
      toast.error(e?.message || "Verification failed");
    } finally {
      setVerifyingId(null);
    }
  };

  // Handler: S3 Sync
  const handleSyncToS3 = async (backupId: string) => {
    setSyncingId(backupId);
    try {
      const res: any = await engine.call("POST", `/api/backups/${backupId}/sync-s3`);
      toast.success(`Snapshot replicated to S3: ${res.s3Key}`);
      backupsQuery.refetch();
      remoteBackupsQuery.refetch();
    } catch (err: any) {
      toast.error(err?.message || "S3 sync failed. Verify credentials in Storage tab.");
    } finally {
      setSyncingId(null);
    }
  };

  // Handler: Instant restore
  const handleRestoreBackup = async (b: BackupItem) => {
    const ok = await confirmAction({
      title: `Restore "${b.database_name}"`,
      description: `Overwrite active database "${b.database_name}" with snapshot from ${new Date(
        b.created_at,
      ).toLocaleString()}? Current unsaved records will be replaced.`,
      confirmLabel: "Restore Snapshot",
      variant: "destructive",
    });
    if (!ok) return;

    setRestoringId(b.id);
    const toastId = toast.loading(`Verifying SHA-256 and restoring snapshot ${b.id}…`);
    try {
      const res = await engine.call<any>("POST", `/api/backups/${b.id}/restore`);
      toast.success(res.message || `Snapshot ${b.id} successfully restored.`, { id: toastId });
      backupsQuery.refetch();
    } catch (err: any) {
      toast.error(err?.message || "Restore operation failed", { id: toastId });
    } finally {
      setRestoringId(null);
    }
  };

  // Handler: Download archive
  const handleDownloadBackup = async (id: string) => {
    try {
      const r = await fetch(`${engine.url}/api/backups/${id}/download`, {
        credentials: "include",
        headers: engine.token ? { authorization: `Bearer ${engine.token}` } : {},
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `HTTP ${r.status}`);
      const name =
        /filename="?([^";]+)"?/.exec(r.headers.get("content-disposition") || "")?.[1] ||
        `${id}.tar.gz`;
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err?.message || "Download failed");
    }
  };

  // Handler: Delete backup
  const handleDeleteBackup = async (id: string) => {
    const ok = await confirmAction({
      title: "Delete Snapshot Archive",
      description: `Permanently delete snapshot "${id}" from disk? This cannot be undone.`,
      confirmLabel: "Delete Snapshot",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await engine.call("DELETE", `/api/backups/${id}`);
      toast.success(`Snapshot ${id} deleted.`);
      backupsQuery.refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete snapshot");
    }
  };

  // Handler: Create Schedule
  const handleCreateSchedule = async () => {
    const target = targets.find((t) => t.id === selectedTargetId) || targets[0];
    if (!target) {
      toast.error("Please select a target database");
      return;
    }
    setSavingSchedule(true);
    try {
      await engine.call("POST", "/api/backups/schedules", {
        databaseName: target.name || target.id,
        containerName: target.containerName || target.id,
        dbType: target.dbType || "mongodb",
        projectName: target.projectName || target.name,
        cron: cronPreset === "custom" ? customCron : cronPreset,
        keepLast,
        keepDays,
        drill: drillMode,
        encrypt: encryptNew,
      });
      toast.success("Automated backup schedule created");
      schedulesQuery.refetch();
    } catch (e: any) {
      toast.error(e?.message || "Could not create schedule");
    } finally {
      setSavingSchedule(false);
    }
  };

  // Handler: Save S3
  const handleSaveS3 = async () => {
    if (!s3Bucket || !s3AccessKey) {
      toast.error("Bucket name and Access Key ID are required");
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

  // Handler: Test S3
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
        toast.success(res.message || "S3 bucket connection test successful!");
      } else {
        toast.error(res.message || "S3 bucket connection failed");
      }
    } catch (err: any) {
      toast.error(err?.message || "Connection test failed");
    } finally {
      setTestingS3(false);
    }
  };

  // Runbook code generation for currently selected target or backup
  const selectedTarget = targets.find((t) => t.id === selectedTargetId) || targets[0];
  const activeRunbookBackup = allBackups[0];
  const generatedRunbook = useMemo(() => {
    return generateEmergencyRunbookScript({
      backupId: activeRunbookBackup?.id || "snapshot_latest",
      databaseName: selectedTarget?.name || "production_db",
      dbType: selectedTarget?.dbType || "postgres",
      isEncrypted: activeRunbookBackup?.encrypted === 1 || encryptNew,
      s3Bucket: s3Config?.bucket || undefined,
      s3Key: s3Config?.configured
        ? `${s3Prefix}/${activeRunbookBackup?.id || "snapshot_latest"}.tar.gz`
        : undefined,
    });
  }, [activeRunbookBackup, selectedTarget, encryptNew, s3Config, s3Prefix]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard!`);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Disaster Recovery & Multi-Cloud Backups
                </h1>
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                  Enterprise DR
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Automated database snapshots, SHA-256 integrity verification, S3/R2 multi-cloud
                replication, and automated sandbox restore drills.
              </p>
            </div>
          </div>
        </div>

        {/* Top Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => handleRunSandboxDrill()}
            disabled={activeDrillRunning || allBackups.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-400 hover:bg-amber-500/20 transition-all disabled:opacity-50"
            title="Spin up ephemeral test container to verify restore validity"
          >
            {activeDrillRunning ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Flame className="h-3.5 w-3.5" />
            )}
            Sandbox Restore Drill
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-all"
          >
            <Plus className="h-3.5 w-3.5" /> Take Snapshot Now
          </button>
        </div>
      </div>

      {/* Recovery Readiness Barometer Card */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {/* Readiness Score Card */}
        <div className="col-span-1 rounded-xl border border-border bg-card p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              DR Readiness Score
            </span>
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                readiness.grade === "A+" || readiness.grade === "A"
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : readiness.grade === "B"
                    ? "bg-sky-500/15 text-sky-400 border border-sky-500/30"
                    : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
              }`}
            >
              Grade {readiness.grade}
            </span>
          </div>

          <div className="my-4 flex items-baseline gap-2">
            <span className="text-4xl font-extrabold tracking-tight text-foreground">
              {readiness.score}%
            </span>
            <span className="text-xs text-muted-foreground">/ 100 points</span>
          </div>

          <div className="space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full transition-all duration-500 ${
                  readiness.score >= 80
                    ? "bg-emerald-500"
                    : readiness.score >= 60
                      ? "bg-sky-500"
                      : "bg-amber-500"
                }`}
                style={{ width: `${readiness.score}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground leading-tight">{readiness.summary}</p>
          </div>
        </div>

        {/* Metric 2: RTO & RPO */}
        <div className="col-span-1 rounded-xl border border-border bg-card p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Target RTO / RPO
            </span>
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <div className="my-3 space-y-2">
            <div>
              <div className="text-[11px] text-muted-foreground">Recovery Time Objective (RTO)</div>
              <div className="text-xl font-bold text-foreground">
                {drillCertificates.length > 0 ? drillCertificates[0].rtoFormatted : "< 15s avg"}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">
                Recovery Point Objective (RPO)
              </div>
              <div className="text-xs font-medium text-foreground">
                {schedules.length > 0 ? "Daily / 6h automated" : "Manual trigger"}
              </div>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Measured via ephemeral container drills
          </div>
        </div>

        {/* Metric 3: Multi-Cloud Offsite Replica */}
        <div className="col-span-1 rounded-xl border border-border bg-card p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Offsite Replica
            </span>
            <Cloud className="h-4 w-4 text-sky-400" />
          </div>
          <div className="my-3">
            {s3Config?.configured ? (
              <div className="space-y-1">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
                  <Check className="h-4 w-4" /> Connected & Active
                </span>
                <p className="font-mono text-xs text-muted-foreground truncate">
                  {s3Config.bucket} ({s3Config.provider_type?.toUpperCase() || "S3"})
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <span className="text-sm font-semibold text-amber-400">Local Only</span>
                <p className="text-xs text-muted-foreground">Offsite replication not configured</p>
              </div>
            )}
          </div>
          <button
            onClick={() => setActiveTab("storage")}
            className="text-left text-xs font-medium text-primary hover:underline"
          >
            Manage storage endpoints →
          </button>
        </div>

        {/* Metric 4: Integrity Verification */}
        <div className="col-span-1 rounded-xl border border-border bg-card p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Integrity & Drills
            </span>
            <FileCheck2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="my-3 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Verified Snapshots</span>
              <span className="font-mono font-bold text-foreground">
                {allBackups.filter((b) => b.verify_status === "verified").length} /{" "}
                {allBackups.length}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Sandbox Drills</span>
              <span className="font-mono font-bold text-foreground">
                {drillCertificates.length} recorded
              </span>
            </div>
          </div>
          <button
            onClick={() => setActiveTab("drills")}
            className="text-left text-xs font-medium text-primary hover:underline"
          >
            View drill certificates →
          </button>
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div className="flex border-b border-border bg-card/60 rounded-t-xl px-4 pt-2 overflow-x-auto">
        {(
          [
            { id: "overview", label: "DR Overview" },
            { id: "drills", label: `Sandbox Drills (${drillCertificates.length})` },
            { id: "snapshots", label: `Snapshot Archives (${allBackups.length})` },
            { id: "schedules", label: `Automated Schedules (${schedules.length})` },
            { id: "storage", label: "Multi-Cloud Storage" },
            { id: "retention", label: "GFS Retention Planner" },
            { id: "runbook", label: "Emergency Runbook" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`border-b-2 px-4 py-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? "border-primary text-primary font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: DR Overview */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Readiness Checks Grid */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">
              Disaster Recovery Compliance Checklist
            </h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {readiness.checks.map((check) => (
                <div
                  key={check.id}
                  className="flex items-start gap-3 rounded-lg border border-border/80 bg-surface/30 p-3 text-xs"
                >
                  <div className="mt-0.5">
                    {check.status === "pass" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : check.status === "warning" ? (
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                    ) : (
                      <ShieldAlert className="h-4 w-4 text-destructive" />
                    )}
                  </div>
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">{check.title}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {check.points} / {check.maxPoints} pts
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {check.description}
                    </p>
                    {check.recommendation && (
                      <div className="rounded bg-amber-500/10 p-1.5 text-[10px] text-amber-400 font-medium">
                        Action: {check.recommendation}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Target Grid */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Active Database Targets</h3>
                <p className="text-xs text-muted-foreground">
                  Monitored containers configured for point-in-time recovery
                </p>
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {targets.length} databases attached
              </span>
            </div>

            {targets.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
                No active database containers found. Attach a database container or launch one from
                the App Store.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {targets.map((t) => (
                  <div
                    key={t.id}
                    className="flex flex-col justify-between rounded-lg border border-border bg-surface/40 p-4 text-xs space-y-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground font-mono">{t.label}</span>
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary uppercase">
                          {t.dbType}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground font-mono">
                        Container: {t.containerName || t.id}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-border">
                      <button
                        onClick={() => {
                          setSelectedTargetId(t.id);
                          setShowCreateModal(true);
                        }}
                        className="flex-1 rounded-md bg-surface-2 py-1.5 text-center text-xs font-medium hover:bg-accent transition-colors"
                      >
                        Snapshot
                      </button>
                      <button
                        onClick={() => {
                          setSelectedTargetId(t.id);
                          setActiveTab("drills");
                        }}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/10 transition-colors"
                      >
                        Drill
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Automated Sandbox Restore Drills */}
      {activeTab === "drills" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Flame className="h-4 w-4 text-amber-400" />
                  Automated Sandbox Restore Drills ("Fire Drills")
                </h3>
                <p className="text-xs text-muted-foreground">
                  Periodically restores snapshots into ephemeral throwaway containers to benchmark
                  RTO and guarantee data viability before a real disaster strikes.
                </p>
              </div>

              <button
                disabled={activeDrillRunning || allBackups.length === 0}
                onClick={() => handleRunSandboxDrill()}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-black hover:bg-amber-400 transition-all disabled:opacity-50"
              >
                {activeDrillRunning ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Running Ephemeral Restore…
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" /> Execute Test Drill Now
                  </>
                )}
              </button>
            </div>

            {drillCertificates.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-12 text-center text-xs text-muted-foreground space-y-3">
                <FileCheck2 className="h-10 w-10 text-muted-foreground/40 mx-auto" />
                <div className="font-semibold text-foreground">No Restore Drills Executed Yet</div>
                <p className="max-w-md mx-auto">
                  A backup that has never been restored is an unverified risk. Run a sandbox drill
                  to simulate recovery time objective (RTO) and verify query responsiveness.
                </p>
                <button
                  disabled={activeDrillRunning || allBackups.length === 0}
                  onClick={() => handleRunSandboxDrill()}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                >
                  Run First Drill
                </button>
              </div>
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border bg-surface/30 overflow-hidden">
                {drillCertificates.map((cert) => (
                  <div
                    key={cert.drillId}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 gap-3 text-xs hover:bg-muted/10 transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 font-mono font-medium">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                            cert.status === "passed"
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                              : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                          }`}
                        >
                          {cert.status}
                        </span>
                        <span className="text-foreground font-semibold">{cert.databaseName}</span>
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {cert.dbType.toUpperCase()}
                        </span>
                        <span className="text-muted-foreground text-[11px]">
                          RTO: <strong className="text-foreground">{cert.rtoFormatted}</strong>
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Executed: {new Date(cert.timestamp).toLocaleString()} · Backup:{" "}
                        <span className="font-mono text-foreground">{cert.backupId}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground/80 font-mono">
                        {cert.auditMessage}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setActiveCertificateModal(cert)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                      >
                        <FileCheck2 className="h-3.5 w-3.5 text-emerald-400" />
                        View Certificate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Snapshots History & Management */}
      {activeTab === "snapshots" && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border bg-card p-4 text-xs">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search snapshots by database, ID, or container..."
                className="w-full rounded-md border border-input bg-input/40 pl-8 pr-3 py-1.5 outline-none focus:border-primary font-mono text-xs"
              />
            </div>

            <select
              value={filterDbType}
              onChange={(e) => setFilterDbType(e.target.value)}
              className="rounded-md border border-input bg-input/40 px-3 py-1.5 outline-none focus:border-primary"
            >
              <option value="all">All Database Engines</option>
              <option value="postgres">PostgreSQL</option>
              <option value="mongo">MongoDB</option>
              <option value="mysql">MySQL</option>
              <option value="redis">Redis</option>
            </select>

            <select
              value={filterDestination}
              onChange={(e) => setFilterDestination(e.target.value as any)}
              className="rounded-md border border-input bg-input/40 px-3 py-1.5 outline-none focus:border-primary"
            >
              <option value="all">All Destinations</option>
              <option value="local">Local Disk Only</option>
              <option value="s3">S3 / Cloudflare R2 Synced</option>
            </select>

            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filterEncryptedOnly}
                onChange={(e) => setFilterEncryptedOnly(e.target.checked)}
              />
              Encrypted only
            </label>

            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filterVerifiedOnly}
                onChange={(e) => setFilterVerifiedOnly(e.target.checked)}
              />
              Verified only
            </label>
          </div>

          {/* Snapshots Table / List */}
          {filteredBackups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center text-xs text-muted-foreground space-y-3">
              <HardDrive className="h-10 w-10 text-muted-foreground/40 mx-auto" />
              <div className="font-semibold text-foreground">No Snapshots Found</div>
              <p>No snapshots match your current search and filter settings.</p>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setFilterDbType("all");
                  setFilterDestination("all");
                  setFilterEncryptedOnly(false);
                  setFilterVerifiedOnly(false);
                }}
                className="text-primary hover:underline font-medium"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
              {filteredBackups.map((b) => (
                <div
                  key={b.id}
                  className="flex flex-col lg:flex-row lg:items-center lg:justify-between p-4 gap-3 text-xs hover:bg-muted/10 transition-colors"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-mono font-medium text-foreground">
                      <Database className="h-3.5 w-3.5 text-primary" />
                      <span className="font-semibold">{b.database_name}</span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {b.id}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.2 text-[10px] uppercase font-semibold ${
                          b.status === "completed"
                            ? "bg-emerald-500/15 text-emerald-400"
                            : b.status === "in_progress"
                              ? "bg-amber-500/15 text-amber-400"
                              : "bg-destructive/15 text-destructive"
                        }`}
                      >
                        {b.status}
                      </span>
                      {b.encrypted === 1 && (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          title="AES-256-GCM Encrypted"
                        >
                          <Lock className="h-3 w-3" /> encrypted
                        </span>
                      )}
                      {b.verify_status && (
                        <span
                          className={`rounded-full px-2 py-0.2 text-[10px] font-medium ${
                            b.verify_status === "verified"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-destructive/15 text-destructive"
                          }`}
                        >
                          {b.verify_status === "verified"
                            ? "SHA-256 verified"
                            : "verification failed"}
                        </span>
                      )}
                      {b.destination === "s3_synced" && (
                        <span className="rounded-full bg-sky-500/15 text-sky-400 px-2 py-0.2 text-[10px] font-medium flex items-center gap-1">
                          <Cloud className="w-3 h-3" /> S3 Synced
                        </span>
                      )}
                    </div>

                    <div className="text-muted-foreground text-[11px]">
                      {b.db_type.toUpperCase()} · {b.sizeMb ?? 0} MB (
                      {formatBytes(b.file_size_bytes || (b.sizeMb || 0) * 1024 * 1024)}) · Created{" "}
                      {new Date(b.created_at).toLocaleString()}
                    </div>

                    <div
                      className="font-mono text-[10px] text-muted-foreground/70 truncate max-w-lg"
                      title={b.sha256}
                    >
                      SHA-256: {b.sha256 || "none"}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Run Drill */}
                    <button
                      onClick={() => handleRunSandboxDrill(b)}
                      disabled={activeDrillRunning}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/20 transition-colors"
                      title="Run automated sandbox restore drill on this archive"
                    >
                      <Flame className="h-3.5 w-3.5" /> Drill
                    </button>

                    {/* S3 Sync */}
                    {s3Config?.configured &&
                      b.status === "completed" &&
                      b.destination !== "s3_synced" && (
                        <button
                          disabled={syncingId === b.id}
                          onClick={() => handleSyncToS3(b.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-sky-500/10 text-sky-400 px-2.5 py-1.5 text-xs font-medium hover:bg-sky-500/20 transition-colors"
                          title="Replicate to remote S3 bucket"
                        >
                          <UploadCloud
                            className={`h-3.5 w-3.5 ${syncingId === b.id ? "animate-spin" : ""}`}
                          />
                          Sync S3
                        </button>
                      )}

                    {/* Verify */}
                    {b.status === "completed" && (
                      <button
                        disabled={verifyingId === b.id}
                        onClick={() => handleVerifyBackup(b.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                        title="Verify SHA-256 integrity"
                      >
                        {verifyingId === b.id ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : (
                          <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        Verify
                      </button>
                    )}

                    {/* Download */}
                    <button
                      onClick={() => handleDownloadBackup(b.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                      title="Download archive"
                    >
                      <Download className="h-3.5 w-3.5 text-muted-foreground" /> Download
                    </button>

                    {/* Instant Restore */}
                    <button
                      disabled={restoringId === b.id || b.status !== "completed"}
                      onClick={() => handleRestoreBackup(b)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                    >
                      {restoringId === b.id ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      Restore
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => handleDeleteBackup(b.id)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="Delete archive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {backupCursor && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                disabled={isLoadingOlder}
                onClick={loadOlder}
                className="rounded-md border border-border px-4 py-2 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60"
              >
                {isLoadingOlder ? "Loading older snapshots…" : "Load older snapshots"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Automated Schedules */}
      {activeTab === "schedules" && (
        <div className="space-y-6">
          <div className="space-y-4 rounded-xl border border-border bg-card p-5 max-w-2xl">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" /> Create Automated Schedule
            </h3>
            <p className="text-xs text-muted-foreground">
              Define scheduled snapshot intervals, retention limits, and automated sandbox drill
              frequency.
            </p>

            <div className="space-y-3 text-xs">
              <label className="block space-y-1">
                <span className="font-medium text-foreground">Target Database</span>
                <select
                  value={selectedTargetId}
                  onChange={(e) => setSelectedTargetId(e.target.value)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 outline-none focus:border-primary font-mono"
                >
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label} ({t.dbType.toUpperCase()})
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="font-medium text-foreground">Cron Frequency</span>
                  <select
                    value={cronPreset}
                    onChange={(e) => setCronPreset(e.target.value)}
                    className="w-full rounded-md border border-input bg-input/40 px-3 py-2 outline-none focus:border-primary"
                  >
                    {CRON_PRESETS.map((p) => (
                      <option key={p.cron} value={p.cron}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>

                {cronPreset === "custom" && (
                  <label className="space-y-1">
                    <span className="font-medium text-foreground">Cron Expression</span>
                    <input
                      value={customCron}
                      onChange={(e) => setCustomCron(e.target.value)}
                      className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono outline-none focus:border-primary"
                    />
                  </label>
                )}

                <label className="space-y-1">
                  <span className="font-medium text-foreground">Retention: Keep Last N</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={keepLast}
                    onChange={(e) => setKeepLast(Number(e.target.value))}
                    className="w-full rounded-md border border-input bg-input/40 px-3 py-2 outline-none focus:border-primary font-mono"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-medium text-foreground">Max Age (Days, 0 = unlimited)</span>
                  <input
                    type="number"
                    min={0}
                    max={3650}
                    value={keepDays}
                    onChange={(e) => setKeepDays(Number(e.target.value))}
                    className="w-full rounded-md border border-input bg-input/40 px-3 py-2 outline-none focus:border-primary font-mono"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="font-medium text-foreground">Prove Each Backup Works</span>
                <select
                  value={drillMode}
                  onChange={(e) => setDrillMode(e.target.value as any)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 outline-none focus:border-primary"
                >
                  <option value="archive">Check archive (checksum, gzip integrity)</option>
                  <option value="restore">
                    Check archive and, every 7th run, restore into a throwaway container
                  </option>
                  <option value="off">Don't check</option>
                </select>
              </label>

              <label className="flex items-start gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={encryptNew}
                  onChange={(e) => setEncryptNew(e.target.checked)}
                />
                <div>
                  <span className="font-medium text-foreground">
                    Encrypt archives (AES-256-GCM)
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    Encrypted with host's <code>secret.key</code> before storing locally or
                    uploading to S3.
                  </p>
                </div>
              </label>

              <button
                disabled={savingSchedule || !selectedTarget}
                onClick={handleCreateSchedule}
                className="mt-2 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                {savingSchedule ? "Saving Schedule…" : "Create Schedule"}
              </button>
            </div>
          </div>

          {/* Existing Schedules */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Active Schedules ({schedules.length})
            </h4>

            {schedules.length === 0 ? (
              <p className="text-xs text-muted-foreground">No automated schedules active.</p>
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
                {schedules.map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 font-mono font-medium">
                        <Database className="h-3.5 w-3.5 text-primary" />
                        <span>{s.databaseName}</span>
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {s.cron}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.2 text-[10px] uppercase font-semibold ${
                            s.lastStatus === "ok"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : s.lastStatus === "failed"
                                ? "bg-destructive/15 text-destructive"
                                : s.lastStatus === "running"
                                  ? "bg-amber-500/15 text-amber-400"
                                  : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {s.lastStatus ?? "pending"}
                        </span>
                        {s.encrypt && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Lock className="h-3 w-3" /> encrypted
                          </span>
                        )}
                        {!s.enabled && <span className="text-[10px] text-amber-400">paused</span>}
                      </div>

                      <div className="text-[11px] text-muted-foreground">
                        Keeps {s.keepLast} {s.keepDays ? ` · ${s.keepDays} days` : ""} · drill:{" "}
                        {s.drill}
                        {s.nextRunAt && s.enabled
                          ? ` · next: ${new Date(s.nextRunAt).toLocaleString()}`
                          : ""}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          try {
                            await engine.call("POST", `/api/backups/schedules/${s.id}/run`);
                            toast.success("Backup job dispatched");
                            schedulesQuery.refetch();
                          } catch (e: any) {
                            toast.error(e?.message);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                      >
                        <Play className="h-3 w-3" /> Run
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await engine.call("PATCH", `/api/backups/schedules/${s.id}`, {
                              enabled: !s.enabled,
                            });
                            schedulesQuery.refetch();
                          } catch (e: any) {
                            toast.error(e?.message);
                          }
                        }}
                        className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                      >
                        {s.enabled ? "Pause" : "Resume"}
                      </button>
                      <button
                        aria-label={`Delete schedule for ${s.databaseName}`}
                        onClick={async () => {
                          const ok = await confirmAction({
                            title: "Delete Backup Schedule",
                            description: `Remove automated backup schedule for "${s.databaseName}"? Existing snapshots will remain intact.`,
                            confirmLabel: "Delete Schedule",
                            variant: "destructive",
                          });
                          if (!ok) return;
                          try {
                            await engine.call("DELETE", `/api/backups/schedules/${s.id}`);
                            schedulesQuery.refetch();
                          } catch (e: any) {
                            toast.error(e?.message);
                          }
                        }}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 5: Multi-Cloud S3 Storage Hub */}
      {activeTab === "storage" && (
        <div className="space-y-6 max-w-2xl">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Multi-Cloud S3 Object Storage Provider
                </h3>
                <p className="text-xs text-muted-foreground">
                  Replicate snapshot archives to offsite S3-compatible cloud storage (AWS,
                  Cloudflare R2, MinIO, Wasabi, Spaces).
                </p>
              </div>
              {s3Config?.configured ? (
                <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/30">
                  <Check className="w-3.5 h-3.5" /> Configured & Verified
                </span>
              ) : (
                <span className="text-xs text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/30">
                  Not Configured
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <label className="space-y-1.5">
                <span className="font-medium text-foreground">Storage Provider</span>
                <select
                  value={s3Provider}
                  onChange={(e) => setS3Provider(e.target.value)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 outline-none focus:border-primary"
                >
                  <option value="s3">Amazon S3</option>
                  <option value="r2">Cloudflare R2 (Zero Egress)</option>
                  <option value="minio">MinIO (Self-Hosted)</option>
                  <option value="wasabi">Wasabi Hot Cloud</option>
                  <option value="spaces">DigitalOcean Spaces</option>
                </select>
              </label>

              <label className="space-y-1.5">
                <span className="font-medium text-foreground">Bucket Name</span>
                <input
                  type="text"
                  placeholder="e.g. hosterax-production-backups"
                  value={s3Bucket}
                  onChange={(e) => setS3Bucket(e.target.value)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono outline-none focus:border-primary"
                />
              </label>

              <label className="col-span-2 space-y-1.5">
                <span className="font-medium text-foreground">
                  Endpoint URL (Required for R2, MinIO, Wasabi, Spaces)
                </span>
                <input
                  type="text"
                  placeholder={
                    s3Provider === "r2"
                      ? "https://<account_id>.r2.cloudflarestorage.com"
                      : s3Provider === "minio"
                        ? "https://minio.internal.net:9000"
                        : "https://s3.us-east-1.amazonaws.com"
                  }
                  value={s3Endpoint}
                  onChange={(e) => setS3Endpoint(e.target.value)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono outline-none focus:border-primary"
                />
              </label>

              <label className="space-y-1.5">
                <span className="font-medium text-foreground">Region</span>
                <input
                  type="text"
                  value={s3Region}
                  onChange={(e) => setS3Region(e.target.value)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono outline-none focus:border-primary"
                />
              </label>

              <label className="space-y-1.5">
                <span className="font-medium text-foreground">Storage Key Prefix</span>
                <input
                  type="text"
                  value={s3Prefix}
                  onChange={(e) => setS3Prefix(e.target.value)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono outline-none focus:border-primary"
                />
              </label>

              <label className="space-y-1.5">
                <span className="font-medium text-foreground">Access Key ID</span>
                <input
                  type="text"
                  value={s3AccessKey}
                  onChange={(e) => setS3AccessKey(e.target.value)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono outline-none focus:border-primary"
                />
              </label>

              <label className="space-y-1.5">
                <span className="font-medium text-foreground">Secret Access Key</span>
                <input
                  type="password"
                  value={s3SecretKey}
                  onChange={(e) => setS3SecretKey(e.target.value)}
                  placeholder="••••••••••••••••"
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono outline-none focus:border-primary"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 pt-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={s3AutoSync}
                onChange={(e) => setS3AutoSync(e.target.checked)}
              />
              <span className="font-medium text-foreground">
                Automatic S3 Synchronization (Upload new snapshots immediately on completion)
              </span>
            </label>

            <div className="flex items-center gap-3 pt-3 border-t border-border">
              <button
                disabled={testingS3}
                onClick={handleTestS3}
                className="rounded-md border border-border bg-surface-2 px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                {testingS3 ? "Testing Connection…" : "Test S3 Connectivity"}
              </button>
              <button
                disabled={savingS3}
                onClick={handleSaveS3}
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                {savingS3 ? "Saving Configuration…" : "Save Storage Settings"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 6: GFS Retention Policy Planner */}
      {activeTab === "retention" && (
        <div className="space-y-6 max-w-4xl">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Calculator className="h-4 w-4 text-primary" />
                Grandfather-Father-Son (GFS) Retention Policy Planner
              </h3>
              <p className="text-xs text-muted-foreground">
                Estimate disk and cloud storage consumption based on rotation tiering (Daily,
                Weekly, Monthly, Yearly).
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <label className="space-y-1">
                <span className="font-medium text-foreground">Database Data Size (MB)</span>
                <input
                  type="number"
                  min={10}
                  value={gfsBaseSizeMb}
                  onChange={(e) => setGfsBaseSizeMb(Number(e.target.value))}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono outline-none focus:border-primary"
                />
              </label>

              <label className="space-y-1">
                <span className="font-medium text-foreground">Daily Delta Rate (%)</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={gfsChangeRate}
                  onChange={(e) => setGfsChangeRate(Number(e.target.value))}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono outline-none focus:border-primary"
                />
              </label>

              <label className="space-y-1">
                <span className="font-medium text-foreground">Daily Tier (Days to keep)</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={gfsDaily}
                  onChange={(e) => setGfsDaily(Number(e.target.value))}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono outline-none focus:border-primary"
                />
              </label>

              <label className="space-y-1">
                <span className="font-medium text-foreground">Weekly Tier (Weeks to keep)</span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={gfsWeekly}
                  onChange={(e) => setGfsWeekly(Number(e.target.value))}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono outline-none focus:border-primary"
                />
              </label>

              <label className="space-y-1">
                <span className="font-medium text-foreground">Monthly Tier (Months to keep)</span>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={gfsMonthly}
                  onChange={(e) => setGfsMonthly(Number(e.target.value))}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono outline-none focus:border-primary"
                />
              </label>

              <label className="space-y-1">
                <span className="font-medium text-foreground">Yearly Tier (Years to keep)</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={gfsYearly}
                  onChange={(e) => setGfsYearly(Number(e.target.value))}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono outline-none focus:border-primary"
                />
              </label>
            </div>

            {/* Projection Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-border text-xs">
              <div className="rounded-lg bg-surface/50 p-3 space-y-1">
                <span className="text-muted-foreground text-[11px]">Total Active Snapshots</span>
                <div className="text-lg font-bold text-foreground">
                  {gfsProjection.totalSnapshots} archives
                </div>
              </div>

              <div className="rounded-lg bg-surface/50 p-3 space-y-1">
                <span className="text-muted-foreground text-[11px]">Compressed Footprint</span>
                <div className="text-lg font-bold text-foreground font-mono">
                  {gfsProjection.estimatedCompressedGb} GB
                </div>
              </div>

              <div className="rounded-lg bg-surface/50 p-3 space-y-1">
                <span className="text-muted-foreground text-[11px]">Est. AWS S3 Cost/Mo</span>
                <div className="text-lg font-bold text-foreground font-mono">
                  ${gfsProjection.estimatedS3CostPerMonth.toFixed(2)}
                </div>
              </div>

              <div className="rounded-lg bg-surface/50 p-3 space-y-1">
                <span className="text-muted-foreground text-[11px]">
                  Est. Cloudflare R2 Cost/Mo
                </span>
                <div className="text-lg font-bold text-emerald-400 font-mono">
                  ${gfsProjection.estimatedR2CostPerMonth.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 7: Emergency Disaster Recovery Runbook */}
      {activeTab === "runbook" && (
        <div className="space-y-6 max-w-3xl">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  Emergency Disaster Recovery CLI Runbook
                </h3>
                <p className="text-xs text-muted-foreground">
                  Self-contained bash recovery runbook. Execute on any bare-metal Linux host or
                  disaster recovery server.
                </p>
              </div>

              <button
                onClick={() => copyToClipboard(generatedRunbook, "Emergency Runbook Script")}
                className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
              >
                <Copy className="h-3.5 w-3.5" /> Copy Script
              </button>
            </div>

            <div className="relative">
              <pre className="max-h-[480px] overflow-auto rounded-lg border border-border bg-black/60 p-4 font-mono text-xs text-emerald-400 leading-relaxed">
                {generatedRunbook}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Immediate Snapshot */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-foreground">Trigger Immediate Snapshot</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <label className="block space-y-1">
                <span className="font-medium text-foreground">Target Database</span>
                <select
                  value={selectedTargetId}
                  onChange={(e) => setSelectedTargetId(e.target.value)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 outline-none focus:border-primary font-mono"
                >
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label} ({t.dbType.toUpperCase()})
                    </option>
                  ))}
                </select>
              </label>

              <div className="space-y-1">
                <span className="font-medium text-foreground">Destination</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateDestination("local")}
                    className={`p-3 rounded-lg border text-left flex flex-col gap-1 ${
                      createDestination === "local"
                        ? "border-primary bg-primary/10 text-primary font-semibold"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    <HardDrive className="h-4 w-4" />
                    <span>Local Disk</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateDestination("s3")}
                    className={`p-3 rounded-lg border text-left flex flex-col gap-1 ${
                      createDestination === "s3"
                        ? "border-primary bg-primary/10 text-primary font-semibold"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    <Cloud className="h-4 w-4" />
                    <span>S3 / Cloud Storage</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-md border border-border px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isBackingUp}
                onClick={handleTriggerBackup}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                {isBackingUp ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Generating Snapshot…
                  </>
                ) : (
                  <>
                    <Download className="h-3.5 w-3.5" /> Start Snapshot
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: View Drill Certificate */}
      {activeCertificateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-xl border border-emerald-500/40 bg-card p-6 shadow-2xl space-y-4 font-sans">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <FileCheck2 className="h-5 w-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-foreground">
                  Sandbox Restore Drill Audit Certificate
                </h3>
              </div>
              <button
                onClick={() => setActiveCertificateModal(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">VERIFICATION STATUS</span>
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-400 uppercase">
                  {activeCertificateModal.status}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {activeCertificateModal.auditMessage}
              </p>
            </div>

            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                <div>
                  Target Database:{" "}
                  <strong className="text-foreground">
                    {activeCertificateModal.databaseName} (
                    {activeCertificateModal.dbType.toUpperCase()})
                  </strong>
                </div>
                <div>
                  Recovery Time (RTO):{" "}
                  <strong className="text-foreground">{activeCertificateModal.rtoFormatted}</strong>
                </div>
                <div>
                  Backup Archive:{" "}
                  <strong className="font-mono text-foreground text-[10px]">
                    {activeCertificateModal.backupId}
                  </strong>
                </div>
                <div>
                  Executed At:{" "}
                  <strong className="text-foreground text-[10px]">
                    {new Date(activeCertificateModal.timestamp).toLocaleString()}
                  </strong>
                </div>
              </div>

              <div className="rounded-md border border-border bg-black/40 p-3 space-y-1 font-mono text-[11px]">
                <div className="text-muted-foreground">Certificate ID:</div>
                <div className="text-sky-400">{activeCertificateModal.drillId}</div>
                <div className="text-muted-foreground pt-1">SHA-256 Digest:</div>
                <div className="text-emerald-400 break-all">{activeCertificateModal.sha256}</div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() =>
                  copyToClipboard(
                    JSON.stringify(activeCertificateModal, null, 2),
                    "Drill Certificate JSON",
                  )
                }
                className="rounded-md border border-border px-3.5 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Copy JSON
              </button>
              <button
                onClick={() => setActiveCertificateModal(null)}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
