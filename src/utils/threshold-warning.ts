/**
 * Pure logic and state evaluation for Resource Monitor threshold alerts.
 * Evaluates whether CPU or RAM usage exceeds the defined threshold (default: 80%)
 * for more than a sustained duration (default: 5,000ms).
 */

export interface ThresholdTrackerState {
  cpuExceededSince: number | null;
  memExceededSince: number | null;
}

export interface ThresholdEvaluationResult {
  isTriggered: boolean;
  cpuTriggered: boolean;
  memTriggered: boolean;
  triggerType: "cpu" | "mem" | "both" | null;
  cpuDurationMs: number;
  memDurationMs: number;
  maxDurationSeconds: number;
  nextState: ThresholdTrackerState;
}

export interface EvaluateThresholdOptions {
  currentCpu: number;
  currentMem: number;
  now?: number;
  state?: ThresholdTrackerState;
  thresholdPercent?: number;
  requiredDurationMs?: number;
}

/**
 * Evaluates whether CPU or RAM has exceeded the threshold for the required duration.
 */
export function evaluateThresholdWarning({
  currentCpu,
  currentMem,
  now = Date.now(),
  state = { cpuExceededSince: null, memExceededSince: null },
  thresholdPercent = 80,
  requiredDurationMs = 5000,
}: EvaluateThresholdOptions): ThresholdEvaluationResult {
  const isCpuHigh = Number.isFinite(currentCpu) && currentCpu >= thresholdPercent;
  const isMemHigh = Number.isFinite(currentMem) && currentMem >= thresholdPercent;

  const nextCpuSince = isCpuHigh ? (state.cpuExceededSince ?? now) : null;
  const nextMemSince = isMemHigh ? (state.memExceededSince ?? now) : null;

  const cpuDurationMs = nextCpuSince ? Math.max(0, now - nextCpuSince) : 0;
  const memDurationMs = nextMemSince ? Math.max(0, now - nextMemSince) : 0;

  const cpuTriggered = isCpuHigh && cpuDurationMs >= requiredDurationMs;
  const memTriggered = isMemHigh && memDurationMs >= requiredDurationMs;
  const isTriggered = cpuTriggered || memTriggered;

  let triggerType: "cpu" | "mem" | "both" | null = null;
  if (cpuTriggered && memTriggered) triggerType = "both";
  else if (cpuTriggered) triggerType = "cpu";
  else if (memTriggered) triggerType = "mem";

  const maxDurationMs = Math.max(
    cpuTriggered ? cpuDurationMs : 0,
    memTriggered ? memDurationMs : 0,
  );

  return {
    isTriggered,
    cpuTriggered,
    memTriggered,
    triggerType,
    cpuDurationMs,
    memDurationMs,
    maxDurationSeconds: Math.floor(maxDurationMs / 1000),
    nextState: {
      cpuExceededSince: nextCpuSince,
      memExceededSince: nextMemSince,
    },
  };
}

/**
 * Formats warning notification message based on trigger type and duration.
 */
export function formatThresholdWarningMessage(
  triggerType: "cpu" | "mem" | "both" | null,
  durationSeconds: number,
  threshold = 80,
): string {
  if (!triggerType) return "";
  const metricLabel =
    triggerType === "both" ? "CPU and RAM" : triggerType === "cpu" ? "CPU" : "RAM";
  return `Warning: ${metricLabel} usage exceeded ${threshold}% for ${durationSeconds}s`;
}
