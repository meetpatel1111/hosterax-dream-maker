import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInternalHostHint,
  formatDbStorageLabel,
  isValidDbName,
  normalizeManualDbName,
  resolveDbEnvUpserts,
  summarizeDomainStatus,
} from "./project-db";

test("normalizeManualDbName produces valid lowercase <=41 char identifiers", () => {
  assert.equal(normalizeManualDbName("My App-DB!", "postgres"), "my_app_db");
  assert.equal(normalizeManualDbName("123-cache", "redis"), "db_123_cache");
  assert.equal(normalizeManualDbName("", "mariadb"), "mariadb_main");
  const longName = normalizeManualDbName("a".repeat(60), "postgres");
  assert.equal(longName.length, 41);
  assert.equal(isValidDbName(longName), true);
  assert.equal(isValidDbName("bad-name"), false);
});

test("formatDbStorageLabel formats MB and GB consistently", () => {
  assert.equal(formatDbStorageLabel(512), "512 MB");
  assert.equal(formatDbStorageLabel(1024), "1 GB");
  assert.equal(formatDbStorageLabel(1536), "1.5 GB");
  assert.equal(formatDbStorageLabel(10240), "10 GB");
});

test("buildInternalHostHint uses allocated port or engine default", () => {
  assert.equal(buildInternalHostHint("postgres", 5439), "host.docker.internal:5439");
  assert.equal(buildInternalHostHint("redis", undefined), "host.docker.internal:6379");
  assert.equal(buildInternalHostHint("mongodb", null), "host.docker.internal:27017");
});

test("resolveDbEnvUpserts marks connection URLs with credentials as secrets", () => {
  const pg = resolveDbEnvUpserts({
    engine: "postgres",
    internalConnectionString: "postgresql://hx:supersecret@host.docker.internal:5432/app_db",
    existingKeys: ["POSTGRES_HOST", "PORT"],
  });
  assert.deepEqual(pg.keys, ["DATABASE_URL", "POSTGRES_HOST"]);
  const dbUrl = pg.upserts.find((u) => u.key === "DATABASE_URL");
  assert.equal(dbUrl?.isSecret, true);
  assert.equal(pg.upserts.find((u) => u.key === "POSTGRES_HOST")?.value, "host.docker.internal");

  const redis = resolveDbEnvUpserts({
    engine: "redis",
    internalConnectionString: "redis://:pass123@host.docker.internal:6379",
  });
  assert.deepEqual(redis.keys, ["REDIS_URL"]);
  assert.equal(redis.upserts[0]?.isSecret, true);
});

test("summarizeDomainStatus computes verification and SSL flags", () => {
  const unverified = summarizeDomainStatus({ verified: 0, is_primary: 0, ssl_status: "none" });
  assert.equal(unverified.verified, false);
  assert.equal(unverified.canProvisionSsl, false);
  assert.equal(unverified.forceHttps, true);

  const verifiedNoSsl = summarizeDomainStatus({
    verified: 1,
    is_primary: 1,
    ssl_status: "none",
    force_https: 0,
    hsts_enabled: 0,
  });
  assert.equal(verifiedNoSsl.verified, true);
  assert.equal(verifiedNoSsl.isPrimary, true);
  assert.equal(verifiedNoSsl.canProvisionSsl, true);
  assert.equal(verifiedNoSsl.forceHttps, false);
  assert.equal(verifiedNoSsl.hstsEnabled, false);

  const activeSsl = summarizeDomainStatus({ verified: 1, ssl_status: "active" });
  assert.equal(activeSsl.canProvisionSsl, false);
});
