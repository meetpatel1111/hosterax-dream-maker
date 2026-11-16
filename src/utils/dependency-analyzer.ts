// Client-side dependency analysis types, secret generation, DB connection-string injection,
// and offline fallback heuristics shared across App Store and Registry Explorer.

export type ManagedDbEngine = "postgres" | "redis" | "mysql" | "mariadb" | "mongodb";

export interface AnalyzedEnvVar {
  key: string;
  defaultValue: string;
  required: boolean;
  secret: boolean;
  description?: string;
  source: "preset" | "oci" | "compose" | "env-example" | "readme" | "custom" | string;
}

export interface DetectedDatabaseDep {
  engine: ManagedDbEngine;
  serviceName?: string;
  reason: string;
  envKey?: string;
  confidence: "high" | "medium";
  recommended: boolean;
}

export interface DependencyAnalysisResult {
  image: string;
  appName?: string;
  detectedPort: number;
  exposedPorts: number[];
  volumes: string[];
  envVars: AnalyzedEnvVar[];
  databases: DetectedDatabaseDep[];
  composeServices?: Array<{ name: string; image?: string }>;
  sourcesChecked: string[];
  warnings: string[];
}

export interface EditableEnvRow {
  id: string;
  key: string;
  value: string;
  required: boolean;
  secret: boolean;
  description?: string;
  source: string;
}

const SECRET_KEY_RE =
  /(SECRET|PASSWORD|PASSWD|PASS\b|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|ENCRYPTION_KEY|AUTH_KEY|SIGNING_KEY|JWT|SALT|CREDENTIAL|MASTER_KEY|SESSION_KEY|APP_KEY)/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

