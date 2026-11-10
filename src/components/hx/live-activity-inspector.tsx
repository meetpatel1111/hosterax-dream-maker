import { useState, useEffect, useMemo, useRef } from "react";
import {
  Activity,
  X,
  Search,
  Filter,
  Download,
  Trash2,
  Copy,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Pause,
  Play,
  Terminal,
  MousePointerClick,
  Globe,
  Clock,
  Sparkles,
  RefreshCw,
  Code2,
} from "lucide-react";
import { toast } from "sonner";
import {
  appLogger,
  filterLogs,
  calculateLogMetrics,
  formatAsCurlCommand,
  exportLogsAsJson,
  exportLogsAsCsv,
  type LogEntry,
  type LogCategory,
  type LogLevel,
} from "../../utils/app-logger";

interface LiveActivityInspectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LiveActivityInspector({ open, onOpenChange }: LiveActivityInspectorProps) {
  const [logs, setLogs] = useState<LogEntry[]>(() => appLogger.getLogs());
  const [selectedCategory, setSelectedCategory] = useState<"all" | LogCategory>("all");
  const [selectedLevel, setSelectedLevel] = useState<"all" | LogLevel>("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "success" | "client_error" | "server_error"
  >("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isPaused, setIsPaused] = useState(false);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const listEndRef = useRef<HTMLDivElement>(null);

  // Subscribe to real-time logger events
  useEffect(() => {
    const unsubscribe = appLogger.subscribe((_, all) => {
      if (!isPaused) {
        setLogs(all);
      }
    });
    return unsubscribe;
  }, [isPaused]);

  // Global keyboard shortcut: Shift + L or Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "L" && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        // Prevent trigger inside inputs
        const target = e.target as HTMLElement;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        e.preventDefault();
        onOpenChange(!open);
      } else if (e.key === "Escape" && open) {
        if (selectedLog) {
          setSelectedLog(null);
        } else if (showClearConfirm) {
          setShowClearConfirm(false);
        } else {
          onOpenChange(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, selectedLog, showClearConfirm, onOpenChange]);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    return filterLogs(logs, {
      category: selectedCategory,
      level: selectedLevel,
      statusFilter,
      searchQuery,
    });
  }, [logs, selectedCategory, selectedLevel, statusFilter, searchQuery]);

  // Telemetry metrics
  const metrics = useMemo(() => calculateLogMetrics(logs), [logs]);

  // Format timestamp helper
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toTimeString().split(" ")[0] + "." + String(d.getMilliseconds()).padStart(3, "0");
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md p-3 sm:p-6 animate-in fade-in-0 duration-200">
      <div className="flex flex-col w-full max-w-6xl h-[88vh] rounded-2xl border border-border/80 bg-card/95 shadow-2xl overflow-hidden backdrop-blur-xl">
        {/* Top Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-border/50 bg-background/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 text-primary">
              <Activity className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-foreground tracking-tight">
                  Live API & UI Telemetry Stream
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-primary/10 text-primary border border-primary/20">
                  {isPaused ? "PAUSED" : "RECORDING"}
                </span>
                <span className="hidden sm:inline-block text-[11px] text-muted-foreground font-mono">
                  (Shift + L)
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                End-to-end request tracer, latency monitor, and UI interaction audit log.
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setIsPaused(!isPaused);
                toast.info(isPaused ? "Telemetry stream resumed" : "Telemetry stream paused");
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                isPaused
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
                  : "bg-muted border-border/60 text-foreground hover:bg-muted/80"
              }`}
            >
              {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              <span>{isPaused ? "Resume" : "Pause"}</span>
            </button>

            <button
              onClick={() => {
                const json = exportLogsAsJson(logs);
                const blob = new Blob([json], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `hosterax-logs-${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
                toast.success("Telemetry logs exported as JSON!");
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-muted border border-border/60 text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
              title="Export all logs as JSON"
            >
              <Download className="h-3.5 w-3.5 text-muted-foreground" />
              <span>JSON</span>
            </button>

            <button
              onClick={() => {
                const csv = exportLogsAsCsv(logs);
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `hosterax-logs-${Date.now()}.csv`;
                a.click();
                URL.revokeObjectURL(a.href);
                toast.success("Telemetry logs exported as CSV!");
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-muted border border-border/60 text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
              title="Export all logs as CSV"
            >
              <Download className="h-3.5 w-3.5 text-muted-foreground" />
              <span>CSV</span>
            </button>

            <button
              onClick={() => setShowClearConfirm(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-destructive/10 border border-destructive/20 text-destructive hover:bg-destructive/20 transition-colors cursor-pointer"
              title="Clear all recorded telemetry logs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear</span>
            </button>

            <button
              onClick={() => onOpenChange(false)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Close inspector"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Telemetry Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 px-5 py-2.5 border-b border-border/40 bg-muted/20 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Total Events:</span>
            <span className="font-mono font-bold text-foreground">{metrics.totalCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">API Calls:</span>
            <span className="font-mono font-bold text-sky-400">{metrics.apiCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">UI Actions:</span>
            <span className="font-mono font-bold text-emerald-400">{metrics.uiCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Errors:</span>
            <span
              className={`font-mono font-bold ${metrics.errorCount > 0 ? "text-rose-400" : "text-muted-foreground"}`}
            >
              {metrics.errorCount}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Avg Latency:</span>
            <span className="font-mono font-bold text-foreground">{metrics.avgApiLatencyMs}ms</span>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3 border-b border-border/40 bg-background/40">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by path, status, action, body..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            {/* Category Filter */}
            <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-card p-0.5 text-xs">
              {(["all", "api", "ui", "security"] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2.5 py-1 rounded-md capitalize font-medium transition-colors cursor-pointer ${
                    selectedCategory === cat
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {cat === "all" ? "All Streams" : cat}
                </button>
              ))}
            </div>

