/**
 * HosteraX Control Plane — Complete Database & API Schema Definitions
 * 
 * Defines TypeScript interfaces for all 19 SQLite relational tables
 * and strongly-typed request/response payloads for every HosteraX Engine REST API.
 */

// ============================================================================
// 1. SQLite Database Entity Models (Relational Tables in hosterax.db)
// ============================================================================

/** SQLite Table: `projects` */
export interface DbProject {
  id: string;
  name: string;
  slug: string;
  source: string;
  build_cmd: string | null;
  start_cmd: string | null;
  port: number;
  target: "docker" | "process" | "ssh";
  stack: string;
  branch: string;
  version: string;
  env_json: string; // JSON string
  status: "idle" | "building" | "running" | "ready" | "failed" | "stopped";
  created_at: number;
  updated_at: number;
}

/** SQLite Table: `deployments` */
export interface DbDeployment {
  id: string;
  project: string;
  version: string;
  commit_sha: string;
  commit_message: string | null;
  branch: string;
  phase: "queued" | "building" | "deploying" | "ready" | "failed";
  trigger: "git" | "manual" | "webhook" | "rollback" | "cli" | "template" | "upload" | "url" | "one-click";
  environment: "production" | "preview" | "development";
  workdir: string | null;
  log_path: string | null;
  started_at: number;
  finished_at: number | null;
}

/** SQLite Table: `domains` */
export interface DbDomain {
  id: string;
  project: string;
  hostname: string;
  verified: number; // 0 or 1
  is_primary: number; // 0 or 1
  ssl_status: "none" | "provisioning" | "active" | "expired" | "error";
  ssl_expires: string | null; // ISO date string
  challenge_token: string;
  created_at: number;
}

/** SQLite Table: `managed_dbs` */
export interface DbManagedDatabase {
  id: string;
  project: string;
  name: string;
  engine: "postgres" | "mysql" | "mongodb" | "redis" | "sqlite";
  port: number;
  status: "provisioning" | "running" | "stopped" | "error";
  size_mb: number;
  container_id: string | null;
  connection_string: string | null;
  created_at: number;
}

/** SQLite Table: `backups` */
export interface DbBackup {
  id: string;
  database_id: string;
  project: string;
  filename: string;
  size_bytes: number;
  status: "pending" | "completed" | "failed";
  created_at: number;
}

/** SQLite Table: `backup_schedules` */
export interface DbBackupSchedule {
  id: string;
  database_id: string;
  project: string;
  cron_expression: string;
  retention_days: number;
  is_active: number;
  last_run_at: number | null;
  created_at: number;
}

/** SQLite Table: `tokens` */
export interface DbToken {
  token: string;
  name: string;
  created_at: number;
}

/** SQLite Table: `settings` */
export interface DbSetting {
  key: string;
  value: string;
  updated_at: number;
}

/** SQLite Table: `routes` */
export interface DbRoute {
  id: string;
  project: string;
  hostname: string;
  path_prefix: string;
  upstream_port: number;
  ssl_enabled: number;
  strip_prefix: number;
  created_at: number;
}

/** SQLite Table: `route_rules` */
export interface DbRouteRule {
  id: string;
  route_id: string;
  match_type: "header" | "path" | "query" | "cookie";
  match_pattern: string;
  action: "forward" | "redirect" | "rewrite" | "block";
  action_target: string | null;
  priority: number;
  created_at: number;
}

/** SQLite Table: `services` */
export interface DbService {
  id: string;
  project: string;
  name: string;
  image: string | null;
  command: string | null;
  port: number;
  replicas: number;
  status: "running" | "stopped" | "restarting" | "failed";
  created_at: number;
}

/** SQLite Table: `installed_apps` */
export interface DbInstalledApp {
  id: string;
  app_id: string;
  name: string;
  category: string;
  version: string;
  port: number;
  status: "installing" | "running" | "stopped" | "failed";
  installed_at: number;
}

/** SQLite Table: `webhooks` */
export interface DbWebhook {
  id: string;
  project: string;
  branch: string;
  secret: string;
  created_at: number;
}

/** SQLite Table: `project_env` */
export interface DbProjectEnv {
  id: string;
  project_id: string;
  key: string;
  value: string;
  is_secret: number;
  created_at: number;
}

/** SQLite Table: `project_environments` */
export interface DbProjectEnvironment {
  id: string;
  project_id: string;
  name: "production" | "preview" | "development";
  branch: string;
  subdomain: string;
  created_at: number;
}

/** SQLite Table: `upload_sessions` */
export interface DbUploadSession {
  id: string;
  project: string;
  bytes_received: number;
  total_bytes: number;
  status: "uploading" | "completed" | "failed";
  created_at: number;
}

/** SQLite Table: `server_logs` */
export interface DbServerLog {
  id: string;
  project: string;
  deployment_id: string | null;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  timestamp: number;
}

