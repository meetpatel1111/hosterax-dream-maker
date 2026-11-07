/**
 * Pure helper functions for HosteraX Resource Monitor telemetry calculations.
 * Decoupled from React UI to enable fast, deterministic unit tests.
 */

export interface SystemMetricsPayload {
  cpuUsagePercent: number;
  cores: number;
  loadAverage: {
    "1m": number;
    "5m": number;
    "15m": number;
  };
  memory: {
    totalMb: number;
    usedMb: number;
    freeMb: number;
    usedPercent: number;
  };
  uptimeSeconds: number;
  activeContainers?: number;
  activeAlertsCount?: number;
}

export type ResourceSeverity = "healthy" | "warning" | "critical";

/**
 * Returns severity status based on threshold levels.
 */
export function getUsageStatus(
  percent: number,
  warningThreshold = 65,
  criticalThreshold = 85,
): ResourceSeverity {
  const safePct = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  if (safePct >= criticalThreshold) return "critical";
  if (safePct >= warningThreshold) return "warning";
  return "healthy";
}

/**
 * Formats uptime in seconds to a human-readable duration string.
 */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0s";
  const sec = Math.floor(seconds);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const remainingSecs = sec % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${remainingSecs}s`;
  if (minutes > 0) return `${minutes}m ${remainingSecs}s`;
  return `${remainingSecs}s`;
}

/**
 * Formats MB into human-readable GB or MB string.
 */
export function formatMegabytes(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return "0 MB";
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${gb >= 10 ? gb.toFixed(1) : gb.toFixed(2)} GB`;
  }
  return `${Math.round(mb)} MB`;
}

/**
 * Calculates and formats detailed memory breakdown.
 */
export function calculateMemoryBreakdown(totalMb: number, usedMb: number) {
  const safeTotal = Math.max(1, Number.isFinite(totalMb) ? totalMb : 1);
  const safeUsed = Math.max(0, Math.min(safeTotal, Number.isFinite(usedMb) ? usedMb : 0));
  const freeMb = Math.max(0, safeTotal - safeUsed);
  const percent = Math.round((safeUsed / safeTotal) * 100);

  return {
    totalMb: safeTotal,
    usedMb: safeUsed,
    freeMb,
    usedPercent: percent,
    totalFormatted: formatMegabytes(safeTotal),
    usedFormatted: formatMegabytes(safeUsed),
    freeFormatted: formatMegabytes(freeMb),
  };
}

/**
 * Validates whether the fetched JSON payload adheres to the /api/metrics schema.
 */
export function validateMetricsResponse(data: unknown): data is { system: SystemMetricsPayload } {
  if (!data || typeof data !== "object") return false;
  const sys = (data as any).system;
  if (!sys || typeof sys !== "object") return false;
  return (
    typeof sys.cpuUsagePercent === "number" &&
    typeof sys.cores === "number" &&
    sys.memory &&
    typeof sys.memory.totalMb === "number" &&
    typeof sys.memory.usedMb === "number"
  );
}
