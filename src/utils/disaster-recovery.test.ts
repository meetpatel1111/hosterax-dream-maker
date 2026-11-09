import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateRecoveryReadinessScore,
  calculateGfsStorageProjection,
  simulateSandboxDrill,
  generateEmergencyRunbookScript,
  filterBackups,
  formatBytes,
  formatRtoDuration,
} from "./disaster-recovery";

test("calculateRecoveryReadinessScore calculates perfect score for complete setup", () => {
  const result = calculateRecoveryReadinessScore({
    lastBackupAgeHours: 4,
    totalBackups: 10,
    verifiedBackupsCount: 10,
    offsiteReplicaConfigured: true,
    encryptionEnabled: true,
    lastDrillAgeDays: 5,
  });

  assert.equal(result.score, 100);
  assert.equal(result.grade, "A+");
  assert.equal(result.checks.length, 5);
  assert.ok(result.checks.every((c) => c.status === "pass"));
});

test("calculateRecoveryReadinessScore flags missing backups and unverified state", () => {
  const result = calculateRecoveryReadinessScore({
    lastBackupAgeHours: null,
    totalBackups: 0,
    verifiedBackupsCount: 0,
    offsiteReplicaConfigured: false,
    encryptionEnabled: false,
    lastDrillAgeDays: null,
  });

  assert.equal(result.score, 0);
  assert.equal(result.grade, "F");
  assert.ok(result.checks.some((c) => c.id === "recency" && c.status === "fail"));
  assert.ok(result.checks.some((c) => c.id === "offsite" && c.status === "fail"));
  assert.ok(result.checks.some((c) => c.id === "drill" && c.status === "fail"));
});

test("calculateRecoveryReadinessScore evaluates partial scores appropriately", () => {
  const result = calculateRecoveryReadinessScore({
    lastBackupAgeHours: 48, // 15 pts
    totalBackups: 10,
    verifiedBackupsCount: 5, // 50% => 15 pts
    offsiteReplicaConfigured: true, // 20 pts
    encryptionEnabled: true, // 15 pts
    lastDrillAgeDays: 20, // 8 pts
  });

  // 15 + 15 + 20 + 15 + 8 = 73 => Grade B
  assert.equal(result.score, 73);
  assert.equal(result.grade, "B");
});

test("calculateGfsStorageProjection calculates snapshot counts and storage footprints", () => {
  const estimate = calculateGfsStorageProjection({
    baseDbSizeMb: 1000, // 1 GB uncompressed
    dailyCount: 7,
    weeklyCount: 4,
    monthlyCount: 12,
    yearlyCount: 1,
    dailyChangeRatePercent: 5,
    compressionRatio: 0.35,
  });

  assert.equal(estimate.totalSnapshots, 24);
  assert.ok(estimate.estimatedCompressedMb > 0);
  assert.ok(estimate.estimatedCompressedGb > 0);
  assert.ok(estimate.estimatedS3CostPerMonth >= 0);
  assert.ok(estimate.estimatedR2CostPerMonth >= 0);
  assert.ok(estimate.estimatedS3CostPerMonth >= estimate.estimatedR2CostPerMonth);
});

test("simulateSandboxDrill generates valid certificate with verification query", () => {
  const cert = simulateSandboxDrill({
    backupId: "bkp_postgres_test123",
    databaseName: "production_db",
    dbType: "postgres",
    sizeMb: 250,
    checksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    isEncrypted: true,
    actualDurationSeconds: 4.8,
  });

  assert.equal(cert.status, "passed");
  assert.equal(cert.databaseName, "production_db");
  assert.equal(cert.checksumMatched, true);
  assert.equal(cert.decryptionVerified, true);
  assert.equal(cert.rtoSeconds, 4.8);
  assert.equal(cert.rtoFormatted, "4.8s");
  assert.ok(cert.verificationQuery.includes("SELECT"));
  assert.ok(cert.sandboxContainerId.startsWith("hx-sandbox-postgres-"));
});

test("generateEmergencyRunbookScript generates executable bash script with proper steps", () => {
  const script = generateEmergencyRunbookScript({
    backupId: "bkp_mongodb_456",
    databaseName: "customer_store",
    dbType: "mongodb",
    isEncrypted: true,
    s3Bucket: "my-backups-bucket",
    s3Key: "customer_store/bkp_mongodb_456.tar.gz",
    customPort: 27017,
  });

  assert.ok(script.startsWith("#!/usr/bin/env bash"));
  assert.ok(script.includes("set -euo pipefail"));
  assert.ok(script.includes("aws s3 cp"));
  assert.ok(script.includes("openssl enc -d -aes-256-gcm"));
  assert.ok(script.includes("mongorestore"));
});

test("filterBackups filters by query, db type, destination, and encryption", () => {
  const sample = [
    {
      id: "bkp_1",
      database_name: "prod_pg",
      db_type: "postgres",
      status: "completed",
      encrypted: 1,
      verify_status: "verified",
      destination: "s3_synced",
    },
    {
      id: "bkp_2",
      database_name: "analytics_mongo",
      db_type: "mongo",
      status: "completed",
      encrypted: 0,
      verify_status: null,
      destination: "local",
    },
    {
      id: "bkp_3",
      database_name: "cache_redis",
      db_type: "redis",
      status: "failed",
      encrypted: 0,
      verify_status: "failed",
      destination: "local",
    },
  ];

  const pgOnly = filterBackups(sample, { dbType: "postgres" });
  assert.equal(pgOnly.length, 1);
  assert.equal(pgOnly[0].id, "bkp_1");

  const s3Only = filterBackups(sample, { destination: "s3" });
  assert.equal(s3Only.length, 1);
  assert.equal(s3Only[0].id, "bkp_1");

  const encOnly = filterBackups(sample, { encryptedOnly: true });
  assert.equal(encOnly.length, 1);
  assert.equal(encOnly[0].id, "bkp_1");

  const searchMongo = filterBackups(sample, { searchQuery: "analytics" });
  assert.equal(searchMongo.length, 1);
  assert.equal(searchMongo[0].id, "bkp_2");
});

test("formatBytes and formatRtoDuration format accurately", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1048576), "1.0 MB");
  assert.equal(formatBytes(1073741824), "1.0 GB");

  assert.equal(formatRtoDuration(4.5), "4.5s");
  assert.equal(formatRtoDuration(65), "1m 5s");
  assert.equal(formatRtoDuration(130), "2m 10s");
});