/** SQLite Table: `self_heal_events` */
export interface DbSelfHealEvent {
  id: string;
  project: string;
  action: "restart_container" | "switch_blue_green" | "rollback_deployment" | "circuit_breaker_opened" | "circuit_breaker_reset" | "heal_completed";
  reason: string;
  attempt: number;
  created_at: number;
}

/** SQLite Table: `health_configs` */
export interface DbHealthConfig {
  project: string;
  endpoint: string;
  expected_status: number;
  interval_ms: number;
  timeout_ms: number;
  max_failures: number;
  created_at: number;
}

// ============================================================================
// 2. Engine API Request & Response Payload Schemas
// ============================================================================

// ── Auth & Tokens ──
export interface AuthLoginRequest {
  email?: string;
  password?: string;
  token?: string;
}

export interface AuthLoginResponse {
  ok: boolean;
  user: {
    id: string;
    email: string;
    role: string;
  };
  token: string;
}

export interface TokenCreateRequest {
  name: string;
  scopes?: Array<"read" | "deploy" | "admin">;
}

export interface TokenItem {
  token: string;
  name: string;
  created_at: number;
}

// ── Projects API ──
export interface ProjectCreateRequest {
  name: string;
  source?: string;
  buildCmd?: string;
  startCmd?: string;
  target?: "docker" | "process" | "ssh";
  port?: number;
  stack?: string;
  branch?: string;
  env?: Record<string, string>;
}

export interface ProjectPatchRequest {
  name?: string;
  branch?: string;
  build_command?: string;
  start_command?: string;
  port?: number;
  target?: string;
}

// ── Deployments API ──
export interface DeploymentTriggerRequest {
  trigger?: "git" | "manual" | "webhook" | "rollback" | "cli" | "template" | "upload" | "url" | "one-click";
  environment?: "production" | "preview" | "development";
}

export interface DeploymentTriggerResponse {
  id: string;
  project: string;
  version: string;
  phase: string;
  started_at: number;
}

export interface RollbackRequest {
  deploymentId?: string;
}

// ── Domains & SSL API ──
export interface DomainCreateRequest {
  hostname: string;
}

export interface DomainVerifyResponse {
  verified: boolean;
  message?: string;
}

export interface DomainSslResponse {
  ssl_status: "provisioning" | "active" | "error";
  message: string;
}

// ── Environment Variables API ──
export interface EnvSetRequest {
  key?: string;
  value?: string;
  env?: Record<string, string>;
}

export type EnvGetResponse = Record<string, string>;

// ── Databases API ──
export interface DatabaseCreateRequest {
  name: string;
  engine: "postgres" | "mysql" | "mongodb" | "redis" | "sqlite";
  size_mb?: number;
}

// ── Magic DNS Settings API ──
export interface MagicDnsProviderInfo {
  id: string;
  label: string;
  badge: string;
  description: string;
  status: string;
  example: string;
  suffix: string;
  isActive: boolean;
}

export interface MagicDnsSettingsResponse {
  activeProvider: string;
  activeHostFormat: string;
  providers: MagicDnsProviderInfo[];
}

export interface MagicDnsUpdateRequest {
  provider: "sslip.io" | "nip.io" | "traefik.me" | "ipq.co" | "fdns.uk" | "localhost";
}

// ── Docker Hub Explorer API ──
export interface DockerHubTag {
  name: string;
  tag_status: string;
  last_updated: string;
  full_size?: number;
  images?: Array<{
    architecture: string;
    os: string;
    digest: string;
    size: number;
  }>;
  vulnerability_count?: {
    critical?: number;
    high?: number;
    medium?: number;
    low?: number;
  };
}

export interface DockerHubTagsResponse {
  image: string;
  official: boolean;
  total_tags: number;
  results: DockerHubTag[];
  dhi_recommendation?: {
    recommended_tag: string;
    reason: string;
    cve_reduction_pct: number;
  };
}

// ── Self-Healing & Resilience API ──
export interface ChaosDrillRequest {
  project: string;
  scenario: "crash" | "high_latency" | "memory_leak" | "corrupt_state" | "network_partition";
}

export interface ChaosDrillResponse {
  ok: boolean;
  message: string;
  drillId: string;
  expectedRemediation: string;
}

export interface ProjectMetricsResponse {
  cpu_percent: number;
  memory_usage_mb: number;
  memory_percent: number;
  restart_count: number;
  circuit_breaker: "CLOSED" | "HALF_OPEN" | "OPEN";
  status: "healthy" | "unhealthy" | "recovering";
  probe_latency_ms: number;
}

// ── System Stats API ──
export interface SystemStatsResponse {
  projects: number;
  deployments: {
    total: number;
    success_rate: string;
  };
  databases: number;
  domains: number;
  system: {
    cpu_cores: number;
    ram_gb: number;
    os: string;
    node_version: string;
    uptime_seconds: number;
  };
}
