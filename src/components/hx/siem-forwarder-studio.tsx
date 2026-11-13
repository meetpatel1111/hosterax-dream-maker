import { useState, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio, Plus, Send, Trash2, Copy, Check, Code2, Server, Layers } from "lucide-react";
import {
  type SiemSinkType,
  PRESET_SIEM_SINKS,
  formatRfc5424Syslog,
  formatDatadogLog,
  formatSplunkHecEvent,
  formatGrafanaLokiPayload,
} from "@/utils/siem-forwarder";
import { type LogEntry } from "@/utils/app-logger";
import { useEngine, useActiveOrgId } from "@/lib/engine";
import { confirmAction } from "@/components/hx/confirm-modal";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type BackendSiemSink = {
  id: string;
  org_id: string;
  name: string;
  provider: string;
  endpoint: string;
  min_level: string;
  filter_source: string;
  enabled: boolean;
  batch_size: number;
  last_delivery_at?: number | null;
  last_error?: string | null;
  hasApiKey: boolean;
  created_at: number;
};

type BackendSiemDelivery = {
  id: string;
  sink_id: string;
  status_code: number;
  ok: boolean;
  events_count: number;
  latency_ms: number;
  error?: string | null;
  created_at: number;
};

function toBackendProvider(type: SiemSinkType): string {
  switch (type) {
    case "splunk_hec":
      return "splunk";
    case "grafana_loki":
      return "loki";
    case "syslog_rfc5424":
      return "syslog";
    default:
      return "datadog";
  }
}

function fromBackendProvider(provider: string): SiemSinkType {
  switch (String(provider).toLowerCase()) {
    case "splunk":
    case "splunk_hec":
      return "splunk_hec";
    case "loki":
    case "grafana_loki":
      return "grafana_loki";
    case "syslog":
    case "syslog_rfc5424":
      return "syslog_rfc5424";
    default:
      return "datadog";
  }
}

