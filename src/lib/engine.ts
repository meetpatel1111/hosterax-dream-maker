import { useSyncExternalStore, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
export * from "./schema";

type EngineState = { url: string; token: string };

const DEFAULT_URL = "http://localhost:7777";

function read(): EngineState {
  if (typeof window === "undefined") return { url: DEFAULT_URL, token: "" };
  return {
    url: localStorage.getItem("hx.url") || DEFAULT_URL,
    token: localStorage.getItem("hx.token") || "",
  };
}

let state: EngineState = read();
const listeners = new Set<() => void>();

// Auto-discover local engine bootstrap token if not set
if (typeof window !== "undefined") {
  if (!state.token && state.url.includes("localhost")) {
    fetch(state.url + "/api/token")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.token) {
          setEngineConfig(state.url, d.token);
        }
      })
      .catch(() => {});
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return state;
}

const SERVER_SNAPSHOT: EngineState = { url: DEFAULT_URL, token: "" };
function getServerSnapshot() {
  return SERVER_SNAPSHOT;
}

export function setEngineConfig(url: string, token: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem("hx.url", url);
    localStorage.setItem("hx.token", token);
  }
  state = { url, token };
  emit();
}

export function useEngine() {
  const { url, token } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const call = useCallback(
    async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const r = await fetch(url + path, {
        method,
        headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) {
        let err: any;
        try {
          err = await r.json();
        } catch {
          err = await r.text();
        }
        throw new Error(
          err?.error || (typeof err === "string" ? err : "") || `Engine error ${r.status}`,
        );
      }
      if (r.status === 204) return undefined as T;
      return r.json();
    },
    [url, token],
  );

  return { url, token, save: setEngineConfig, call };
}

export function useEngineHealth() {
  const eng = useEngine();
  return useQuery({
    queryKey: ["engine-health", eng.url],
    queryFn: async () => {
      try {
        const r = await fetch(eng.url + "/health");
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    },
    refetchInterval: 5000,
    retry: false,
  });
}

export function useEngineProjects() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery({
    queryKey: ["engine-projects", eng.url, eng.token],
    queryFn: async () => (await eng.call<any[]>("GET", "/api/projects").catch(() => [])) ?? [],
    enabled: !!health.data?.ok,
    refetchInterval: 3000,
  });
}

export function useEngineSystem() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery({
    queryKey: ["engine-system", eng.url, eng.token],
    queryFn: async () => await eng.call<any>("GET", "/api/system").catch(() => null),
    enabled: !!health.data?.ok,
    refetchInterval: 4000,
  });
}

export function useProjectMetrics(projectName: string) {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery({
    queryKey: ["project-metrics", projectName, eng.url, eng.token],
    queryFn: async () =>
      projectName
        ? await eng.call<any>("GET", `/api/projects/${projectName}/metrics`).catch(() => null)
        : null,
    enabled: !!health.data?.ok && !!projectName,
    refetchInterval: 3000,
  });
}

export type MagicDnsProviderInfo = {
  id: string;
  label: string;
  badge: string;
  description: string;
  status: "active" | "defunct";
  example: string;
  suffix: string;
  isActive: boolean;
};

export type MagicDnsSettingsResponse = {
  activeProvider: string;
  activeHostFormat: string;
  providers: MagicDnsProviderInfo[];
};

