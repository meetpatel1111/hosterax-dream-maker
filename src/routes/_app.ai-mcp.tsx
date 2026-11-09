import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bot,
  Play,
  Copy,
  Check,
  Search,
  Sparkles,
  Terminal,
  Cpu,
  Layers,
  KeyRound,
  ShieldCheck,
  RefreshCw,
  Clock,
  ArrowRight,
  ExternalLink,
  Code2,
} from "lucide-react";
import { useEngine } from "@/lib/engine";
import {
  categorizeMcpTool,
  buildMcpCallPayload,
  generateIdeConfig,
  formatMcpResponse,
  type IdeClientType,
  type McpCategory,
  type McpToolSchema,
} from "@/utils/mcp";

export const Route = createFileRoute("/_app/ai-mcp")({
  head: () => ({
    meta: [
      { title: "AI Agents & MCP Hub — HosteraX" },
      {
        name: "description",
        content:
          "Connect Claude Desktop, Cursor, Windsurf, and autonomous AI agents directly to your HosteraX infrastructure via Model Context Protocol.",
      },
    ],
  }),
  component: McpHubPage,
});

const CATEGORIES: McpCategory[] = [
  "All",
  "Observability",
  "Deployments",
  "Databases",
  "Networking & Edge",
  "Automation",
  "Email & Mailboxes",
  "Team & RBAC",
];

