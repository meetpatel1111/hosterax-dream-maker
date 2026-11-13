import { useState, useMemo, useRef, useEffect } from "react";
import {
  Terminal as TerminalIcon,
  Play,
  Server,
  Trash2,
  Download,
  Plus,
  X,
  Search,
  CornerDownLeft,
  PlugZap,
} from "lucide-react";
import { toast } from "sonner";
import { confirmAction } from "./confirm-modal";
import { appLogger } from "../../utils/app-logger";
import { useEngine, useDockerContainers, useDockerExec } from "../../lib/engine";
import {
  CURATED_TERMINAL_SNIPPETS,
  categorizeContainer,
  stripAnsiCodes,
  filterTerminalHistory,
  formatAuditCsv,
  formatAuditJson,
  type TerminalHistoryItem,
  type TerminalTab,
} from "../../utils/terminal-studio";

export function WebShellStudio({ initialContainer }: { initialContainer?: string }) {
  const engine = useEngine();
  const containersQuery = useDockerContainers();
  const execMutation = useDockerExec();

  const containers = useMemo(() => containersQuery.data || [], [containersQuery.data]);

  const containerOptions = useMemo(() => {
    return containers.map((c) => {
      const rawName = c.Names[0] || c.Id.slice(0, 12);
      const cleanName = rawName.replace(/^\//, "");
      return {
        id: c.Id,
        name: cleanName,
        image: c.Image,
        category: categorizeContainer(c.Image, cleanName),
        state: c.State || "running",
        ports: c.Ports.map((p) => p.PublicPort || p.PrivatePort).filter(Boolean),
      };
    });
  }, [containers]);

  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const appliedInitialRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (containerOptions.length === 0) return;

    const preferred = initialContainer
      ? containerOptions.find((c) => c.name === initialContainer)
      : undefined;

    const shouldApplyInitial = !!preferred && appliedInitialRef.current !== preferred.name;

    setTabs((prev) => {
      if (prev.length === 0) {
        const target = preferred || containerOptions[0];
        if (preferred) appliedInitialRef.current = preferred.name;
        return [
          {
            id: `tab-${target.id}`,
            title: target.name,
            containerName: target.name,
            shell: "sh",
            active: true,
          },
        ];
      }
      if (!shouldApplyInitial || !preferred) return prev;
      appliedInitialRef.current = preferred.name;
      const existing = prev.find((t) => t.containerName === preferred.name);
      if (existing) {
        return existing.active ? prev : prev.map((t) => ({ ...t, active: t.id === existing.id }));
      }
      return [
        ...prev.map((t) => ({ ...t, active: false })),
        {
          id: `tab-${preferred.id}`,
          title: preferred.name,
          containerName: preferred.name,
          shell: "sh",
          active: true,
        },
      ];
    });
  }, [containerOptions, initialContainer]);

  const activeTab = useMemo(() => tabs.find((t) => t.active) || tabs[0], [tabs]);

  const [history, setHistory] = useState<TerminalHistoryItem[]>([]);
  const [ptyStreamByContainer, setPtyStreamByContainer] = useState<Record<string, string>>({});
  const [ptyConnected, setPtyConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const [cmdInput, setCmdInput] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [auditSearch, setAuditSearch] = useState("");
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showNewTabModal, setShowNewTabModal] = useState(false);
  const [selectedNewContainer, setSelectedNewContainer] = useState("");

  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Connect interactive WebSocket PTY when an active container tab is selected
  useEffect(() => {
    if (!activeTab?.containerName) {
      setPtyConnected(false);
      return;
    }

    const baseWs = engine.url.replace(/^http/, "ws").replace(/\/$/, "");
    const wsUrl = `${baseWs}/ws?shell=1&container=${encodeURIComponent(activeTab.containerName)}&cols=100&rows=30&cmd=${encodeURIComponent(activeTab.shell || "sh")}`;
    const protocols = engine.token ? ["hosterax", engine.token] : ["hosterax"];

    let closedByCleanup = false;
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(wsUrl, protocols);
      wsRef.current = socket;

      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "ready") {
            setPtyConnected(true);
          } else if (msg.type === "output" && typeof msg.data === "string") {
            setPtyStreamByContainer((prev) => ({
              ...prev,
              [activeTab.containerName]: ((prev[activeTab.containerName] || "") + msg.data).slice(
                -24000,
              ),
            }));
          } else if (msg.type === "exit" || msg.type === "error") {
            setPtyConnected(false);
          }
        } catch {
          // ignore malformed frames
        }
      };

      socket.onclose = () => {
        if (!closedByCleanup) setPtyConnected(false);
      };
      socket.onerror = () => {
        if (!closedByCleanup) setPtyConnected(false);
      };
    } catch {
      setPtyConnected(false);
    }

    return () => {
      closedByCleanup = true;
      setPtyConnected(false);
      if (wsRef.current === socket) wsRef.current = null;
      try {
        socket?.close();
      } catch {}
    };
  }, [activeTab?.containerName, activeTab?.shell, engine.url, engine.token]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, ptyStreamByContainer]);

  const activeTabHistory = useMemo(() => {
    if (!activeTab) return [];
    return history.filter((h) => h.containerName === activeTab.containerName);
  }, [history, activeTab]);

  const filteredAudit = useMemo(() => {
    return filterTerminalHistory(history, auditSearch);
  }, [history, auditSearch]);

  const handleSelectTab = (tabId: string) => {
    setTabs((prev) => prev.map((t) => ({ ...t, active: t.id === tabId })));
    setCmdInput("");
    setHistoryIndex(null);
    inputRef.current?.focus();
  };

  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) {
      toast.warning("Cannot close the only open terminal tab.");
      return;
    }
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== tabId);
      if (prev.find((t) => t.id === tabId)?.active) {
        remaining[0].active = true;
      }
      return remaining;
    });
  };

  const handleAddTab = () => {
    const target =
      containerOptions.find((c) => c.name === selectedNewContainer) || containerOptions[0];
    if (!target) return;
    const newTabId = `tab-${Date.now()}`;
    const newTab: TerminalTab = {
      id: newTabId,
      title: target.name,
      containerName: target.name,
      shell: "sh",
      active: true,
    };

    setTabs((prev) => prev.map((t) => ({ ...t, active: false })).concat(newTab));
    setShowNewTabModal(false);
    toast.success(`Opened terminal tab for ${target.name}`);
  };

  const handleRunCommand = async (commandToRun?: string) => {
    const cmd = (commandToRun ?? cmdInput).trim();
    if (!cmd || !activeTab) return;

    // Stream directly over interactive PTY WebSocket when connected
    if (ptyConnected && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input", data: cmd + "\n" }));
      setHistory((prev) => [
        ...prev,
        {
          id: `hist-${Date.now()}`,
          containerName: activeTab.containerName,
          command: cmd,
          output: "(Sent to interactive PTY session)",
          exitCode: 0,
          timestamp: Date.now(),
          durationMs: 0,
        },
      ]);
      setCmdInput("");
      setHistoryIndex(null);
      inputRef.current?.focus();
      return;
    }

    // Fallback to HTTP docker exec API
    setIsExecuting(true);
    const startMs = Date.now();
    try {
      let exitCode = 0;
      let outputText = "";
      try {
        const res = await execMutation.mutateAsync({
          containerName: activeTab.containerName,
          cmd,
        });
        exitCode = res.exitCode;
        outputText = res.output;
      } catch (err: any) {
        exitCode = 1;
        outputText =
          err?.message ||
          `Error: failed to execute "${cmd}" on container ${activeTab.containerName}`;
      }

      const durationMs = Date.now() - startMs;
      setHistory((prev) => [
        ...prev,
        {
          id: `hist-${Date.now()}`,
          containerName: activeTab.containerName,
          command: cmd,
          output: outputText || "(No output)",
          exitCode,
          timestamp: Date.now(),
          durationMs,
        },
      ]);
      setCmdInput("");
      setHistoryIndex(null);
    } finally {
      setIsExecuting(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRunCommand();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (activeTabHistory.length === 0) return;
      const nextIdx =
        historyIndex === null ? activeTabHistory.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIdx);
      setCmdInput(activeTabHistory[nextIdx].command);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex === null) return;
      if (historyIndex >= activeTabHistory.length - 1) {
        setHistoryIndex(null);
        setCmdInput("");
      } else {
        const nextIdx = historyIndex + 1;
        setHistoryIndex(nextIdx);
        setCmdInput(activeTabHistory[nextIdx].command);
      }
    }
  };

  const handleClearTerminal = async () => {
    if (!activeTab) return;
    if (activeTabHistory.length > 0 || ptyStreamByContainer[activeTab.containerName]) {
      const ok = await confirmAction({
        title: `Clear Terminal Output (${activeTab.containerName})`,
        description: `Clear the terminal buffer for ${activeTab.containerName}?`,
        confirmLabel: "Clear Buffer",
      });
      if (!ok) return;
    }
    setHistory((prev) => prev.filter((h) => h.containerName !== activeTab.containerName));
    setPtyStreamByContainer((prev) => ({ ...prev, [activeTab.containerName]: "" }));
    appLogger.logUi(
      `Terminal Cleared: ${activeTab.containerName}`,
      `Cleared buffer for tab ${activeTab.containerName}`,
    );
    toast.success("Terminal output cleared.");
  };

  const handleDownloadCsv = () => {
    const csv = formatAuditCsv(history);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `terminal-audit-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadJson = () => {
    const json = formatAuditJson(history);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `terminal-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activePtyStream = activeTab ? ptyStreamByContainer[activeTab.containerName] || "" : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <TerminalIcon className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  Multi-Container Web Terminal &amp; Live Exec Studio
                </h1>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold flex items-center gap-1 ${
                    ptyConnected
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <PlugZap className="h-3 w-3" />
                  {ptyConnected ? "WebSocket PTY Live" : "Docker Exec"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Real container PTY shell over authenticated WebSocket subprotocol with docker exec
                fallback.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowAuditModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> Audit Log ({history.length})
          </button>
          <button
            type="button"
            onClick={() => setShowNewTabModal(true)}
            disabled={containerOptions.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-all disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> New Terminal Session
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-[#0d0e12] shadow-2xl overflow-hidden font-mono flex flex-col min-h-[580px]">
        <div className="flex flex-wrap items-center justify-between border-b border-border/80 bg-[#14151b] px-4 py-2 text-xs select-none gap-2">
          <div className="flex items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => handleSelectTab(tab.id)}
                className={`group flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                  tab.active
                    ? "bg-[#1f212a] text-foreground border border-border/80 shadow-sm"
                    : "text-muted-foreground hover:bg-[#181920] hover:text-foreground"
                }`}
              >
                <div
                  className={`h-2 w-2 rounded-full ${
                    tab.active ? "bg-emerald-400" : "bg-muted-foreground/40"
                  }`}
                />
                <span className="truncate max-w-[120px]">{tab.title}</span>
                <span className="text-[10px] text-muted-foreground">({tab.shell})</span>
                <button
                  type="button"
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  className="rounded p-0.5 text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive transition-all"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>

          {activeTab ? (
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Server className="h-3.5 w-3.5 text-primary" />
                <span>Container:</span>
                <strong className="text-foreground">{activeTab.containerName}</strong>
              </div>
              <button
                type="button"
                onClick={handleClearTerminal}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground">No active session</div>
          )}
        </div>

        <div className="flex items-center gap-2 border-b border-border/40 bg-[#111217] px-4 py-2 overflow-x-auto text-xs">
          <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider shrink-0 mr-1">
            Quick Runbooks:
          </span>
          {CURATED_TERMINAL_SNIPPETS.map((snippet) => (
            <button
              key={snippet.id}
              type="button"
              onClick={() => handleRunCommand(snippet.command)}
              disabled={!activeTab}
              className="inline-flex items-center gap-1 rounded bg-[#1c1e27] hover:bg-primary/20 hover:text-primary px-2.5 py-1 text-[11px] text-muted-foreground border border-border/50 shrink-0 transition-colors disabled:opacity-40"
              title={`${snippet.description} (${snippet.command})`}
            >
              <Play className="h-2.5 w-2.5 opacity-70" />
              <span>{snippet.name}</span>
            </button>
          ))}
        </div>

        {!activeTab ? (
          <div className="p-16 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-[#1c1e27] border border-border flex items-center justify-center mx-auto text-muted-foreground">
              <TerminalIcon className="w-6 h-6 text-primary/70" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">No active containers found</h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                No running containers detected. Deploy an application or start a container to launch
                an interactive shell session.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-[#d1d5db] font-mono leading-relaxed max-h-[460px]">
              <div className="text-muted-foreground/80 space-y-1 text-[11px] border-b border-border/30 pb-3">
                <div>
                  HosteraX Container Terminal · Mode:{" "}
                  {ptyConnected ? "WebSocket Interactive PTY" : "Docker Exec API"}
                </div>
                <div>
                  Target: <span className="text-emerald-400 font-bold">{activeTab.containerName}</span>
                </div>
              </div>

              {activePtyStream && (
                <pre className="whitespace-pre-wrap text-[#e5e7eb] font-mono text-[11px] leading-snug">
                  {stripAnsiCodes(activePtyStream)}
                </pre>
              )}

              {activeTabHistory.map((item) => (
                <div key={item.id} className="space-y-1">
                  <div className="flex items-center gap-2 text-foreground font-semibold">
                    <span className="text-emerald-400">{activeTab.containerName}</span>
                    <span className="text-muted-foreground">$</span>
                    <span className="text-sky-300">{item.command}</span>
                    <span
                      className={`ml-auto text-[10px] font-mono px-1.5 py-0.2 rounded ${
                        item.exitCode === 0
                          ? "text-emerald-400 bg-emerald-500/10"
                          : "text-destructive bg-destructive/10"
                      }`}
                    >
                      Exit: {item.exitCode} {item.durationMs ? `(${item.durationMs}ms)` : ""}
                    </span>
                  </div>
                  <pre className="whitespace-pre-wrap text-muted-foreground/90 font-mono text-[11px] pl-4 border-l border-border/40 py-0.5">
                    {stripAnsiCodes(item.output)}
                  </pre>
                </div>
              ))}

              <div ref={terminalEndRef} />
            </div>

            <div className="border-t border-border/80 bg-[#14151b] px-4 py-3 flex items-center gap-2">
              <span className="text-emerald-400 font-bold text-xs select-none">
                {activeTab.containerName}
              </span>
              <span className="text-muted-foreground font-bold select-none">$</span>
              <input
                ref={inputRef}
                type="text"
                value={cmdInput}
                onChange={(e) => setCmdInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isExecuting}
                placeholder="Type a shell command (e.g. uname -a, ls -la)..."
                className="flex-1 bg-transparent text-xs text-foreground outline-none font-mono placeholder:text-muted-foreground/40"
                autoFocus
              />
              <button
                type="button"
                disabled={isExecuting || !cmdInput.trim()}
                onClick={() => handleRunCommand()}
                className="inline-flex items-center gap-1 rounded bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 px-3 py-1 text-xs font-semibold disabled:opacity-40 transition-colors"
              >
                <CornerDownLeft className="h-3 w-3" />
                <span>Run</span>
              </button>
            </div>
          </>
        )}
      </div>

      {showNewTabModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-foreground">Open Container Shell Session</h3>
              <button
                type="button"
                onClick={() => setShowNewTabModal(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-foreground">Select Target Container</span>
              <select
                value={selectedNewContainer}
                onChange={(e) => setSelectedNewContainer(e.target.value)}
                className="w-full rounded-md border border-input bg-input/40 px-3 py-2 outline-none font-mono text-xs"
              >
                {containerOptions.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.image})
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setShowNewTabModal(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddTab}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                Connect Session
              </button>
            </div>
          </div>
        </div>
      )}

      {showAuditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md font-sans">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-foreground">Terminal Command Audit Log</h3>
              <button
                type="button"
                onClick={() => setShowAuditModal(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Search audit trail..."
                className="w-full rounded-md border border-input bg-input/40 pl-8 pr-3 py-1.5 outline-none font-mono text-xs"
              />
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-border border border-border rounded-lg bg-surface/30 text-xs font-mono">
              {filteredAudit.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">No audit logs found.</div>
              ) : (
                filteredAudit.map((item) => (
                  <div key={item.id} className="p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-primary">{item.containerName}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(item.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-foreground">$ {item.command}</div>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border text-xs">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  className="rounded-md border border-border bg-surface-2 px-3 py-1.5 font-medium"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={handleDownloadJson}
                  className="rounded-md border border-border bg-surface-2 px-3 py-1.5 font-medium"
                >
                  Export JSON
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowAuditModal(false)}
                className="rounded-md bg-primary px-4 py-1.5 font-semibold text-primary-foreground"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
