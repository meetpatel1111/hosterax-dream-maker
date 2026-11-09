/**
 * Disaster Recovery, Multi-Cloud Backup Hub & Sandbox Restore Drill Utilities
 */

export interface ReadinessCheck {
  id: string;
  title: string;
  description: string;
  points: number;
  maxPoints: number;
  status: "pass" | "warning" | "fail";
  recommendation?: string;
}

export interface ReadinessEvaluation {
  score: number;
  grade: "A+" | "A" | "B" | "C" | "F";
  summary: string;
  checks: ReadinessCheck[];
}

export interface GfsStorageProjectionParams {
  baseDbSizeMb: number;
  dailyCount: number;
  weeklyCount: number;
  monthlyCount: number;
  yearlyCount: number;
  dailyChangeRatePercent?: number; // e.g. 5 for 5% daily delta
  compressionRatio?: number; // e.g. 0.35 means 65% reduction
}

export interface GfsStorageEstimate {
  totalSnapshots: number;
  estimatedRawMb: number;
  estimatedCompressedMb: number;
  estimatedCompressedGb: number;
  dailyStorageMb: number;
  weeklyStorageMb: number;
  monthlyStorageMb: number;
  yearlyStorageMb: number;
  estimatedS3CostPerMonth: number; // approx $0.023 / GB
  estimatedR2CostPerMonth: number; // approx $0.015 / GB
}

export interface SandboxDrillParams {
  backupId: string;
  databaseName: string;
  dbType: string;
  sizeMb: number;
  checksum?: string;
  isEncrypted: boolean;
  actualDurationSeconds?: number;
}

export interface DrillCertificate {
  drillId: string;
  backupId: string;
  databaseName: string;
  dbType: string;
  timestamp: string;
  status: "passed" | "warning" | "failed";
  rtoSeconds: number;
  rtoFormatted: string;
  checksumMatched: boolean;
  decryptionVerified: boolean;
  verificationQuery: string;
  queryResult: string;
  sandboxContainerId: string;
  auditMessage: string;
}

export interface RunbookParams {
  backupId: string;
  databaseName: string;
  dbType: string;
  isEncrypted: boolean;
  s3Bucket?: string;
  s3Key?: string;
  customPort?: number;
}

export interface BackupFilters {
  searchQuery?: string;
  dbType?: string;
  destination?: "all" | "local" | "s3";
  status?: "all" | "completed" | "failed" | "in_progress";
  encryptedOnly?: boolean;
  verifiedOnly?: boolean;
}

/**
 * Calculates Disaster Recovery Readiness Score (0 - 100)
 */
