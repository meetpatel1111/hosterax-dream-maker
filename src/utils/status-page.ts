// src/utils/status-page.ts
// Pure utility functions and data models for HosteraX Synthetic Uptime Probes,
// SLA Analytics, Incident Management, and Public/Private Status Page Generator.

export type ServiceStatus =
  "operational" | "degraded_performance" | "partial_outage" | "major_outage" | "under_maintenance";

export type ProbeType = "http" | "tcp" | "ssl" | "docker";

export interface SyntheticProbeConfig {
  id: string;
  name: string;
  target: string; // URL, host:port, or container name
  type: ProbeType;
  intervalSeconds: number; // 10, 30, 60, 300
  timeoutMs: number;
  expectedStatus?: number; // e.g. 200
  enabled: boolean;
}

export interface ProbeResult {
  timestamp: number;
  latencyMs: number;
  success: boolean;
  statusCode?: number;
  sslDaysRemaining?: number;
  errorMessage?: string;
}

export interface MonitoredComponent {
  id: string;
  name: string;
  description: string;
  group: "Edge & Ingress" | "Core Microservices" | "Storage & Databases" | "Third-Party & APIs";
  status: ServiceStatus;
  probe: SyntheticProbeConfig;
  recentResults: ProbeResult[]; // Last 20 probe executions
  uptime90d: number; // e.g. 99.98%
  sslDaysRemaining?: number;
  containerId?: string;
}

export type IncidentSeverity = "minor" | "major" | "critical" | "maintenance";
export type IncidentStage = "investigating" | "identified" | "monitoring" | "resolved";

export interface IncidentUpdate {
  id: string;
  timestamp: number;
  stage: IncidentStage;
  message: string;
}

export interface Incident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  affectedComponentIds: string[];
  stage: IncidentStage;
  createdAt: number;
  resolvedAt?: number;
  updates: IncidentUpdate[];
  postMortem?: string;
}

export interface StatusPageSettings {
  title: string;
  companyName: string;
  headline: string;
  customDomain: string;
  isPublic: boolean;
  announcement?: {
    active: boolean;
    text: string;
    type: "info" | "warning";
  };
  refreshIntervalSeconds: number;
}

/**
 * Computes overall system status based on worst-case component status.
 */
export function calculateOverallSystemStatus(components: MonitoredComponent[]): ServiceStatus {
  if (components.length === 0) return "operational";

  const hasMajor = components.some((c) => c.status === "major_outage");
  if (hasMajor) return "major_outage";

  const hasPartial = components.some((c) => c.status === "partial_outage");
  if (hasPartial) return "partial_outage";

  const hasDegraded = components.some((c) => c.status === "degraded_performance");
  if (hasDegraded) return "degraded_performance";

  const hasMaintenance = components.some((c) => c.status === "under_maintenance");
  if (hasMaintenance) return "under_maintenance";

  return "operational";
}

/**
 * Calculates uptime percentage from an array of probe outcomes.
 * Returns percentage with two decimal places (e.g. 99.95).
 */
export function calculateUptimePercentage(results: ProbeResult[]): number {
  if (results.length === 0) return 100.0;
  const successful = results.filter((r) => r.success).length;
  const pct = (successful / results.length) * 100;
  return Number(pct.toFixed(2));
}

/**
 * Calculates average response latency in milliseconds.
 */
export function calculateAverageLatency(results: ProbeResult[]): number {
  const valid = results.filter((r) => r.success && r.latencyMs > 0);
  if (valid.length === 0) return 0;
  const total = valid.reduce((sum, r) => sum + r.latencyMs, 0);
  return Math.round(total / valid.length);
}

/**
 * Evaluates whether an SSL certificate requires imminent renewal (< 14 days).
 */
export function checkSslRenewalWarning(daysRemaining?: number): {
  warning: boolean;
  severity: "critical" | "warning" | "ok";
  message: string;
} {
  if (daysRemaining === undefined || daysRemaining === null) {
    return { warning: false, severity: "ok", message: "Certificate status normal" };
  }
  if (daysRemaining <= 3) {
    return {
      warning: true,
      severity: "critical",
      message: `CRITICAL: SSL certificate expires in ${daysRemaining} day(s)! Renew immediately.`,
    };
  }
  if (daysRemaining <= 14) {
    return {
      warning: true,
      severity: "warning",
      message: `WARNING: SSL certificate expires in ${daysRemaining} days. Renewal scheduled.`,
    };
  }
  return {
    warning: false,
    severity: "ok",
    message: `SSL certificate valid for ${daysRemaining} days.`,
  };
}

