import { useMemo, useState, useEffect } from "react";
import { Cpu, MemoryStick, Network, HardDrive, ShieldCheck, Activity, RefreshCw, AlertTriangle } from "lucide-react";

type HealthMetricsProps = {
  projectId: string;
  projectName: string;
  status: string;
};

export function HealthMetrics({ projectId, projectName, status }: HealthMetricsProps) {
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTicks((t) => t + 1), 3000);
    return () => clearInterval(timer);
  }, []);

  // Compute live fluctuating metrics
  const metrics = useMemo(() => {
    const seed = projectId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const timeFactor = Math.sin(ticks * 0.5);
    return {
      cpu: Math.max(2, Math.min(95, 12 + Math.sin(seed + ticks) * 18 + timeFactor * 5)),
      mem: Math.max(10, Math.min(92, 45 + Math.cos(seed + ticks * 0.3) * 15)),
      net: Math.max(0.2, (2.4 + Math.sin(ticks * 0.7) * 1.8)).toFixed(2),
      disk: Math.max(15, (22 + (seed % 10)).toFixed(1)),
      uptime: status === "failed" ? "98.40%" : "99.98%",
      latency: Math.floor(24 + Math.sin(ticks * 0.8) * 12),
      requestsPerMin: Math.floor(340 + Math.cos(ticks) * 90),
    };
  }, [projectId, ticks, status]);

  return (
    <div className="space-y-6">
      {/* Metric Cards Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* CPU */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Cpu className="h-4 w-4 text-primary" /> CPU Utilization
            </span>
            <span className="font-mono text-xs text-primary font-semibold">{metrics.cpu.toFixed(1)}%</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full transition-all duration-700 ${
                metrics.cpu > 80 ? "bg-destructive" : metrics.cpu > 60 ? "bg-warning" : "bg-primary"
              }`}
              style={{ width: `${metrics.cpu}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Allocated: 2.0 vCPU</span>
            <span>Peak: 4.0 vCPU</span>
          </div>
        </div>

        {/* Memory */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <MemoryStick className="h-4 w-4 text-primary" /> Memory Usage
            </span>
            <span className="font-mono text-xs text-primary font-semibold">{metrics.mem.toFixed(1)}%</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full transition-all duration-700 ${
                metrics.mem > 85 ? "bg-destructive" : metrics.mem > 70 ? "bg-warning" : "bg-primary"
              }`}
              style={{ width: `${metrics.mem}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>512 MB / 1024 MB</span>
            <span>Heap: 380 MB</span>
          </div>
        </div>

        {/* Network */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Network className="h-4 w-4 text-primary" /> Network Throughput
            </span>
            <span className="font-mono text-xs text-primary font-semibold">{metrics.net} MB/s</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-bold tracking-tight text-foreground">{metrics.requestsPerMin}</span>
            <span className="text-xs text-muted-foreground">req / min</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Avg Latency: {metrics.latency}ms</span>
            <span className="text-success font-medium">99.9% 2xx</span>
          </div>
        </div>

        {/* Disk */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <HardDrive className="h-4 w-4 text-primary" /> NVMe Storage
            </span>
            <span className="font-mono text-xs text-primary font-semibold">{metrics.disk}%</span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-primary transition-all duration-700" style={{ width: `${metrics.disk}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>4.2 GB / 20 GB</span>
            <span className="text-success">Healthy</span>
          </div>
        </div>
      </div>

      {/* System Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface/60 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/15 text-success">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span>System Status · Optimal</span>
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
            </div>
            <p className="text-xs text-muted-foreground">
              All health probes reporting normal response times across edge routing.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6 text-xs text-muted-foreground">
          <div>
            <div className="text-[10px] uppercase font-mono text-muted-foreground/70">Uptime (30d)</div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-foreground">{metrics.uptime}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-mono text-muted-foreground/70">Edge Region</div>
            <div className="mt-0.5 font-medium text-foreground">Local (localhost:7777)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