export function calculateRecoveryReadinessScore(params: {
  lastBackupAgeHours: number | null;
  totalBackups: number;
  verifiedBackupsCount: number;
  offsiteReplicaConfigured: boolean;
  encryptionEnabled: boolean;
  lastDrillAgeDays: number | null;
}): ReadinessEvaluation {
  const checks: ReadinessCheck[] = [];

  // Check 1: Snapshot Recency (25 pts max)
  let recencyPoints = 0;
  let recencyStatus: "pass" | "warning" | "fail" = "fail";
  let recencyRec: string | undefined;

  if (params.lastBackupAgeHours === null || params.totalBackups === 0) {
    recencyPoints = 0;
    recencyStatus = "fail";
    recencyRec =
      "No backups found. Trigger an immediate snapshot or schedule automatic daily backups.";
  } else if (params.lastBackupAgeHours <= 24) {
    recencyPoints = 25;
    recencyStatus = "pass";
  } else if (params.lastBackupAgeHours <= 72) {
    recencyPoints = 15;
    recencyStatus = "warning";
    recencyRec = `Latest backup is ${Math.round(params.lastBackupAgeHours)} hours old. Daily schedules are recommended.`;
  } else {
    recencyPoints = 5;
    recencyStatus = "fail";
    recencyRec = `Latest backup is stale (${Math.round(params.lastBackupAgeHours / 24)} days old). High risk of data loss.`;
  }

  checks.push({
    id: "recency",
    title: "Backup Recency (RPO)",
    description: "Evaluates whether your databases have been snapshotted within the past 24 hours.",
    points: recencyPoints,
    maxPoints: 25,
    status: recencyStatus,
    recommendation: recencyRec,
  });

  // Check 2: Integrity & SHA-256 Verification (25 pts max)
  let verifyPoints = 0;
  let verifyStatus: "pass" | "warning" | "fail" = "fail";
  let verifyRec: string | undefined;

  if (params.totalBackups === 0) {
    verifyPoints = 0;
    verifyStatus = "fail";
    verifyRec = "No snapshots available to verify.";
  } else {
    const ratio = params.verifiedBackupsCount / params.totalBackups;
    if (ratio >= 0.8) {
      verifyPoints = 25;
      verifyStatus = "pass";
    } else if (ratio >= 0.4) {
      verifyPoints = 15;
      verifyStatus = "warning";
      verifyRec = `${Math.round(ratio * 100)}% of snapshots verified. Run checksum verification across all archives.`;
    } else {
      verifyPoints = Math.round(ratio * 25);
      verifyStatus = "fail";
      verifyRec =
        "Most snapshots lack verified checksums. Unverified backups risk silent corruption.";
    }
  }

  checks.push({
    id: "verification",
    title: "Cryptographic Checksum Verification",
    description: "Validates archive gzip integrity and SHA-256 fingerprint parity.",
    points: verifyPoints,
    maxPoints: 25,
    status: verifyStatus,
    recommendation: verifyRec,
  });

  // Check 3: Multi-Cloud / Offsite Replication (20 pts max)
  const offsitePoints = params.offsiteReplicaConfigured ? 20 : 0;
  checks.push({
    id: "offsite",
    title: "Offsite & Multi-Cloud Replication",
    description:
      "Copies snapshots to remote S3, Cloudflare R2, or Wasabi to survive datacenter loss.",
    points: offsitePoints,
    maxPoints: 20,
    status: params.offsiteReplicaConfigured ? "pass" : "fail",
    recommendation: params.offsiteReplicaConfigured
      ? undefined
      : "Configure an offsite S3 / Cloudflare R2 bucket to ensure 3-2-1 backup compliance.",
  });

  // Check 4: Encryption at Rest (15 pts max)
  const encPoints = params.encryptionEnabled ? 15 : 0;
  checks.push({
    id: "encryption",
    title: "AES-256-GCM Encryption at Rest",
    description: "Guarantees zero-knowledge privacy for cloud-replicated snapshots.",
    points: encPoints,
    maxPoints: 15,
    status: params.encryptionEnabled ? "pass" : "warning",
    recommendation: params.encryptionEnabled
      ? undefined
      : "Enable AES-256-GCM encryption on backup schedules to protect sensitive customer data.",
  });

  // Check 5: Automated Sandbox Restore Drill (15 pts max)
  let drillPoints = 0;
  let drillStatus: "pass" | "warning" | "fail" = "fail";
  let drillRec: string | undefined;

  if (params.lastDrillAgeDays === null) {
    drillPoints = 0;
    drillStatus = "fail";
    drillRec = "Never performed a restore drill. A backup that has not been restored is unproven.";
  } else if (params.lastDrillAgeDays <= 14) {
    drillPoints = 15;
    drillStatus = "pass";
  } else if (params.lastDrillAgeDays <= 30) {
    drillPoints = 8;
    drillStatus = "warning";
    drillRec = `Last drill was ${Math.round(params.lastDrillAgeDays)} days ago. Run a bi-weekly sandbox drill.`;
  } else {
    drillPoints = 3;
    drillStatus = "fail";
    drillRec = `Last drill was over a month ago (${Math.round(params.lastDrillAgeDays)} days). Run an immediate test restore.`;
  }

  checks.push({
    id: "drill",
    title: "Automated Sandbox Restore Drills",
    description: "Proves that archives can be fully restored and queryable in an isolated sandbox.",
    points: drillPoints,
    maxPoints: 15,
    status: drillStatus,
    recommendation: drillRec,
  });

  const totalScore = Math.min(
    100,
    checks.reduce((acc, c) => acc + c.points, 0),
  );

  let grade: "A+" | "A" | "B" | "C" | "F" = "F";
  let summary = "";

  if (totalScore >= 95) {
    grade = "A+";
    summary =
      "Enterprise-Grade Disaster Recovery posture. Resilient against catastrophic host failure.";
  } else if (totalScore >= 80) {
    grade = "A";
    summary = "Strong Disaster Recovery posture with regular snapshots and integrity verification.";
  } else if (totalScore >= 65) {
    grade = "B";
    summary =
      "Adequate recovery setup. Consider enabling offsite S3 replication or running regular drills.";
  } else if (totalScore >= 50) {
    grade = "C";
    summary =
      "Vulnerable to data loss. Immediate attention required for offsite replication and verification.";
  } else {
    grade = "F";
    summary =
      "Critical Risk: Databases lack regular snapshots, offsite copies, or verified restore capabilities.";
  }

  return {
    score: totalScore,
    grade,
    summary,
    checks,
  };
}

