/**
 * Unified Logging Engine for HosteraX Client & Engine Telemetry.
 * Provides structured tracking for ALL API calls, UI interactions, error events,
 * and security audits with real-time pub/sub, analytics, and export capabilities.
 */

export type LogCategory = "api" | "ui" | "system" | "security";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: string;
  timestamp: number;
  category: LogCategory;
  level: LogLevel;
  action: string;
  message: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  meta?: Record<string, unknown>;
}

export interface LogFilterOptions {
  category?: "all" | LogCategory;
  level?: "all" | LogLevel;
  searchQuery?: string;
  statusFilter?: "all" | "success" | "client_error" | "server_error";
  startTime?: number;
  endTime?: number;
}

export interface LogMetrics {
  totalCount: number;
  apiCount: number;
  uiCount: number;
  errorCount: number;
  warnCount: number;
  avgApiLatencyMs: number;
  apiSuccessRate: number;
  slowestEndpoints: Array<{ path: string; method: string; durationMs: number }>;
}

const MAX_LOG_BUFFER = 1000;
let memoryLogs: LogEntry[] = [];
const subscribers = new Set<(entry: LogEntry, all: LogEntry[]) => void>();

/**
 * Creates a normalized LogEntry object.
 */
export function createLogEntry(
  category: LogCategory,
  level: LogLevel,
  action: string,
  message: string,
  details: {
    method?: string;
    path?: string;
    status?: number;
    durationMs?: number;
    meta?: Record<string, unknown>;
  } = {},
): LogEntry {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    category,
    level,
    action,
    message,
    method: details.method?.toUpperCase(),
    path: details.path,
    status: details.status,
    durationMs: details.durationMs !== undefined ? Math.round(details.durationMs) : undefined,
    meta: details.meta,
  };
}

/**
 * Sanitizes sensitive metadata (passwords, tokens, API keys) before logging.
 */
export function sanitizeLogMetadata(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  try {
    const json = JSON.parse(JSON.stringify(data));
    const redactKeys = [
      "password",
      "token",
      "secret",
      "authorization",
      "api_key",
      "apiKey",
      "access_key",
    ];

    const redact = (obj: any) => {
      if (!obj || typeof obj !== "object") return;
      for (const k of Object.keys(obj)) {
        if (redactKeys.some((rk) => k.toLowerCase().includes(rk.toLowerCase()))) {
          obj[k] = "[REDACTED]";
        } else if (typeof obj[k] === "object") {
          redact(obj[k]);
        }
      }
    };

    redact(json);
    return json;
  } catch {
    return { sanitized: true };
  }
}

/**
 * Filters log entries based on search query, category, level, and status code.
 */
