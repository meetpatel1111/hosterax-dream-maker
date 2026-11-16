import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEnvUpsertsFromRows,
  buildProjectCreatePayload,
  buildReclaimedSummary,
  deriveProjectNameFromImage,
  mergeDotEnvIntoRows,
  normalizeHealthPath,
  parseQuotaLimits,
  resolveEffectiveTarget,
} from "./new-project";

test("resolveEffectiveTarget enforces docker for remote servers and docker images", () => {
  assert.equal(
    resolveEffectiveTarget({ tab: "git", selectedTarget: "process", serverId: "local" }),
    "process",
  );
  assert.equal(
    resolveEffectiveTarget({ tab: "git", selectedTarget: "process", serverId: "vps-eu-1" }),
    "docker",
  );
  assert.equal(
    resolveEffectiveTarget({ tab: "docker-image", selectedTarget: "process", serverId: "local" }),
    "docker",
  );
});

test("deriveProjectNameFromImage extracts clean slug from registry image refs", () => {
  assert.equal(
    deriveProjectNameFromImage("ghcr.io/immich-app/immich-server:release"),
    "immich-server",
  );
  assert.equal(deriveProjectNameFromImage("nginx:alpine"), "nginx");
  assert.equal(deriveProjectNameFromImage("   "), "docker-app");
});

test("parseQuotaLimits validates bounds and returns null when empty", () => {
  assert.deepEqual(parseQuotaLimits({ cpuLimit: "", memoryMbLimit: "" }), {
    cpu_limit: null,
    memory_mb_limit: null,
  });
  assert.deepEqual(parseQuotaLimits({ cpuLimit: "1.5", memoryMbLimit: "512" }), {
    cpu_limit: 1.5,
    memory_mb_limit: 512,
  });
  const badCpu = parseQuotaLimits({ cpuLimit: "0", memoryMbLimit: "512" });
  assert.ok(badCpu.error);
  const badMem = parseQuotaLimits({ cpuLimit: "1", memoryMbLimit: "8" });
  assert.ok(badMem.error);
});

test("mergeDotEnvIntoRows merges new and updated keys while filtering blank placeholders", () => {
  const res = mergeDotEnvIntoRows(
    [
      { key: "NODE_ENV", value: "production" },
      { key: "", value: "" },
    ],
    "NODE_ENV=staging\nDATABASE_URL=postgres://localhost/app\n# comment\nBADLINE",
  );
  assert.equal(res.updatedCount, 1);
  assert.equal(res.addedCount, 1);
  assert.equal(res.errors.length, 1);
  assert.deepEqual(res.rows, [
    { key: "NODE_ENV", value: "staging" },
    { key: "DATABASE_URL", value: "postgres://localhost/app" },
  ]);
});

test("buildEnvUpsertsFromRows flags sensitive keys automatically", () => {
  const { envMap, upserts } = buildEnvUpsertsFromRows([
    { key: "PORT", value: "3000" },
    { key: "DATABASE_URL", value: "postgres://db/app" },
    { key: "JWT_SECRET", value: "supersecret" },
  ]);
  assert.equal(envMap.PORT, "3000");
  assert.equal(upserts[0].isSecret, false);
  assert.equal(upserts[1].isSecret, true);
  assert.equal(upserts[2].isSecret, true);
});

test("buildProjectCreatePayload normalizes health path, root directory, and remote server placement", () => {
  const payload = buildProjectCreatePayload({
    name: "billing-api",
    source: "https://github.com/acme/billing",
    tab: "git",
    selectedTarget: "process",
    serverId: "vps-1",
    buildCmd: "npm run build",
    startCmd: "npm start",
    port: 8080,
    branch: "main",
    rootDirectory: "apps/api",
    healthPath: "healthz",
    envMap: { NODE_ENV: "production" },
  });

  assert.equal(payload.target, "docker");
  assert.equal(payload.serverId, "vps-1");
  assert.equal(payload.healthPath, "/healthz");
  assert.equal(payload.rootDirectory, "apps/api");
  assert.equal(payload.gitBranch, "main");
  assert.equal(normalizeHealthPath(""), "/");
});

test("buildReclaimedSummary formats reclaimed disk space cleanly", () => {
  assert.equal(
    buildReclaimedSummary({ images: { SpaceReclaimed: 150 * 1024 * 1024 } }),
    "Docker cleanup freed 150 MB",
  );
  assert.equal(
    buildReclaimedSummary({ images: { SpaceReclaimed: 0 } }),
    "Docker cleanup completed (no unused artifacts remaining).",
  );
});
