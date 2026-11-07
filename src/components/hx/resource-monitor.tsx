import { useState, useEffect, useMemo } from "react";
import {
  Cpu,
  Activity,
  HardDrive,
  RefreshCw,
  Pause,
  Play,
  Server,
  Clock,
  Layers,
  AlertCircle,
  Zap,
  TrendingUp,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { useEngineMetrics } from "@/lib/engine";
import {
  getUsageStatus,
  formatUptime,
  formatMegabytes,
  calculateMemoryBreakdown,
} from "@/utils/resource-metrics";
import {
  evaluateThresholdWarning,
  formatThresholdWarningMessage,
  type ThresholdTrackerState,
  type ThresholdEvaluationResult,
} from "@/utils/threshold-warning";
import { ResourceTrends } from "./resource-trends";
import { cn } from "@/lib/utils";

interface TelemetryPoint {
  time: string;
  cpu: number;
  mem: number;
}

export interface ResourceMonitorProps {
  className?: string;
  showHeader?: boolean;
  compact?: boolean;
  title?: string;
  description?: string;
  defaultMode?: "live" | "trends" | "both";
  thresholdPercent?: number;
  thresholdDurationMs?: number;
}

export function ResourceMonitor({
  className,
  showHeader = true,
  compact = false,
  title = "Resource Monitor",
  description = "Real-time CPU and RAM telemetry streamed directly from local HosteraX engine (/api/metrics)",
  defaultMode = "both",
  thresholdPercent = 80,
  thresholdDurationMs = 5000,
}: ResourceMonitorProps) {
  const [viewMode, setViewMode] = useState<"live" | "trends" | "both">(defaultMode);
  const [isPaused, setIsPaused] = useState(false);
  const [intervalMs, setIntervalMs] = useState<number>(3000);
  const [history, setHistory] = useState<TelemetryPoint[]>([]);

  const {
    data: metricsData,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useEngineMetrics({
    refetchInterval: isPaused ? undefined : intervalMs,
    enabled: true,
  });

  const sys = metricsData?.system;

  // Append real-time data point to rolling buffer whenever fresh metrics arrive
  useEffect(() => {
    if (!sys) return;
    const nowStr = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const newPoint: TelemetryPoint = {
      time: nowStr,
      cpu: Math.max(0, Math.min(100, Math.round(sys.cpuUsagePercent))),
      mem: Math.max(0, Math.min(100, Math.round(sys.memory?.usedPercent ?? 0))),
    };

    setHistory((prev) => {
      // Keep up to 24 rolling historical telemetry points
      const updated = [...prev, newPoint];
      if (updated.length > 24) return updated.slice(updated.length - 24);
      return updated;
    });
  }, [sys]);

  const memBreakdown = useMemo(() => {
    if (!sys?.memory) return null;
    return calculateMemoryBreakdown(sys.memory.totalMb, sys.memory.usedMb);
  }, [sys?.memory]);

  // Threshold Warning System State (>80% for >5s)
  const [trackerState, setTrackerState] = useState<ThresholdTrackerState>({
    cpuExceededSince: null,
    memExceededSince: null,
  });
  const [isSimulatingSpike, setIsSimulatingSpike] = useState(false);

  const effectiveCpu = isSimulatingSpike ? 89 : (sys?.cpuUsagePercent ?? 0);
  const effectiveMem = isSimulatingSpike ? 84 : (sys?.memory?.usedPercent ?? 0);

  const [warningResult, setWarningResult] = useState<ThresholdEvaluationResult>(() =>
    evaluateThresholdWarning({
      currentCpu: effectiveCpu,
      currentMem: effectiveMem,
      thresholdPercent,
      requiredDurationMs: thresholdDurationMs,
    }),
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setTrackerState((prev) => {
        const res = evaluateThresholdWarning({
          currentCpu: effectiveCpu,
          currentMem: effectiveMem,
          now: Date.now(),
          state: prev,
          thresholdPercent,
          requiredDurationMs: thresholdDurationMs,
        });
        setWarningResult(res);
        return res.nextState;
      });
    }, 500);

    return () => clearInterval(timer);
  }, [effectiveCpu, effectiveMem, thresholdPercent, thresholdDurationMs]);

  const cpuStatus = getUsageStatus(effectiveCpu);
  const memStatus = getUsageStatus(effectiveMem);

  const getStatusColor = (status: "healthy" | "warning" | "critical") => {
    switch (status) {
      case "critical":
        return "text-rose-400 border-rose-500/30 bg-rose-500/10";
      case "warning":
        return "text-amber-400 border-amber-500/30 bg-amber-500/10";
      default:
        return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
    }
  };

  const getProgressColor = (status: "healthy" | "warning" | "critical") => {
    switch (status) {
      case "critical":
        return "bg-rose-500";
      case "warning":
        return "bg-amber-500";
      default:
        return "bg-emerald-500";
    }
  };

  if (error && !sys) {
    return (
      <div
        className={cn(
          "rounded-xl border border-destructive/40 bg-destructive/10 p-5 text-sm text-destructive shadow-sm",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Unable to fetch metrics from /api/metrics</p>
              <p className="text-xs text-destructive/80 mt-0.5">
                Ensure the local HosteraX engine daemon is active on port 7777.
              </p>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/20 px-3 py-1.5 text-xs font-medium hover:bg-destructive/30 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-5 shadow-sm space-y-5 transition-all duration-300",
        warningResult.isTriggered
          ? "border-rose-500/90 shadow-[0_0_35px_rgba(244,63,94,0.35)] ring-2 ring-rose-500/60 bg-gradient-to-b from-rose-950/20 to-card"
          : "border-border",
        className,
      )}
    >
      {/* Header & Polling Controls */}
      {showHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
                {warningResult.isTriggered ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/60 bg-rose-500/20 px-2.5 py-0.5 text-[10px] font-mono font-bold text-rose-300 animate-pulse">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-ping" />
                    THRESHOLD BREACH (&gt;80% for {warningResult.maxDurationSeconds}s)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono font-medium text-emerald-400">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full bg-emerald-400",
                        !isPaused && "animate-ping",
                      )}
                    />
                    {isPaused ? "PAUSED" : "LIVE /api/metrics"}
                  </span>
                )}
              </div>
              {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* View Mode Selector: Gauges vs 30m Trends vs Unified */}
            <div className="inline-flex items-center rounded-lg border border-border bg-surface-2 p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setViewMode("live")}
                className={cn(
                  "rounded-md px-2.5 py-1 transition-all",
                  viewMode === "live"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Gauges
              </button>
              <button
                type="button"
                onClick={() => setViewMode("trends")}
                className={cn(
                  "rounded-md px-2.5 py-1 transition-all flex items-center gap-1",
                  viewMode === "trends"
                    ? "bg-emerald-500 text-black font-semibold shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <TrendingUp className="h-3 w-3" />
                30m Trends
              </button>
              <button
                type="button"
                onClick={() => setViewMode("both")}
                className={cn(
                  "rounded-md px-2.5 py-1 transition-all",
                  viewMode === "both"
                    ? "bg-cyan-500 text-black font-semibold shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Unified
              </button>
            </div>

            {/* Polling Interval Selector */}
            <select
              aria-label="Polling interval"
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
              className="rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value={1000}>1s interval</option>
              <option value={2000}>2s interval</option>
              <option value={3000}>3s interval</option>
              <option value={5000}>5s interval</option>
            </select>

            {/* Pause / Resume Button */}
            <button
              onClick={() => setIsPaused((prev) => !prev)}
              title={isPaused ? "Resume live metrics stream" : "Pause live metrics stream"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                isPaused
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                  : "border-border bg-surface-2 text-muted-foreground hover:text-foreground",
              )}
            >
              {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              <span>{isPaused ? "Resume" : "Pause"}</span>
            </button>

            {/* Test Simulation Button */}
            <button
              type="button"
              onClick={() => setIsSimulatingSpike((prev) => !prev)}
              title="Test threshold warning: simulates sustained >80% resource load for >5 seconds"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                isSimulatingSpike
                  ? "border-rose-500 bg-rose-500/25 text-rose-300 ring-1 ring-rose-500 animate-pulse font-semibold"
                  : "border-border bg-surface-2 text-muted-foreground hover:text-foreground",
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
              <span>{isSimulatingSpike ? "Simulating >80% Spike" : "Test Alert (>80%)"}</span>
            </button>

            {/* Manual Refresh Button */}
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              title="Manual refetch now"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </button>
          </div>
        </div>
      )}

      {/* Critical Threshold Exceeded Warning Banner (>80% for >5s) */}
      {warningResult.isTriggered && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/70 bg-rose-500/15 p-4 text-rose-200 shadow-lg animate-in fade-in duration-300"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-500/30 text-rose-300 border border-rose-500/50">
              <AlertTriangle className="h-5 w-5 animate-bounce" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                  Critical Resource Threshold Warning
                </h4>
                <span className="rounded-full bg-rose-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-rose-100 border border-rose-400">
                  Exceeded &gt;80% for {warningResult.maxDurationSeconds}s
                </span>
              </div>
              <p className="text-xs text-rose-200/90 mt-1">
                {formatThresholdWarningMessage(
                  warningResult.triggerType,
                  warningResult.maxDurationSeconds,
                  thresholdPercent,
                )}
                . Sustained resource saturation may cause service degradation or container
                throttling.
              </p>
            </div>
          </div>
          {isSimulatingSpike && (
            <button
              type="button"
              onClick={() => setIsSimulatingSpike(false)}
              className="rounded-lg border border-rose-400/40 bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-500/40 transition-colors"
            >
              Reset Simulation
            </button>
          )}
        </div>
      )}

      {/* Primary KPI Gauges: CPU & RAM (Live Mode) */}
      {(viewMode === "live" || viewMode === "both") && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* CPU Usage Card */}
            <div
              className={cn(
                "rounded-xl border p-4 space-y-3 relative overflow-hidden transition-all duration-300",
                warningResult.cpuTriggered
                  ? "border-rose-500/80 bg-rose-950/30 shadow-[0_0_20px_rgba(244,63,94,0.3)] ring-1 ring-rose-500"
                  : "border-border/80 bg-surface/50",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <Cpu className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    CPU Utilization
                  </span>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-mono font-medium",
                    warningResult.cpuTriggered
                      ? "border-rose-500/50 bg-rose-500/20 text-rose-300 animate-pulse font-bold"
                      : getStatusColor(cpuStatus),
                  )}
                >
                  {warningResult.cpuTriggered
                    ? `CRITICAL >80% (${warningResult.maxDurationSeconds}s)`
                    : cpuStatus}
                </span>
              </div>

              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-extrabold tracking-tight font-mono text-foreground">
                    {isLoading && !sys ? "--" : Math.round(effectiveCpu)}
                  </span>
                  <span className="text-lg font-bold text-muted-foreground">%</span>
                </div>
                <div className="text-right text-[11px] font-mono text-muted-foreground">
                  <span>{sys?.cores ? `${sys.cores} Cores` : "Host CPU"}</span>
                </div>
              </div>

              {/* CPU Progress Bar */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500 ease-out",
                    warningResult.cpuTriggered ? "bg-rose-500" : getProgressColor(cpuStatus),
                  )}
                  style={{ width: `${Math.min(100, Math.max(2, effectiveCpu))}%` }}
                />
              </div>

              {/* Load Average Breakdown */}
              {sys?.loadAverage && (
                <div className="flex items-center justify-between pt-1 text-[11px] font-mono text-muted-foreground">
                  <span>Load avg (1m / 5m / 15m):</span>
                  <span className="font-semibold text-foreground">
                    {sys.loadAverage["1m"]} / {sys.loadAverage["5m"]} / {sys.loadAverage["15m"]}
                  </span>
                </div>
              )}
            </div>

            {/* RAM Usage Card */}
            <div
              className={cn(
                "rounded-xl border p-4 space-y-3 relative overflow-hidden transition-all duration-300",
                warningResult.memTriggered
                  ? "border-rose-500/80 bg-rose-950/30 shadow-[0_0_20px_rgba(244,63,94,0.3)] ring-1 ring-rose-500"
                  : "border-border/80 bg-surface/50",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    <HardDrive className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    RAM Memory Usage
                  </span>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-mono font-medium",
                    warningResult.memTriggered
                      ? "border-rose-500/50 bg-rose-500/20 text-rose-300 animate-pulse font-bold"
                      : getStatusColor(memStatus),
                  )}
                >
                  {warningResult.memTriggered
                    ? `CRITICAL >80% (${warningResult.maxDurationSeconds}s)`
                    : memStatus}
                </span>
              </div>

              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-extrabold tracking-tight font-mono text-foreground">
                    {isLoading && !sys ? "--" : Math.round(effectiveMem)}
                  </span>
                  <span className="text-lg font-bold text-muted-foreground">%</span>
                </div>
                <div className="text-right text-[11px] font-mono text-muted-foreground">
                  <span>
                    {memBreakdown
                      ? `${memBreakdown.usedFormatted} / ${memBreakdown.totalFormatted}`
                      : "--"}
                  </span>
                </div>
              </div>

              {/* RAM Progress Bar */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500 ease-out",
                    warningResult.memTriggered ? "bg-rose-500" : getProgressColor(memStatus),
                  )}
                  style={{ width: `${Math.min(100, Math.max(2, effectiveMem))}%` }}
                />
              </div>

              {/* Free RAM Breakdown */}
              {memBreakdown && (
                <div className="flex items-center justify-between pt-1 text-[11px] font-mono text-muted-foreground">
                  <span>Available Free Memory:</span>
                  <span className="font-semibold text-emerald-400">
                    {memBreakdown.freeFormatted}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Real-Time Live Telemetry Trend Chart */}
          {!compact && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-primary" /> Live Telemetry Trend (Rolling Buffer)
                </span>
                <div className="flex items-center gap-4 font-mono text-[11px]">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" /> CPU %
                  </span>
                  <span className="flex items-center gap-1.5 text-cyan-400">
                    <span className="h-2 w-2 rounded-full bg-cyan-400" /> RAM %
                  </span>
                </div>
              </div>

              <div className="h-[160px] w-full rounded-lg border border-border/70 bg-surface/30 p-2">
                {history.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="rmCpuGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                        </linearGradient>
                        <linearGradient id="rmMemGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
                      <XAxis
                        dataKey="time"
                        stroke="#737373"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="#737373"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        domain={[0, 100]}
                        unit="%"
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const item = payload[0].payload as TelemetryPoint;
                            return (
                              <div className="rounded-lg border border-border bg-popover/95 p-2.5 shadow-xl text-xs backdrop-blur-md space-y-1 font-mono">
                                <div className="font-semibold text-foreground">{item.time}</div>
                                <div className="flex items-center justify-between gap-3 text-emerald-400">
                                  <span>CPU:</span>
                                  <span className="font-bold">{item.cpu}%</span>
                                </div>
                                <div className="flex items-center justify-between gap-3 text-cyan-400">
                                  <span>RAM:</span>
                                  <span className="font-bold">{item.mem}%</span>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="cpu"
                        stroke="#10b981"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#rmCpuGrad)"
                        isAnimationActive={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="mem"
                        stroke="#06b6d4"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#rmMemGrad)"
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground font-mono">
                    Streaming telemetry snapshots from /api/metrics...
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* 30-Minute Historical Trends Component (Trends & Unified Modes) */}
      {(viewMode === "trends" || viewMode === "both") && (
        <ResourceTrends
          snapshots={metricsData?.history}
          currentCpu={sys?.cpuUsagePercent ?? 0}
          currentMem={sys?.memory?.usedPercent ?? 0}
          totalMemMb={sys?.memory?.totalMb ?? 12288}
        />
      )}

      {/* Footer Host Meta Info */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3 text-[11px] font-mono text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-foreground/80">
            <Server className="h-3.5 w-3.5 text-primary" /> Endpoint: /api/metrics
          </span>
          {sys?.activeContainers !== undefined && (
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" /> Containers: {sys.activeContainers}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5" />
          <span>Uptime: {formatUptime(sys?.uptimeSeconds ?? 0)}</span>
        </div>
      </div>
    </div>
  );
}

export { ResourceTrends } from "./resource-trends";
export default ResourceMonitor;
