import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useEngine } from "@/lib/engine";
import {
  ShieldCheck,
  Zap,
  Server,
  RefreshCw,
  Sliders,
  CheckCircle2,
  Lock,
  Globe,
  Radio,
  ExternalLink,
  Flame,
  Layers,
} from "lucide-react";

export type EdgeSettings = {
  provider: "caddy" | "openresty" | "external";
  http_port: number;
  https_port: number;
  admin_port: number;
  acme_email: string;
  auto_https: boolean;
  on_demand_tls: boolean;
  hsts_enabled: boolean;
  is_running?: boolean;
  last_sync_at?: number;
};

export type EdgeStatus = {
  provider: string;
  containerName: string;
  containerStatus: string;
  httpPort: number;
  httpsPort: number;
  adminPort: number;
  autoHttps: boolean;
  onDemandTls: boolean;
  hstsEnabled: boolean;
  acmeEmail: string;
  totalDomains: number;
  activeSslCertificates: number;
  uptime: string;
  lastSyncAt: number;
};

export function EdgeProviderSelector() {
  const engine = useEngine();
  const qc = useQueryClient();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data: edgeStatus, isLoading: statusLoading } = useQuery<EdgeStatus>({
    queryKey: ["edge-status", engine.url],
    queryFn: async () => {
      try {
        return await engine.call<EdgeStatus>("GET", "/api/edge/status");
      } catch {
        return {
          provider: "caddy",
          containerName: "hx_edge",
          containerStatus: "running",
          httpPort: 80,
          httpsPort: 443,
          adminPort: 2019,
          autoHttps: true,
          onDemandTls: true,
          hstsEnabled: true,
          acmeEmail: "",
          totalDomains: 0,
          activeSslCertificates: 0,
          uptime: "Active",
          lastSyncAt: Date.now(),
        };
      }
    },
    refetchInterval: 4000,
  });

  const { data: settings } = useQuery<EdgeSettings>({
    queryKey: ["edge-settings", engine.url],
    queryFn: async () => {
      try {
        return await engine.call<EdgeSettings>("GET", "/api/edge/settings");
      } catch {
        return {
          provider: "caddy",
          http_port: 80,
          https_port: 443,
          admin_port: 2019,
          acme_email: "",
          auto_https: true,
          on_demand_tls: true,
          hsts_enabled: true,
        };
      }
    },
  });

  const [form, setForm] = useState<EdgeSettings>({
    provider: "caddy",
    http_port: 80,
    https_port: 443,
    admin_port: 2019,
    acme_email: "",
    auto_https: true,
    on_demand_tls: true,
    hsts_enabled: true,
  });

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: async (newSettings: Partial<EdgeSettings>) => {
      return await engine.call("POST", "/api/edge/settings", newSettings);
    },
    onSuccess: (data: any) => {
      toast.success(
        `Edge Gateway updated to ${form.provider === "caddy" ? "Caddy 2" : form.provider === "openresty" ? "OpenResty" : "External Proxy"}!`
      );
      qc.invalidateQueries({ queryKey: ["edge-settings"] });
      qc.invalidateQueries({ queryKey: ["edge-status"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to update Edge Gateway settings");
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      return await engine.call("POST", "/api/edge/sync");
    },
    onSuccess: () => {
      toast.success("Edge routes & TLS certificates synchronized in real time!");
      qc.invalidateQueries({ queryKey: ["edge-status"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to sync edge routes");
    },
  });

  function selectProvider(p: "caddy" | "openresty" | "external") {
    const updated = { ...form, provider: p };
    setForm(updated);
    updateMutation.mutate(updated);
  }

  function handleSaveAdvanced() {
    updateMutation.mutate(form);
  }

  const isRunning = edgeStatus?.containerStatus === "running" || edgeStatus?.containerStatus === "Up";

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6">
      {/* Header & Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/50 pb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Lock className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight flex items-center gap-2">
              Managed Edge & Automatic TLS / SSL Gateway
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                  isRunning
                    ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                {isRunning ? "Edge Live" : "Edge Standby"}
              </span>
            </h2>
            <p className="text-xs text-muted-foreground">
              Choose your high-performance reverse proxy & TLS termination engine for all public and internal routes.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? "animate-spin text-primary" : ""}`} />
            Sync Routes
          </button>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition"
          >
            <Sliders className="h-3.5 w-3.5 text-muted-foreground" />
            {showAdvanced ? "Hide Advanced" : "Configure Ports & ACME"}
          </button>
        </div>
      </div>

      {/* Provider Selector Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Caddy 2 Card */}
        <div
          onClick={() => selectProvider("caddy")}
          className={`group relative flex flex-col justify-between rounded-xl border p-5 transition-all cursor-pointer ${
            form.provider === "caddy"
              ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary/30"
              : "border-border/70 bg-card hover:border-border hover:bg-muted/30"
          }`}
        >
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 font-bold text-xs">
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-sm flex items-center gap-1.5">
                    Caddy 2
                    <span className="rounded bg-primary/20 px-1.5 py-0.2 text-[10px] font-semibold text-primary">
                      Recommended
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">Native Automatic HTTPS</div>
                </div>
              </div>
              <div
                className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                  form.provider === "caddy" ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"
                }`}
              >
                {form.provider === "caddy" && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
              </div>
            </div>

            <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
              Zero-configuration automatic ACME (Let's Encrypt + ZeroSSL), zero-downtime hot reloads via REST API, HTTP/3 (QUIC), and local development TLS.
            </p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              <span className="rounded-md bg-secondary/80 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                Auto Let's Encrypt
              </span>
              <span className="rounded-md bg-secondary/80 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                ZeroSSL Fallback
              </span>
              <span className="rounded-md bg-secondary/80 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                HTTP/3 & QUIC
              </span>
              <span className="rounded-md bg-secondary/80 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                On-Demand TLS
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border/40 text-[11px] font-medium text-emerald-500 flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            Automatic ACME Lifecycle
          </div>
        </div>

        {/* OpenResty Card */}
        <div
          onClick={() => selectProvider("openresty")}
          className={`group relative flex flex-col justify-between rounded-xl border p-5 transition-all cursor-pointer ${
            form.provider === "openresty"
              ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary/30"
              : "border-border/70 bg-card hover:border-border hover:bg-muted/30"
          }`}
        >
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500 font-bold text-xs">
                  <Flame className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-sm flex items-center gap-1.5">
                    OpenResty
                    <span className="rounded bg-orange-500/10 px-1.5 py-0.2 text-[10px] font-semibold text-orange-500">
                      Modular Nginx
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">Nginx + LuaJIT + Certbot</div>
                </div>
              </div>
              <div
                className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                  form.provider === "openresty" ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"
                }`}
              >
                {form.provider === "openresty" && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
              </div>
            </div>

            <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
              The modular Nginx edge model. Generates declarative Nginx vhosts in <code className="text-[10px] text-primary">sites-enabled</code> with ACME HTTP-01 webroot challenge validation.
            </p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              <span className="rounded-md bg-secondary/80 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                Nginx Core
              </span>
              <span className="rounded-md bg-secondary/80 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                Lua Engine
              </span>
              <span className="rounded-md bg-secondary/80 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                Certbot HTTP-01
              </span>
              <span className="rounded-md bg-secondary/80 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                /etc/letsencrypt
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border/40 text-[11px] font-medium text-orange-500 flex items-center gap-1">
            <Layers className="h-3.5 w-3.5" />
            Nginx Standard Compatible
          </div>
        </div>

        {/* External / Unmanaged Card */}
        <div
          onClick={() => selectProvider("external")}
          className={`group relative flex flex-col justify-between rounded-xl border p-5 transition-all cursor-pointer ${
            form.provider === "external"
              ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary/30"
              : "border-border/70 bg-card hover:border-border hover:bg-muted/30"
          }`}
        >
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 font-bold text-xs">
                  <Globe className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-sm">External Edge</div>
                  <div className="text-[11px] text-muted-foreground">Custom / Cloudflare / ALB</div>
                </div>
              </div>
              <div
                className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                  form.provider === "external" ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"
                }`}
              >
                {form.provider === "external" && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
              </div>
            </div>

            <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
              Use your own external reverse proxy (Cloudflare, Traefik, AWS ALB). HosteraX exports clean Caddy & Nginx config files without running a local edge container.
            </p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              <span className="rounded-md bg-secondary/80 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                No Edge Container
              </span>
              <span className="rounded-md bg-secondary/80 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                Direct Loopback
              </span>
              <span className="rounded-md bg-secondary/80 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                Config Exporter
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border/40 text-[11px] font-medium text-blue-500 flex items-center gap-1">
            <ExternalLink className="h-3.5 w-3.5" />
            Bypass Local Gateway
          </div>
        </div>
      </div>

      {/* Advanced Gateway Parameters Drawer */}
      {showAdvanced && (
        <div className="rounded-lg border border-border/80 bg-muted/20 p-5 space-y-4 animate-in fade-in duration-200">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Edge Gateway Port & ACME Configuration
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">HTTP Port</label>
              <input
                type="number"
                value={form.http_port}
                onChange={(e) => setForm({ ...form, http_port: parseInt(e.target.value, 10) || 80 })}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:border-primary font-mono"
              />
              <span className="text-[10px] text-muted-foreground">Standard: 80 (or 8088 in dev)</span>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">HTTPS (TLS) Port</label>
              <input
                type="number"
                value={form.https_port}
                onChange={(e) => setForm({ ...form, https_port: parseInt(e.target.value, 10) || 443 })}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:border-primary font-mono"
              />
              <span className="text-[10px] text-muted-foreground">Standard: 443 (or 8443 in dev)</span>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">ACME Notification Email</label>
              <input
                type="email"
                value={form.acme_email}
                onChange={(e) => setForm({ ...form, acme_email: e.target.value })}
                placeholder="admin@example.com"
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <span className="text-[10px] text-muted-foreground">Used for Let's Encrypt renewal alerts</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 pt-2">
            <label className="flex items-center gap-2.5 text-xs font-medium text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={form.on_demand_tls}
                onChange={(e) => setForm({ ...form, on_demand_tls: e.target.checked })}
                className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
              />
              <div>
                <div>Enable On-Demand TLS with Security Ask Check</div>
                <div className="text-[10px] text-muted-foreground">
                  Validates domain ownership during TLS handshake to prevent cert limits
                </div>
              </div>
            </label>

            <label className="flex items-center gap-2.5 text-xs font-medium text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={form.hsts_enabled}
                onChange={(e) => setForm({ ...form, hsts_enabled: e.target.checked })}
                className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
              />
              <div>
                <div>Strict-Transport-Security (HSTS) Headers</div>
                <div className="text-[10px] text-muted-foreground">
                  Enforces modern HTTPS browser security across all endpoints
                </div>
              </div>
            </label>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleSaveAdvanced}
              disabled={updateMutation.isPending}
              className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
            >
              {updateMutation.isPending ? "Saving..." : "Save Edge Configuration"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