export interface DayUptimeSummary {
  dayOffset: number; // 0 = today, 1 = yesterday, etc.
  dateString: string;
  status: ServiceStatus;
  uptimePercent: number;
}

/**
 * Synthesizes a 90-day uptime timeline history for visualization.
 */
export function generate90DayTimeline(
  overallUptime: number,
  daysCount: number = 90,
): DayUptimeSummary[] {
  const timeline: DayUptimeSummary[] = [];
  const now = Date.now();
  const dayMs = 86400000;

  for (let i = daysCount - 1; i >= 0; i--) {
    const timestamp = now - i * dayMs;
    const date = new Date(timestamp);
    const dateString = date.toISOString().split("T")[0];

    // Seed realistic deterministic status based on day index and overall uptime
    let status: ServiceStatus = "operational";
    let dayUptime = 100;

    if (overallUptime < 99.9) {
      if (i === 12) {
        status = "partial_outage";
        dayUptime = 98.4;
      } else if (i === 34) {
        status = "degraded_performance";
        dayUptime = 99.2;
      } else if (i === 67) {
        status = "under_maintenance";
        dayUptime = 99.6;
      }
    }

    timeline.push({
      dayOffset: i,
      dateString,
      status,
      uptimePercent: dayUptime,
    });
  }

  return timeline;
}

/**
 * Generates an Incident Post-Mortem in structured GitHub Markdown format.
 */
export function generatePostMortemMarkdown(
  incident: Incident,
  components: MonitoredComponent[],
): string {
  const affectedNames = incident.affectedComponentIds
    .map((id) => components.find((c) => c.id === id)?.name || id)
    .join(", ");

  const durationMinutes = incident.resolvedAt
    ? Math.max(1, Math.round((incident.resolvedAt - incident.createdAt) / 60000))
    : "Ongoing";

  let md = `# Incident Post-Mortem: ${incident.title}\n\n`;
  md += `**Severity:** ${incident.severity.toUpperCase()}  \n`;
  md += `**Affected Systems:** ${affectedNames || "All Services"}  \n`;
  md += `**Time to Resolution (TTR):** ${durationMinutes} minute(s)  \n`;
  md += `**Status:** ${incident.stage.toUpperCase()}  \n\n`;

  md += `## 🕒 Timeline of Events\n\n`;
  for (const update of incident.updates) {
    const timeStr = new Date(update.timestamp).toISOString();
    md += `- **[${timeStr}] (${update.stage.toUpperCase()})**: ${update.message}\n`;
  }

  md += `\n## 🔍 Root Cause Analysis (RCA)\n\n`;
  md +=
    incident.postMortem ||
    `During the scheduled health cycle, unexpected latency spikes triggered automated synthetic thresholds. Engineering identified transient socket contention and provisioned fallback connection pooling.\n`;

  md += `\n## 🛡️ Corrective & Preventive Actions\n\n`;
  md += `- [x] Restored normal edge proxy routing and verified upstream socket health.\n`;
  md += `- [ ] Increased synthetic health probe check frequency from 60s to 30s.\n`;
  md += `- [ ] Configured automated self-healing restart triggers on degraded status.\n`;

  return md;
}

/**
 * Generates a Shields.io status badge markdown for inclusion in READMEs.
 */
export function generateStatusBadgeMarkdown(status: ServiceStatus, domain: string): string {
  const colorMap: Record<ServiceStatus, string> = {
    operational: "brightgreen",
    degraded_performance: "yellow",
    partial_outage: "orange",
    major_outage: "red",
    under_maintenance: "blue",
  };

  const labelMap: Record<ServiceStatus, string> = {
    operational: "Operational",
    degraded_performance: "Degraded",
    partial_outage: "Partial_Outage",
    major_outage: "Outage",
    under_maintenance: "Maintenance",
  };

  const color = colorMap[status] || "brightgreen";
  const label = labelMap[status] || "Operational";
  const badgeUrl = `https://img.shields.io/badge/Status-${label}-${color}.svg?style=flat-square`;

  return `[![Service Status](${badgeUrl})](https://${domain}/status)`;
}

/**
 * Default preset components pre-configured with synthetic probes.
 */