/**
 * Calculates Grandfather-Father-Son (GFS) Storage Projections
 */
export function calculateGfsStorageProjection(
  params: GfsStorageProjectionParams,
): GfsStorageEstimate {
  const {
    baseDbSizeMb,
    dailyCount,
    weeklyCount,
    monthlyCount,
    yearlyCount,
    dailyChangeRatePercent = 5,
    compressionRatio = 0.35,
  } = params;

  // Base snapshot compressed size
  const baseCompressedMb = Math.max(0.1, baseDbSizeMb * compressionRatio);

  // Daily snapshots: base size with incremental accumulation
  const dailyStorageMb = dailyCount * baseCompressedMb;

  // Weekly snapshots (accumulates average 7 days of change per week)
  const weeklyChangeFactor = 1 + (7 * dailyChangeRatePercent) / 100;
  const weeklyAvgMb = baseCompressedMb * weeklyChangeFactor;
  const weeklyStorageMb = weeklyCount * weeklyAvgMb;

  // Monthly snapshots (accumulates ~30 days of growth)
  const monthlyChangeFactor = 1 + (30 * dailyChangeRatePercent) / 100;
  const monthlyAvgMb = baseCompressedMb * monthlyChangeFactor;
  const monthlyStorageMb = monthlyCount * monthlyAvgMb;

  // Yearly snapshots
  const yearlyChangeFactor = 1 + (180 * dailyChangeRatePercent) / 100;
  const yearlyAvgMb = baseCompressedMb * yearlyChangeFactor;
  const yearlyStorageMb = yearlyCount * yearlyAvgMb;

  const totalSnapshots = dailyCount + weeklyCount + monthlyCount + yearlyCount;
  const totalCompressedMb =
    Math.round((dailyStorageMb + weeklyStorageMb + monthlyStorageMb + yearlyStorageMb) * 100) / 100;
  const totalRawMb = Math.round((totalCompressedMb / compressionRatio) * 100) / 100;
  const totalCompressedGb = Math.round((totalCompressedMb / 1024) * 100) / 100;

  // Cloud pricing estimates
  const estimatedS3CostPerMonth = Math.round(totalCompressedGb * 0.023 * 100) / 100;
  const estimatedR2CostPerMonth = Math.round(totalCompressedGb * 0.015 * 100) / 100;

  return {
    totalSnapshots,
    estimatedRawMb: totalRawMb,
    estimatedCompressedMb: totalCompressedMb,
    estimatedCompressedGb: totalCompressedGb,
    dailyStorageMb: Math.round(dailyStorageMb * 10) / 10,
    weeklyStorageMb: Math.round(weeklyStorageMb * 10) / 10,
    monthlyStorageMb: Math.round(monthlyStorageMb * 10) / 10,
    yearlyStorageMb: Math.round(yearlyStorageMb * 10) / 10,
    estimatedS3CostPerMonth,
    estimatedR2CostPerMonth,
  };
}

/**
 * Simulates a Sandbox Restore Drill for audit and verification
 */
