import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Terminal,
  Search,
  Filter,
  Play,
  Pause,
  Trash2,
  Copy,
  Check,
  AlertCircle,
  AlertTriangle,
  Info,
  ChevronDown,
  ArrowDown,
  Sparkles,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import {
  SystemLogEntry,
  LogFilterSeverity,
  LogSeverity,
  filterSystemLogs,
  countLogsBySeverity,
  appendLogWithCap,
  formatLogTimestamp,
  parseWebSocketLogMessage,
  exportLogsAsText,
} from "@/utils/system-logs";
import { useEngine } from "@/lib/engine";

export function SystemLogsPanel() {
  const engine = useEngine();
  const [logs, setLogs] = useState<SystemLogEntry[]>([]);
  const [severityFilter, setSeverityFilter] = useState<LogFilterSeverity>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSource, setSelectedSource] = useState<string>("all");
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [isPaused, setIsPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isEmitting, setIsEmitting] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Derive unique sources from logs
  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const log of logs) {
      if (log.source) set.add(log.source);
    }
    return Array.from(set).sort();
  }, [logs]);

  // Initial fetch via REST to ensure instant backfill before WS binds
  useEffect(() => {
    let cancelled = false;
    async function fetchInitialLogs() {
      try {
        const res = await engine.call<{ logs: SystemLogEntry[] }>(
          "GET",
          "/api/system/logs?limit=150",
        );
        if (!cancelled && res?.logs && Array.isArray(res.logs)) {
          setLogs((prev) => {
            let merged = [...prev];
            for (const item of res.logs) {
              merged = appendLogWithCap(merged, item, 500);
            }
            return merged;
          });
        }
      } catch {
        // Handled gracefully; WS will connect
      }
    }

    fetchInitialLogs();
    return () => {
      cancelled = true;
    };
  }, [engine]);

  // Establish WebSocket connection
  const connectWebSocket = useCallback(() => {
    if (typeof window === "undefined") return;

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
    }

    setConnectionStatus("connecting");

    // Build WebSocket URL from engine URL or current host
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let wsUrl: string;

    if (
      engine.url &&
      !engine.url.startsWith("http://localhost:3000") &&
      !engine.url.startsWith("/")
    ) {
      const cleanUrl = engine.url.replace(/^http(s)?:\/\//, "");
      wsUrl = `${protocol}//${cleanUrl}/ws?system=true`;
    } else {
      // Connect through Vite proxy /ws
      wsUrl = `${protocol}//${window.location.host}/ws?system=true`;
    }

    try {
      const subprotocols = ["hosterax", engine.token || "local"];
      const ws = new WebSocket(wsUrl, subprotocols);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus("connected");
      };

      ws.onmessage = (event) => {
        const entry = parseWebSocketLogMessage(event.data);
        if (entry) {
          setLogs((prev) => appendLogWithCap(prev, entry, 500));
        }
      };

      ws.onclose = () => {
        setConnectionStatus("disconnected");
        // Reconnect after 3 seconds
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 3000);
      };

      ws.onerror = () => {
        setConnectionStatus("disconnected");
      };
    } catch {
      setConnectionStatus("disconnected");
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWebSocket();
      }, 3000);
    }
  }, [engine.url, engine.token]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
      }
    };
  }, [connectWebSocket]);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    return filterSystemLogs(logs, {
      level: severityFilter,
      searchQuery,
      source: selectedSource,
    });
  }, [logs, severityFilter, searchQuery, selectedSource]);

  // Counts by severity
  const counts = useMemo(() => {
    return countLogsBySeverity(logs);
  }, [logs]);

  // Auto-scroll effect
  useEffect(() => {
    if (!autoScroll || isPaused) return;
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll, isPaused]);

  // Handle user scrolling
  const handleScroll = () => {
    if (!terminalRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    if (!atBottom && autoScroll) {
      setAutoScroll(false);
    } else if (atBottom && !autoScroll) {
      setAutoScroll(true);
    }
  };

  const scrollToBottom = () => {
    setAutoScroll(true);
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  };

  // Actions
  const clearView = () => {
    setLogs([]);
    toast.info("Log view cleared");
  };

  const copyLogs = async () => {
    try {
      const text = exportLogsAsText(filteredLogs);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`Copied ${filteredLogs.length} log line(s) to clipboard`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy logs to clipboard");
    }
  };

  const emitTestLog = async (level: LogSeverity) => {
    setIsEmitting(true);
    try {
      // 1. Try sending over WebSocket if open
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "emit_test",
            level,
            source: "dashboard-ws",
            message: `User triggered live test event (${level}) at ${new Date().toLocaleTimeString()}`,
            meta: { clientTime: Date.now() },
          }),
        );
      } else {
        // Fallback to REST endpoint
        await engine.call("POST", "/api/system/logs/test", {
          level,
          source: "dashboard-test",
          message: `User triggered live test event (${level}) at ${new Date().toLocaleTimeString()}`,
          meta: { clientTime: Date.now() },
        });
      }
      toast.success(`Emitted ${level} test event`);
    } catch (e) {
      toast.error(`Failed to emit test event: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsEmitting(false);
    }
  };

  return (
    <div
      data-testid="system-logs-panel"
      className="mt-6 rounded-xl border border-border bg-card/90 shadow-sm backdrop-blur-sm overflow-hidden"
    >
      {/* Header & Connection status */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 px-4 py-3 bg-muted/20">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
            <Terminal className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                Live System Logs
              </h3>
              <span className="text-[11px] font-mono text-muted-foreground">/ws?system=true</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Real-time engine event stream, background supervisor audits, and error telemetry
            </p>
          </div>
        </div>

        {/* Live connection indicator & actions */}
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium border ${
              connectionStatus === "connected"
                ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                : connectionStatus === "connecting"
                  ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                  : "bg-rose-500/10 text-rose-500 border-rose-500/20"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                connectionStatus === "connected"
                  ? "bg-emerald-500 animate-ping opacity-75"
                  : connectionStatus === "connecting"
                    ? "bg-amber-500"
                    : "bg-rose-500"
              }`}
            />
            {connectionStatus === "connected" ? (
              <span className="flex items-center gap-1">
                <Wifi className="h-3 w-3" /> Live
              </span>
            ) : connectionStatus === "connecting" ? (
              <span>Connecting...</span>
            ) : (
              <span className="flex items-center gap-1">
                <WifiOff className="h-3 w-3" /> Offline
              </span>
            )}
          </div>

          {/* Test Event Buttons */}
          <div className="flex items-center rounded-md border border-border/80 bg-background/50 p-0.5 text-xs">
            <span className="px-2 py-0.5 text-[10px] text-muted-foreground uppercase font-medium">
              Test:
            </span>
            <button
              type="button"
              data-testid="btn-test-info"
              disabled={isEmitting}
              onClick={() => emitTestLog("INFO")}
              className="px-2 py-0.5 rounded text-[11px] font-mono font-medium text-cyan-400 hover:bg-cyan-500/10 transition-colors"
              title="Emit INFO test log"
            >
              +INFO
            </button>
            <button
              type="button"
              data-testid="btn-test-warn"
              disabled={isEmitting}
              onClick={() => emitTestLog("WARN")}
              className="px-2 py-0.5 rounded text-[11px] font-mono font-medium text-amber-400 hover:bg-amber-500/10 transition-colors"
              title="Emit WARN test log"
            >
              +WARN
            </button>
            <button
              type="button"
              data-testid="btn-test-error"
              disabled={isEmitting}
              onClick={() => emitTestLog("ERROR")}
              className="px-2 py-0.5 rounded text-[11px] font-mono font-medium text-rose-400 hover:bg-rose-500/10 transition-colors"
              title="Emit ERROR test log"
            >
              +ERROR
            </button>
          </div>
        </div>
      </div>

      {/* Control Bar: Severity Tabs, Source selector, Search & Terminal Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 p-3 bg-muted/10 text-xs">
        {/* Severity Tabs */}
        <div className="flex items-center gap-1 bg-background/60 p-1 rounded-lg border border-border/60">
          <button
            type="button"
            data-testid="filter-all"
            onClick={() => setSeverityFilter("ALL")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-all ${
              severityFilter === "ALL"
                ? "bg-secondary text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span>All</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-muted font-mono">
              {counts.ALL}
            </span>
          </button>

          <button
            type="button"
            data-testid="filter-info"
            onClick={() => setSeverityFilter("INFO")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-all ${
              severityFilter === "INFO"
                ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 font-semibold"
                : "text-muted-foreground hover:text-cyan-400"
            }`}
          >
            <Info className="h-3 w-3 text-cyan-400" />
            <span>INFO</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-cyan-500/20 text-cyan-300 font-mono">
              {counts.INFO}
            </span>
          </button>

          <button
            type="button"
            data-testid="filter-warn"
            onClick={() => setSeverityFilter("WARN")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-all ${
              severityFilter === "WARN"
                ? "bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold"
                : "text-muted-foreground hover:text-amber-400"
            }`}
          >
            <AlertTriangle className="h-3 w-3 text-amber-400" />
            <span>WARN</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/20 text-amber-300 font-mono">
              {counts.WARN}
            </span>
          </button>

          <button
            type="button"
            data-testid="filter-error"
            onClick={() => setSeverityFilter("ERROR")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-all ${
              severityFilter === "ERROR"
                ? "bg-rose-500/15 text-rose-400 border border-rose-500/30 font-semibold"
                : "text-muted-foreground hover:text-rose-400"
            }`}
          >
            <AlertCircle className="h-3 w-3 text-rose-400" />
            <span>ERROR</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500/20 text-rose-300 font-mono">
              {counts.ERROR}
            </span>
          </button>
        </div>

        {/* Search Input & Source Dropdown */}
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search logs by keyword, source, or meta..."
              className="w-full rounded-md border border-border bg-background/80 pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:ring-1 focus:ring-primary font-mono"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            )}
          </div>

          {sources.length > 0 && (
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground font-mono focus:outline-hidden focus:ring-1 focus:ring-primary"
            >
              <option value="all">All Sources</option>
              {sources.map((src) => (
                <option key={src} value={src}>
                  {src}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* View Controls: Pause, Auto-scroll, Copy, Clear */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsPaused(!isPaused)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border transition-colors ${
              isPaused
                ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                : "border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
            }`}
            title={isPaused ? "Resume live streaming" : "Pause live updates"}
          >
            {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            <span>{isPaused ? "Paused" : "Live"}</span>
          </button>

          <button
            type="button"
            onClick={copyLogs}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Copy logs to clipboard"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            <span>Copy</span>
          </button>

          <button
            type="button"
            onClick={clearView}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border bg-background hover:bg-rose-500/10 text-muted-foreground hover:text-rose-400 transition-colors"
            title="Clear logs from view"
          >
            <Trash2 className="h-3 w-3" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Terminal Display Area */}
      <div className="relative">
        <div
          ref={terminalRef}
          onScroll={handleScroll}
          className="h-[340px] overflow-y-auto bg-slate-950 p-3 font-mono text-xs leading-relaxed select-text border-t border-slate-800/80"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-slate-500">
              <Terminal className="h-8 w-8 mb-2 opacity-40 text-slate-400" />
              <p className="text-sm font-medium text-slate-400">No logs found</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {searchQuery || severityFilter !== "ALL" || selectedSource !== "all"
                  ? "Try clearing filters or search query"
                  : "Waiting for incoming system events from /ws socket..."}
              </p>
            </div>
          ) : (
            <div className="space-y-1 font-mono">
              {filteredLogs.map((log) => {
                const isInfo = log.level === "INFO";
                const isWarn = log.level === "WARN";
                const isError = log.level === "ERROR";

                return (
                  <div
                    key={log.id}
                    className={`group flex items-start gap-2.5 rounded px-2 py-1 transition-colors hover:bg-slate-900/80 ${
                      isError
                        ? "bg-rose-950/20 text-rose-200 border-l-2 border-rose-500"
                        : isWarn
                          ? "bg-amber-950/20 text-amber-200 border-l-2 border-amber-500"
                          : "text-slate-300 border-l-2 border-transparent"
                    }`}
                  >
                    {/* Timestamp */}
                    <span className="text-[11px] text-slate-500 shrink-0 select-none">
                      {formatLogTimestamp(log.ts, true)}
                    </span>

                    {/* Severity Pill */}
                    <span
                      className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold tracking-wider shrink-0 ${
                        isError
                          ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                          : isWarn
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                            : "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                      }`}
                    >
                      {log.level}
                    </span>

                    {/* Source */}
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700/60 shrink-0">
                      {log.source}
                    </span>

                    {/* Message Body */}
                    <div className="flex-1 min-w-0 break-words">
                      <span className="text-slate-200">{log.message}</span>
                      {log.meta && (
                        <span className="ml-2 text-[11px] text-slate-500 font-mono">
                          {JSON.stringify(log.meta)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Jump to bottom float button if scrolled up */}
        {!autoScroll && filteredLogs.length > 0 && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-4 flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg hover:opacity-95 transition-all animate-bounce"
          >
            <ArrowDown className="h-3 w-3" />
            <span>More logs below</span>
          </button>
        )}
      </div>

      {/* Footer statistics */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/80 px-4 py-2 bg-muted/20 text-[11px] text-muted-foreground font-mono">
        <div className="flex items-center gap-4">
          <span>
            Showing <strong className="text-foreground">{filteredLogs.length}</strong> of{" "}
            <strong className="text-foreground">{logs.length}</strong> buffered events
          </span>
          {isPaused && (
            <span className="text-amber-500 font-medium flex items-center gap-1">
              <Pause className="h-3 w-3" /> Live streaming paused
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-border text-primary focus:ring-primary h-3 w-3"
            />
            <span>Auto-scroll to bottom</span>
          </label>
        </div>
      </div>
    </div>
  );
}