export function sanitizeProjectSlug(rawName: string): string {
  const cleaned = String(rawName || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "app-container";
}

export function sanitizeDatabaseName(
  projectSlug: string,
  engine: ManagedDbEngine | string,
  suffixTag = "",
): string {
  const cleanProj = String(projectSlug || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  const cleanEng = String(engine || "db")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const cleanTag = String(suffixTag || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "");
  const suffix = `${cleanEng ? `_${cleanEng}` : ""}${cleanTag ? `_${cleanTag}` : ""}`;
  const maxBaseLen = Math.max(1, 41 - suffix.length);
  let base = cleanProj.slice(0, maxBaseLen).replace(/_+$/g, "");
  if (!base || !/^[a-z]/.test(base)) {
    base = `db_${base}`.replace(/_+$/g, "").slice(0, maxBaseLen).replace(/_+$/g, "");
  }
  return `${base}${suffix}`.slice(0, 41).replace(/_+$/g, "");
}

export function deriveProjectNameFromImage(imageRef: string): string {
  const base =
    String(imageRef || "")
      .trim()
      .split("@")[0]
      .split("/")
      .pop()
      ?.split(":")[0] || "custom-app";
  return sanitizeProjectSlug(base);
}

export function generateRandomSecret(byteLength = 24): string {
  const bytes = new Uint8Array(byteLength);
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.getRandomValues === "function"
  ) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildFallbackDependencyAnalysis({
  image,
  appName = "",
  presetEnv = {},
  presetPort = 3000,
  imageVerified = true,
}: {
  image: string;
  appName?: string;
  presetEnv?: Record<string, string>;
  presetPort?: number;
  imageVerified?: boolean;
}): DependencyAnalysisResult {
  const envVars: AnalyzedEnvVar[] = Object.entries(presetEnv || {}).map(([key, val]) => ({
    key,
    defaultValue: String(val ?? ""),
    required: !String(val ?? "").trim(),
    secret: isSecretKey(key),
    source: "preset",
  }));

  const warnings: string[] = [];
  if (imageVerified === false) {
    warnings.push(
      `Image "${image}" is inferred from the repository name and is not yet verified — confirm the tag before deploying.`,
    );
  }

  return {
    image,
    appName,
    detectedPort: presetPort || 3000,
    exposedPorts: [presetPort || 3000],
    volumes: [],
    envVars,
    databases: [],
    sourcesChecked: envVars.length > 0 ? ["curated-catalog"] : [],
    warnings,
  };
}

export function toEditableEnvRows(analysis: DependencyAnalysisResult): EditableEnvRow[] {
  return (analysis.envVars || []).map((v, idx) => ({
    id: `env-${idx}-${v.key}`,
    key: v.key,
    value: v.defaultValue ?? "",
    required: Boolean(v.required),
    secret: Boolean(v.secret),
    description: v.description,
    source: v.source || "oci",
  }));
}

export function parseEnvPaste(
  text: string,
): Array<{ key: string; value: string; secret: boolean }> {
  const rows: Array<{ key: string; value: string; secret: boolean }> = [];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const cleaned = line.replace(/^export\s+/, "");
    const eq = cleaned.indexOf("=");
    if (eq <= 0) continue;
    const key = cleaned
      .slice(0, eq)
      .trim()
      .replace(/[^A-Za-z0-9_.-]/g, "");
    if (!key) continue;
    let value = cleaned.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    rows.push({ key, value, secret: isSecretKey(key) });
  }
  return rows;
}

export function parseConnectionUriParts(uri: string): {
  protocol: string;
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
} | null {
  try {
    const u = new URL(uri);
    return {
      protocol: u.protocol.replace(/:$/, ""),
      user: decodeURIComponent(u.username || ""),
      password: decodeURIComponent(u.password || ""),
      host: u.hostname,
      port: u.port,
      database: u.pathname.replace(/^\//, ""),
    };
  } catch {
    return null;
  }
}

export function buildConnectionEnvForDb({
  engine,
  internalConnectionString,
  existingKeys,
  preferredEnvKey,
  imageHint = "",
}: {
  engine: ManagedDbEngine;
  internalConnectionString: string;
  existingKeys: string[];
  preferredEnvKey?: string;
  imageHint?: string;
}): Record<string, string> {
  const injected: Record<string, string> = {};
  const upperKeys = new Set(existingKeys.map((k) => k.toUpperCase()));
  const parts = parseConnectionUriParts(internalConnectionString);
  const imgLower = String(imageHint || "").toLowerCase();

  if (engine === "redis") {
    const targetUrlKey =
      preferredEnvKey && /REDIS/i.test(preferredEnvKey)
        ? preferredEnvKey
        : upperKeys.has("PAPERLESS_REDIS") || /paperless/.test(imgLower)
          ? "PAPERLESS_REDIS"
          : upperKeys.has("VALKEY_URL")
            ? "VALKEY_URL"
            : "REDIS_URL";
    injected[targetUrlKey] = internalConnectionString;
    if (upperKeys.has("REDIS") && targetUrlKey !== "REDIS") {
      injected.REDIS = internalConnectionString;
    }
    if (parts) {
      if (upperKeys.has("REDIS_HOST")) injected.REDIS_HOST = parts.host;
      if (upperKeys.has("REDIS_PORT") && parts.port) injected.REDIS_PORT = parts.port;
      if (upperKeys.has("REDIS_PASSWORD") && parts.password)
        injected.REDIS_PASSWORD = parts.password;
      if (upperKeys.has("QUEUE_BULL_REDIS_HOST")) injected.QUEUE_BULL_REDIS_HOST = parts.host;
      if (upperKeys.has("QUEUE_BULL_REDIS_PORT") && parts.port)
        injected.QUEUE_BULL_REDIS_PORT = parts.port;
      if (upperKeys.has("QUEUE_BULL_REDIS_PASSWORD") && parts.password)
        injected.QUEUE_BULL_REDIS_PASSWORD = parts.password;
    }
    return injected;
  }

  if (engine === "mongodb") {
    const targetUrlKey =
      preferredEnvKey && /MONGO/i.test(preferredEnvKey)
        ? preferredEnvKey
        : upperKeys.has("MONGO_URL")
          ? "MONGO_URL"
          : upperKeys.has("DATABASE_URL")
            ? "DATABASE_URL"
            : "MONGODB_URI";
    injected[targetUrlKey] = internalConnectionString;
    if (parts) {
      if (upperKeys.has("MONGO_HOST")) injected.MONGO_HOST = parts.host;
      if (upperKeys.has("MONGO_PORT") && parts.port) injected.MONGO_PORT = parts.port;
    }
    return injected;
  }

  const isGitea =
    /(?:^|\/)(?:gitea|forgejo)(?::|$)/.test(imgLower) ||
    upperKeys.has("GITEA__DATABASE__HOST") ||
    upperKeys.has("GITEA__SERVER__ROOT_URL");
  const isGhost =
    /(?:^|\/)ghost(?::|$)/.test(imgLower) || upperKeys.has("DATABASE__CONNECTION__HOST");
  const isMetabase = /(?:^|\/)metabase(?::|$)/.test(imgLower) || upperKeys.has("MB_DB_HOST");
  const isPaperless = /paperless/.test(imgLower) || upperKeys.has("PAPERLESS_DBHOST");
  const isDirectus = /(?:^|\/)directus(?::|$)/.test(imgLower) || upperKeys.has("DB_CLIENT");

  const primaryKey =
    preferredEnvKey && !isGitea && !isGhost && !isMetabase && !isPaperless
      ? preferredEnvKey
      : upperKeys.has("POSTGRES_URL")
        ? "POSTGRES_URL"
        : upperKeys.has("POSTGRESQL_URL")
          ? "POSTGRESQL_URL"
          : "DATABASE_URL";
  injected[primaryKey] = internalConnectionString;

  if (parts) {
    if (isGitea) {
      injected.GITEA__database__DB_TYPE = engine === "postgres" ? "postgres" : "mysql";
      injected.GITEA__database__HOST = parts.port ? `${parts.host}:${parts.port}` : parts.host;
      if (parts.database) injected.GITEA__database__NAME = parts.database;
      if (parts.user) injected.GITEA__database__USER = parts.user;
      if (parts.password) injected.GITEA__database__PASSWD = parts.password;
    }
    if (isGhost) {
      injected.database__client = engine === "postgres" ? "pg" : "mysql";
      injected.database__connection__host = parts.host;
      if (parts.port) injected.database__connection__port = parts.port;
      if (parts.user) injected.database__connection__user = parts.user;
      if (parts.password) injected.database__connection__password = parts.password;
      if (parts.database) injected.database__connection__database = parts.database;
    }
    if (isMetabase) {
      injected.MB_DB_TYPE = engine === "postgres" ? "postgres" : "mysql";
      injected.MB_DB_HOST = parts.host;
      if (parts.port) injected.MB_DB_PORT = parts.port;
      if (parts.database) injected.MB_DB_DBNAME = parts.database;
      if (parts.user) injected.MB_DB_USER = parts.user;
      if (parts.password) injected.MB_DB_PASS = parts.password;
    }
    if (isPaperless) {
      injected.PAPERLESS_DBENGINE = engine === "postgres" ? "postgresql" : "mariadb";
      injected.PAPERLESS_DBHOST = parts.host;
      if (parts.port) injected.PAPERLESS_DBPORT = parts.port;
      if (parts.database) injected.PAPERLESS_DBNAME = parts.database;
      if (parts.user) injected.PAPERLESS_DBUSER = parts.user;
      if (parts.password) injected.PAPERLESS_DBPASS = parts.password;
    }
    if (isDirectus) {
      injected.DB_CLIENT = engine === "postgres" ? "pg" : "mysql";
      injected.DB_HOST = parts.host;
      if (parts.port) injected.DB_PORT = parts.port;
      if (parts.database) injected.DB_DATABASE = parts.database;
      if (parts.user) injected.DB_USER = parts.user;
      if (parts.password) injected.DB_PASSWORD = parts.password;
    }

    if (engine === "postgres") {
      if (upperKeys.has("POSTGRES_HOST")) injected.POSTGRES_HOST = parts.host;
      if (upperKeys.has("POSTGRES_PORT") && parts.port) injected.POSTGRES_PORT = parts.port;
      if (upperKeys.has("POSTGRES_USER") && parts.user) injected.POSTGRES_USER = parts.user;
      if (upperKeys.has("POSTGRES_PASSWORD") && parts.password)
        injected.POSTGRES_PASSWORD = parts.password;
      if (upperKeys.has("POSTGRES_DB") && parts.database) injected.POSTGRES_DB = parts.database;
      if (upperKeys.has("PGHOST")) injected.PGHOST = parts.host;
      if (upperKeys.has("PGPORT") && parts.port) injected.PGPORT = parts.port;
      if (upperKeys.has("PGUSER") && parts.user) injected.PGUSER = parts.user;
      if (upperKeys.has("PGPASSWORD") && parts.password) injected.PGPASSWORD = parts.password;
      if (upperKeys.has("PGDATABASE") && parts.database) injected.PGDATABASE = parts.database;
      if (upperKeys.has("DB_POSTGRESDB_HOST")) {
        injected.DB_TYPE = "postgresdb";
        injected.DB_POSTGRESDB_HOST = parts.host;
        if (parts.port) injected.DB_POSTGRESDB_PORT = parts.port;
        if (parts.user) injected.DB_POSTGRESDB_USER = parts.user;
        if (parts.password) injected.DB_POSTGRESDB_PASSWORD = parts.password;
        if (parts.database) injected.DB_POSTGRESDB_DATABASE = parts.database;
      }
    } else {
      const pfx = engine === "mariadb" ? "MARIADB" : "MYSQL";
      if (upperKeys.has(`${pfx}_HOST`)) injected[`${pfx}_HOST`] = parts.host;
      if (upperKeys.has(`${pfx}_PORT`) && parts.port) injected[`${pfx}_PORT`] = parts.port;
      if (upperKeys.has(`${pfx}_USER`) && parts.user) injected[`${pfx}_USER`] = parts.user;
      if (upperKeys.has(`${pfx}_PASSWORD`) && parts.password)
        injected[`${pfx}_PASSWORD`] = parts.password;
      if (upperKeys.has(`${pfx}_DATABASE`) && parts.database)
        injected[`${pfx}_DATABASE`] = parts.database;
    }

    if (upperKeys.has("DB_HOST")) injected.DB_HOST = parts.host;
    if (upperKeys.has("DB_PORT") && parts.port) injected.DB_PORT = parts.port;
    if (upperKeys.has("DB_USER") && parts.user) injected.DB_USER = parts.user;
    if (upperKeys.has("DB_PASSWORD") && parts.password) injected.DB_PASSWORD = parts.password;
    if (upperKeys.has("DB_DATABASE") && parts.database) injected.DB_DATABASE = parts.database;
    if (upperKeys.has("DB_NAME") && parts.database) injected.DB_NAME = parts.database;
  }

  return injected;
}

const FULL_URL_ENV_KEYS = new Set([
  "APP_URL",
  "PUBLIC_URL",
  "WEBHOOK_URL",
  "NEXTAUTH_URL",
  "ROOT_URL",
  "GITEA__SERVER__ROOT_URL",
  "GF_SERVER_ROOT_URL",
  "PAPERLESS_URL",
  "MB_SITE_URL",
  "URL",
  "DOMAIN",
]);

const HOSTNAME_ONLY_ENV_KEYS = new Set([
  "N8N_HOST",
  "GITEA__SERVER__DOMAIN",
  "KC_HOSTNAME",
  "NEXTCLOUD_TRUSTED_DOMAINS",
]);

export function buildMagicDomainHost(projectSlug: string, activeHostFormat?: string): string {
  const clean = sanitizeProjectSlug(projectSlug);
  const fmt = String(activeHostFormat || "").trim();
  if (!fmt) return "";
  if (fmt.includes("app-name")) {
    return fmt.replace(/app-name/g, clean);
  }
  const dotIdx = fmt.indexOf(".");
  if (dotIdx > 0) {
    return `${clean}${fmt.slice(dotIdx)}`;
  }
  return `${clean}.${fmt}`;
}

export function applyDomainToUrlEnvRows(
  rows: EditableEnvRow[],
  domainHost: string,
  previousAutoHost = "",
): EditableEnvRow[] {
  const cleanHost = String(domainHost || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  if (!cleanHost) return rows;
  const fullUrl = `https://${cleanHost}`;
  const prevClean = String(previousAutoHost || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  const prevUrl = prevClean ? `https://${prevClean}` : "";

  return rows.map((row) => {
    const upper = row.key.trim().toUpperCase();
    const cur = row.value.trim();
    if (FULL_URL_ENV_KEYS.has(upper)) {
      if (!cur || (prevUrl && cur === prevUrl)) {
        return { ...row, value: fullUrl };
      }
    } else if (HOSTNAME_ONLY_ENV_KEYS.has(upper)) {
      if (!cur || (prevClean && cur === prevClean)) {
        return { ...row, value: cleanHost };
      }
    }
    return row;
  });
}
