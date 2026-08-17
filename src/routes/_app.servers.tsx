import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Cpu,
  Server,
  Plus,
  Loader2,
  Terminal,
  Activity,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  HardDrive,
  Copy,
  Check,
  Zap,
  Globe,
  Radio,
} from "lucide-react";
import { useEngine, useServerNodes, type ServerNode } from "@/lib/engine";
import { AddServerDialog } from "@/components/hx/add-server-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/servers")({
  head: () => ({ meta: [{ title: "Servers — HosteraX" }] }),
  component: ServersPage,
});

function ServersPage() {
  const engine = useEngine();
  const [showAddModal, setShowAddModal] = useState(false);
  const [bootstrapServer, setBootstrapServer] = useState<ServerNode | null>(null);
  const [bootstrapScript, setBootstrapScript] = useState("");
  const [copiedBootstrap, setCopiedBootstrap] = useState(false);
  const [pingingId, setPingingId] = useState<string | null>(null);

  const { data: servers = [], isLoading, refetch } = useServerNodes();

  const totalServers = servers.length;
  const onlineServers = servers.filter((s) => s.status === "online").length;
  const totalCores = servers.reduce((acc, s) => acc + (s.cpu_cores || 1), 0);
  const totalRamGb = Math.round(servers.reduce((acc, s) => acc + (s.total_ram_mb || 0), 0) / 1024);

  async function handlePingTest(server: ServerNode) {
    setPingingId(server.id);
    try {
      const res: any = await engine.call("POST", `/api/servers/${server.id}/test`);
      if (res.ok) {
        toast.success(`Server "${server.name}" ping: ${res.latencyMs}ms (${res.message})`);
      } else {
        toast.error(`Ping failed: ${res.message}`);
      }
      refetch();
    } catch (e: any) {
      toast.error(e.message || "Failed to ping server");
    } finally {
      setPingingId(null);
    }
  }

  async function handleOpenBootstrap(server: ServerNode) {
    setBootstrapServer(server);
    try {
      const res = await fetch(`${engine.url}/api/servers/${server.id}/bootstrap`, {
        headers: { authorization: `Bearer ${engine.token}` },
      });
      const text = await res.text();
      setBootstrapScript(text);
    } catch {
      setBootstrapScript("#!/bin/bash\ncurl -fsSL https://get.docker.com | sh\n");
    }
  }

  async function handleDeleteServer(server: ServerNode) {
    if (server.id === "local") {
      toast.error("Cannot delete local master node.");
      return;
    }
    if (!confirm(`Are you sure you want to remove compute node "${server.name}" (${server.host})?`)) return;
    try {
      await engine.call("DELETE", `/api/servers/${server.id}`);
      toast.success(`Server node "${server.name}" removed.`);
      refetch();
    } catch (e: any) {
      toast.error(e.message || "Failed to delete server");
    }
  }

  function handleCopyBootstrap() {
    navigator.clipboard.writeText(bootstrapScript);
    setCopiedBootstrap(true);
    toast.success("Bootstrap script copied to clipboard!");
    setTimeout(() => setCopiedBootstrap(false), 2000);
  }

  return (
    <div className="space-y-8 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/50 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs font-mono">
              <Zap className="w-3 h-3 mr-1" /> Multi-Node Infrastructure
            </Badge>
            <span className="text-xs text-muted-foreground">Phase 2 Parity</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
            Compute Nodes & Servers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage local and remote VPS compute nodes, run agentless SSH health checks, and bootstrap remote Docker instances.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm" onClick={() => setShowAddModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Server Node
          </Button>
        </div>
      </div>

      {/* Cluster Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cluster Nodes</span>
            <Server className="w-4 h-4 text-primary" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono">{onlineServers}</span>
            <span className="text-xs text-muted-foreground">/ {totalServers} online</span>
          </div>
        </div>

        <div className="rounded-xl border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Compute</span>
            <Cpu className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono">{totalCores}</span>
            <span className="text-xs text-muted-foreground">CPU cores</span>
          </div>
        </div>

        <div className="rounded-xl border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total RAM Pool</span>
            <HardDrive className="w-4 h-4 text-sky-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono">{totalRamGb} GB</span>
            <span className="text-xs text-muted-foreground">available</span>
          </div>
        </div>

        <div className="rounded-xl border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Architecture</span>
            <Radio className="w-4 h-4 text-purple-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-base font-bold font-mono text-purple-400">Agentless SSH</span>
            <span className="text-xs text-muted-foreground">Zero Overhead</span>
          </div>
        </div>
      </div>

      {/* Servers Grid */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">Registered Compute Nodes</h2>
        {isLoading ? (
          <div className="flex justify-center p-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center rounded-xl border border-dashed bg-card/40">
            <Server className="mb-2 h-10 w-10 text-muted-foreground/30" />
            <p className="font-semibold text-base">No Servers Connected</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">Add your first target VPS node to start deploying applications remotely.</p>
            <Button size="sm" onClick={() => setShowAddModal(true)}>
              <Plus className="w-4 h-4 mr-2" /> Add Server Node
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {servers.map((server) => (
              <div key={server.id} className="rounded-xl border bg-card/60 p-5 shadow-sm space-y-4 hover:border-primary/40 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {server.type === "local" ? <Cpu className="h-5 w-5" /> : <Server className="h-5 w-5" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{server.name}</span>
                        {server.is_default ? (
                          <Badge variant="secondary" className="text-[10px] py-0 px-1.5 font-mono">Master</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-mono">Remote VPS</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">
                        {server.host}:{server.port} · {server.os_info || "Linux"}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {server.status === "online" && (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" /> Online
                      </span>
                    )}
                    {server.status === "provisioning" && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-400 font-medium bg-amber-500/10 px-2 py-0.5 rounded-full">
                        <RefreshCw className="w-3 h-3 animate-spin" /> Provisioning
                      </span>
                    )}
                    {server.status === "unreachable" && (
                      <span className="inline-flex items-center gap-1 text-xs text-rose-400 font-medium bg-rose-500/10 px-2 py-0.5 rounded-full">
                        <XCircle className="w-3 h-3" /> Unreachable
                      </span>
                    )}
                  </div>
                </div>

                {/* Telemetry Gauges */}
                <div className="grid grid-cols-3 gap-2 bg-muted/20 p-3 rounded-lg text-xs font-mono">
                  <div>
                    <span className="text-muted-foreground text-[10px] block">CPU ({server.cpu_cores || 1} Cores)</span>
                    <span className="font-semibold text-foreground">{server.cpu_usage_pct || 5}%</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-[10px] block">RAM ({Math.round((server.total_ram_mb || 4096) / 1024)} GB)</span>
                    <span className="font-semibold text-foreground">{server.ram_usage_pct || 25}%</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-[10px] block">Containers</span>
                    <span className="font-semibold text-foreground">{server.containers_count || 0} active</span>
                  </div>
                </div>

                {/* Docker & SSH Badges */}
                <div className="flex items-center justify-between text-xs pt-1 border-t border-border/40">
                  <span className="font-mono text-muted-foreground text-[11px]">
                    {server.docker_version || "Docker Engine"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {server.type === "remote" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs px-2"
                        onClick={() => handleOpenBootstrap(server)}
                      >
                        <Terminal className="w-3 h-3 mr-1" /> Bootstrap Script
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs px-2"
                      disabled={pingingId === server.id}
                      onClick={() => handlePingTest(server)}
                    >
                      <Activity className={`w-3 h-3 mr-1 ${pingingId === server.id ? "animate-spin" : ""}`} />
                      Ping
                    </Button>
                    {server.id !== "local" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteServer(server)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bootstrap Script Modal */}
      <Dialog open={!!bootstrapServer} onOpenChange={(open) => !open && setBootstrapServer(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-primary" />
              Bootstrap Compute Node: {bootstrapServer?.name}
            </DialogTitle>
            <DialogDescription>
              Run this one-line command via SSH on your target VPS to install Docker Engine, configure networking, and register with HosteraX.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="relative">
              <pre className="p-3.5 rounded-lg bg-muted/60 font-mono text-xs text-foreground overflow-x-auto whitespace-pre-wrap max-h-60">
                {bootstrapScript}
              </pre>
            </div>
            <div className="p-3 rounded-lg border bg-muted/20 text-xs text-muted-foreground">
              Tip: SSH into your server with <code className="font-mono bg-muted px-1 py-0.5 rounded">ssh {bootstrapServer?.username || "root"}@{bootstrapServer?.host}</code> and paste the script above.
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBootstrapServer(null)}>
              Close
            </Button>
            <Button onClick={handleCopyBootstrap}>
              {copiedBootstrap ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
              {copiedBootstrap ? "Copied!" : "Copy One-Line Script"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddServerDialog open={showAddModal} onOpenChange={setShowAddModal} />
    </div>
  );
}