            {/* Level Filter */}
            <select
              value={selectedLevel}
              onChange={(e) => setSelectedLevel(e.target.value as any)}
              className="text-xs bg-card border border-border/60 rounded-lg px-2.5 py-1 text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All Levels</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Errors Only</option>
            </select>

            {/* Status Filter for API */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="text-xs bg-card border border-border/60 rounded-lg px-2.5 py-1 text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All HTTP Status</option>
              <option value="success">2xx Success</option>
              <option value="client_error">4xx Client Errors</option>
              <option value="server_error">5xx Server Errors</option>
            </select>
          </div>
        </div>

        {/* Log Stream Table */}
        <div className="flex-1 overflow-y-auto divide-y divide-border/30 font-mono text-xs">
          {filteredLogs.length === 0 ? (
            <div className="p-16 text-center space-y-2">
              <div className="w-10 h-10 rounded-full bg-muted border border-border flex items-center justify-center mx-auto text-muted-foreground">
                <Activity className="h-5 w-5" />
              </div>
              <h4 className="text-sm font-semibold text-foreground">No telemetry logs found</h4>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                No events matched your current filters. Trigger API calls or interact with the UI to
                see live telemetry.
              </p>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isApi = log.category === "api";
              const isUi = log.category === "ui";
              const isError = log.level === "error";
              const isWarn = log.level === "warn";

              return (
                <div
                  key={log.id}
                  onClick={() => setSelectedLog(log)}
                  className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-muted/40 transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Timestamp */}
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {formatTime(log.timestamp)}
                    </span>

                    {/* Category pill */}
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold shrink-0 ${
                        isApi
                          ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                          : isUi
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                      }`}
                    >
                      {log.category}
                    </span>

                    {/* Method badge if API */}
                    {log.method && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-black shrink-0 ${
                          log.method === "GET"
                            ? "bg-blue-500/20 text-blue-300"
                            : log.method === "POST"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : log.method === "DELETE"
                                ? "bg-rose-500/20 text-rose-300"
                                : "bg-amber-500/20 text-amber-300"
                        }`}
                      >
                        {log.method}
                      </span>
                    )}