function McpHubPage() {
  const engine = useEngine();
  const [selectedClient, setSelectedClient] = useState<IdeClientType>("cursor");
  const [activeCategory, setActiveCategory] = useState<McpCategory>("All");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const [selectedToken, setSelectedToken] = useState<string>("");

  // Workbench state
  const [activeToolName, setActiveToolName] = useState<string>("get_system_metrics");
  const [argumentsJson, setArgumentsJson] = useState<string>("{}");
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<{
    status: "idle" | "success" | "error";
    data: any;
    rawText: string;
    durationMs?: number;
  }>({ status: "idle", data: null, rawText: "" });

  // Query MCP discovery info
  const {
    data: mcpInfo,
    isLoading: isMcpLoading,
    refetch: refetchMcp,
  } = useQuery({
    queryKey: ["mcp-info", engine.url],
    queryFn: () =>
      engine.call<{
        mcp: string;
        server: string;
        version: string;
        endpoint: string;
        transport: string;
        toolsCount: number;
      }>("GET", "/api/mcp"),
  });

  // Query all tools via JSON-RPC
  const { data: toolsList = [], isLoading: isToolsLoading } = useQuery<McpToolSchema[]>({
    queryKey: ["mcp-tools-list", engine.url],
    queryFn: async () => {
      const res = await engine.call<{ result: { tools: McpToolSchema[] } }>("POST", "/api/mcp", {
        jsonrpc: "2.0",
        id: "discovery",
        method: "tools/list",
        params: {},
      });
      return res?.result?.tools || [];
    },
    staleTime: 60000,
  });

  // Query existing tokens for config auto-fill
  const { data: tokens = [] } = useQuery<Array<{ id: string; name: string; prefix: string }>>({
    queryKey: ["tokens", engine.url],
    queryFn: () => engine.call<any[]>("GET", "/api/tokens"),
  });

  // Filter tools
  const filteredTools = useMemo(() => {
    return toolsList.filter((tool) => {
      const matchesCategory =
        activeCategory === "All" || categorizeMcpTool(tool.name) === activeCategory;
      const term = search.toLowerCase().trim();
      const matchesSearch =
        !term ||
        tool.name.toLowerCase().includes(term) ||
        (tool.description || "").toLowerCase().includes(term);
      return matchesCategory && matchesSearch;
    });
  }, [toolsList, activeCategory, search]);

  const activeTool = useMemo(() => {
    return toolsList.find((t) => t.name === activeToolName) || toolsList[0];
  }, [toolsList, activeToolName]);

  // Handle selecting a tool
  const selectTool = (tool: McpToolSchema) => {
    setActiveToolName(tool.name);
    // Generate default sample JSON based on inputSchema
    if (tool.inputSchema?.properties && Object.keys(tool.inputSchema.properties).length > 0) {
      const sample: Record<string, any> = {};
      for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
        if (prop.enum && prop.enum.length) {
          sample[key] = prop.enum[0];
        } else if (prop.type === "number") {
          sample[key] = 10;
        } else if (prop.type === "boolean") {
          sample[key] = true;
        } else {
          sample[key] = `sample-${key}`;
        }
      }
      setArgumentsJson(JSON.stringify(sample, null, 2));
    } else {
      setArgumentsJson("{}");
    }
    setExecutionResult({ status: "idle", data: null, rawText: "" });
  };

  // Execute MCP tool via JSON-RPC
  const handleExecute = async () => {
    if (!activeTool) return;
    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(argumentsJson || "{}");
    } catch {
      toast.error("Invalid JSON arguments syntax");
      return;
    }

    setExecuting(true);
    const start = performance.now();
    try {
      const payload = buildMcpCallPayload(activeTool.name, parsedArgs, Date.now());
      const response = await engine.call<any>("POST", "/api/mcp", payload);
      const duration = Math.round(performance.now() - start);
      const formatted = formatMcpResponse(response);

      setExecutionResult({
        status: formatted.isError ? "error" : "success",
        data: formatted.data,
        rawText: formatted.rawText,
        durationMs: duration,
      });

      if (formatted.isError) {
        toast.error(`Tool returned error: ${response.error?.message || "Execution failed"}`);
      } else {
        toast.success(`Executed ${activeTool.name} in ${duration}ms`);
      }
    } catch (err: any) {
      const duration = Math.round(performance.now() - start);
      setExecutionResult({
        status: "error",
        data: { error: err.message },
        rawText: JSON.stringify({ error: err.message }, null, 2),
        durationMs: duration,
      });
      toast.error(err.message || "Execution error");
    } finally {
      setExecuting(false);
    }
  };

  // Mint instant token
  const mintToken = async (scope: "admin" | "read") => {
    try {
      const res = await engine.call<{ token: string }>("POST", "/api/tokens", {
        name: `mcp-${selectedClient}-${scope}`,
        scopes: [scope],
      });
      setSelectedToken(res.token);
      toast.success(`Minted new ${scope} MCP token!`);
    } catch (e: any) {
      toast.error(e.message || "Failed to mint token");
    }
  };

  const ideConfig = useMemo(() => {
    return generateIdeConfig(selectedClient, engine.url, selectedToken);
  }, [selectedClient, engine.url, selectedToken]);

  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(ideConfig.snippet);
      setCopied(true);
      toast.success(`Copied ${ideConfig.filename} to clipboard!`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <div className="space-y-6" data-testid="mcp-hub-page">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Bot className="h-4 w-4" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              AI Agents &amp; MCP Hub
            </h1>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Native Model Context Protocol (MCP 2024-11-05) JSON-RPC 2.0 interface for Cursor, Claude
            Desktop, and autonomous agents.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-1.5 text-xs font-mono shadow-xs">
            <span className="text-muted-foreground">Spec:</span>
            <span className="text-primary font-semibold">{mcpInfo?.mcp || "2024-11-05"}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-emerald-400 font-semibold">
              {toolsList.length || mcpInfo?.toolsCount || 46} Tools
            </span>
          </div>

          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-500">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Endpoint: /api/mcp</span>
          </div>

          <button
            type="button"
            onClick={() => refetchMcp()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shadow-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* Quick Setup Card for IDEs */}
      <div className="rounded-xl border border-border bg-card/60 backdrop-blur-xs p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              1-Click IDE Configuration
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add HosteraX as an MCP server to let AI tools inspect logs, deploy projects, and
              analyze performance.
            </p>
          </div>

          {/* Client Selector Pills */}
          <div className="flex flex-wrap items-center gap-1.5 bg-muted/40 p-1 rounded-lg border border-border/60 text-xs font-medium">
            <button
              type="button"
              onClick={() => setSelectedClient("cursor")}
              className={`px-2.5 py-1 rounded-md transition-all ${
                selectedClient === "cursor"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Cursor
            </button>
            <button
              type="button"
              onClick={() => setSelectedClient("claude_desktop")}
              className={`px-2.5 py-1 rounded-md transition-all ${
                selectedClient === "claude_desktop"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Claude Desktop
            </button>
            <button
              type="button"
              onClick={() => setSelectedClient("windsurf")}
              className={`px-2.5 py-1 rounded-md transition-all ${
                selectedClient === "windsurf"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Windsurf
            </button>
            <button
              type="button"
              onClick={() => setSelectedClient("claude_code")}
              className={`px-2.5 py-1 rounded-md transition-all ${
                selectedClient === "claude_code"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Claude Code CLI
            </button>
          </div>
        </div>

        {/* Token Ingestion Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/60">
          <div className="flex items-center gap-2 text-xs">
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Inject Token:</span>
            <input
              type="password"
              placeholder="Paste token or mint below..."
              value={selectedToken}
              onChange={(e) => setSelectedToken(e.target.value)}
              className="h-7 w-52 rounded border border-input bg-input/40 px-2 text-xs font-mono outline-none focus:border-primary"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => mintToken("read")}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50"
            >
              <ShieldCheck className="h-3 w-3 text-cyan-400" />
              <span>Mint Read-Only</span>
            </button>
            <button
              type="button"
              onClick={() => mintToken("admin")}
              className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20"
            >
              <Sparkles className="h-3 w-3" />
              <span>Mint Admin Token</span>
            </button>
            <button
              type="button"
              onClick={copyConfig}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 transition-all shadow-xs"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? "Copied!" : "Copy Config"}</span>
            </button>
          </div>
        </div>

        {/* Snippet display */}
        <div className="relative">
          <div className="absolute right-3 top-3 text-[10px] font-mono text-muted-foreground bg-muted/60 px-2 py-0.5 rounded">
            {ideConfig.filename}
          </div>
          <pre className="p-3.5 rounded-lg bg-muted/30 border border-border font-mono text-xs text-foreground/90 overflow-x-auto whitespace-pre">
            {ideConfig.snippet}
          </pre>
        </div>
      </div>

      {/* Interactive MCP Tool Playground & Catalog */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Tool Catalog (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Layers className="h-4 w-4 text-cyan-400" />
              Registered Tools ({filteredTools.length})
            </h3>
            <span className="text-[11px] font-mono text-muted-foreground">JSON-RPC 2.0</span>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tools e.g. metrics, deploy, crash..."
              className="w-full rounded-lg border border-input bg-input/40 py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary"
            />
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`px-2 py-0.5 rounded text-[11px] transition-all ${
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "bg-muted/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Tool List */}
          <div className="space-y-1.5 max-h-[540px] overflow-y-auto pr-1">
            {isToolsLoading && (
              <div className="p-6 text-center text-xs text-muted-foreground">
                Loading MCP tool schema...
              </div>
            )}
            {!isToolsLoading && filteredTools.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground border border-dashed rounded-lg">
                No tools found matching &quot;{search}&quot;
              </div>
            )}
            {filteredTools.map((tool) => {
              const isSelected = tool.name === activeToolName;
              const category = categorizeMcpTool(tool.name);
              return (
                <button
                  key={tool.name}
                  type="button"
                  onClick={() => selectTool(tool)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                    isSelected
                      ? "border-primary bg-primary/5 shadow-xs"
                      : "border-border/60 bg-card/40 hover:bg-muted/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-foreground">
                      {tool.name}
                    </span>
                    <span className="text-[10px] rounded px-1.5 py-0.2 font-medium bg-muted text-muted-foreground">
                      {category}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
                    {tool.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Execution Workbench (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Terminal className="h-4 w-4 text-emerald-400" />
              Interactive Execution Workbench
            </h3>
            {executionResult.durationMs !== undefined && (
              <span className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
                <Clock className="h-3 w-3" />
                {executionResult.durationMs}ms
              </span>
            )}
          </div>

          {activeTool ? (
            <div className="rounded-xl border border-border bg-card p-4 space-y-4 shadow-xs">
              {/* Active Tool Header */}
              <div className="border-b border-border/70 pb-3">
                <div className="flex items-center justify-between">
                  <span className="text-base font-bold font-mono text-foreground">
                    {activeTool.name}
                  </span>
                  <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
                    tools/call
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{activeTool.description}</p>
              </div>

              {/* Arguments Editor */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-muted-foreground flex items-center gap-1.5">
                    <Code2 className="h-3.5 w-3.5 text-primary" />
                    Input Arguments (JSON):
                  </span>
                  <button
                    type="button"
                    onClick={() => selectTool(activeTool)}
                    className="text-[11px] text-primary hover:underline"
                  >
                    Reset Defaults
                  </button>
                </div>
                <textarea
                  rows={4}
                  value={argumentsJson}
                  onChange={(e) => setArgumentsJson(e.target.value)}
                  className="w-full rounded-lg border border-input bg-input/40 p-2.5 font-mono text-xs outline-none focus:border-primary"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">Quick Presets:</span>
                  <button
                    type="button"
                    onClick={() => {
                      const t = toolsList.find((x) => x.name === "get_system_metrics");
                      if (t) selectTool(t);
                    }}
                    className="text-[11px] rounded bg-muted/60 hover:bg-muted px-2 py-0.5 text-foreground"
                  >
                    metrics
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const t = toolsList.find((x) => x.name === "list_projects");
                      if (t) selectTool(t);
                    }}
                    className="text-[11px] rounded bg-muted/60 hover:bg-muted px-2 py-0.5 text-foreground"
                  >
                    projects
                  </button>
                </div>

                <button
                  type="button"
                  data-testid="btn-run-mcp-tool"
                  onClick={handleExecute}
                  disabled={executing}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-xs font-semibold transition-all shadow-xs disabled:opacity-50"
                >
                  <Play className={`h-3.5 w-3.5 ${executing ? "animate-spin" : ""}`} />
                  <span>{executing ? "Calling..." : "Execute Tool"}</span>
                </button>
              </div>

              {/* Result Terminal */}
              <div className="space-y-1.5 pt-2 border-t border-border/70">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-muted-foreground">JSON-RPC 2.0 Response:</span>
                  {executionResult.status !== "idle" && (
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                        executionResult.status === "success"
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-destructive/10 text-destructive border border-destructive/20"
                      }`}
                    >
                      {executionResult.status === "success" ? "200 OK" : "RPC ERROR"}
                    </span>
                  )}
                </div>

                <pre className="p-3 rounded-lg bg-muted/30 border border-border font-mono text-[11px] text-foreground/90 max-h-[300px] overflow-y-auto whitespace-pre">
                  {executionResult.rawText ||
                    '// Click "Execute Tool" to send JSON-RPC payload to /api/mcp'}
                </pre>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
              Select a tool on the left to inspect and execute
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