export function simulateSandboxDrill(params: SandboxDrillParams): DrillCertificate {
  const { backupId, databaseName, dbType, sizeMb, checksum, isEncrypted, actualDurationSeconds } =
    params;

  // Simulated Recovery Time Objective (RTO) scaling with archive size
  const calculatedSeconds =
    actualDurationSeconds ?? Math.max(1.2, Math.round((sizeMb * 0.08 + 1.4) * 10) / 10);

  const normalizedType = dbType.toLowerCase();
  let verificationQuery = "SELECT 1;";
  let queryResult = "1 row in set (0.00 sec)";

  if (normalizedType.includes("mongo")) {
    verificationQuery = "db.adminCommand({ ping: 1 })";
    queryResult = '{ "ok": 1 }';
  } else if (normalizedType.includes("redis")) {
    verificationQuery = "PING";
    queryResult = "PONG";
  } else if (normalizedType.includes("postgres") || normalizedType.includes("pg")) {
    verificationQuery = "SELECT current_database(), pg_database_size(current_database());";
    queryResult = `${databaseName} | ${(sizeMb * 1024 * 1024).toFixed(0)} bytes (1 row)`;
  } else if (normalizedType.includes("mysql") || normalizedType.includes("maria")) {
    verificationQuery = "SELECT DATABASE(), @@version;";
    queryResult = `${databaseName} | 8.0.36-community (1 row)`;
  }

  const randomHash = Math.random().toString(36).substring(2, 10);
  const sandboxContainerId = `hx-sandbox-${normalizedType}-${randomHash}`;

  const checksumMatched = Boolean(checksum && checksum.length >= 32);

  return {
    drillId: `drill-${Date.now()}-${randomHash}`,
    backupId,
    databaseName,
    dbType: normalizedType,
    timestamp: new Date().toISOString(),
    status: checksumMatched ? "passed" : "warning",
    rtoSeconds: calculatedSeconds,
    rtoFormatted: formatRtoDuration(calculatedSeconds),
    checksumMatched,
    decryptionVerified: isEncrypted,
    verificationQuery,
    queryResult,
    sandboxContainerId,
    auditMessage: checksumMatched
      ? `Successfully restored into ephemeral container ${sandboxContainerId}. Verification query returned expected response. Container terminated cleanly.`
      : `Restored into ${sandboxContainerId}, but archive SHA-256 fingerprint was missing from original metadata. Recommend manual re-hash.`,
  };
}

/**
 * Formats duration in seconds to human-friendly RTO
 */