                    {/* Status Code pill */}
                    {log.status !== undefined && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
                          log.status >= 200 && log.status < 300
                            ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                            : log.status >= 400
                              ? "text-rose-400 bg-rose-500/10 border border-rose-500/20 font-black"
                              : "text-amber-400 bg-amber-500/10 border border-amber-500/20"
                        }`}
                      >
                        {log.status === 0 ? "NET_ERR" : log.status}
                      </span>
                    )}

                    {/* Action / Message */}
                    <span className="text-foreground truncate font-sans text-xs group-hover:text-primary transition-colors">
                      {log.message}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {/* Duration */}
                    {log.durationMs !== undefined && (
                      <span
                        className={`text-[11px] font-mono ${
                          log.durationMs > 200
                            ? "text-rose-400 font-bold"
                            : log.durationMs > 80
                              ? "text-amber-400"
                              : "text-muted-foreground"
                        }`}
                      >
                        {log.durationMs}ms
                      </span>
                    )}

                    {/* Inspect button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedLog(log);
                      }}
                      className="px-2 py-0.5 rounded bg-muted/80 group-hover:bg-primary group-hover:text-primary-foreground text-[10px] font-sans font-medium transition-colors"
                    >
                      Inspect
                    </button>
                  </div>
                </div>
              );
            })
          )}
          <div ref={listEndRef} />
        </div>

        {/* Footer info bar */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-border/50 bg-background/80 text-[11px] text-muted-foreground">
          <span>
            Showing {filteredLogs.length} of {logs.length} telemetry records
          </span>
          <span className="hidden sm:inline-block">
            Click any row or press &quot;Inspect&quot; for complete request/response payloads &amp;
            cURL command.
          </span>
        </div>
      </div>

      {/* Pop-up Modal: Detailed Log Inspection */}
      {selectedLog && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-background/85 backdrop-blur-sm p-4 animate-in fade-in-0 duration-150">
          <div className="flex flex-col w-full max-w-2xl max-h-[85vh] rounded-2xl border border-border/90 bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <Code2 className="h-5 w-5 text-primary" />
                <h3 className="font-bold text-foreground text-sm font-mono">
                  {selectedLog.action}
                </h3>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 overflow-y-auto pr-1 text-xs">
              {/* Summary grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-background border border-border/50">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                    Category
                  </span>
                  <span className="font-mono font-bold text-foreground capitalize">
                    {selectedLog.category}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                    Status
                  </span>
                  <span className="font-mono font-bold text-foreground">
                    {selectedLog.status !== undefined ? selectedLog.status : "N/A"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                    Latency
                  </span>
                  <span className="font-mono font-bold text-foreground">
                    {selectedLog.durationMs !== undefined
                      ? `${selectedLog.durationMs}ms`
                      : "Instant"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                    Time
                  </span>
                  <span className="font-mono text-muted-foreground text-[11px]">
                    {new Date(selectedLog.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>

              {/* Message */}
              <div>
                <span className="text-muted-foreground block text-[11px] font-semibold mb-1">
                  Description
                </span>
                <p className="p-2.5 rounded-lg bg-background border border-border/40 font-mono text-xs text-foreground">
                  {selectedLog.message}
                </p>
              </div>

              {/* Metadata / Payloads */}
              {selectedLog.meta && Object.keys(selectedLog.meta).length > 0 && (
                <div>
                  <span className="text-muted-foreground block text-[11px] font-semibold mb-1">
                    Payload &amp; Metadata
                  </span>
                  <pre className="p-3 rounded-lg bg-background border border-border/50 font-mono text-xs text-foreground/90 overflow-x-auto max-h-48 whitespace-pre">
                    {JSON.stringify(selectedLog.meta, null, 2)}
                  </pre>
                </div>
              )}

              {/* cURL command snippet if API request */}
              {selectedLog.category === "api" && selectedLog.path && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-muted-foreground text-[11px] font-semibold">
                      Executable cURL Command
                    </span>
                    <button
                      onClick={() => {
                        const cmd = formatAsCurlCommand(selectedLog);
                        navigator.clipboard.writeText(cmd);
                        toast.success("cURL command copied to clipboard!");
                      }}
                      className="text-[10px] text-primary hover:underline flex items-center gap-1 font-sans"
                    >
                      <Copy className="h-3 w-3" /> Copy cURL
                    </button>
                  </div>
                  <pre className="p-3 rounded-lg bg-background border border-border/50 font-mono text-xs text-emerald-400 overflow-x-auto max-h-36 whitespace-pre">
                    {formatAsCurlCommand(selectedLog)}
                  </pre>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border/50">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(selectedLog, null, 2));
                  toast.success("Log details copied as JSON!");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-muted text-foreground hover:bg-muted/80 transition-colors"
              >
                <Copy className="h-3.5 w-3.5" /> Copy Log JSON
              </button>
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pop-up Modal: Clear Logs Confirmation Dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-background/85 backdrop-blur-sm p-4 animate-in fade-in-0 duration-150">
          <div className="w-full max-w-md rounded-2xl border border-destructive/40 bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-foreground text-sm">Clear All Telemetry Logs?</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  This will purge all in-memory API requests and UI audit records.
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to clear all {logs.length} recorded events? This action cannot
              be undone.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  appLogger.clear();
                  setLogs([]);
                  setShowClearConfirm(false);
                  toast.success("All telemetry and API audit logs cleared!");
                }}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors shadow-sm cursor-pointer"
              >
                Clear All Logs
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
