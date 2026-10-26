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
  ShieldCheck,
  KeyRound,
  AlertTriangle,
} from "lucide-react";
import { useEngine, useServerNodes, type HostKeyScan, type ServerNode } from "@/lib/engine";
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
  const [trustServer, setTrustServer] = useState<ServerNode | null>(null);
  const [scan, setScan] = useState<HostKeyScan | null>(null);
  const [scanError, setScanError] = useState("");
  const [trusting, setTrusting] = useState(false);

  const { data: servers = [], isLoading, refetch } = useServerNodes();

  const totalServers = servers.length;
  const onlineServers = servers.filter((s) => s.status === "online").length;
  const readyServers = servers.filter((s) => s.ready).length;
  const totalCores = servers.reduce((acc, s) => acc + (s.cpu_cores || 0), 0);
  const totalRamGb = Math.round(servers.reduce((acc, s) => acc + (s.total_ram_mb || 0), 0) / 1024);
  const hasUnknownSpecs = servers.some((s) => !s.cpu_cores || !s.total_ram_mb);

  async function handlePingTest(server: ServerNode) {
    setPingingId(server.id);
    try {
      const res: any = await engine.call("POST", `/api/servers/${server.id}/test`);
      if (res.ok) {
        toast.success(res.message);
      } else {
        toast.error(res.message || "The connection check failed");
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
    setBootstrapScript("");
    try {
      const res = await fetch(`${engine.url}/api/servers/${server.id}/bootstrap`, {
        credentials: "omit",
        headers: engine.token ? { authorization: `Bearer ${engine.token}` } : {},
      });
      if (!res.ok) throw new Error(`The engine answered ${res.status}`);
      setBootstrapScript(await res.text());
    } catch (e: any) {
      setBootstrapServer(null);
      toast.error(`Could not load the bootstrap script: ${e.message || "engine unreachable"}`);
    }
  }

  async function openTrust(server: ServerNode) {
    setTrustServer(server);
    setScan(null);
    setScanError("");
    try {
      setScan(await engine.call<HostKeyScan>("GET", `/api/servers/${server.id}/host-key`));
    } catch (e: any) {
      setScanError(e.message || "The server did not answer");
    }
  }

  async function confirmTrust() {
    if (!trustServer || !scan) return;
    setTrusting(true);
    try {
      await engine.call("POST", `/api/servers/${trustServer.id}/host-key`, {
        fingerprint: scan.keys[0].fingerprint,
        replace: Boolean(scan.pinned),
      });
      toast.success("Host key confirmed. Checking the connection…");
      const name = trustServer.name;
      setTrustServer(null);
      const res: any = await engine.call("POST", `/api/servers/${trustServer.id}/test`);
      if (res.ok) toast.success(res.message);
      else toast.error(res.message || `Could not connect to ${name}`);
      refetch();
    } catch (e: any) {
      toast.error(e.message || "Could not confirm the host key");
    } finally {
      setTrusting(false);
    }
  }

  async function handleDeleteServer(server: ServerNode) {
    if (server.id === "local") {
      toast.error("Cannot delete local master node.");
      return;
    }
    if (!confirm(`Are you sure you want to remove compute node "${server.name}" (${server.host})?`))
      return;
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
            <Badge
              variant="outline"
              className="bg-primary/10 text-primary border-primary/20 text-xs font-mono"
            >
              <Zap className="w-3 h-3 mr-1" /> Multi-Node Infrastructure
            </Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
            Compute Nodes & Servers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Add a VPS, confirm its host key, and choose it when you create a project: the app is
            built and run there over SSH, with nothing to install on the server except Docker. The
            app is only reachable through HosteraX, never on the server's public address.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
            onClick={() => setShowAddModal(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Server Node
          </Button>
        </div>
      </div>

      {/* Cluster Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Cluster Nodes
            </span>
            <Server className="w-4 h-4 text-primary" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono">{onlineServers}</span>
            <span className="text-xs text-muted-foreground">/ {totalServers} online</span>
          </div>
        </div>

        <div className="rounded-xl border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total Compute
            </span>
            <Cpu className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono">{totalCores || "—"}</span>
            <span className="text-xs text-muted-foreground">
              CPU cores{hasUnknownSpecs ? " (remote specs unknown)" : ""}
            </span>
          </div>
        </div>

        <div className="rounded-xl border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total RAM Pool
            </span>
            <HardDrive className="w-4 h-4 text-sky-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono">
              {totalRamGb ? `${totalRamGb} GB` : "—"}
            </span>
            <span className="text-xs text-muted-foreground">
              {hasUnknownSpecs ? "known nodes only" : "installed"}
            </span>
          </div>
        </div>

        <div className="rounded-xl border bg-card/60 p-4 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Deploy targets
            </span>
            <Radio className="w-4 h-4 text-purple-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-purple-400">{readyServers}</span>
            <span className="text-xs text-muted-foreground">ready for deploys</span>
          </div>
        </div>
      </div>

      {/* Servers Grid */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
          Registered Compute Nodes
        </h2>
        {isLoading ? (
          <div className="flex justify-center p-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center rounded-xl border border-dashed bg-card/40">
            <Server className="mb-2 h-10 w-10 text-muted-foreground/30" />
            <p className="font-semibold text-base">No Servers Connected</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Add a VPS to run projects on it over SSH.
            </p>
            <Button size="sm" onClick={() => setShowAddModal(true)}>
              <Plus className="w-4 h-4 mr-2" /> Add Server Node
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {servers.map((server) => (
              <div
                key={server.id}
                className="rounded-xl border bg-card/60 p-5 shadow-sm space-y-4 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {server.type === "local" ? (
                        <Cpu className="h-5 w-5" />
                      ) : (
                        <Server className="h-5 w-5" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{server.name}</span>
                        {server.is_default ? (
                          <Badge variant="secondary" className="text-[10px] py-0 px-1.5 font-mono">
                            Master
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-mono">
                            Remote VPS
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">
                        {server.type === "local" ? "this machine" : `${server.host}:${server.port}`}{" "}
                        · {server.os_info || "OS unknown"}
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
                        <KeyRound className="w-3 h-3" />{" "}
                        {server.host_key_pinned ? "Not connected yet" : "Confirm host key"}
                      </span>
                    )}
                    {server.status === "unreachable" && (
                      <span className="inline-flex items-center gap-1 text-xs text-rose-400 font-medium bg-rose-500/10 px-2 py-0.5 rounded-full">
                        <XCircle className="w-3 h-3" /> Unreachable
                      </span>
                    )}
                    {server.status === "error" && (
                      <span className="inline-flex items-center gap-1 text-xs text-rose-400 font-medium bg-rose-500/10 px-2 py-0.5 rounded-full">
                        <AlertTriangle className="w-3 h-3" /> Needs attention
                      </span>
                    )}
                  </div>
                </div>

                {/* Telemetry Gauges */}
                <div className="grid grid-cols-3 gap-2 bg-muted/20 p-3 rounded-lg text-xs font-mono">
                  <div>
                    <span className="text-muted-foreground text-[10px] block">
                      CPU ({server.cpu_cores ? `${server.cpu_cores} cores` : "unknown"})
                    </span>
                    <span className="font-semibold text-foreground">
                      {server.type === "local" ? `${Math.round(server.cpu_usage_pct || 0)}%` : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-[10px] block">
                      RAM (
                      {server.total_ram_mb
                        ? `${Math.round(server.total_ram_mb / 1024)} GB`
                        : "unknown"}
                      )
                    </span>
                    <span className="font-semibold text-foreground">
                      {server.type === "local" ? `${Math.round(server.ram_usage_pct || 0)}%` : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-[10px] block">Containers</span>
                    <span className="font-semibold text-foreground">
                      {server.type === "local" || server.status === "online"
                        ? `${server.containers_count || 0} active`
                        : "—"}
                    </span>
                  </div>
                </div>

                {server.type === "remote" && server.last_error && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-300">
                    {server.last_error}
                  </div>
                )}
                {server.type === "remote" && server.public_key && !server.ready && (
                  <div className="rounded-lg border bg-muted/20 p-3 text-xs space-y-1.5">
                    <div className="text-muted-foreground">
                      Add this key to <code className="font-mono">~/.ssh/authorized_keys</code> for{" "}
                      <code className="font-mono">{server.username}</code> on the server (the
                      bootstrap script does it for you):
                    </div>
                    <div className="flex items-start gap-2">
                      <code className="font-mono text-[10px] break-all flex-1">
                        {server.public_key}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => {
                          navigator.clipboard.writeText(server.public_key || "");
                          toast.success("Public key copied");
                        }}
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                )}
                {server.type === "remote" && server.host_key_pinned && (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono">
                    <ShieldCheck className="w-3 h-3 text-emerald-400" />
                    {server.host_key_type} · {server.host_key_fingerprint}
                  </div>
                )}

                {/* Docker & SSH Badges */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1 border-t border-border/40">
                  <span className="font-mono text-muted-foreground text-[11px]">
                    {server.docker_version || "Docker version unknown"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {server.type === "remote" && (
                      <Button
                        variant={server.host_key_pinned ? "ghost" : "default"}
                        size="sm"
                        className="h-7 text-xs px-2"
                        onClick={() => openTrust(server)}
                      >
                        <ShieldCheck className="w-3 h-3 mr-1" />
                        {server.host_key_pinned ? "Host key" : "Confirm host key"}
                      </Button>
                    )}
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
                      <Activity
                        className={`w-3 h-3 mr-1 ${pingingId === server.id ? "animate-spin" : ""}`}
                      />
                      Test
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
              Review this script, then run it over SSH on the target VPS as root. It installs Docker
              Engine and lets this server's SSH key log in; it does not connect back to HosteraX.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="relative">
              <pre className="p-3.5 rounded-lg bg-muted/60 font-mono text-xs text-foreground overflow-x-auto whitespace-pre-wrap max-h-60">
                {bootstrapScript || "Loading…"}
              </pre>
            </div>
            <div className="p-3 rounded-lg border bg-muted/20 text-xs text-muted-foreground">
              Tip: SSH into your server with{" "}
              <code className="font-mono bg-muted px-1 py-0.5 rounded">
                ssh {bootstrapServer?.username || "root"}@{bootstrapServer?.host}
              </code>{" "}
              and paste the script above.
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBootstrapServer(null)}>
              Close
            </Button>
            <Button onClick={handleCopyBootstrap}>
              {copiedBootstrap ? (
                <Check className="w-4 h-4 mr-1" />
              ) : (
                <Copy className="w-4 h-4 mr-1" />
              )}
              {copiedBootstrap ? "Copied!" : "Copy One-Line Script"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Host key confirmation */}
      <Dialog open={!!trustServer} onOpenChange={(open) => !open && setTrustServer(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Confirm the identity of {trustServer?.name}
            </DialogTitle>
            <DialogDescription>
              HosteraX only logs in to a server whose host key you have confirmed, and refuses it if
              the key ever changes. Compare the fingerprint below with your provider's console, or
              with the output of{" "}
              <code className="font-mono">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code> on
              the server.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {!scan && !scanError && (
              <div className="flex justify-center p-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {scanError && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-300">
                {scanError}
              </div>
            )}
            {scan && (
              <>
                <div className="text-xs text-muted-foreground">
                  {scan.host}:{scan.port} presents:
                </div>
                <div className="rounded-lg bg-muted/60 p-3 font-mono text-xs space-y-1">
                  {scan.keys.map((k) => (
                    <div key={k.fingerprint} className="break-all">
                      <span className="text-muted-foreground">{k.type}</span> {k.fingerprint}
                    </div>
                  ))}
                </div>
                {scan.pinned && (
                  <div
                    className={`rounded-lg border p-3 text-xs ${
                      scan.changed
                        ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                        : "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                    }`}
                  >
                    {scan.changed ? (
                      <>
                        <strong>The key has changed.</strong> The confirmed key{" "}
                        <span className="font-mono">{scan.pinned.fingerprint}</span> is no longer
                        presented. That is expected if you reinstalled the server; otherwise someone
                        may be intercepting the connection. Only confirm if you can verify the new
                        fingerprint.
                      </>
                    ) : (
                      <>
                        Already confirmed:{" "}
                        <span className="font-mono">{scan.pinned.fingerprint}</span>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTrustServer(null)}>
              Cancel
            </Button>
            <Button
              disabled={!scan || trusting || (!!scan.pinned && !scan.changed)}
              onClick={confirmTrust}
            >
              {trusting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              {scan?.pinned ? "Replace and confirm" : "The fingerprint matches"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddServerDialog open={showAddModal} onOpenChange={setShowAddModal} />
    </div>
  );
}
