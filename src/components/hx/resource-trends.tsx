import { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { Activity, Cpu, HardDrive, Clock, TrendingUp, AlertTriangle, Zap } from "lucide-react";
import type { SystemTelemetrySnapshot } from "@/lib/engine";
import {
  prepare30MinTimeline,
  calculateTrendStats,
  type TelemetryTrendPoint,
} from "@/utils/resource-trends";
import { formatMegabytes } from "@/utils/resource-metrics";
import { cn } from "@/lib/utils";

export interface ResourceTrendsProps {
  className?: string;
  snapshots?: SystemTelemetrySnapshot[];
  currentCpu?: number;
  currentMem?: number;
  totalMemMb?: number;
  title?: string;
  description?: string;
}

export function ResourceTrends({
  className,
  snapshots = [],
  currentCpu = 5,
  currentMem = 12,
  totalMemMb = 12288,
  title = "30-Minute Resource Utilization Trends",
  description = "Historical CPU load and RAM allocation curves across the last 30 minutes",
}: ResourceTrendsProps) {
  const [activeTab, setActiveTab] = useState<"all" | "cpu" | "mem">("all");
  const [showThresholds, setShowThresholds] = useState(true);

  // Prepare the 30-minute continuous timeline dataset
  const timelineData: TelemetryTrendPoint[] = useMemo(() => {
    return prepare30MinTimeline(snapshots, currentCpu, currentMem, totalMemMb);
  }, [snapshots, currentCpu, currentMem, totalMemMb]);

  // Compute 30-minute summary stats (avg, peak, min, current)
  const stats = useMemo(() => {
    return calculateTrendStats(timelineData, 30);
  }, [timelineData]);

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-5 shadow-sm space-y-5 transition-all",
        className,
      )}
    >
      {/* Top Header & View Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-mono font-medium text-primary">
                <Clock className="h-3 w-3" /> 30m Window
              </span>
            </div>
            {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Threshold Lines Toggle */}
          <button
            type="button"
            onClick={() => setShowThresholds((prev) => !prev)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
              showThresholds
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-border bg-surface-2 text-muted-foreground hover:text-foreground",
            )}
          >
            <AlertTriangle className="h-3 w-3" />
            <span>Thresholds (70% / 85%)</span>
          </button>

          {/* Mode Switch Tabs */}
          <div className="inline-flex items-center rounded-lg border border-border bg-surface-2 p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab("all")}
              className={cn(
                "rounded-md px-2.5 py-1 transition-all",
                activeTab === "all"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Combined
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("cpu")}
              className={cn(
                "rounded-md px-2.5 py-1 transition-all",
                activeTab === "cpu"
                  ? "bg-emerald-500 text-black font-semibold shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              CPU Only
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("mem")}
              className={cn(
                "rounded-md px-2.5 py-1 transition-all",
                activeTab === "mem"
                  ? "bg-cyan-500 text-black font-semibold shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              RAM Only
            </button>
          </div>
        </div>
      </div>

      {/* 30-Minute Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* CPU 30m Avg & Peak */}
        <div className="rounded-lg border border-border/70 bg-surface/40 p-3 space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1 text-emerald-400 font-medium">
              <Cpu className="h-3.5 w-3.5" /> CPU 30m Avg
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              Peak: {stats.peakCpu}%
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-foreground">{stats.avgCpu}</span>
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>

        {/* RAM 30m Avg & Peak */}
        <div className="rounded-lg border border-border/70 bg-surface/40 p-3 space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1 text-cyan-400 font-medium">
              <HardDrive className="h-3.5 w-3.5" /> RAM 30m Avg
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              Peak: {stats.peakMem}%
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-foreground">{stats.avgMem}</span>
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>

        {/* Current Live Values */}
        <div className="rounded-lg border border-border/70 bg-surface/40 p-3 space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1 text-foreground font-medium">
              <Zap className="h-3.5 w-3.5 text-primary" /> Current Load
            </span>
            <span className="font-mono text-[10px] text-emerald-400">Live</span>
          </div>
          <div className="flex items-baseline gap-2 font-mono text-xs">
            <span className="text-emerald-400 font-bold">CPU: {stats.currentCpu}%</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-cyan-400 font-bold">RAM: {stats.currentMem}%</span>
          </div>
        </div>

        {/* Window Details */}
        <div className="rounded-lg border border-border/70 bg-surface/40 p-3 space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1 text-muted-foreground font-medium">
              <Activity className="h-3.5 w-3.5" /> Horizon
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">Resolution</span>
          </div>
          <div className="text-xs font-mono text-foreground font-semibold">
            Last 30 Minutes
            <span className="block text-[10px] text-muted-foreground font-normal">
              {stats.sampleCount} continuous points
            </span>
          </div>
        </div>
      </div>

      {/* Recharts 30-Minute Area Chart */}
      <div className="h-[240px] w-full pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={timelineData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="trendsCpuGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="trendsRamGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
            <XAxis
              dataKey="relativeLabel"
              stroke="#737373"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              interval={4}
            />
            <YAxis
              stroke="#737373"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              domain={[0, 100]}
              unit="%"
            />

            {/* Threshold Guide Reference Lines */}
            {showThresholds && (
              <>
                <ReferenceLine
                  y={85}
                  stroke="#f43f5e"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  label={{
                    value: "Critical 85%",
                    position: "insideTopRight",
                    fill: "#f43f5e",
                    fontSize: 9,
                  }}
                />
                <ReferenceLine
                  y={70}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  label={{
                    value: "Warning 70%",
                    position: "insideTopRight",
                    fill: "#f59e0b",
                    fontSize: 9,
                  }}
                />
              </>
            )}

            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const item = payload[0].payload as TelemetryTrendPoint;
                  return (
                    <div className="rounded-lg border border-border bg-popover/95 p-3 shadow-xl text-xs backdrop-blur-md space-y-1.5 font-mono">
                      <div className="flex items-center justify-between gap-4 font-semibold text-foreground border-b border-border/70 pb-1">
                        <span>{item.timeLabel}</span>
                        <span className="text-muted-foreground font-normal">
                          {item.relativeLabel}
                        </span>
                      </div>
                      {(activeTab === "all" || activeTab === "cpu") && (
                        <div className="flex items-center justify-between gap-4 text-emerald-400">
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-400" /> CPU Usage:
                          </span>
                          <span className="font-bold">{item.cpu}%</span>
                        </div>
                      )}
                      {(activeTab === "all" || activeTab === "mem") && (
                        <div className="flex items-center justify-between gap-4 text-cyan-400">
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-cyan-400" /> RAM Memory:
                          </span>
                          <span className="font-bold">
                            {item.mem}%{" "}
                            {item.memUsedMb ? `(${formatMegabytes(item.memUsedMb)})` : ""}
                          </span>
                        </div>
                      )}
                      {item.load1m !== undefined && (
                        <div className="text-[10px] text-muted-foreground pt-0.5">
                          Load avg 1m: {item.load1m}
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              }}
            />

            {(activeTab === "all" || activeTab === "cpu") && (
              <Area
                type="monotone"
                dataKey="cpu"
                name="CPU Load"
                stroke="#10b981"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#trendsCpuGrad)"
                isAnimationActive={false}
              />
            )}

            {(activeTab === "all" || activeTab === "mem") && (
              <Area
                type="monotone"
                dataKey="mem"
                name="RAM Allocation"
                stroke="#06b6d4"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#trendsRamGrad)"
                isAnimationActive={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Chart Footer Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3 text-[11px] font-mono text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> CPU Utilization Curve
          </span>
          <span className="flex items-center gap-1.5 text-cyan-400">
            <span className="h-2 w-2 rounded-full bg-cyan-400" /> RAM Memory Curve
          </span>
        </div>
        <span className="text-muted-foreground/70">
          Continuous 30-minute window · Anchored to live engine telemetry
        </span>
      </div>
    </div>
  );
}

export default ResourceTrends;
