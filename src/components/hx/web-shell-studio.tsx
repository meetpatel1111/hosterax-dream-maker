import { useState, useMemo, useRef, useEffect } from "react";
import {
  Terminal as TerminalIcon,
  Play,
  Server,
  Layers,
  Database,
  ShieldCheck,
  RotateCcw,
  Trash2,
  Download,
  Copy,
  Plus,
  X,
  Search,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Activity,
  Cpu,
  Globe,
  CornerDownLeft,
} from "lucide-react";
import { toast } from "sonner";
import { confirmAction } from "./confirm-modal";
import { appLogger } from "../../utils/app-logger";
import {
  useEngine,
  useDockerContainers,
  useDockerExec,
  type DockerContainerItem,
} from "../../lib/engine";
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

export function WebShellStudio() {
  const engine = useEngine();
  const containersQuery = useDockerContainers();
  const execMutation = useDockerExec();

  const containers = useMemo(() => containersQuery.data || [], [containersQuery.data]);

  // Detected container options
  const containerOptions = useMemo(() => {
    if (containers.length > 0) {
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
    }

    // Only real containers returned by Docker API
    return [];
  }, [containers]);

  // Terminal Tabs
  const [tabs, setTabs] = useState<TerminalTab[]>([]);

  useEffect(() => {
    if (tabs.length === 0 && containerOptions.length > 0) {
      const first = containerOptions[0];
      setTabs([
        {
          id: `tab-${first.id}`,
          title: first.name,
          containerName: first.name,
          shell: "sh",
          active: true,
        },
      ]);
    }
  }, [containerOptions, tabs.length]);

  const activeTab = useMemo(() => tabs.find((t) => t.active) || tabs[0], [tabs]);

  // Terminal history state per session
  const [history, setHistory] = useState<TerminalHistoryItem[]>([]);

  // Command input & terminal UI state
  const [cmdInput, setCmdInput] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [auditSearch, setAuditSearch] = useState("");
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showNewTabModal, setShowNewTabModal] = useState(false);
  const [selectedNewContainer, setSelectedNewContainer] = useState("");

  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-scroll terminal output
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  // Filtered history for the active tab
  const activeTabHistory = useMemo(() => {
    if (!activeTab) return [];
    return history.filter((h) => h.containerName === activeTab.containerName);
  }, [history, activeTab]);

  // Filtered audit list
  const filteredAudit = useMemo(() => {
    return filterTerminalHistory(history, auditSearch);
  }, [history, auditSearch]);

  // Handler: Switch Tab
  const handleSelectTab = (tabId: string) => {
    setTabs((prev) => prev.map((t) => ({ ...t, active: t.id === tabId })));
    setCmdInput("");
    setHistoryIndex(null);
    inputRef.current?.focus();
  };

  // Handler: Close Tab
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

  // Handler: Add New Tab
  const handleAddTab = () => {
    const target =
      containerOptions.find((c) => c.name === selectedNewContainer) || containerOptions[0];
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

  // Handler: Run Command
  const handleRunCommand = async (commandToRun?: string) => {
    const cmd = (commandToRun ?? cmdInput).trim();
    if (!cmd) return;

    setIsExecuting(true);
    const startMs = Date.now();

    try {
      let exitCode = 0;
      let outputText = "";

      // Attempt actual docker exec API call
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
          `Error: failed to execute "${cmd}" on container ${activeTab?.containerName || "unknown"}`;
      }

      const durationMs = Date.now() - startMs;
      const historyItem: TerminalHistoryItem = {
        id: `hist-${Date.now()}`,
        containerName: activeTab.containerName,
        command: cmd,
        output: outputText || "(No standard output received)",
        exitCode,
        timestamp: Date.now(),
        durationMs,
      };

      setHistory((prev) => [...prev, historyItem]);
      setCmdInput("");
      setHistoryIndex(null);
    } catch (err: any) {
      toast.error(err?.message || "Command execution failed");
    } finally {
      setIsExecuting(false);
      inputRef.current?.focus();
    }
  };

  // Keyboard navigation for command history
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

  // Clear Terminal Output
  const handleClearTerminal = async () => {
    if (!activeTab) return;
    if (activeTabHistory.length > 0) {
      const ok = await confirmAction({
        title: `Clear Terminal Output (${activeTab.containerName})`,
        description: `Are you sure you want to clear the terminal output buffer (${activeTabHistory.length} command results)?`,
        confirmLabel: "Clear Buffer",
      });
      if (!ok) return;
    }
    setHistory((prev) => prev.filter((h) => h.containerName !== activeTab.containerName));
    appLogger.logUi(
      `Terminal Cleared: ${activeTab.containerName}`,
      `Cleared buffer for tab ${activeTab.containerName}`,
    );
    toast.success("Terminal output cleared.");
  };

  // Export Audit Handlers
  const handleDownloadCsv = () => {
    const csv = formatAuditCsv(history);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `terminal-audit-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Terminal audit log exported as CSV.");
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
    toast.success("Terminal audit log exported as JSON.");
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
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
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                  Interactive TTY
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Zero-SSH in-browser shell access across all running containers, curated diagnostic
                runbooks, and SOC2 command audit logging.
              </p>
            </div>
          </div>
        </div>

        {/* Top Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setShowAuditModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> Audit Log ({history.length})
          </button>
          <button
            onClick={() => setShowNewTabModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-all"
          >
            <Plus className="h-3.5 w-3.5" /> New Terminal Session
          </button>
        </div>
      </div>

      {/* Main Terminal Window Frame */}
      <div className="rounded-xl border border-border bg-[#0d0e12] shadow-2xl overflow-hidden font-mono flex flex-col min-h-[580px]">
        {/* Terminal Header & Tabs Bar */}
        <div className="flex flex-wrap items-center justify-between border-b border-border/80 bg-[#14151b] px-4 py-2 text-xs select-none gap-2">
          {/* Tabs */}
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
                    tab.active ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground/40"
                  }`}
                />
                <span className="truncate max-w-[120px]">{tab.title}</span>
                <span className="text-[10px] text-muted-foreground">({tab.shell})</span>
                <button
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  className="rounded p-0.5 text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive transition-all"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}

            <button
              onClick={() => setShowNewTabModal(true)}
              className="rounded-md border border-border/60 bg-[#181920] p-1.5 text-muted-foreground hover:text-foreground hover:bg-[#22242e] transition-colors"
              title="Open session in another container"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Active Container Metadata & Clear Button */}
          {activeTab ? (
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Server className="h-3.5 w-3.5 text-primary" />
                <span>Container:</span>
                <strong className="text-foreground">{activeTab.containerName}</strong>
              </div>
              <button
                onClick={handleClearTerminal}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                title="Clear terminal output buffer"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground">No active session</div>
          )}
        </div>

        {/* Curated Runbook Snippets Shelf */}
        <div className="flex items-center gap-2 border-b border-border/40 bg-[#111217] px-4 py-2 overflow-x-auto text-xs">
          <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider shrink-0 mr-1">
            ⚡ Quick Runbooks:
          </span>
          {CURATED_TERMINAL_SNIPPETS.map((snippet) => (
            <button
              key={snippet.id}
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
                No running containers detected. Deploy an application or start a database to launch
                an interactive shell session.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Terminal Output Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-[#d1d5db] font-mono leading-relaxed max-h-[460px]">
              {/* Welcome Message */}
              <div className="text-muted-foreground/80 space-y-1 text-[11px] border-b border-border/30 pb-3">
                <div>HosteraX Container Terminal Studio · Session Connected</div>
                <div>
                  Target:{" "}
                  <span className="text-emerald-400 font-bold">{activeTab.containerName}</span> ·
                  Architecture: x86_64 Linux
                </div>
                <div>
                  Type any command or use the quick runbooks above. Press Up/Down for history.
                </div>
              </div>

              {/* Execution History */}
              {activeTabHistory.map((item) => (
                <div key={item.id} className="space-y-1">
                  {/* Command Prompt Line */}
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

                  {/* Formatted Output */}
                  <pre className="whitespace-pre-wrap text-muted-foreground/90 font-mono text-[11px] pl-4 border-l border-border/40 py-0.5">
                    {stripAnsiCodes(item.output)}
                  </pre>
                </div>
              ))}

              <div ref={terminalEndRef} />
            </div>

            {/* Live Terminal Input Prompt */}
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
                placeholder="Type a shell command (e.g. ls -la, curl localhost:80, df -h)..."
                className="flex-1 bg-transparent text-xs text-foreground outline-none font-mono placeholder:text-muted-foreground/40"
                autoFocus
              />
              <button
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

      {/* Modal: Open Session in Another Container */}
      {showNewTabModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-foreground">Open Container Shell Session</h3>
              <button
                onClick={() => setShowNewTabModal(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <label className="block space-y-1">
                <span className="font-medium text-foreground">Select Target Container</span>
                <select
                  value={selectedNewContainer}
                  onChange={(e) => setSelectedNewContainer(e.target.value)}
                  className="w-full rounded-md border border-input bg-input/40 px-3 py-2 outline-none font-mono text-xs"
                >
                  {containerOptions.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} ({c.image}) — {c.category.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-lg bg-surface/50 p-3 border border-border space-y-1 text-muted-foreground text-[11px]">
                <p>
                  Zero SSH keys required. Direct container TTY session connects through the HosteraX
                  Engine Docker daemon.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => setShowNewTabModal(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={handleAddTab}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                Connect Session
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Command Audit Log & Export */}
      {showAuditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-150 font-sans">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-sm font-bold text-foreground">Terminal Command Audit Log</h3>
                <p className="text-xs text-muted-foreground">
                  Complete history of commands executed through the WebShell Studio.
                </p>
              </div>
              <button
                onClick={() => setShowAuditModal(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* Search Filter */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Search audit trail by command or container..."
                className="w-full rounded-md border border-input bg-input/40 pl-8 pr-3 py-1.5 outline-none font-mono text-xs"
              />
            </div>

            {/* Audit Rows */}
            <div className="flex-1 overflow-y-auto divide-y divide-border border border-border rounded-lg bg-surface/30 text-xs font-mono">
              {filteredAudit.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">No audit logs found.</div>
              ) : (
                filteredAudit.map((item) => (
                  <div key={item.id} className="p-3 space-y-1 hover:bg-muted/10 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-primary">{item.containerName}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(item.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-foreground">$ {item.command}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {stripAnsiCodes(item.output).slice(0, 120)}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Export Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-border text-xs">
              <div className="flex gap-2">
                <button
                  onClick={handleDownloadCsv}
                  className="rounded-md border border-border bg-surface-2 px-3 py-1.5 font-medium hover:bg-accent transition-colors"
                >
                  Export CSV
                </button>
                <button
                  onClick={handleDownloadJson}
                  className="rounded-md border border-border bg-surface-2 px-3 py-1.5 font-medium hover:bg-accent transition-colors"
                >
                  Export JSON
                </button>
              </div>
              <button
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