export function filterLogs(logs: LogEntry[], options: LogFilterOptions = {}): LogEntry[] {
  const {
    category = "all",
    level = "all",
    searchQuery = "",
    statusFilter = "all",
    startTime,
    endTime,
  } = options;

  const q = searchQuery.trim().toLowerCase();

  return logs.filter((log) => {
    if (category !== "all" && log.category !== category) return false;
    if (level !== "all" && log.level !== level) return false;

    if (startTime && log.timestamp < startTime) return false;
    if (endTime && log.timestamp > endTime) return false;

    if (statusFilter !== "all") {
      if (log.status === undefined) return false;
      if (statusFilter === "success" && (log.status < 200 || log.status >= 400)) return false;
      if (statusFilter === "client_error" && (log.status < 400 || log.status >= 500)) return false;
      if (statusFilter === "server_error" && log.status < 500) return false;
    }

    if (q) {
      const matchAction = log.action.toLowerCase().includes(q);
      const matchMessage = log.message.toLowerCase().includes(q);
      const matchPath = log.path?.toLowerCase().includes(q) ?? false;
      const matchMethod = log.method?.toLowerCase().includes(q) ?? false;
      const matchStatus = log.status?.toString().includes(q) ?? false;
      let matchMeta = false;
      if (log.meta) {
        try {
          matchMeta = JSON.stringify(log.meta).toLowerCase().includes(q);
        } catch {}
      }
      if (
        !matchAction &&
        !matchMessage &&
        !matchPath &&
        !matchMethod &&
        !matchStatus &&
        !matchMeta
      ) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Computes telemetry analytics and latency metrics from an array of log entries.
 */
export function calculateLogMetrics(logs: LogEntry[]): LogMetrics {
  let apiCount = 0;
  let uiCount = 0;
  let errorCount = 0;
  let warnCount = 0;
  let totalApiLatency = 0;
  let successfulApiCount = 0;

  const apiLogsWithDuration: Array<{ path: string; method: string; durationMs: number }> = [];

  for (const log of logs) {
    if (log.category === "api") {
      apiCount++;
      if (log.durationMs !== undefined && log.durationMs > 0) {
        totalApiLatency += log.durationMs;
        if (log.path) {
          apiLogsWithDuration.push({
            path: log.path,
            method: log.method || "GET",
            durationMs: log.durationMs,
          });
        }
      }
      if (log.status !== undefined && log.status >= 200 && log.status < 400) {
        successfulApiCount++;
      }
    } else if (log.category === "ui") {
      uiCount++;
    }

    if (log.level === "error") errorCount++;
    else if (log.level === "warn") warnCount++;
  }

  const avgApiLatencyMs = apiCount > 0 ? Math.round(totalApiLatency / apiCount) : 0;
  const apiSuccessRate =
    apiCount > 0 ? Number(((successfulApiCount / apiCount) * 100).toFixed(1)) : 100;

  // Sort slowest endpoints descending
  const slowestEndpoints = apiLogsWithDuration
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5);

  return {
    totalCount: logs.length,
    apiCount,
    uiCount,
    errorCount,
    warnCount,
    avgApiLatencyMs,
    apiSuccessRate,
    slowestEndpoints,
  };
}

/**
 * Formats an API log entry into an executable cURL command.
 */
export function formatAsCurlCommand(log: LogEntry, baseUrl = "http://127.0.0.1:7777"): string {
  if (log.category !== "api" || !log.path) {
    return "# Not an API request log";
  }

  const method = log.method || "GET";
  const url = log.path.startsWith("http") ? log.path : `${baseUrl}${log.path}`;
  let cmd = `curl -X ${method} "${url}"`;

  cmd += ` \\\n  -H "Content-Type: application/json"`;

  if (log.meta?.headers && typeof log.meta.headers === "object") {
    for (const [k, v] of Object.entries(log.meta.headers as Record<string, string>)) {
      if (k.toLowerCase() !== "content-type") {
        cmd += ` \\\n  -H "${k}: ${v}"`;
      }
    }
  }

  if (log.meta?.requestBody) {
    const bodyStr =
      typeof log.meta.requestBody === "string"
        ? log.meta.requestBody
        : JSON.stringify(log.meta.requestBody);
    cmd += ` \\\n  -d '${bodyStr}'`;
  }

  return cmd;
}

/**
 * Exports logs as a formatted JSON string.
 */
export function exportLogsAsJson(logs: LogEntry[]): string {
  return JSON.stringify(logs, null, 2);
}

/**
 * Exports logs as CSV format.
 */
export function exportLogsAsCsv(logs: LogEntry[]): string {
  const headers = [
    "Timestamp",
    "ISO Time",
    "Category",
    "Level",
    "Action",
    "Method",
    "Path",
    "Status",
    "Duration (ms)",
    "Message",
  ];
  const rows = logs.map((l) => [
    l.timestamp,
    new Date(l.timestamp).toISOString(),
    l.category,
    l.level,
    `"${l.action.replace(/"/g, '""')}"`,
    l.method || "",
    l.path ? `"${l.path.replace(/"/g, '""')}"` : "",
    l.status !== undefined ? l.status : "",
    l.durationMs !== undefined ? l.durationMs : "",
    `"${l.message.replace(/"/g, '""')}"`,
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

// ────────── Singleton Runtime State & Event Dispatcher ──────────

export const appLogger = {
  getLogs(): LogEntry[] {
    return [...memoryLogs];
  },

  log(entry: LogEntry): LogEntry {
    memoryLogs.unshift(entry);
    if (memoryLogs.length > MAX_LOG_BUFFER) {
      memoryLogs = memoryLogs.slice(0, MAX_LOG_BUFFER);
    }
    subscribers.forEach((fn) => fn(entry, memoryLogs));
    return entry;
  },

  logApi(
    method: string,
    path: string,
    status: number,
    durationMs: number,
    meta?: Record<string, unknown>,
  ): LogEntry {
    const isError = status >= 400 || status === 0;
    const isWarn = status >= 300 && status < 400;
    const level: LogLevel = isError ? "error" : isWarn ? "warn" : "info";

    const entry = createLogEntry(
      "api",
      level,
      `${method.toUpperCase()} ${path}`,
      `${method.toUpperCase()} ${path} -> ${status} (${Math.round(durationMs)}ms)`,
      {
        method,
        path,
        status,
        durationMs,
        meta: sanitizeLogMetadata(meta),
      },
    );
    return this.log(entry);
  },

  logUi(
    action: string,
    message: string,
    meta?: Record<string, unknown>,
    level: LogLevel = "info",
  ): LogEntry {
    const entry = createLogEntry("ui", level, action, message, {
      meta: sanitizeLogMetadata(meta),
    });
    return this.log(entry);
  },

  clear(): void {
    memoryLogs = [];
    subscribers.forEach((fn) => fn({} as any, []));
  },

  subscribe(callback: (entry: LogEntry, all: LogEntry[]) => void): () => void {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  },
};

// Global browser window hook for automated validation or console inspection
if (typeof window !== "undefined") {
  (window as any).__HX_LOGGER__ = appLogger;
}