export const FALLBACK_MAGIC_DNS_PROVIDERS: MagicDnsProviderInfo[] = [
  {
    id: "sslip.io",
    label: "sslip.io",
    badge: "Recommended",
    description: "Modern & robust wildcard DNS. Supports IPv4, IPv6, and hexadecimal addresses.",
    status: "active",
    example: "my-app.127-0-0-1.sslip.io",
    suffix: "sslip.io",
    isActive: true,
  },
  {
    id: "nip.io",
    label: "nip.io",
    badge: "Popular",
    description: "Classic zero-config wildcard DNS (127.0.0.1.nip.io) for local development.",
    status: "active",
    example: "my-app.127.0.0.1.nip.io",
    suffix: "nip.io",
    isActive: false,
  },
  {
    id: "traefik.me",
    label: "traefik.me",
    badge: "Zero-Config",
    description: "Clean domain format mapping subdomains directly to 127.0.0.1.",
    status: "active",
    example: "my-app.traefik.me",
    suffix: "traefik.me",
    isActive: false,
  },
  {
    id: "ipq.co",
    label: "ipq.co",
    badge: "Alternative",
    description: "Configurable wildcard DNS mapping service pointing to your local machine.",
    status: "active",
    example: "my-app.127.0.0.1.ipq.co",
    suffix: "ipq.co",
    isActive: false,
  },
  {
    id: "fdns.uk",
    label: "fdns.uk",
    badge: "Fast",
    description: "Magic wildcard domain resolving to any target IP address.",
    status: "active",
    example: "my-app.127.0.0.1.fdns.uk",
    suffix: "fdns.uk",
    isActive: false,
  },
  {
    id: "localhost",
    label: ".localhost",
    badge: "Offline / Native",
    description: "RFC 6761 browser-native loopback domain without external DNS dependency.",
    status: "active",
    example: "my-app.localhost",
    suffix: "localhost",
    isActive: false,
  },
];

export function useMagicDnsSettings() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<MagicDnsSettingsResponse>({
    queryKey: ["magic-dns-settings", eng.url, eng.token],
    queryFn: async () => {
      try {
        const res = await eng.call<MagicDnsSettingsResponse>("GET", "/api/settings/magic-dns");
        if (res && res.providers) return res;
      } catch {}
      return {
        activeProvider: "sslip.io",
        activeHostFormat: "app-name.127-0-0-1.sslip.io",
        providers: FALLBACK_MAGIC_DNS_PROVIDERS,
      };
    },
    enabled: !!health.data?.ok,
    refetchInterval: 8000,
  });
}

export function formatMagicDnsUrl(
  projectName: string,
  providerId: string = "sslip.io",
  port?: number,
  includePort: boolean = false,
) {
  const p = projectName.toLowerCase();
  let host = `${p}.127-0-0-1.sslip.io`;
  if (providerId === "nip.io") host = `${p}.127.0.0.1.nip.io`;
  else if (providerId === "traefik.me") host = `${p}.traefik.me`;
  else if (providerId === "ipq.co") host = `${p}.127.0.0.1.ipq.co`;
  else if (providerId === "fdns.uk") host = `${p}.127.0.0.1.fdns.uk`;
  else if (providerId === "localhost") host = `${p}.localhost`;
  else if (providerId === "sslip.io") host = `${p}.127-0-0-1.sslip.io`;

  if (includePort && port && port !== 80 && port !== 443) {
    return `${host}:${port}`;
  }
  return host;
}

export type BackupTarget = {
  id: string;
  name: string;
  containerName: string;
  dbType: string;
  image?: string;
  label: string;
  ports?: string;
  isContainer: boolean;
  projectName?: string;
};

export type BackupItem = {
  id: string;
  project_name?: string;
  database_name: string;
  db_type: string;
  file_path: string;
  file_size_bytes: number;
  sizeMb: number;
  sha256: string;
  destination: string;
  status: string;
  created_at: number;
  finished_at?: number;
  error_message?: string;
  existsOnDisk?: boolean;
};

export function useBackupTargets() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<BackupTarget[]>({
    queryKey: ["backup-targets", eng.url, eng.token],
    queryFn: async () => {
      try {
        return await eng.call<BackupTarget[]>("GET", "/api/backups/targets");
      } catch {
        return [];
      }
    },
    enabled: !!health.data?.ok,
  });
}

export function useBackups(database?: string, project?: string) {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<BackupItem[]>({
    queryKey: ["backups", eng.url, eng.token, database, project],
    queryFn: async () => {
      try {
        let path = "/api/backups";
        const params = new URLSearchParams();
        if (database) params.set("database", database);
        if (project) params.set("project", project);
        if (params.toString()) path += `?${params.toString()}`;
        return await eng.call<BackupItem[]>("GET", path);
      } catch {
        return [];
      }
    },
    enabled: !!health.data?.ok,
    refetchInterval: 5000,
  });
}

// ────────── S3 / Cloudflare R2 Remote Storage ──────────
export type S3StorageConfig = {
  configured: boolean;
  name: string;
  provider_type: string;
  endpoint: string;
  region: string;
  bucket: string;
  access_key_id: string;
  secret_access_key?: string;
  prefix: string;
  auto_sync: number;
  updated_at?: number;
};

