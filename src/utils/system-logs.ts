/**
 * Pure utility functions for the Live System Logs panel.
 * Decoupled from React for deterministic testing.
 */

export type LogSeverity = "INFO" | "WARN" | "ERROR";
export type LogFilterSeverity = "ALL" | LogSeverity;

export interface SystemLogEntry {
  id: string;
  ts: number;
  level: LogSeverity;
  source: string;
  message: string;
  meta?: Record<string, unknown> | null;
}

export interface FilterOptions {
  level?: LogFilterSeverity;
  searchQuery?: string;
  source?: string;
}

/**
 * Normalizes an arbitrary severity string into 'INFO' | 'WARN' | 'ERROR'.
 */
export function normalizeSeverity(raw: unknown): LogSeverity {
  const str = String(raw || "")
    .trim()
    .toUpperCase();
  if (str === "WARN" || str === "WARNING") return "WARN";
  if (str === "ERROR" || str === "CRITICAL" || str === "FATAL" || str === "ERR") return "ERROR";
  return "INFO";
}

/**
 * Safely parses an incoming WebSocket message into a SystemLogEntry.
 * Returns null if the message is malformed or unparseable.
 */
export function parseWebSocketLogMessage(data: unknown): SystemLogEntry | null {
  if (!data) return null;
  let parsed: any;
  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }
  } else if (typeof data === "object") {
    parsed = data;
  } else {
    return null;
  }

  // Handle standard HosteraX deployment/runtime ws messages or system_log messages
  const messageText = parsed.message ?? parsed.text;
  if (typeof messageText !== "string" && typeof parsed.message !== "number") {
    return null;
  }

  const ts = typeof parsed.ts === "number" && !Number.isNaN(parsed.ts) ? parsed.ts : Date.now();
  const level = normalizeSeverity(parsed.level ?? (parsed.stream === "stderr" ? "WARN" : "INFO"));
  const source = String(
    parsed.source ?? parsed.project ?? (parsed.deploymentId ? "deployment" : "engine"),
  ).trim();
  const id = String(parsed.id || `log_${ts}_${Math.random().toString(36).slice(2, 7)}`);

  return {
    id,
    ts,
    level,
    source: source || "engine",
    message: String(messageText),
    meta: parsed.meta && typeof parsed.meta === "object" ? parsed.meta : undefined,
  };
}

/**
 * Formats a numeric timestamp into a localized 24h clock string (HH:mm:ss or HH:mm:ss.SSS).
 */
export function formatLogTimestamp(ts: number, includeMs = false): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  if (!includeMs) {
    return `${hh}:${mm}:${ss}`;
  }
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 * Filters a list of system logs by severity, source, and search query.
 */
export function filterSystemLogs(
  logs: SystemLogEntry[],
  options: FilterOptions = {},
): SystemLogEntry[] {
  const { level = "ALL", searchQuery = "", source = "all" } = options;
  const q = searchQuery.trim().toLowerCase();
  const cleanSource = source.trim().toLowerCase();

  return logs.filter((entry) => {
    // 1. Severity filter
    if (level !== "ALL" && entry.level !== level) {
      return false;
    }

    // 2. Source filter
    if (cleanSource !== "all" && entry.source.toLowerCase() !== cleanSource) {
      return false;
    }

    // 3. Search query filter
    if (q) {
      const matchMessage = entry.message.toLowerCase().includes(q);
      const matchSource = entry.source.toLowerCase().includes(q);
      const matchLevel = entry.level.toLowerCase().includes(q);
      let matchMeta = false;
      if (entry.meta) {
        try {
          matchMeta = JSON.stringify(entry.meta).toLowerCase().includes(q);
        } catch {}
      }
      if (!matchMessage && !matchSource && !matchLevel && !matchMeta) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Computes log counts broken down by severity level.
 */
export function countLogsBySeverity(logs: SystemLogEntry[]): Record<LogFilterSeverity, number> {
  const counts: Record<LogFilterSeverity, number> = {
    ALL: logs.length,
    INFO: 0,
    WARN: 0,
    ERROR: 0,
  };

  for (const log of logs) {
    if (log.level === "INFO") counts.INFO++;
    else if (log.level === "WARN") counts.WARN++;
    else if (log.level === "ERROR") counts.ERROR++;
  }

  return counts;
}

/**
 * Appends a new log entry to an existing array, deduplicating by ID and respecting capacity.
 */
export function appendLogWithCap(
  existingLogs: SystemLogEntry[],
  newLog: SystemLogEntry,
  cap = 500,
): SystemLogEntry[] {
  // Prevent duplicate if already present
  if (existingLogs.some((l) => l.id === newLog.id)) {
    return existingLogs;
  }
  const updated = [...existingLogs, newLog];
  if (updated.length > cap) {
    return updated.slice(updated.length - cap);
  }
  return updated;
}

/**
 * Formats a collection of logs into plain-text format for downloading or copying.
 */
export function exportLogsAsText(logs: SystemLogEntry[]): string {
  return logs
    .map((l) => {
      const time = new Date(l.ts).toISOString();
      return `[${time}] [${l.level.padEnd(5)}] [${l.source}] ${l.message}`;
    })
    .join("\n");
}