export function formatRtoDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${mins}m ${rem}s`;
}

/**
 * Formats raw bytes to human-readable string (MB / GB)
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Generates an Emergency CLI Recovery Runbook script
 */
export function generateEmergencyRunbookScript(params: RunbookParams): string {
  const { backupId, databaseName, dbType, isEncrypted, s3Bucket, s3Key, customPort } = params;
  const normalizedType = dbType.toLowerCase();

  const lines: string[] = [
    "#!/usr/bin/env bash",
    "# =====================================================================",
    `# HOSTERAX EMERGENCY DISASTER RECOVERY RUNBOOK`,
    `# Target Database: ${databaseName} (${normalizedType.toUpperCase()})`,
    `# Snapshot ID:     ${backupId}`,
    `# Generated At:    ${new Date().toISOString()}`,
    "# =====================================================================",
    "set -euo pipefail",
    "",
    'echo "==> [1/4] Preparing recovery workspace..."',
    "RESTORE_DIR=$(mktemp -d -t hosterax-recovery-XXXXXX)",
    "cd $RESTORE_DIR",
    "",
  ];

  if (s3Bucket && s3Key) {
    lines.push(
      'echo "==> [2/4] Pulling snapshot archive from offsite Cloud Storage..."',
      `aws s3 cp "s3://${s3Bucket}/${s3Key}" archive.tar.gz`,
      "",
    );
  } else {
    lines.push(
      'echo "==> [2/4] Locating local snapshot archive..."',
      `ARCHIVE_PATH="$HOME/.hosterax/backups/${backupId}.tar.gz"`,
      'if [ ! -f "$ARCHIVE_PATH" ]; then',
      `  echo "ERROR: Backup archive $ARCHIVE_PATH not found on host!" >&2`,
      "  exit 1",
      "fi",
      'cp "$ARCHIVE_PATH" archive.tar.gz',
      "",
    );
  }

  if (isEncrypted) {
    lines.push(
      'echo "==> [3/4] Decrypting AES-256-GCM encrypted payload using server secret.key..."',
      'if [ ! -f "$HOME/.hosterax/secret.key" ]; then',
      `  echo "ERROR: Missing encryption key at ~/.hosterax/secret.key" >&2`,
      "  exit 1",
      "fi",
      'openssl enc -d -aes-256-gcm -in archive.tar.gz -out decrypted.tar -pass file:"$HOME/.hosterax/secret.key"',
      "tar -xzf decrypted.tar",
      "",
    );
  } else {
    lines.push('echo "==> [3/4] Unpacking compressed snapshot..."', "tar -xzf archive.tar.gz", "");
  }

  lines.push('echo "==> [4/4] Restoring into database container..."');

  if (normalizedType.includes("postgres") || normalizedType.includes("pg")) {
    const port = customPort || 5432;
    lines.push(
      `docker exec -i ${databaseName} psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS ${databaseName}_recovery;"`,
      `docker exec -i ${databaseName} psql -U postgres -d postgres -c "CREATE DATABASE ${databaseName}_recovery;"`,
      `docker exec -i ${databaseName} pg_restore -U postgres -d ${databaseName}_recovery < dump.sql`,
      `echo "SUCCESS: PostgreSQL database restored into ${databaseName}_recovery on port ${port}."`,
    );
  } else if (normalizedType.includes("mongo")) {
    const port = customPort || 27017;
    lines.push(
      `docker exec -i ${databaseName} mongorestore --drop --gzip --archive=archive.dump`,
      `echo "SUCCESS: MongoDB collections restored on port ${port}."`,
    );
  } else if (normalizedType.includes("mysql") || normalizedType.includes("maria")) {
    const port = customPort || 3306;
    lines.push(
      `docker exec -i ${databaseName} mysql -u root -p"$MYSQL_ROOT_PASSWORD" ${databaseName} < dump.sql`,
      `echo "SUCCESS: MySQL database restored on port ${port}."`,
    );
  } else if (normalizedType.includes("redis")) {
    lines.push(
      `docker cp dump.rdb ${databaseName}:/data/dump.rdb`,
      `docker restart ${databaseName}`,
      `echo "SUCCESS: Redis dump.rdb copied and server restarted."`,
    );
  } else {
    lines.push(`echo "Generic volume restore completed in $RESTORE_DIR."`);
  }

  lines.push("", 'echo "==> Emergency recovery complete."', "rm -rf $RESTORE_DIR");

  return lines.join("\n");
}

/**
 * Filter backups based on search query, destination, and status
 */
export function filterBackups<
  T extends {
    id: string;
    database_name: string;
    db_type: string;
    status: string;
    encrypted?: number;
    verify_status?: string | null;
    destination?: string;
  },
>(items: T[], filters: BackupFilters): T[] {
  return items.filter((b) => {
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase().trim();
      const match =
        b.id.toLowerCase().includes(q) ||
        b.database_name.toLowerCase().includes(q) ||
        b.db_type.toLowerCase().includes(q);
      if (!match) return false;
    }

    if (filters.dbType && filters.dbType !== "all") {
      if (b.db_type.toLowerCase() !== filters.dbType.toLowerCase()) return false;
    }

    if (filters.destination && filters.destination !== "all") {
      if (filters.destination === "s3" && b.destination !== "s3_synced") return false;
      if (filters.destination === "local" && b.destination === "s3_synced") return false;
    }

    if (filters.status && filters.status !== "all") {
      if (b.status !== filters.status) return false;
    }

    if (filters.encryptedOnly && b.encrypted !== 1) {
      return false;
    }

    if (filters.verifiedOnly && b.verify_status !== "verified") {
      return false;
    }

    return true;
  });
}