export const DEFAULT_MONITORED_COMPONENTS: MonitoredComponent[] = [
  {
    id: "comp-edge",
    name: "Edge Gateway & Reverse Proxy",
    description: "Caddy / OpenResty TLS termination, HTTPS routing and ACME certbot renewals.",
    group: "Edge & Ingress",
    status: "operational",
    probe: {
      id: "prb-edge",
      name: "Edge HTTP Healthcheck",
      target: "http://127.0.0.1:80/health",
      type: "http",
      intervalSeconds: 15,
      timeoutMs: 2000,
      expectedStatus: 200,
      enabled: true,
    },
    uptime90d: 99.99,
    sslDaysRemaining: 74,
    containerId: "hx_edge",
    recentResults: [
      { timestamp: Date.now() - 60000, latencyMs: 4, success: true, statusCode: 200 },
      { timestamp: Date.now() - 45000, latencyMs: 6, success: true, statusCode: 200 },
      { timestamp: Date.now() - 30000, latencyMs: 5, success: true, statusCode: 200 },
      { timestamp: Date.now() - 15000, latencyMs: 4, success: true, statusCode: 200 },
      { timestamp: Date.now(), latencyMs: 5, success: true, statusCode: 200 },
    ],
  },
  {
    id: "comp-postgres",
    name: "Primary PostgreSQL Cluster",
    description: "Relational database storage, ACID transaction logs and read replicas.",
    group: "Storage & Databases",
    status: "operational",
    probe: {
      id: "prb-pg",
      name: "PostgreSQL TCP Ping",
      target: "127.0.0.1:5432",
      type: "tcp",
      intervalSeconds: 30,
      timeoutMs: 3000,
      enabled: true,
    },
    uptime90d: 99.98,
    containerId: "hx_postgres_cluster",
    recentResults: [
      { timestamp: Date.now() - 60000, latencyMs: 2, success: true },
      { timestamp: Date.now() - 45000, latencyMs: 2, success: true },
      { timestamp: Date.now() - 30000, latencyMs: 3, success: true },
      { timestamp: Date.now() - 15000, latencyMs: 2, success: true },
      { timestamp: Date.now(), latencyMs: 2, success: true },
    ],
  },
  {
    id: "comp-redis",
    name: "Redis Cache & Session Store",
    description: "In-memory key-value caching, rate limiting counters and pub/sub message queues.",
    group: "Storage & Databases",
    status: "operational",
    probe: {
      id: "prb-redis",
      name: "Redis Socket Probe",
      target: "127.0.0.1:6379",
      type: "tcp",
      intervalSeconds: 30,
      timeoutMs: 1500,
      enabled: true,
    },
    uptime90d: 100.0,
    containerId: "hx_redis_cache",
    recentResults: [
      { timestamp: Date.now() - 60000, latencyMs: 1, success: true },
      { timestamp: Date.now() - 45000, latencyMs: 1, success: true },
      { timestamp: Date.now() - 30000, latencyMs: 1, success: true },
      { timestamp: Date.now() - 15000, latencyMs: 1, success: true },
      { timestamp: Date.now(), latencyMs: 1, success: true },
    ],
  },
  {
    id: "comp-engine",
    name: "HosteraX Control Plane Daemon",
    description: "Core API engine, Docker socket daemon supervisor and task scheduler.",
    group: "Core Microservices",
    status: "operational",
    probe: {
      id: "prb-engine",
      name: "Control Plane Healthcheck",
      target: "http://127.0.0.1:7777/health",
      type: "http",
      intervalSeconds: 15,
      timeoutMs: 2000,
      expectedStatus: 200,
      enabled: true,
    },
    uptime90d: 99.95,
    recentResults: [
      { timestamp: Date.now() - 60000, latencyMs: 8, success: true, statusCode: 200 },
      { timestamp: Date.now() - 45000, latencyMs: 12, success: true, statusCode: 200 },
      { timestamp: Date.now() - 30000, latencyMs: 9, success: true, statusCode: 200 },
      { timestamp: Date.now() - 15000, latencyMs: 11, success: true, statusCode: 200 },
      { timestamp: Date.now(), latencyMs: 10, success: true, statusCode: 200 },
    ],
  },
  {
    id: "comp-s3",
    name: "Object Storage & S3 Vault",
    description: "MinIO S3-compatible bucket storage for database snapshots and media assets.",
    group: "Storage & Databases",
    status: "operational",
    probe: {
      id: "prb-s3",
      name: "S3 Storage Ping",
      target: "http://127.0.0.1:9000/minio/health/live",
      type: "http",
      intervalSeconds: 60,
      timeoutMs: 3000,
      expectedStatus: 200,
      enabled: true,
    },
    uptime90d: 99.97,
    recentResults: [
      { timestamp: Date.now() - 60000, latencyMs: 14, success: true, statusCode: 200 },
      { timestamp: Date.now() - 45000, latencyMs: 15, success: true, statusCode: 200 },
      { timestamp: Date.now() - 30000, latencyMs: 12, success: true, statusCode: 200 },
      { timestamp: Date.now() - 15000, latencyMs: 18, success: true, statusCode: 200 },
      { timestamp: Date.now(), latencyMs: 14, success: true, statusCode: 200 },
    ],
  },
];
