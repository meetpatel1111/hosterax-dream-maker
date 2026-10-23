import React, { useState } from "react";
import {
  Globe,
  Shield,
  Server,
  Database,
  HardDrive,
  Cpu,
  Wifi,
  Activity,
  Zap,
  Moon,
  Sun,
  RefreshCw,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { formatMagicDnsUrl, useScaleToZero, useEngine, useBackups } from "@/lib/engine";
import { toast } from "sonner";

interface ServiceTopologyGraphProps {
  project: any;
  activeProvider?: string;
  lanIp?: string | null;
}

export function ServiceTopologyGraph({
  project,
  activeProvider = "sslip.io",
  lanIp,
}: ServiceTopologyGraphProps) {
  const engine = useEngine();
  const { data: scaleZero, refetch: refetchScaleZero } = useScaleToZero(project?.name || "");
  const [selectedNode, setSelectedNode] = useState<string | null>("app");
  const [isWaking, setIsWaking] = useState(false);
  const [isSleeping, setIsSleeping] = useState(false);

  const projectName = project?.name || "app";
  const port = project?.port || 8080;
  const containerName = `hx_${projectName.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

  const { data: edge } = useQuery({
    queryKey: ["edge-status", engine.url],
    queryFn: () =>
      engine.call<{ provider: string; containerStatus: string; activeSslCertificates: number }>(
        "GET",
        "/api/edge/status",
      ),
    refetchInterval: 15000,
    retry: false,
  });
  const { data: heal } = useQuery({
    queryKey: ["self-heal-status", engine.url],
    queryFn: () => engine.call<any>("GET", "/api/self-heal/status"),
    refetchInterval: 5000,
    retry: false,
  });
  const { data: backups = [] } = useBackups(undefined, projectName);
  const health = heal?.projects?.[projectName];
  const providerLabel =
    edge?.provider === "openresty"
      ? "OpenResty"
      : edge?.provider === "external"
        ? "External proxy"
        : "Caddy 2";
  const edgeRunning = edge?.containerStatus === "running";
  const volumeNote = backups.length
    ? `${backups.filter((b) => b.status === "completed").length} snapshot(s)`
    : "No snapshots yet";
  const magicHost = formatMagicDnsUrl(projectName, activeProvider);
  const isSuspended = scaleZero?.isSleeping;

  async function handleToggleSleep() {
    if (isSuspended) {
      setIsWaking(true);
      try {
        const res = await engine.call<any>("POST", `/api/projects/${projectName}/wake`);
        if (res.ok) {
          toast.success(`Woke ${projectName} in ${res.wakeDurationMs || 800}ms!`);
          refetchScaleZero();
        }
      } catch (e: any) {
        toast.error(e.message || "Failed to wake container");
      } finally {
        setIsWaking(false);
      }
    } else {
      setIsSleeping(true);
      try {
        const res = await engine.call<any>("POST", `/api/projects/${projectName}/sleep`);
        if (res.ok) {
          toast.success(`${projectName} suspended (Scale-to-Zero active)`);
          refetchScaleZero();
        }
      } catch (e: any) {
        toast.error(e.message || "Failed to sleep container");
      } finally {
        setIsSleeping(false);
      }
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card/60 backdrop-blur-sm p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <div className="font-semibold text-sm flex items-center gap-2">
              <span>Application Service Topology & Dependency Mesh</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Real-time interactive data flow, edge ingress, and container dependency topology.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {scaleZero?.enabled && (
            <button
              onClick={handleToggleSleep}
              disabled={isWaking || isSleeping}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
                isSuspended
                  ? "bg-amber-950/40 border-amber-800/50 text-amber-300 hover:bg-amber-900/50"
                  : "bg-surface-2 hover:bg-surface-3 border-border text-foreground"
              }`}
            >
              {isSuspended ? (
                <>
                  <Sun className="h-3.5 w-3.5 text-amber-400 animate-spin" />
                  <span>Wake Container ({projectName})</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Suspend to Zero RAM</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Visual Interactive Graph Canvas */}
      <div className="relative overflow-hidden rounded-xl border border-border/70 bg-gradient-to-br from-background/90 via-card/40 to-background/90 p-6">
        {/* Subtle grid background */}
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(#fff 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />

        {/* Nodes Grid Layout */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 relative z-10">
          {/* Node 1: Ingress */}
          <div
            onClick={() => setSelectedNode("ingress")}
            className={`cursor-pointer rounded-xl border p-4 transition-all ${
              selectedNode === "ingress"
                ? "border-primary bg-primary/10 shadow-md shadow-primary/5"
                : "border-border/80 bg-card/70 hover:border-border"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Globe className="h-4 w-4 text-sky-400" />
                <span>1. Public & LAN Ingress</span>
              </div>
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div className="space-y-1 text-[11px] font-mono text-muted-foreground">
              <div className="truncate">https://{magicHost}</div>
              {lanIp && (
                <div className="text-emerald-400 truncate">
                  http://{lanIp}:{port}
                </div>
              )}
            </div>
          </div>

          {/* Node 2: Edge Gateway */}
          <div
            onClick={() => setSelectedNode("edge")}
            className={`cursor-pointer rounded-xl border p-4 transition-all ${
              selectedNode === "edge"
                ? "border-primary bg-primary/10 shadow-md shadow-primary/5"
                : "border-border/80 bg-card/70 hover:border-border"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Shield className="h-4 w-4 text-violet-400" />
                <span>2. {providerLabel} edge</span>
              </div>
              <span className="text-[10px] font-mono text-violet-400 bg-violet-950/50 px-1 rounded">
                {edgeRunning ? "running" : "stopped"}
              </span>
            </div>
            <div className="space-y-1 text-[11px] font-mono text-muted-foreground">
              <div>Port 80 & 443 ➔ : {port}</div>
              <div
                className={`flex items-center gap-1 ${edgeRunning ? "text-emerald-400" : "text-amber-400"}`}
              >
                {edgeRunning ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <AlertCircle className="h-3 w-3" />
                )}
                {edgeRunning
                  ? `${edge?.activeSslCertificates ?? 0} active certificate(s)`
                  : "Edge container not running"}
              </div>
            </div>
          </div>

          {/* Node 3: Core Service Container */}
          <div
            onClick={() => setSelectedNode("app")}
            className={`cursor-pointer rounded-xl border p-4 transition-all ${
              selectedNode === "app"
                ? "border-primary bg-primary/10 shadow-md shadow-primary/5"
                : "border-border/80 bg-card/70 hover:border-border"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Server className="h-4 w-4 text-primary" />
                <span className="truncate">{projectName}</span>
              </div>
              {isSuspended ? (
                <span className="text-[9px] font-semibold text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/40">
                  SLEEPING
                </span>
              ) : (
                <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </div>
            <div className="space-y-1 text-[11px] font-mono text-muted-foreground">
              <div>Container: {containerName}</div>
              <div className="text-foreground font-semibold">Port: :{port} (HTTP)</div>
            </div>
          </div>

          {/* Node 4: Attached Database & Storage */}
          <div
            onClick={() => setSelectedNode("storage")}
            className={`cursor-pointer rounded-xl border p-4 transition-all ${
              selectedNode === "storage"
                ? "border-primary bg-primary/10 shadow-md shadow-primary/5"
                : "border-border/80 bg-card/70 hover:border-border"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <HardDrive className="h-4 w-4 text-emerald-400" />
                <span>4. Volumes & Persistence</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/50 px-1 rounded">
                volumes
              </span>
            </div>
            <div className="space-y-1 text-[11px] font-mono text-muted-foreground">
              <div>Volumes: hx_vol_{projectName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_*</div>
              <div className="text-muted-foreground">Backups: {volumeNote}</div>
            </div>
          </div>
        </div>

        {/* Selected Node Deep Inspector */}
        <div className="mt-4 pt-4 border-t border-border/50 text-xs flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-primary" />
            <span>
              {selectedNode === "ingress" &&
                "Ingress: Direct TCP/HTTP traffic load balanced across loopback and local Wi-Fi interfaces."}
              {selectedNode === "edge" &&
                "Edge Gateway: reverse proxy that routes hostnames to this container; certificates come from Let's Encrypt (public domains) or a local CA."}
              {selectedNode === "app" &&
                `Application Service: container on the Docker bridge network, supervised by the self-healing watchdog.`}
              {selectedNode === "storage" &&
                "Persistence: named Docker volumes; snapshots are created from the Backups wizard or a scheduled backup job and can be replicated to S3."}
            </span>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span
              className={`font-medium ${
                health?.status === "healthy"
                  ? "text-emerald-400"
                  : health
                    ? "text-amber-400"
                    : "text-muted-foreground"
              }`}
            >
              Health: {health?.status ?? "not probed yet"}
            </span>
            <span>•</span>
            <span>
              Latency:{" "}
              {health?.latencyMs != null && health.latencyMs > 0 ? `${health.latencyMs} ms` : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
