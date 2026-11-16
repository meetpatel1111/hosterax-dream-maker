import { isLikelySecretEnvKey, parseDotEnvText } from "./env-parser";

export type NewProjectTab =
  "git" | "docker-image" | "upload" | "url" | "cli" | "template" | "one-click";

export type EnvRowDraft = {
  key: string;
  value: string;
};

export type EnvUpsertPayload = {
  key: string;
  value: string;
  isSecret: boolean;
  environment?: string;
};

export function slugifyProjectName(input: string): string {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function deriveProjectNameFromImage(image: string): string {
  const cleaned = String(image || "")
    .trim()
    .split("/")
    .pop()
    ?.split(":")[0]
    ?.split("@")[0];
  return slugifyProjectName(cleaned || "") || "docker-app";
}

export function normalizeHealthPath(path: string): string {
  const trimmed = String(path || "").trim();
  if (!trimmed || trimmed === "/") return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function resolveEffectiveTarget(params: {
  tab: NewProjectTab;
  selectedTarget: "docker" | "process" | "ssh";
  serverId: string;
  overrideTarget?: "docker" | "process" | "ssh";
}): "docker" | "process" {
  const candidate = params.overrideTarget ?? params.selectedTarget;
  if (
    params.tab === "docker-image" ||
    params.tab === "one-click" ||
    params.serverId !== "local" ||
    candidate === "docker" ||
    candidate === "ssh"
  ) {
    return "docker";
  }
  return "process";
}

export function parseQuotaLimits(inputs: { cpuLimit: string; memoryMbLimit: string }): {
  cpu_limit: number | null;
  memory_mb_limit: number | null;
  error?: string;
} {
  let cpu: number | null = null;
  let mem: number | null = null;

  const cpuRaw = String(inputs.cpuLimit || "").trim();
  if (cpuRaw) {
    const parsedCpu = Number(cpuRaw);
    if (!Number.isFinite(parsedCpu) || parsedCpu <= 0) {
      return {
        cpu_limit: null,
        memory_mb_limit: null,
        error: "CPU limit must be a positive number of cores (e.g. 0.5, 1, 2)",
      };
    }
    cpu = Math.round(parsedCpu * 100) / 100;
  }

  const memRaw = String(inputs.memoryMbLimit || "").trim();
  if (memRaw) {
    const parsedMem = Number(memRaw);
    if (!Number.isFinite(parsedMem) || parsedMem < 16) {
      return {
        cpu_limit: null,
        memory_mb_limit: null,
        error: "Memory limit must be at least 16 MB",
      };
    }
    mem = Math.round(parsedMem);
  }

  return { cpu_limit: cpu, memory_mb_limit: mem };
}

export function mergeDotEnvIntoRows(
  existingRows: EnvRowDraft[],
  dotEnvText: string,
): { rows: EnvRowDraft[]; addedCount: number; updatedCount: number; errors: string[] } {
  const parsed = parseDotEnvText(dotEnvText);
  const next = existingRows.filter((r) => r.key.trim() !== "" || r.value !== "");
  const indexByKey = new Map<string, number>();

  next.forEach((row, idx) => {
    const k = row.key.trim();
    if (k) indexByKey.set(k, idx);
  });

  let addedCount = 0;
  let updatedCount = 0;
  for (const entry of parsed.entries) {
    const existingIdx = indexByKey.get(entry.key);
    if (existingIdx !== undefined) {
      next[existingIdx] = { key: entry.key, value: entry.value };
      updatedCount += 1;
    } else {
      indexByKey.set(entry.key, next.length);
      next.push({ key: entry.key, value: entry.value });
      addedCount += 1;
    }
  }

  if (next.length === 0) {
    next.push({ key: "NODE_ENV", value: "production" });
  }

  return {
    rows: next,
    addedCount,
    updatedCount,
    errors: parsed.errors,
  };
}

export function buildEnvUpsertsFromRows(
  rows: EnvRowDraft[],
  environment = "production",
): { envMap: Record<string, string>; upserts: EnvUpsertPayload[] } {
  const envMap: Record<string, string> = {};
  const deduped = new Map<string, EnvUpsertPayload>();

  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    envMap[key] = row.value;
    deduped.set(key, {
      key,
      value: row.value,
      isSecret: isLikelySecretEnvKey(key),
      environment,
    });
  }

  return {
    envMap,
    upserts: Array.from(deduped.values()),
  };
}

export function buildProjectCreatePayload(input: {
  name: string;
  source: string;
  tab: NewProjectTab;
  selectedTarget: "docker" | "process" | "ssh";
  serverId: string;
  buildCmd: string;
  startCmd: string;
  port: number;
  branch?: string;
  rootDirectory?: string;
  healthPath?: string;
  envMap: Record<string, string>;
}): Record<string, unknown> {
  const target = resolveEffectiveTarget({
    tab: input.tab,
    selectedTarget: input.selectedTarget,
    serverId: input.serverId,
  });

  const payload: Record<string, unknown> = {
    name: input.name.trim(),
    source: input.source.trim(),
    buildCmd: input.buildCmd,
    startCmd: input.startCmd,
    target,
    port: Number(input.port) || 3000,
    healthPath: normalizeHealthPath(input.healthPath || "/"),
    env: input.envMap,
  };

  if (input.serverId !== "local") {
    payload.serverId = input.serverId;
  }

  if ((input.tab === "git" || input.tab === "url") && input.branch?.trim()) {
    payload.gitBranch = input.branch.trim();
  }

  const rootDir = String(input.rootDirectory || "").trim();
  if (rootDir && rootDir !== "./" && rootDir !== ".") {
    payload.rootDirectory = rootDir;
  }

  return payload;
}

export function buildReclaimedSummary(result: Record<string, any> | undefined | null): string {
  if (!result || typeof result !== "object") {
    return "Docker cleanup completed.";
  }
  const sections = ["containers", "images", "networks", "volumes", "buildCache"];
  let reclaimedBytes = 0;
  for (const key of sections) {
    const val = result[key];
    if (val && typeof val.SpaceReclaimed === "number") {
      reclaimedBytes += val.SpaceReclaimed;
    }
  }
  if (reclaimedBytes > 0) {
    const mb = reclaimedBytes / (1024 * 1024);
    return mb >= 1024
      ? `Docker cleanup freed ${(mb / 1024).toFixed(2)} GB`
      : `Docker cleanup freed ${Math.round(mb)} MB`;
  }
  return "Docker cleanup completed (no unused artifacts remaining).";
}
