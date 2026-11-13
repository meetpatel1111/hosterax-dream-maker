import { useState, useEffect, useMemo } from "react";
import {
  LineChart as LineChartIcon,
  Cpu,
  Activity,
  HardDrive,
  ShieldAlert,
  Bell,
  CheckCircle2,
  AlertTriangle,
  Play,
  Pause,
  RefreshCw,
  Copy,
  Check,
  Terminal,
  ExternalLink,
  Sliders,
  Plus,
  Trash2,
  Server,
  Globe,
  Flame,
  Zap,
} from "lucide-react";
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
import { toast } from "sonner";
import { useEngineMetrics, useEngineSystem, useDockerContainers, useEngine } from "@/lib/engine";
import {
  generatePrometheusMetrics,
  evaluateAlertRule,
  DEFAULT_ALERT_RULES,
  type AlertRule,
  type AlertEvaluation,
  type HostMetricsSnapshot,
  type ContainerMetric,
  type EdgeMetric,
} from "@/utils/monitoring-engine";
import { appLogger } from "@/utils/app-logger";
import { confirmAction } from "./confirm-modal";
import { SystemLogsPanel } from "./system-logs-panel";

interface TrendPoint {
  time: string;
  cpu: number;
  memory: number;
  disk: number;
}

export function ObservabilityStudio() {
  const engine = useEngine();
  const metricsQuery = useEngineMetrics({ refetchInterval: 3000 });
  const systemQuery = useEngineSystem();
  const containersQuery = useDockerContainers();

  const [activeTab, setActiveTab] = useState<"overview" | "alerts" | "prometheus" | "logs">(
    "overview",
  );
  const [isLivePaused, setIsLivePaused] = useState(false);
  const [timeWindow, setTimeWindow] = useState<"5m" | "15m" | "30m">("15m");
  const [rules, setRules] = useState<AlertRule[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("hx_alert_rules");
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          // fallback
        }
      }
    }
    return DEFAULT_ALERT_RULES;
  });

  const [trendHistory, setTrendHistory] = useState<TrendPoint[]>([]);
  const [copiedPrometheus, setCopiedPrometheus] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);

  // Sync alert rules to local storage
  const saveRules = (newRules: AlertRule[]) => {
    setRules(newRules);
    if (typeof window !== "undefined") {
      localStorage.setItem("hx_alert_rules", JSON.stringify(newRules));
    }
  };

  const rawMetrics = metricsQuery.data;
  const sysInfo = systemQuery.data;

  // Transform engine metrics into standardized snapshot
  const hostSnapshot: HostMetricsSnapshot = useMemo(() => {
    const sysMetrics = rawMetrics?.system;
    const cpu = Number(sysMetrics?.cpuUsagePercent ?? sysInfo?.cpu?.percent ?? 0);
    const totalMemMb = Number(sysMetrics?.memory?.totalMb ?? sysInfo?.memory?.total_mb ?? 12288);
    const usedMemMb = Number(sysMetrics?.memory?.usedMb ?? sysInfo?.memory?.used_mb ?? 0);
    const totalMem = totalMemMb * 1024 * 1024;
    const usedMem = usedMemMb * 1024 * 1024;
    const freeMem = Math.max(0, totalMem - usedMem);

    const totalDiskGb = Number(sysInfo?.disk?.total_gb ?? 100);
    const usedDiskGb = Number(sysInfo?.disk?.used_gb ?? 0);
    const totalDisk = totalDiskGb * 1024 * 1024 * 1024;
    const usedDisk = usedDiskGb * 1024 * 1024 * 1024;
    const freeDisk = Math.max(0, totalDisk - usedDisk);

    const loadAvg = sysMetrics?.loadAverage;

    return {
      cpuPercent: cpu,
      memoryTotalBytes: totalMem,
      memoryUsedBytes: usedMem,
      memoryFreeBytes: freeMem,
      diskTotalBytes: totalDisk,
      diskUsedBytes: usedDisk,
      diskFreeBytes: freeDisk,
      uptimeSeconds: Number(sysMetrics?.uptimeSeconds ?? sysInfo?.uptime ?? 0),
      loadAvg1m: Number(loadAvg?.["1m"] ?? 0),
      loadAvg5m: Number(loadAvg?.["5m"] ?? 0),
      loadAvg15m: Number(loadAvg?.["15m"] ?? 0),
    };
  }, [rawMetrics, sysInfo]);

  // Containers metrics mapped deterministically from real engine service telemetry when available
  const containerMetrics: ContainerMetric[] = useMemo(() => {
    const list = containersQuery.data || [];
    const services = rawMetrics?.services || {};
    return list.map((c, i) => {
      const name = (c.Names[0] || `container-${i}`).replace(/^\//, "");
      const svcKey = name.startsWith("hx_") ? name.slice(3).toLowerCase() : name.toLowerCase();
      const liveStats = services[svcKey]?.current || services[name]?.current;
      return {
        id: c.Id.slice(0, 12),
        name,
        status: (c.State === "running" ? "running" : "stopped") as any,
        cpuPercent: Number(liveStats?.cpuPercent ?? 0),
        memoryBytes: Number(liveStats?.memoryUsedMb ?? 0) * 1024 * 1024,
        memoryLimitBytes: Number(liveStats?.memoryLimitMb ?? 1024) * 1024 * 1024,
        restartCount: 0,
      };
    });
  }, [containersQuery.data, rawMetrics?.services]);

  // Edge mock/detected metrics
  const edgeMetrics: EdgeMetric[] = useMemo(() => {
    return [
      {
        domain: "control-plane.hosterax.local",
        requestsTotal: 1420,
        status2xx: 1400,
        status4xx: 18,
        status5xx: 2,
        latencyP50Ms: 14,
        latencyP95Ms: 38,
        latencyP99Ms: 85,
        sslDaysRemaining: 88,
      },
    ];
  }, []);

  // Rolling telemetry buffer for live charts
  useEffect(() => {
    if (isLivePaused) return;
    const now = new Date().toLocaleTimeString([], { hour12: false });
    const memPercent = Math.round(
      (hostSnapshot.memoryUsedBytes / (hostSnapshot.memoryTotalBytes || 1)) * 100,
    );
    const diskPercent = Math.round(
      (hostSnapshot.diskUsedBytes / (hostSnapshot.diskTotalBytes || 1)) * 100,
    );

    const point: TrendPoint = {
      time: now,
      cpu: hostSnapshot.cpuPercent,
      memory: memPercent,
      disk: diskPercent,
    };

    setTrendHistory((prev) => {
      const maxPoints = timeWindow === "5m" ? 30 : timeWindow === "15m" ? 60 : 120;
      return [...prev.slice(-(maxPoints - 1)), point];
    });
  }, [hostSnapshot, isLivePaused, timeWindow]);

  // Evaluate all alert rules
  const ruleEvaluations: AlertEvaluation[] = useMemo(() => {
    return rules.map((r) =>
      evaluateAlertRule(r, {
        host: hostSnapshot,
        containers: containerMetrics,
        edge: edgeMetrics,
      }),
    );
  }, [rules, hostSnapshot, containerMetrics, edgeMetrics]);

  const activeTriggeredAlerts = ruleEvaluations.filter((e) => e.triggered);

  // Generate Prometheus exposition format
  const prometheusText = useMemo(() => {
    return generatePrometheusMetrics(hostSnapshot, containerMetrics, edgeMetrics);
  }, [hostSnapshot, containerMetrics, edgeMetrics]);

  const prometheusConfigSnippet = `scrape_configs:
  - job_name: 'hosterax-node'
    scrape_interval: 15s
    scrape_timeout: 5s
    metrics_path: '/api/metrics'
    static_configs:
      - targets: ['${typeof window !== "undefined" ? window.location.host : "localhost:3000"}']
        labels:
          environment: 'production'
          role: 'hosterax-control-plane'`;

  // Toggle rule
  const handleToggleRule = (id: string) => {
    const updated = rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
    saveRules(updated);
    toast.info("Alert rule configuration updated");
  };

  // Test dispatch alert
  const handleTestAlertDispatch = async () => {
    const ok = await confirmAction({
      title: "Dispatch Synthetic Test Alert",
      description:
        "This will trigger a mock test alert and dispatch a warning payload across active notification channels and internal telemetry.",
      variant: "warning",
      confirmLabel: "Send Test Alert",
    });
    if (!ok) return;

    appLogger.log({
      id: `alert-test-${Date.now()}`,
      timestamp: Date.now(),
      category: "security",
      level: "warn",
      action: "Observability Alert Dispatched",
      message: "SYNTHETIC ALERT: CPU Exhaustion simulation triggered by operator",
      meta: { severity: "warning", node: "control-plane-master" },
    });
    toast.warning("Test Alert: Simulated alert notification dispatched to listeners.");
  };

  const handleCopyPrometheus = () => {
    navigator.clipboard.writeText(prometheusText);
    setCopiedPrometheus(true);
    setTimeout(() => setCopiedPrometheus(false), 2000);
    toast.success("Prometheus metrics copied to clipboard");
  };

  const handleCopyConfig = () => {
    navigator.clipboard.writeText(prometheusConfigSnippet);
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 2000);
    toast.success("Prometheus scrape config copied");
  };

  const memPercent = Math.round(
    (hostSnapshot.memoryUsedBytes / (hostSnapshot.memoryTotalBytes || 1)) * 100,
  );
  const diskPercent = Math.round(
    (hostSnapshot.diskUsedBytes / (hostSnapshot.diskTotalBytes || 1)) * 100,
  );

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LineChartIcon className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Observability &amp; Alert Rules
                </h1>
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live
                  Telemetry
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Node performance metrics, container telemetry, Prometheus exporter, and threshold
                alert rules.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleTestAlertDispatch}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
          >
            <Bell className="h-3.5 w-3.5 text-amber-400" />
            <span>Test Alert</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("prometheus")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>Prometheus Scraper</span>
          </button>
        </div>
      </div>

      {/* Triggered Alerts Banner */}
      {activeTriggeredAlerts.length > 0 && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
            <ShieldAlert className="h-4 w-4 animate-bounce" />
            <span>Active Triggered Threshold Alerts ({activeTriggeredAlerts.length})</span>
          </div>
          <div className="space-y-1.5">
            {activeTriggeredAlerts.map((a) => (
              <div
                key={a.ruleId}
                className="flex items-center justify-between text-xs bg-background/60 rounded-lg p-2.5 border border-destructive/20"
              >
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-destructive text-destructive-foreground">
                    {a.severity}
                  </span>
                  <span className="font-semibold text-foreground">{a.ruleName}:</span>
                  <span className="text-muted-foreground">{a.message}</span>
                </div>
                <span className="font-mono text-[11px] text-destructive">
                  Value: {a.currentValue} (Threshold: {a.threshold})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs Switcher */}
      <div className="flex items-center gap-2 border-b border-border pb-2 text-xs font-medium">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
            activeTab === "overview"
              ? "bg-primary text-primary-foreground font-semibold shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Activity className="h-3.5 w-3.5" />
          <span>Metrics &amp; Trend Charts</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("alerts")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
            activeTab === "alerts"
              ? "bg-primary text-primary-foreground font-semibold shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Bell className="h-3.5 w-3.5" />
          <span>Alert Rules ({rules.length})</span>
          {activeTriggeredAlerts.length > 0 && (
            <span className="ml-1 rounded-full bg-destructive px-1.5 py-0.2 text-[10px] text-destructive-foreground">
              {activeTriggeredAlerts.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("prometheus")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
            activeTab === "prometheus"
              ? "bg-primary text-primary-foreground font-semibold shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Terminal className="h-3.5 w-3.5" />
          <span>Prometheus Exposition</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("logs")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
            activeTab === "logs"
              ? "bg-primary text-primary-foreground font-semibold shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Activity className="h-3.5 w-3.5" />
          <span>System Logs Stream</span>
        </button>
      </div>

      {/* Tab: Overview & Live Charts */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Top 4 KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* CPU */}
            <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <div className="flex items-center justify-between text-muted-foreground text-xs">
                <span>Node CPU Utilization</span>
                <Cpu className="h-4 w-4 text-primary" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-foreground">
                  {hostSnapshot.cpuPercent}%
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  Load: {hostSnapshot.loadAvg1m.toFixed(2)} / {hostSnapshot.loadAvg5m.toFixed(2)}
                </span>
              </div>
              <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    hostSnapshot.cpuPercent > 85
                      ? "bg-rose-500"
                      : hostSnapshot.cpuPercent > 70
                        ? "bg-amber-500"
                        : "bg-primary"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(2, hostSnapshot.cpuPercent))}%` }}
                />
              </div>
            </div>

            {/* RAM */}
            <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <div className="flex items-center justify-between text-muted-foreground text-xs">
                <span>Memory Allocation</span>
                <Activity className="h-4 w-4 text-emerald-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-foreground">
                  {memPercent}%
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  {(hostSnapshot.memoryUsedBytes / (1024 * 1024 * 1024)).toFixed(1)} GB /{" "}
                  {(hostSnapshot.memoryTotalBytes / (1024 * 1024 * 1024)).toFixed(1)} GB
                </span>
              </div>
              <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    memPercent > 90
                      ? "bg-rose-500"
                      : memPercent > 75
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(2, memPercent))}%` }}
                />
              </div>
            </div>

            {/* Disk */}
            <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <div className="flex items-center justify-between text-muted-foreground text-xs">
                <span>Storage Volume</span>
                <HardDrive className="h-4 w-4 text-sky-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-foreground">
                  {diskPercent}%
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  {(hostSnapshot.diskUsedBytes / (1024 * 1024 * 1024)).toFixed(0)} GB /{" "}
                  {(hostSnapshot.diskTotalBytes / (1024 * 1024 * 1024)).toFixed(0)} GB
                </span>
              </div>
              <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-sky-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(2, diskPercent))}%` }}
                />
              </div>
            </div>

            {/* Containers */}
            <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <div className="flex items-center justify-between text-muted-foreground text-xs">
                <span>Fleet Containers</span>
                <Server className="h-4 w-4 text-amber-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-foreground">
                  {containerMetrics.length}
                </span>
                <span className="text-xs text-muted-foreground">managed services</span>
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {containerMetrics.filter((c) => c.status === "running").length} active
                </span>
                <span>·</span>
                <span>Uptime: {Math.round(hostSnapshot.uptimeSeconds / 3600)}h</span>
              </div>
            </div>
          </div>

          {/* Real-time Trend Area Chart */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-foreground">Real-Time Utilization Trends</h3>
                <p className="text-xs text-muted-foreground">
                  Rolling buffer with warning (70%) and critical (85%) threshold guide lines.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
                  {(["5m", "15m", "30m"] as const).map((win) => (
                    <button
                      key={win}
                      type="button"
                      onClick={() => setTimeWindow(win)}
                      className={`px-2.5 py-1 rounded-md transition-colors ${
                        timeWindow === win
                          ? "bg-card text-foreground font-semibold shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {win}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setIsLivePaused((p) => !p)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                    isLivePaused
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {isLivePaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                  <span>{isLivePaused ? "Resume" : "Pause"}</span>
                </button>
              </div>
            </div>

            <div className="h-[280px] w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={trendHistory}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="memGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="time" stroke="#71717a" fontSize={11} tickLine={false} />
                  <YAxis
                    domain={[0, 100]}
                    stroke="#71717a"
                    fontSize={11}
                    tickLine={false}
                    unit="%"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      border: "1px solid #27272a",
                      borderRadius: "8px",
                      fontSize: "12px",
                      color: "#f4f4f5",
                    }}
                  />
                  <ReferenceLine
                    y={70}
                    stroke="#f59e0b"
                    strokeDasharray="4 4"
                    label={{ value: "Warning (70%)", fill: "#f59e0b", fontSize: 10 }}
                  />
                  <ReferenceLine
                    y={85}
                    stroke="#f43f5e"
                    strokeDasharray="4 4"
                    label={{ value: "Critical (85%)", fill: "#f43f5e", fontSize: 10 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="cpu"
                    name="CPU Utilization"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#cpuGradient)"
                  />
                  <Area
                    type="monotone"
                    dataKey="memory"
                    name="Memory Allocation"
                    stroke="#10b981"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#memGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Alert Rules Manager */}
      {activeTab === "alerts" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground">Configured Threshold Rules</h3>
              <p className="text-xs text-muted-foreground">
                Rules are automatically evaluated against live node metrics and dispatch
                notifications upon threshold breach.
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="divide-y divide-border">
              {rules.map((rule) => {
                const evalResult = ruleEvaluations.find((e) => e.ruleId === rule.id);
                const isTriggered = evalResult?.triggered;

                return (
                  <div
                    key={rule.id}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 transition-colors ${
                      isTriggered ? "bg-destructive/5" : "hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className={`mt-0.5 p-2 rounded-lg border shrink-0 ${
                          isTriggered
                            ? "bg-destructive/15 text-destructive border-destructive/30"
                            : rule.severity === "critical"
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                              : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        }`}
                      >
                        {isTriggered ? (
                          <AlertTriangle className="h-4 w-4 animate-bounce" />
                        ) : (
                          <Bell className="h-4 w-4" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-foreground">{rule.name}</span>
                          <span
                            className={`text-[10px] font-bold uppercase px-1.5 py-0.2 rounded border ${
                              rule.severity === "critical"
                                ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
                                : "bg-amber-500/15 text-amber-400 border-amber-500/30"
                            }`}
                          >
                            {rule.severity}
                          </span>
                          {isTriggered ? (
                            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-destructive text-destructive-foreground">
                              TRIGGERED
                            </span>
                          ) : rule.enabled ? (
                            <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
                              PASSING
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.2 rounded">
                              DISABLED
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{rule.description}</p>
                        <div className="mt-1 flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
                          <span>
                            Condition: {rule.category.toUpperCase()} {rule.condition}{" "}
                            {rule.threshold}
                            {rule.unit}
                          </span>
                          <span>·</span>
                          <span>
                            Current value: {evalResult?.currentValue ?? 0}
                            {rule.unit}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() => handleToggleRule(rule.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          rule.enabled
                            ? "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border"
                            : "bg-primary text-primary-foreground hover:bg-primary/90"
                        }`}
                      >
                        {rule.enabled ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Prometheus Exposition */}
      {activeTab === "prometheus" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  Prometheus Exporter &amp; Scrape Configuration
                </h3>
                <p className="text-xs text-muted-foreground">
                  Standard Prometheus Text Format (v0.0.4) exposition ready for Prometheus, Grafana
                  Agent, VictoriaMetrics, or Datadog.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyPrometheus}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs"
                >
                  {copiedPrometheus ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>Copy Metrics</span>
                </button>
              </div>
            </div>

            {/* Prometheus scrape config */}
            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  Recommended prometheus.yml scrape job:
                </span>
                <button
                  type="button"
                  onClick={handleCopyConfig}
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  {copiedConfig ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  <span>{copiedConfig ? "Copied" : "Copy YAML"}</span>
                </button>
              </div>
              <pre className="p-3 rounded-lg bg-[#0d0e12] border border-border/80 font-mono text-[11px] text-zinc-300 overflow-x-auto">
                {prometheusConfigSnippet}
              </pre>
            </div>

            {/* Raw Prometheus Text Exposition Preview */}
            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  Live Exposition Output Preview (/api/metrics):
                </span>
                <span className="text-[10px] font-mono">Format: text/plain; version=0.0.4</span>
              </div>
              <pre className="p-4 rounded-lg bg-[#0d0e12] border border-border/80 font-mono text-[11px] text-emerald-400/90 overflow-x-auto max-h-[380px] overflow-y-auto leading-relaxed">
                {prometheusText}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Live System Logs Stream */}
      {activeTab === "logs" && <SystemLogsPanel />}
    </div>
  );
}