export type RemoteS3BackupItem = {
  key: string;
  filename: string;
  sizeBytes: number;
  lastModified: number;
  etag: string;
};

export function useS3Config() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<S3StorageConfig>({
    queryKey: ["s3-config", eng.url, eng.token],
    queryFn: async () => {
      try {
        return await eng.call<S3StorageConfig>("GET", "/api/backups/s3-config");
      } catch {
        return {
          configured: false,
          name: "Remote S3 Storage",
          provider_type: "s3",
          endpoint: "",
          region: "us-east-1",
          bucket: "",
          access_key_id: "",
          prefix: "hosterax-backups",
          auto_sync: 0,
        };
      }
    },
    enabled: !!health.data?.ok,
  });
}

export function useRemoteS3Backups() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<RemoteS3BackupItem[]>({
    queryKey: ["remote-s3-backups", eng.url, eng.token],
    queryFn: async () => {
      try {
        return await eng.call<RemoteS3BackupItem[]>("GET", "/api/backups/remote-s3");
      } catch {
        return [];
      }
    },
    enabled: !!health.data?.ok,
    refetchInterval: 10000,
  });
}

// ────────── Scheduled Cron Jobs Subsystem ──────────
export type CronJob = {
  id: string;
  name: string;
  project_name?: string | null;
  schedule_type: string;
  cron_expression: string;
  job_type: "command" | "http" | "backup";
  command?: string;
  http_url?: string;
  http_method?: string;
  http_headers_json?: string;
  target_container?: string;
  timeout_seconds: number;
  max_retries: number;
  enabled: number;
  next_run_at?: number | null;
  last_run_at?: number | null;
  last_status?: "success" | "failed" | "running" | null;
  last_duration_ms?: number | null;
  created_at: number;
  updated_at: number;
};

export type JobRun = {
  id: string;
  job_id: string;
  job_name: string;
  project_name?: string | null;
  trigger_type: "scheduled" | "manual" | "webhook" | "mcp_ai";
  status: "running" | "success" | "failed";
  started_at: number;
  finished_at?: number | null;
  duration_ms?: number | null;
  exit_code?: number | null;
  stdout?: string | null;
  stderr?: string | null;
  error_message?: string | null;
};

export function useCronJobs() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<CronJob[]>({
    queryKey: ["cron-jobs", eng.url, eng.token],
    queryFn: async () => {
      try {
        return await eng.call<CronJob[]>("GET", "/api/jobs");
      } catch {
        return [];
      }
    },
    enabled: !!health.data?.ok,
    refetchInterval: 4000,
  });
}

export function useJobRuns(jobId?: string) {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<JobRun[]>({
    queryKey: ["job-runs", eng.url, eng.token, jobId],
    queryFn: async () => {
      try {
        const path = jobId ? `/api/jobs/${jobId}/runs` : "/api/jobs-runs";
        return await eng.call<JobRun[]>("GET", path);
      } catch {
        return [];
      }
    },
    enabled: !!health.data?.ok,
    refetchInterval: 3000,
  });
}

// ────────── Model Context Protocol (MCP) Server ──────────
export type MCPServerInfo = {
  mcp: string;
  server: string;
  version: string;
  endpoint: string;
  transport: string;
  capabilities: { tools: boolean; resources: boolean; prompts: boolean };
  toolsCount: number;
};

export function useMCPInfo() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<MCPServerInfo>({
    queryKey: ["mcp-info", eng.url, eng.token],
    queryFn: async () => {
      try {
        return await eng.call<MCPServerInfo>("GET", "/api/mcp");
      } catch {
        return {
          mcp: "2024-11-05",
          server: "HosteraX Autonomous Engine",
          version: "0.2.0",
          endpoint: "/api/mcp",
          transport: "JSON-RPC 2.0 (HTTP POST)",
          capabilities: { tools: true, resources: true, prompts: true },
          toolsCount: 11,
        };
      }
    },
    enabled: !!health.data?.ok,
  });
}