export function SiemForwarderStudio() {
  const engine = useEngine();
  const orgId = useActiveOrgId();
  const qc = useQueryClient();

  const modalSinkNameId = useId();
  const modalEndpointId = useId();
  const modalApiKeyId = useId();

  const { data: sinks = [], isLoading } = useQuery<BackendSiemSink[]>({
    queryKey: ["siem-sinks", engine.url, engine.token, orgId],
    queryFn: () => engine.call<BackendSiemSink[]>("GET", "/api/siem/sinks"),
  });

  const { data: deliveries = [] } = useQuery<BackendSiemDelivery[]>({
    queryKey: ["siem-deliveries", engine.url, engine.token, orgId],
    queryFn: () => engine.call<BackendSiemDelivery[]>("GET", "/api/siem/deliveries"),
    refetchInterval: 10000,
  });

  const [activeTab, setActiveTab] = useState<"sinks" | "inspector" | "setup">("sinks");
  const [modalOpen, setModalOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const [newSinkName, setNewSinkName] = useState("");
  const [newSinkType, setNewSinkType] = useState<SiemSinkType>("datadog");
  const [newEndpoint, setNewEndpoint] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newMinLevel, setNewMinLevel] = useState<"debug" | "info" | "warn" | "error">("info");
  const [inspectorSinkId, setInspectorSinkId] = useState<string>("");

  const handleCopy = (text: string, label: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success(`${label} copied to clipboard!`);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleApplyPreset = (preset: (typeof PRESET_SIEM_SINKS)[0]) => {
    setNewSinkName(preset.name);
    setNewSinkType(preset.type);
    setNewEndpoint(preset.endpoint);
    setNewMinLevel(preset.minLevel);
    toast.info(`Loaded template defaults for ${preset.name}`);
  };

  const handleCreateSink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSinkName.trim() || !newEndpoint.trim()) {
      toast.error("Name and endpoint URL are required.");
      return;
    }

    await engine.call("POST", "/api/siem/sinks", {
      name: newSinkName.trim(),
      provider: toBackendProvider(newSinkType),
      endpoint: newEndpoint.trim(),
      apiKey: newApiKey.trim() || undefined,
      minLevel: newMinLevel.toUpperCase(),
      enabled: true,
    });
    await qc.invalidateQueries({ queryKey: ["siem-sinks"] });
    setModalOpen(false);
    setNewSinkName("");
    setNewEndpoint("");
    setNewApiKey("");
    setNewMinLevel("info");
    toast.success("SIEM forwarding sink created");
  };

  const handleToggleSink = async (sink: BackendSiemSink) => {
    await engine.call("PATCH", `/api/siem/sinks/${encodeURIComponent(sink.id)}`, {
      enabled: !sink.enabled,
    });
    await qc.invalidateQueries({ queryKey: ["siem-sinks"] });
    toast.success(`Sink "${sink.name}" is now ${!sink.enabled ? "active" : "paused"}`);
  };

  const handleDeleteSink = async (sink: BackendSiemSink) => {
    const ok = await confirmAction({
      title: `Delete SIEM Sink "${sink.name}"`,
      description: `Remove outbound log forwarder targeting ${sink.endpoint}?`,
      variant: "destructive",
      confirmLabel: "Delete Sink",
    });
    if (!ok) return;
    await engine.call("DELETE", `/api/siem/sinks/${encodeURIComponent(sink.id)}`);
    await qc.invalidateQueries({ queryKey: ["siem-sinks"] });
    await qc.invalidateQueries({ queryKey: ["siem-deliveries"] });
    toast.success(`Removed sink "${sink.name}"`);
  };

  const handleSendTestAudit = async (sink: BackendSiemSink) => {
    setTestingId(sink.id);
    try {
      await engine.call("POST", `/api/siem/sinks/${encodeURIComponent(sink.id)}/test`, {});
      toast.success(`Delivered test audit event to "${sink.name}"`);
    } catch (err: any) {
      toast.error(`Delivery failed for "${sink.name}": ${err?.message || "Endpoint unreachable"}`);
    } finally {
      await qc.invalidateQueries({ queryKey: ["siem-deliveries"] });
      await qc.invalidateQueries({ queryKey: ["siem-sinks"] });
      setTestingId(null);
    }
  };

  const selectedSink = sinks.find((s) => s.id === inspectorSinkId) || sinks[0] || null;
  const selectedSinkType: SiemSinkType = selectedSink
    ? fromBackendProvider(selectedSink.provider)
    : "datadog";

  const sampleLog: LogEntry = {
    id: "sample_log_demo",
    timestamp: Date.now(),
    category: "api",
    level: "info",
    action: "ENGINE_CONTAINER_DEPLOY",
    message: "Container image deployed to HosteraX runtime successfully",
    method: "POST",
    path: "/api/deployments/deploy",
    status: 200,
    durationMs: 34,
    meta: { container: "web-api" },
  };

  let formattedSample = "";
  if (selectedSinkType === "syslog_rfc5424") {
    formattedSample = formatRfc5424Syslog(sampleLog);
  } else if (selectedSinkType === "datadog") {
    formattedSample = JSON.stringify(formatDatadogLog(sampleLog), null, 2);
  } else if (selectedSinkType === "splunk_hec") {
    formattedSample = JSON.stringify(formatSplunkHecEvent(sampleLog), null, 2);
  } else if (selectedSinkType === "grafana_loki") {
    formattedSample = JSON.stringify(formatGrafanaLokiPayload(sampleLog), null, 2);
  }

  const activeSinksCount = sinks.filter((s) => s.enabled).length;
  const okDeliveriesCount = deliveries.filter((d) => d.ok).length;

  return (
    <div className="w-full space-y-6" data-testid="siem-forwarder-studio">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/80 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <Radio className="h-5 w-5 text-primary" />
              SIEM &amp; Syslog Log Forwarding
            </h2>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary border border-primary/20">
              Engine Dispatched
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Server-side control plane audit forwarding to Datadog, Splunk HEC, Grafana Loki, or
            HTTP webhook receivers.
          </p>
        </div>

        <button
          type="button"
          data-testid="btn-add-siem-sink"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          Add SIEM Sink
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-card p-3.5 space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase">
            Configured Sinks
          </span>
          <div className="text-xl font-bold tracking-tight">{sinks.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3.5 space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase">
            Active Forwarders
          </span>
          <div className="text-xl font-bold tracking-tight text-emerald-400">
            {activeSinksCount}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3.5 space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase">
            Successful Deliveries
          </span>
          <div className="text-xl font-bold tracking-tight text-primary">{okDeliveriesCount}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3.5 space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground uppercase">
            Protocol Standards
          </span>
          <div className="text-xs font-mono font-semibold text-muted-foreground pt-1">
            RFC 5424 · HEC · Logs V2
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("sinks")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer",
            activeTab === "sinks"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Layers className="h-4 w-4" />
          Forwarding Sinks ({sinks.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("inspector")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer",
            activeTab === "inspector"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Code2 className="h-4 w-4" />
          Delivery Log &amp; Payload Format ({deliveries.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("setup")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer",
            activeTab === "setup"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Server className="h-4 w-4" />
          Collector Setup Guides
        </button>
      </div>

      {activeTab === "sinks" && (
        <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
          {isLoading ? (
            <div className="col-span-full p-8 text-center text-xs text-muted-foreground">
              Loading SIEM forwarding sinks...
            </div>
          ) : sinks.length === 0 ? (
            <div className="col-span-full rounded-xl border border-dashed border-border p-10 text-center space-y-2">
              <p className="text-sm font-semibold text-foreground">No SIEM sinks configured</p>
              <p className="text-xs text-muted-foreground">
                Add a Datadog, Splunk, Grafana Loki, or webhook collector sink to stream real
                control-plane audit events.
              </p>
            </div>
          ) : (
            sinks.map((sink) => (
              <div
                key={sink.id}
                className={cn(
                  "rounded-lg border bg-card p-5 space-y-4 shadow-sm transition-all",
                  sink.enabled ? "border-border hover:border-border/80" : "border-muted opacity-70",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center flex-wrap gap-2">
                      <h3 className="text-sm font-semibold tracking-tight">{sink.name}</h3>
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 text-[10px] font-mono font-semibold uppercase",
                          sink.enabled
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {sink.enabled ? "Active" : "Paused"}
                      </span>
                      <span className="rounded bg-secondary/80 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                        {sink.provider}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground font-mono truncate max-w-sm">
                      <span className="truncate">{sink.endpoint}</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(sink.endpoint, "Endpoint", `end-${sink.id}`)}
                        aria-label="Copy Endpoint"
                        className="text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                      >
                        {copiedKey === `end-${sink.id}` ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={testingId === sink.id}
                      onClick={() => handleSendTestAudit(sink)}
                      className="inline-flex items-center gap-1 rounded border border-primary/30 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Send className="h-3 w-3" />
                      {testingId === sink.id ? "Sending..." : "Test"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleSink(sink)}
                      className={cn(
                        "rounded px-2 py-1 text-[11px] font-medium border transition-colors cursor-pointer",
                        sink.enabled
                          ? "border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                          : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10",
                      )}
                    >
                      {sink.enabled ? "Pause" : "Resume"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSink(sink)}
                      aria-label={`Delete ${sink.name}`}
                      className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 rounded bg-muted/40 p-2.5 text-[11px] font-mono border border-border/50">
                  <div>
                    <span className="text-muted-foreground">Min Level:</span>
                    <div className="text-foreground font-semibold uppercase">{sink.min_level}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">API Key:</span>
                    <div className="text-foreground font-semibold">
                      {sink.hasApiKey ? "Configured" : "None"}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last Delivery:</span>
                    <div className="text-muted-foreground truncate">
                      {sink.last_delivery_at
                        ? new Date(sink.last_delivery_at).toLocaleTimeString()
                        : "Never"}
                    </div>
                  </div>
                </div>
                {sink.last_error && (
                  <div className="text-[11px] font-mono text-rose-400 bg-rose-500/5 border border-rose-500/20 rounded px-2.5 py-1.5">
                    Last Error: {sink.last_error}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "inspector" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Payload Format Preview</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Wire format transmitted by the engine for the selected sink provider.
                </p>
              </div>
              {sinks.length > 0 && (
                <select
                  aria-label="Select sink for payload inspector"
                  value={selectedSink?.id || ""}
                  onChange={(e) => setInspectorSinkId(e.target.value)}
                  className="rounded-md border border-input bg-card px-2.5 py-1 text-xs font-mono text-foreground outline-none cursor-pointer"
                >
                  {sinks.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.provider})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="relative">
              <pre className="rounded bg-muted/60 p-3 text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all max-h-96">
                {formattedSample}
              </pre>
              <button
                type="button"
                onClick={() => handleCopy(formattedSample, "Payload Sample", "sample-payload")}
                className="absolute top-2 right-2 rounded bg-secondary px-2 py-1 text-[10px] font-mono text-secondary-foreground hover:bg-secondary/80 flex items-center gap-1 cursor-pointer"
              >
                {copiedKey === "sample-payload" ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                Copy
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Persisted Delivery Attempts</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Real outbound HTTP delivery results recorded by the engine.
                </p>
              </div>
              <span className="text-[11px] text-muted-foreground font-mono">
                {deliveries.length} records
              </span>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {deliveries.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  No delivery attempts recorded yet. Click &quot;Test&quot; on a configured sink.
                </div>
              ) : (
                deliveries.map((del) => (
                  <div
                    key={del.id}
                    className="rounded border border-border/60 bg-muted/30 p-2.5 text-xs font-mono space-y-1"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span
                        className={
                          del.ok ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"
                        }
                      >
                        HTTP {del.status_code} · {del.ok ? "Delivered" : "Failed"} (
                        {del.events_count} evt · {del.latency_ms}ms)
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(del.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    {del.error && <div className="text-[10px] text-rose-400">{del.error}</div>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "setup" && (
        <div className="rounded-lg border border-border bg-card p-6 space-y-6">
          <div className="border-b border-border/80 pb-4">
            <h3 className="text-base font-semibold">Collector Quick-Start Configuration</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Reference configuration snippets for downstream syslog and Datadog log agents.
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <pre className="rounded bg-muted/60 p-3 text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre">
              {`# Receive HosteraX RFC 5424 logs\nmodule(load="imudp")\ninput(type="imudp" port="514")`}
            </pre>
            <pre className="rounded bg-muted/60 p-3 text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre">
              {`logs:\n  - type: tcp\n    port: 10518\n    service: hosterax-control-plane\n    source: hosterax`}
            </pre>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border/80 pb-3">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Radio className="h-5 w-5 text-primary" />
                Configure New SIEM Forwarding Sink
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Quick Template
              </span>
              <div className="flex flex-wrap gap-2">
                {PRESET_SIEM_SINKS.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className="rounded border border-border bg-muted/30 px-2 py-1 text-xs text-foreground hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleCreateSink} className="space-y-4">
              <div>
                <label
                  htmlFor={modalSinkNameId}
                  className="block text-xs font-medium text-foreground"
                >
                  Sink Name *
                </label>
                <input
                  id={modalSinkNameId}
                  type="text"
                  required
                  value={newSinkName}
                  onChange={(e) => setNewSinkName(e.target.value)}
                  placeholder="e.g. Corporate Datadog Ingest"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <span className="block text-xs font-medium text-foreground">Sink Type</span>
                <select
                  aria-label="Select Sink Type"
                  value={newSinkType}
                  onChange={(e) => setNewSinkType(e.target.value as SiemSinkType)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  <option value="datadog">Datadog Logs API (HTTP v2)</option>
                  <option value="splunk_hec">Splunk HTTP Event Collector (HEC)</option>
                  <option value="grafana_loki">Grafana Loki Push Stream API</option>
                  <option value="syslog_rfc5424">Syslog Webhook / RFC 5424</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor={modalEndpointId}
                  className="block text-xs font-medium text-foreground"
                >
                  Collector Ingestion Endpoint URL *
                </label>
                <input
                  id={modalEndpointId}
                  type="url"
                  required
                  value={newEndpoint}
                  onChange={(e) => setNewEndpoint(e.target.value)}
                  placeholder="https://http-intake.logs.datadoghq.com/api/v2/logs"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label
                  htmlFor={modalApiKeyId}
                  className="block text-xs font-medium text-foreground"
                >
                  API Key / Token (Optional)
                </label>
                <input
                  id={modalApiKeyId}
                  type="password"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder="DD-API-KEY or Splunk HEC Token"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <span className="block text-xs font-medium text-foreground">
                  Minimum Severity Level
                </span>
                <select
                  aria-label="Select Minimum Severity Level"
                  value={newMinLevel}
                  onChange={(e) => setNewMinLevel(e.target.value as any)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  <option value="debug">DEBUG</option>
                  <option value="info">INFO</option>
                  <option value="warn">WARN</option>
                  <option value="error">ERROR</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-border/80">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 cursor-pointer shadow-sm"
                >
                  Save Forwarder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
