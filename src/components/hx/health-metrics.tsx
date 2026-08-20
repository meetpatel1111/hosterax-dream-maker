import { useMemo } from "react";
import { Cpu, MemoryStick, Network, HardDrive, ShieldCheck, Activity, Box, Zap, Flame } from "lucide-react";
import { useEngineSystem, useProjectMetrics, useGpuTelemetry } from "@/lib/engine";

type HealthMetricsProps = {
  projectId: string;
  projectName: string;
  status: string;
};

export function HealthMetrics({ projectName, status }: HealthMetricsProps) {
  const sysQuery = useEngineSystem();
  const sys = sysQuery.data;
  const projectMetricsQuery = useProjectMetrics(projectName);
  const projData = projectMetricsQuery.data;
  const docker = projData?.docker;
  const gpuQuery = useGpuTelemetry();
  const gpuData = gpuQuery.data;
  const primaryGpu = gpuData?.primary;

  const metrics = useMemo(() => {
    // Real CPU percent
    const cpuVal =
      docker?.cpu_percent != null
        ? Number(docker.cpu_percent)
        : sys?.cpu?.percent != null
          ? Number(sys.cpu.percent)
          : 0;

    // Real Memory percent
    const memVal =
      docker?.memory_percent != null
        ? Number(docker.memory_percent)
        : sys?.memory?.percent != null
          ? parseFloat(String(sys.memory.percent))
          : 0;

    // Real Storage percent
    const diskVal = sys?.disk?.percent != null ? Number(sys.disk.percent) : 0;

    // Real Host Uptime
    const uptimeSecs = sys?.os?.uptime ?? sys?.uptime_seconds;
    const uptimeStr =
      uptimeSecs != null
        ? `${Math.floor(uptimeSecs / 3600)}h ${Math.floor((uptimeSecs % 3600) / 60)}m`
        : status === "running"
          ? "Live"
          : "Stopped";

    return {
      cpu: cpuVal,
      mem: memVal,
      net: docker?.network_io || "Active",
      disk: diskVal,
      uptime: uptimeStr,
    };
  }, [status, sys, docker]);

  return (
    <div className="space-y-6">
      {/* Container Banner if Docker */}
      {docker && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-foreground">
          <div className="flex items-center gap-2 font-medium">
            <Box className="h-4 w-4 text-primary animate-pulse" />
            <span>
              Docker Container:{" "}
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-primary font-semibold">
                {docker.name}
              </code>
            </span>
            <span className="text-muted-foreground">({docker.container_id?.slice(0, 12)})</span>
          </div>
          <div className="flex items-center gap-4 text-muted-foreground font-mono text-[11px]">
            <span>
              Net I/O: <strong className="text-foreground">{docker.network_io}</strong>
            </span>
            <span>
              Block I/O: <strong className="text-foreground">{docker.block_io}</strong>
            </span>
            <span>
              PIDs: <strong className="text-foreground">{docker.pids}</strong>
            </span>
          </div>
        </div>
      )}

      {/* Metric Cards Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* CPU */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Cpu className="h-4 w-4 text-primary" /> {docker ? "Container CPU" : "Host CPU Load"}
            </span>
            <span className="font-mono text-xs text-primary font-semibold">
              {metrics.cpu.toFixed(1)}%
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full transition-all duration-700 ${
                metrics.cpu > 80 ? "bg-destructive" : metrics.cpu > 60 ? "bg-warning" : "bg-primary"
              }`}
              style={{ width: `${Math.min(100, Math.max(2, metrics.cpu))}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {docker
                ? `${docker.pids} active threads`
                : sys?.cpu?.cores
                  ? `${sys.cpu.cores} Physical Cores`
                  : "--"}
            </span>
            <span className="truncate max-w-[120px]">
              {sys?.cpu?.model ? sys.cpu.model.split(" ")[0] : "Physical CPU"}
            </span>
          </div>
        </div>

        {/* Memory */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <MemoryStick className="h-4 w-4 text-primary" />{" "}
              {docker ? "Container RAM" : "Host Memory"}
            </span>
            <span className="font-mono text-xs text-primary font-semibold">
              {metrics.mem.toFixed(1)}%
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full transition-all duration-700 ${
                metrics.mem > 85 ? "bg-destructive" : metrics.mem > 70 ? "bg-warning" : "bg-primary"
              }`}
              style={{ width: `${Math.min(100, Math.max(2, metrics.mem))}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {sys?.memory?.used_mb != null
                ? `${(sys.memory.used_mb / 1024).toFixed(1)} GB Used`
                : "--"}
            </span>
            <span>
              {sys?.memory?.total_mb != null
                ? `${(sys.memory.total_mb / 1024).toFixed(1)} GB Total`
                : "--"}
            </span>
          </div>
        </div>

        {/* Storage */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <HardDrive className="h-4 w-4 text-primary" /> NVMe Storage
            </span>
            <span className="font-mono text-xs text-primary font-semibold">
              {metrics.disk.toFixed(1)}%
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full transition-all duration-700 ${
                metrics.disk > 90
                  ? "bg-destructive"
                  : metrics.disk > 75
                    ? "bg-warning"
                    : "bg-primary"
              }`}
              style={{ width: `${Math.min(100, Math.max(2, metrics.disk))}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{sys?.disk?.used_gb != null ? `${sys.disk.used_gb} GB Used` : "--"}</span>
            <span>{sys?.disk?.total_gb != null ? `${sys.disk.total_gb} GB Total` : "--"}</span>
          </div>
        </div>

        {/* Network & Node */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Network className="h-4 w-4 text-primary" /> Network & Sockets
            </span>
            <span className="font-mono text-xs text-emerald-400 font-semibold flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
              Online
            </span>
          </div>
          <div className="mt-3 font-mono text-lg font-bold text-foreground truncate">
            {docker?.network_io || (sys?.docker?.running ? "Docker Bridge" : "Native Loop")}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Platform: {sys?.os?.platform || "Linux / Windows"}</span>
            <span>Uptime: {metrics.uptime}</span>
          </div>
        </div>

        {/* NVIDIA GPU & VRAM Accelerator (Kubeara Benchmark) */}
        {primaryGpu && (
          <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-5 shadow-sm md:col-span-2 lg:col-span-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-xs text-foreground flex items-center gap-2">
                    <span>{primaryGpu.name}</span>
                    <span className="text-[10px] font-mono uppercase bg-emerald-900/60 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-700/50">
                      CUDA Ready
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono">
                    Driver v{primaryGpu.driverVersion} • Power: {primaryGpu.powerDrawWatts}W
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs font-mono">
                <div className="flex items-center gap-1 text-emerald-400">
                  <Flame className="h-3.5 w-3.5" />
                  <span>{primaryGpu.temperatureC}°C</span>
                </div>
                <div className="text-foreground">
                  GPU Core: <strong>{primaryGpu.utilizationGpuPercent}%</strong>
                </div>
                <div className="text-emerald-400 font-semibold">
                  VRAM: {primaryGpu.memoryUsedMb} MB / {primaryGpu.memoryTotalMb} MB ({primaryGpu.memoryUsagePercent}%)
                </div>
              </div>
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-emerald-950/80 border border-emerald-800/40">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-700"
                style={{ width: `${Math.min(100, Math.max(2, primaryGpu.memoryUsagePercent))}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
              <span>Free VRAM: {primaryGpu.memoryFreeMb} MB</span>
              <span>Available for AI Model Inference (Ollama / vLLM / DeepSeek)</span>
            </div>
          </div>
        )}
      </div>

      {/* Real Node Telemetry Status Banner */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span>
                {docker
                  ? `Docker Container · ${docker.name}`
                  : sys
                    ? "System Status · Running Live Telemetry"
                    : "Connecting to Engine..."}
              </span>
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
            </div>
            <p className="text-xs text-muted-foreground">
              {docker
                ? `Running in isolated container environment on node '${sys?.os?.platform || "Host"}'.`
                : sys
                  ? `Host kernel reporting physical telemetry across ${sys.cpu?.cores || 1} cores.`
                  : "Connecting to HosteraX daemon (localhost:7777) for live telemetry."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6 text-xs text-muted-foreground">
          <div>
            <div className="text-[10px] uppercase font-mono text-muted-foreground/70">
              Host Uptime
            </div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-foreground">
              {metrics.uptime}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-mono text-muted-foreground/70">
              Active Containers
            </div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-foreground">
              {sys?.docker?.containers_count ?? (docker ? 1 : 0)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