// ────────── Multi-Node Compute Infrastructure (Servers) ──────────
export type ServerNode = {
  id: string;
  name: string;
  type: "local" | "remote";
  host?: string;
  port: number;
  username: string;
  auth_type: string;
  status: "online" | "offline" | "provisioning" | "unreachable";
  docker_version?: string;
  os_info?: string;
  cpu_cores: number;
  total_ram_mb: number;
  cpu_usage_pct: number;
  ram_usage_pct: number;
  disk_usage_pct: number;
  containers_count: number;
  is_default: number;
  last_ping_at?: number;
  created_at: number;
  updated_at: number;
};

export function useServerNodes() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<ServerNode[]>({
    queryKey: ["server-nodes", eng.url, eng.token],
    queryFn: async () => {
      try {
        return await eng.call<ServerNode[]>("GET", "/api/servers");
      } catch {
        return [];
      }
    },
    enabled: !!health.data?.ok,
    refetchInterval: 5000,
  });
}

// ────────── GitHub Webhooks & Ephemeral PR Previews ──────────
export type PRPreview = {
  id: string;
  project_name: string;
  pr_number: number;
  pr_title: string;
  branch: string;
  commit_sha: string;
  subdomain: string;
  preview_url: string;
  container_name?: string;
  port: number;
  status: "live" | "deploying" | "failed" | "stopped";
  created_at: number;
  updated_at: number;
};

export type WebhookConfig = {
  project_name: string;
  secret: string;
  webhook_token: string;
  auto_deploy_push: number;
  auto_deploy_pr: number;
  tracked_branch: string;
  created_at: number;
  updated_at: number;
};

export function usePRPreviews(projectName?: string) {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<PRPreview[]>({
    queryKey: ["pr-previews", eng.url, eng.token, projectName],
    queryFn: async () => {
      try {
        const path = projectName ? `/api/projects/${projectName}/previews` : "/api/previews";
        return await eng.call<PRPreview[]>("GET", path);
      } catch {
        return [];
      }
    },
    enabled: !!health.data?.ok,
    refetchInterval: 5000,
  });
}

export function useProjectWebhookConfig(projectName?: string) {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<WebhookConfig>({
    queryKey: ["project-webhook-config", eng.url, eng.token, projectName],
    queryFn: async () => {
      if (!projectName) return null as any;
      try {
        return await eng.call<WebhookConfig>("GET", `/api/projects/${projectName}/webhook-config`);
      } catch {
        return null as any;
      }
    },
    enabled: !!health.data?.ok && !!projectName,
  });
}

// ────────── Multi-Tenant Organizations & RBAC ──────────
export type OrganizationMember = {
  id: string;
  org_id: string;
  user_email: string;
  user_name: string;
  role: "owner" | "admin" | "member" | "viewer";
  joined_at: number;
};

export type OrganizationInvite = {
  id: string;
  org_id: string;
  email: string;
  role: string;
  token: string;
  status: "pending" | "accepted" | "revoked";
  expires_at: number;
  created_at: number;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  avatar_url?: string | null;
  plan: string;
  is_default: number;
  member_count?: number;
  members?: OrganizationMember[];
  invites?: OrganizationInvite[];
  created_at: number;
  updated_at: number;
};

export function useOrganizations() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<Organization[]>({
    queryKey: ["organizations", eng.url, eng.token],
    queryFn: async () => {
      try {
        return await eng.call<Organization[]>("GET", "/api/orgs");
      } catch {
        return [];
      }
    },
    enabled: !!health.data?.ok,
    refetchInterval: 6000,
  });
}

export function useOrganization(idOrSlug?: string) {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<Organization>({
    queryKey: ["organization", eng.url, eng.token, idOrSlug],
    queryFn: async () => {
      if (!idOrSlug) return null as any;
      try {
        return await eng.call<Organization>("GET", `/api/orgs/${idOrSlug}`);
      } catch {
        return null as any;
      }
    },
    enabled: !!health.data?.ok && !!idOrSlug,
  });
}

// ────────── Self-Hosted Email Stack & Webmail ──────────
export type DnsRecord = {
  type: string;
  host: string;
  value: string;
  priority?: number;
  purpose: string;
  status: string;
};

