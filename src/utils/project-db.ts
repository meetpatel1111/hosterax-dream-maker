import { buildConnectionEnvForDb, isSecretKey, ManagedDbEngine } from "./dependency-analyzer";

export interface DbEngineSpec {
  id: ManagedDbEngine;
  label: string;
  shortTag: string;
  defaultPort: number;
  primaryEnvKey: string;
}

export const DB_ENGINE_SPECS: DbEngineSpec[] = [
  {
    id: "postgres",
    label: "PostgreSQL",
    shortTag: "PG",
    defaultPort: 5432,
    primaryEnvKey: "DATABASE_URL",
  },
  {
    id: "redis",
    label: "Redis",
    shortTag: "RD",
    defaultPort: 6379,
    primaryEnvKey: "REDIS_URL",
  },
  {
    id: "mysql",
    label: "MySQL",
    shortTag: "MY",
    defaultPort: 3306,
    primaryEnvKey: "DATABASE_URL",
  },
  {
    id: "mariadb",
    label: "MariaDB",
    shortTag: "MA",
    defaultPort: 3306,
    primaryEnvKey: "DATABASE_URL",
  },
  {
    id: "mongodb",
    label: "MongoDB",
    shortTag: "MG",
    defaultPort: 27017,
    primaryEnvKey: "MONGODB_URI",
  },
  {
    id: "clickhouse",
    label: "ClickHouse",
    shortTag: "CH",
    defaultPort: 8123,
    primaryEnvKey: "CLICKHOUSE_URL",
  },
  {
    id: "libsql",
    label: "LibSQL",
    shortTag: "LQ",
    defaultPort: 8080,
    primaryEnvKey: "LIBSQL_URL",
  },
];

export const DB_STORAGE_OPTIONS_MB = [512, 1024, 2048, 5120, 10240] as const;

const DB_NAME_RE = /^[a-z][a-z0-9_]{0,40}$/;

export function isValidDbName(name: string): boolean {
  return DB_NAME_RE.test(String(name || ""));
}

export function normalizeManualDbName(rawName: string, engine: string = "postgres"): string {
  const cleanEng =
    String(engine || "db")
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "") || "db";
  let cleaned = String(rawName || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) {
    cleaned = `${cleanEng}_main`;
  }
  if (!/^[a-z]/.test(cleaned)) {
    cleaned = `db_${cleaned}`;
  }
  return cleaned.slice(0, 41).replace(/_+$/g, "") || "db_main";
}

export function formatDbStorageLabel(sizeMb: number): string {
  const n = Number(sizeMb);
  if (!Number.isFinite(n) || n <= 0) return "1 GB";
  if (n >= 1024) {
    const gb = n / 1024;
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
  }
  return `${Math.round(n)} MB`;
}

export function buildInternalHostHint(engine: string, port?: number | null): string {
  const normalized = String(engine || "").toLowerCase();
  const spec = DB_ENGINE_SPECS.find((s) => s.id === normalized);
  const resolvedPort = Number(port) > 0 ? Number(port) : spec?.defaultPort || 5432;
  return `host.docker.internal:${resolvedPort}`;
}

export interface DbEnvUpsert {
  key: string;
  value: string;
  isSecret: boolean;
}

export function resolveDbEnvUpserts({
  engine,
  internalConnectionString,
  existingKeys = [],
  projectImage = "",
}: {
  engine: ManagedDbEngine;
  internalConnectionString: string;
  existingKeys?: string[];
  projectImage?: string;
}): { upserts: DbEnvUpsert[]; keys: string[] } {
  const uri = String(internalConnectionString || "").trim();
  if (!uri) return { upserts: [], keys: [] };

  const injected = buildConnectionEnvForDb({
    engine,
    internalConnectionString: uri,
    existingKeys,
    imageHint: projectImage,
  });

  const upserts: DbEnvUpsert[] = Object.entries(injected).map(([key, value]) => ({
    key,
    value,
    isSecret:
      isSecretKey(key) ||
      /:\/\/[^@]*:[^@]+@/.test(value) ||
      /^(DATABASE_URL|REDIS_URL|MONGODB_URI|MONGO_URL|POSTGRES_URL|POSTGRESQL_URL|VALKEY_URL|CLICKHOUSE_URL|LIBSQL_URL)$/i.test(
        key,
      ),
  }));

  return {
    upserts,
    keys: upserts.map((u) => u.key),
  };
}

export interface DomainStatusSummary {
  verified: boolean;
  isPrimary: boolean;
  sslStatus: string;
  forceHttps: boolean;
  hstsEnabled: boolean;
  canProvisionSsl: boolean;
}

export function summarizeDomainStatus(domain: {
  verified?: boolean | number;
  is_primary?: boolean | number;
  ssl_status?: string | null;
  force_https?: boolean | number;
  hsts_enabled?: boolean | number;
}): DomainStatusSummary {
  const verified = Boolean(domain.verified);
  const sslStatus = String(domain.ssl_status || "none").toLowerCase();
  return {
    verified,
    isPrimary: Boolean(domain.is_primary),
    sslStatus,
    forceHttps: domain.force_https !== undefined ? Boolean(domain.force_https) : true,
    hstsEnabled: domain.hsts_enabled !== undefined ? Boolean(domain.hsts_enabled) : true,
    canProvisionSsl: verified && sslStatus !== "active" && sslStatus !== "provisioning",
  };
}
