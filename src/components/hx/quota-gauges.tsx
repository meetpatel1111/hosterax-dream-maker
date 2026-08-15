import { Cpu, MemoryStick, HardDrive, Network, Zap, CheckCircle, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEngine } from "@/lib/engine";

export function QuotaGauges() {
  const engine = useEngine();

  const {
    data: metrics,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["system-metrics", engine.url],
    queryFn: async () => {
      return engine.call<any>("GET", "/api/system");
    },
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm flex items-center justify-center h-32">
        <span className="text-sm text-destructive">Unable to fetch metrics from Server Node</span>
      </div>
    );
  }

  const quotas = [
    {
      name: "vCPU Cores",
      used: metrics.cpu.cores * (metrics.cpu.percent / 100),
      total: metrics.cpu.cores,
      unit: "Cores",
      icon: Cpu,
      pct: metrics.cpu.percent,
    },
    {
      name: "RAM Memory",
      used: metrics.memory.used_mb / 1024,
      total: metrics.memory.total_mb / 1024,
      unit: "GB",
      icon: MemoryStick,
      pct: parseFloat(metrics.memory.percent),
    },
    {
      name: "NVMe Storage",
      used: metrics.disk.used_gb,
      total: metrics.disk.total_gb,
      unit: "GB",
      icon: HardDrive,
      pct: metrics.disk.percent,
    },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-5">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight">
              Instance Resource Allocation & Quotas
            </h3>
            <p className="text-xs text-muted-foreground">
              Self-hosted machine capacity limits & active allocation meters
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1 text-xs font-mono font-medium text-success border border-success/30">
          <CheckCircle className="h-3.5 w-3.5" /> Host Active
        </span>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {quotas.map((q) => {
          const Icon = q.icon;
          return (
            <div
              key={q.name}
              className="space-y-3 rounded-lg border border-border/70 bg-surface/40 p-4"
            >
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5 text-primary" /> {q.name}
                </span>
                <span className="font-mono text-foreground font-semibold">{q.pct}%</span>
              </div>

              <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${q.pct}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                <span>
                  {q.used.toFixed(1)} {q.unit} used
                </span>
                <span>
                  {q.total.toFixed(1)} {q.unit} limit
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