export type EmailDomain = {
  id: string;
  domain: string;
  spf_status: string;
  dkim_status: string;
  dmarc_status: string;
  mx_status: string;
  dkim_selector: string;
  dkim_public_key: string;
  mailbox_count?: number;
  alias_count?: number;
  dns_records?: DnsRecord[];
  mailboxes?: Mailbox[];
  aliases?: EmailAlias[];
  created_at: number;
};

export type Mailbox = {
  id: string;
  domain_id: string;
  email: string;
  name: string;
  quota_mb: number;
  used_mb: number;
  created_at: number;
};

export type EmailMessage = {
  id: string;
  mailbox_id: string;
  from_address: string;
  to_address: string;
  subject: string;
  body_text?: string;
  body_html?: string;
  folder: "inbox" | "sent" | "trash" | "drafts";
  is_read: number;
  is_starred: number;
  created_at: number;
};

export function useEmailDomains() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<EmailDomain[]>({
    queryKey: ["email-domains", eng.url, eng.token],
    queryFn: async () => {
      try {
        return await eng.call<EmailDomain[]>("GET", "/api/email/domains");
      } catch {
        return [];
      }
    },
    enabled: !!health.data?.ok,
    refetchInterval: 6000,
  });
}

export function useMailboxes(domainId?: string) {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<Mailbox[]>({
    queryKey: ["mailboxes", eng.url, eng.token, domainId],
    queryFn: async () => {
      try {
        const path = domainId ? `/api/email/mailboxes?domain_id=${domainId}` : "/api/email/mailboxes";
        return await eng.call<Mailbox[]>("GET", path);
      } catch {
        return [];
      }
    },
    enabled: !!health.data?.ok,
  });
}

export function useEmailMessages(mailboxId?: string, folder = "inbox") {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<EmailMessage[]>({
    queryKey: ["email-messages", eng.url, eng.token, mailboxId, folder],
    queryFn: async () => {
      if (!mailboxId) return [];
      try {
        return await eng.call<EmailMessage[]>("GET", `/api/email/mailboxes/${mailboxId}/messages?folder=${folder}`);
      } catch {
        return [];
      }
    },
    enabled: !!health.data?.ok && !!mailboxId,
    refetchInterval: 4000,
  });
}

export type EmailAlias = {
  id: string;
  domain_id: string;
  source_email: string;
  destination_type: "email" | "webhook";
  destination_target: string;
  is_active: number;
  created_at: number;
};

export type EmailSmtpRelay = {
  id: string;
  name: string;
  provider: "direct" | "resend" | "postmark" | "ses" | "sendgrid" | "custom";
  host: string;
  port: number;
  username?: string;
  password?: string;
  from_email?: string;
  is_default: number;
  created_at: number;
};

export function useEmailAliases(domainId?: string) {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<EmailAlias[]>({
    queryKey: ["email-aliases", eng.url, eng.token, domainId],
    queryFn: async () => {
      try {
        const path = domainId ? `/api/email/aliases?domain_id=${domainId}` : "/api/email/aliases";
        return await eng.call<EmailAlias[]>("GET", path);
      } catch {
        return [];
      }
    },
    enabled: !!health.data?.ok,
    refetchInterval: 6000,
  });
}

export function useEmailSmtpRelays() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<EmailSmtpRelay[]>({
    queryKey: ["email-smtp-relays", eng.url, eng.token],
    queryFn: async () => {
      try {
        return await eng.call<EmailSmtpRelay[]>("GET", "/api/email/smtp-relays");
      } catch {
        return [];
      }
    },
    enabled: !!health.data?.ok,
    refetchInterval: 6000,
  });
}

export type ProjectDiagnostics = {
  project: string;
  container: string;
  fault_type: string;
  severity: "low" | "medium" | "high" | "critical";
  root_cause: string;
  suggested_action: string;
  suggested_command: string;
  analyzed_lines: number;
  timestamp: number;
};

export function useProjectDiagnostics(projectName?: string) {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<ProjectDiagnostics>({
    queryKey: ["project-diagnostics", eng.url, eng.token, projectName],
    queryFn: async () => {
      if (!projectName) return null as any;
      try {
        return await eng.call<ProjectDiagnostics>("GET", `/api/projects/${projectName}/diagnostics`);
      } catch {
        return null as any;
      }
    },
    enabled: !!health.data?.ok && !!projectName,
    refetchInterval: 10000,
  });
}

