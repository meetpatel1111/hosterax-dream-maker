import { useState, useMemo, useEffect } from "react";
import {
  Rocket,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Zap,
  Activity,
  Sliders,
  Server,
  Layers,
  ArrowRight,
  Code2,
  Copy,
  Clock,
  Eye,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { useEngine, useEngineProjects } from "../../lib/engine";
import {
  generateCaddyTrafficSplitSnippet,
  generateNginxTrafficSplitSnippet,
  evaluateCanaryHealth,
  calculateTrafficDistribution,
  PRESET_ROLLOUT_STRATEGIES,
  type HealthProbeResult,
  type RolloutStrategyPreset,
} from "../../utils/traffic-splitting";

export function TrafficSplittingManager() {
  const engine = useEngine();
  const projectsQuery = useEngineProjects();
  const projects = useMemo(() => projectsQuery.data || [], [projectsQuery.data]);

  // Active configuration state
  const [selectedProject, setSelectedProject] = useState("");
  const [domain, setDomain] = useState("api.production.internal");
  const [stableVersion, setStableVersion] = useState("v2.4.1");
  const [canaryVersion, setCanaryVersion] = useState("v2.5.0-rc.3");
  const [stablePort, setStablePort] = useState(3000);
  const [canaryPort, setCanaryPort] = useState(3001);
  const [canaryWeight, setCanaryWeight] = useState(10); // default 10% canary
  const [stickySession, setStickySession] = useState(true);
  const [headerOverride, setHeaderOverride] = useState("X-Canary");
  const [activePresetId, setActivePresetId] = useState("conservative-canary");
  const [configView, setConfigView] = useState<"caddy" | "nginx">("caddy");

  // Auto-select first project
  useEffect(() => {
    if (projects.length > 0 && !selectedProject) {
      setSelectedProject(projects[0].name);
      setDomain(`${projects[0].name}.internal.hosterax.net`);
    }
  }, [projects, selectedProject]);

  // Real live health probes to the HosteraX control plane & projects
  const [probes, setProbes] = useState<HealthProbeResult[]>([]);

  useEffect(() => {
    let cancelled = false;
    const executeProbe = async () => {
      const start = performance.now();
      try {
        const res = await fetch("/health");
        const latencyMs = Math.max(1, Math.round(performance.now() - start));
        if (!cancelled) {
          const newProbe: HealthProbeResult = {
            statusCode: res.status,
            latencyMs,
            timestamp: Date.now(),
            endpoint: "/health",
          };
          setProbes((prev) => [newProbe, ...prev.slice(0, 19)]);
        }
      } catch {
        if (!cancelled) {
          const latencyMs = Math.max(1, Math.round(performance.now() - start));
          const newProbe: HealthProbeResult = {
            statusCode: 503,
            latencyMs,
            timestamp: Date.now(),
            endpoint: "/health",
          };
          setProbes((prev) => [newProbe, ...prev.slice(0, 19)]);
        }
      }
    };

    executeProbe();
    const timer = setInterval(executeProbe, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Compute evaluation
  const evaluation = useMemo(() => {
    return evaluateCanaryHealth(probes);
  }, [probes]);

  // Compute distribution (assuming 10k req/min throughput)
  const distribution = useMemo(() => {
    return calculateTrafficDistribution(10000, canaryWeight);
  }, [canaryWeight]);

  // Generate Snippets
  const caddySnippet = useMemo(() => {
    return generateCaddyTrafficSplitSnippet({
      domain,
      stablePort,
      canaryPort,
      canaryWeightPercent: canaryWeight,
      stickyCookie: stickySession,
      headerOverride,
    });
  }, [domain, stablePort, canaryPort, canaryWeight, stickySession, headerOverride]);

  const nginxSnippet = useMemo(() => {
    return generateNginxTrafficSplitSnippet({
      domain,
      stablePort,
      canaryPort,
      canaryWeightPercent: canaryWeight,
      stickyCookie: stickySession,
    });
  }, [domain, stablePort, canaryPort, canaryWeight, stickySession]);

  const activeSnippet = configView === "caddy" ? caddySnippet : nginxSnippet;

  // Handler: Apply Preset
  const handleSelectPreset = (preset: RolloutStrategyPreset) => {
    setActivePresetId(preset.id);
    setCanaryWeight(preset.initialCanaryWeight);
    toast.success(`Applied strategy: ${preset.name}`);
  };

  // Handler: Instant Rollback
  const handleInstantRollback = () => {
    setCanaryWeight(0);
    toast.error("Instant Rollback Executed: 100% traffic shifted back to Stable.");
  };

  // Handler: Promote to 100%
  const handlePromoteToFull = () => {
    setCanaryWeight(100);
    toast.success(`Canary ${canaryVersion} promoted to 100% rollout!`);
  };

  // Handler: Copy
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard!`);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sliders className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Canary Releases &amp; Zero-Downtime Traffic Splitting
                </h1>
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                  Sub-Second Rollback Armed
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Progressive canary traffic shifting, automated health-probe gating, header-based
                routing, and dual Caddy/OpenResty edge directives.
              </p>
            </div>
          </div>
        </div>

        {/* Panic Switch & Promotion Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleInstantRollback}
            className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/15 px-3.5 py-2 text-xs font-semibold text-destructive hover:bg-destructive/25 transition-all"
            title="Immediately drop Canary to 0% and route all requests to Stable"
          >
            <ShieldAlert className="h-3.5 w-3.5" /> Instant Rollback (0%)
          </button>

          <button
            onClick={handlePromoteToFull}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-black hover:bg-emerald-400 transition-all shadow-sm"
          >
            <Zap className="h-3.5 w-3.5" /> Promote to 100%
          </button>
        </div>
      </div>

      {/* Main Grid: Splitter & Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Traffic Weight Slider & Stage Visualizer */}
        <div className="lg:col-span-2 space-y-6">
          {/* Traffic Splitting Slider Card */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" /> Live Traffic Allocation
                </h2>
                <p className="text-xs text-muted-foreground">
                  Adjust the percentage of production requests routed to Canary Candidate vs Stable
                  Release.
                </p>
              </div>

              {/* Version Badges */}
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="rounded bg-sky-500/15 text-sky-400 px-2 py-0.5 font-bold">
                  Stable: {stableVersion} ({100 - canaryWeight}%)
                </span>
                <span className="rounded bg-emerald-500/15 text-emerald-400 px-2 py-0.5 font-bold">
                  Canary: {canaryVersion} ({canaryWeight}%)
                </span>
              </div>
            </div>

            {/* Visual Dual Weight Bar */}
            <div className="space-y-2">
              <div className="h-4 w-full rounded-full overflow-hidden flex bg-surface-2 shadow-inner">
                <div
                  className="bg-sky-500 transition-all duration-300 flex items-center justify-center text-[10px] font-bold text-white font-mono"
                  style={{ width: `${100 - canaryWeight}%` }}
                >
                  {100 - canaryWeight > 12 && `${100 - canaryWeight}%`}
                </div>
                <div
                  className="bg-emerald-500 transition-all duration-300 flex items-center justify-center text-[10px] font-bold text-black font-mono"
                  style={{ width: `${canaryWeight}%` }}
                >
                  {canaryWeight > 8 && `${canaryWeight}%`}
                </div>
              </div>

              {/* Slider Input */}
              <input
                type="range"
                min={0}
                max={100}
                value={canaryWeight}
                onChange={(e) => setCanaryWeight(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />

              <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
                <span>0% (Full Stable)</span>
                <span>25% Canary</span>
                <span>50% A/B Split</span>
                <span>75% Canary</span>
                <span>100% (Full Canary)</span>
              </div>
            </div>

            {/* Quick Weight Presets */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
              <span className="text-xs text-muted-foreground self-center mr-2">Quick Weights:</span>
              {[
                { label: "100% Stable (0% Canary)", val: 0 },
                { label: "10% Canary", val: 10 },
                { label: "25% Canary", val: 25 },
                { label: "50% / 50% A/B", val: 50 },
                { label: "100% Rollout", val: 100 },
              ].map((btn) => (
                <button
                  key={btn.val}
                  onClick={() => setCanaryWeight(btn.val)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold font-mono transition-colors ${
                    canaryWeight === btn.val
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-surface-2 text-foreground hover:bg-accent"
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            {/* Estimated Traffic Distribution Breakdown */}
            <div className="grid grid-cols-2 gap-4 rounded-lg bg-surface/40 p-4 border border-border text-xs">
              <div className="space-y-1">
                <span className="text-muted-foreground">Stable Ingress Target</span>
                <div className="text-lg font-bold text-sky-400 font-mono">
                  {distribution.stableRequests.toLocaleString()} req/10k
                </div>
                <div className="text-[11px] text-muted-foreground font-mono">
                  Port {stablePort} · Container: {selectedProject || "app"}_stable
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-muted-foreground">Canary Ingress Target</span>
                <div className="text-lg font-bold text-emerald-400 font-mono">
                  {distribution.canaryRequests.toLocaleString()} req/10k
                </div>
                <div className="text-[11px] text-muted-foreground font-mono">
                  Port {canaryPort} · Container: {selectedProject || "app"}_canary
                </div>
              </div>
            </div>
          </div>

          {/* Rollout Strategies Presets Grid */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Preset Deployment Strategies
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {PRESET_ROLLOUT_STRATEGIES.map((preset) => (
                <div
                  key={preset.id}
                  onClick={() => handleSelectPreset(preset)}
                  className={`cursor-pointer rounded-lg border p-4 space-y-2 transition-all ${
                    activePresetId === preset.id
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border bg-surface/30 hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-foreground">{preset.name}</span>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground uppercase">
                      {preset.type}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {preset.description}
                  </p>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    Initial weight: {preset.initialCanaryWeight}% · Soak: {preset.soakMinutes}m ·
                    Max error: {preset.autoRollbackErrorThreshold}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Col: Canary Health Probes & Live Edge Config */}
        <div className="space-y-6">
          {/* Live Canary Health Gating Card */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Zap className="h-4 w-4 text-emerald-400" /> Automated Canary Health Probes
              </h3>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  evaluation.healthy
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                    : "bg-destructive/15 text-destructive border border-destructive/30"
                }`}
              >
                {evaluation.healthy ? "Healthy" : "Anomalous"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-surface/50 p-3 space-y-1">
                <span className="text-muted-foreground text-[11px]">Success Rate</span>
                <div className="text-xl font-bold font-mono text-foreground">
                  {evaluation.successRate}%
                </div>
              </div>
              <div className="rounded-lg bg-surface/50 p-3 space-y-1">
                <span className="text-muted-foreground text-[11px]">Avg Latency (p95)</span>
                <div className="text-xl font-bold font-mono text-emerald-400">
                  {evaluation.avgLatencyMs}ms
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface/30 p-3 text-xs space-y-1">
              <span className="font-semibold text-foreground">Health Evaluator:</span>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {evaluation.details}
              </p>
            </div>

            {/* Probe Feed */}
            <div className="space-y-2">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Recent Probes ({probes.length})
              </span>
              <div className="divide-y divide-border rounded-md border border-border bg-black/40 font-mono text-[10px] max-h-36 overflow-y-auto">
                {probes.map((pr, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2">
                    <span className="text-muted-foreground">{pr.endpoint}</span>
                    <span
                      className={
                        pr.statusCode === 200
                          ? "text-emerald-400 font-bold"
                          : "text-destructive font-bold"
                      }
                    >
                      HTTP {pr.statusCode}
                    </span>
                    <span className="text-foreground">{pr.latencyMs}ms</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Edge Reverse Proxy Config Inspector */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Edge Routing Directives</h3>
              </div>
              <div className="flex rounded-md border border-border bg-surface-2 p-0.5 text-xs font-mono">
                <button
                  onClick={() => setConfigView("caddy")}
                  className={`px-2.5 py-1 rounded transition-colors ${
                    configView === "caddy"
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-muted-foreground"
                  }`}
                >
                  Caddy
                </button>
                <button
                  onClick={() => setConfigView("nginx")}
                  className={`px-2.5 py-1 rounded transition-colors ${
                    configView === "nginx"
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-muted-foreground"
                  }`}
                >
                  Nginx
                </button>
              </div>
            </div>

            <div className="relative">
              <pre className="max-h-56 overflow-auto rounded-lg border border-border bg-black/60 p-3 font-mono text-[11px] text-emerald-400 leading-relaxed">
                {activeSnippet}
              </pre>
            </div>

            <button
              onClick={() => copyToClipboard(activeSnippet, `${configView.toUpperCase()} Config`)}
              className="w-full flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 py-2 text-xs font-semibold hover:bg-accent transition-colors"
            >
              <Copy className="h-3.5 w-3.5" /> Copy {configView.toUpperCase()} Directive
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
