import { type LogEntry } from "./app-logger";

export type SiemSinkType = "syslog_rfc5424" | "datadog" | "splunk_hec" | "grafana_loki";

export interface SiemSinkConfig {
  id: string;
  name: string;
  type: SiemSinkType;
  enabled: boolean;
  endpoint: string;
  apiKey?: string;
  facility?: number; // Syslog facility 1-23 (16 = local0)
  minLevel: "debug" | "info" | "warn" | "error";
  tags?: Record<string, string>;
  createdAt: string;
  lastDeliveredAt?: string | null;
  deliveryCount: number;
  failureCount: number;
}

export interface DeliveryResult {
  sinkId: string;
  success: boolean;
  statusCode?: number;
  message: string;
  payloadPreview: string;
  timestamp: string;
}

/**
 * Calculates RFC 5424 PRI value from facility and severity
 * PRI = (facility * 8) + severity
 */
export function calculateSyslogPri(facility = 16, level: string): number {
  let severity = 6; // Informational default
  switch (level.toLowerCase()) {
    case "emergency":
    case "fatal":
      severity = 0;
      break;
    case "alert":
      severity = 1;
      break;
    case "critical":
      severity = 2;
      break;
    case "error":
      severity = 3;
      break;
    case "warn":
    case "warning":
      severity = 4;
      break;
    case "notice":
      severity = 5;
      break;
    case "info":
      severity = 6;
      break;
    case "debug":
      severity = 7;
      break;
  }
  return facility * 8 + severity;
}

/**
 * Formats a log entry into RFC 5424 Syslog Protocol message format
 * <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROC-ID MSGID [STRUCTURED-DATA] MSG
 */
export function formatRfc5424Syslog(
  entry: LogEntry,
  options?: {
    hostname?: string;
    appName?: string;
    facility?: number;
  },
): string {
  const pri = calculateSyslogPri(options?.facility ?? 16, entry.level);
  const version = "1";
  const timestamp = new Date(entry.timestamp).toISOString();
  const hostname = options?.hostname || "control-plane.hosterax.internal";
  const appName = options?.appName || "hosterax-engine";
  const procId = "1";
  const msgId = entry.action.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "-";

  // Structured Data (RFC 5424 [SD-ID param="value"])
  const categoryParam = `category="${entry.category}"`;
  const levelParam = `level="${entry.level}"`;
  const structuredData = `[hosterax@54321 ${categoryParam} ${levelParam}]`;

  const msg = `${entry.message}${entry.durationMs != null ? ` (latency: ${entry.durationMs}ms)` : ""}`;

  return `<${pri}>${version} ${timestamp} ${hostname} ${appName} ${procId} ${msgId} ${structuredData} ${msg}`;
}

/**
 * Formats a log entry into Datadog Logs V2 intake JSON format
 */
export function formatDatadogLog(
  entry: LogEntry,
  tags?: Record<string, string>,
): Record<string, any> {
  const formattedTags = Object.entries({
    env: "production",
    service: "hosterax-control-plane",
    category: entry.category,
    ...tags,
  })
    .map(([k, v]) => `${k}:${v}`)
    .join(",");

  return {
    ddsource: "hosterax",
    ddtags: formattedTags,
    hostname: "control-plane.hosterax.internal",
    service: "hosterax-engine",
    status: entry.level.toUpperCase(),
    timestamp: entry.timestamp,
    message: entry.message,
    attributes: {
      action: entry.action,
      category: entry.category,
      method: entry.method,
      path: entry.path,
      statusCode: entry.status,
      durationMs: entry.durationMs,
      meta: entry.meta,
    },
  };
}

/**
 * Formats a log entry into Splunk HTTP Event Collector (HEC) JSON payload
 */
export function formatSplunkHecEvent(entry: LogEntry, index = "main"): Record<string, any> {
  return {
    time: Math.floor(entry.timestamp / 1000),
    host: "control-plane.hosterax.internal",
    source: "hosterax-audit",
    sourcetype: "_json",
    index,
    event: {
      id: entry.id,
      timestamp: entry.timestamp,
      category: entry.category,
      level: entry.level,
      action: entry.action,
      message: entry.message,
      method: entry.method,
      path: entry.path,
      status: entry.status,
      durationMs: entry.durationMs,
      meta: entry.meta,
    },
  };
}

/**
 * Formats a log entry into Grafana Loki Push API stream payload
 */
export function formatGrafanaLokiPayload(
  entry: LogEntry,
  labels?: Record<string, string>,
): Record<string, any> {
  const streamLabels: Record<string, string> = {
    app: "hosterax",
    env: "production",
    category: entry.category,
    level: entry.level,
    ...labels,
  };

  // Loki timestamps are in nanoseconds string
  const timestampNano = `${entry.timestamp}000000`;
  const logLine = JSON.stringify({
    timestamp: new Date(entry.timestamp).toISOString(),
    level: entry.level,
    action: entry.action,
    message: entry.message,
    ...(entry.durationMs != null ? { durationMs: entry.durationMs } : {}),
  });

  return {
    streams: [
      {
        stream: streamLabels,
        values: [[timestampNano, logLine]],
      },
    ],
  };
}

/**
 * Filter logs based on sink minimum severity level
 */
export function shouldForwardLog(
  entryLevel: "debug" | "info" | "warn" | "error",
  minLevel: "debug" | "info" | "warn" | "error",
): boolean {
  const levels = ["debug", "info", "warn", "error"];
  const entryIdx = levels.indexOf(entryLevel);
  const minIdx = levels.indexOf(minLevel);
  return entryIdx >= minIdx;
}

/**
 * Preset SIEM sink configurations for rapid onboarding
 */
export const PRESET_SIEM_SINKS: Omit<
  SiemSinkConfig,
  "id" | "createdAt" | "deliveryCount" | "failureCount"
>[] = [
  {
    name: "Datadog EU Intake",
    type: "datadog",
    enabled: true,
    endpoint: "https://http-intake.logs.datadoghq.eu/api/v2/logs",
    minLevel: "info",
    tags: { cluster: "primary-node", datacenter: "eu-central" },
  },
  {
    name: "Splunk Enterprise HEC",
    type: "splunk_hec",
    enabled: true,
    endpoint: "https://splunk.internal.company:8088/services/collector/raw",
    minLevel: "warn",
    tags: { environment: "production" },
  },
  {
    name: "Grafana Loki Ingestion",
    type: "grafana_loki",
    enabled: true,
    endpoint: "https://loki.internal:3100/loki/api/v1/push",
    minLevel: "info",
    tags: { job: "hosterax-audit" },
  },
  {
    name: "Corporate Syslog RFC 5424",
    type: "syslog_rfc5424",
    enabled: true,
    endpoint: "syslog://syslog-collector.internal:514",
    facility: 16,
    minLevel: "info",
  },
];
