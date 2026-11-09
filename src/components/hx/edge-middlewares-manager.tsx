import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEngine } from "@/lib/engine";
import {
  generateCaddySnippet,
  generateNginxSnippet,
  testMiddlewareEvaluation,
  PRESET_MIDDLEWARES,
  type EdgeMiddleware,
  type MiddlewareType,
  type SimulationRequest,
  type SimulationResult,
} from "@/utils/edge-middlewares";
import {
  ShieldCheck,
  ShieldAlert,
  Lock,
  Zap,
  Globe,
  SlidersHorizontal,
  Plus,
  Play,
  Copy,
  Check,
  Trash2,
  Edit2,
  Code2,
  Radio,
  FileCode,
  ArrowRight,
  Sparkles,
  Info,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

interface EdgeMiddlewaresManagerProps {
  availableDomains?: { hostname: string; project: string }[];
}

const TYPE_METAS: Record<
  MiddlewareType,
  { label: string; icon: any; color: string; bg: string; border: string }
> = {
  "basic-auth": {
    label: "Basic Authentication",
    icon: Lock,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
  "rate-limit": {
    label: "Rate Limiting & Anti-DDoS",
    icon: Zap,
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/30",
  },
  "ip-whitelist": {
    label: "IP & CIDR Firewall",
    icon: ShieldCheck,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
  },
  "security-headers": {
    label: "Security Headers & HSTS",
    icon: ShieldAlert,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  cors: {
    label: "CORS Access Control",
    icon: Globe,
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/30",
  },
  "redirect-rewrite": {
    label: "Path Rewrite & Redirection",
    icon: ArrowRight,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/30",
  },
  "body-limit": {
    label: "Payload Buffer Limit",
    icon: SlidersHorizontal,
    color: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/30",
  },
};

export function EdgeMiddlewaresManager({ availableDomains = [] }: EdgeMiddlewaresManagerProps) {
  const engine = useEngine();

  // Load active edge status
  const { data: edgeStatus } = useQuery<any>({
    queryKey: ["edge-status-mw", engine.url],
    queryFn: async () => {
      try {
        return await engine.call<any>("GET", "/api/edge/status");
      } catch {
        return { provider: "caddy", containerStatus: "running" };
      }
    },
    refetchInterval: 5000,
  });

  const provider = edgeStatus?.provider === "openresty" ? "openresty" : "caddy";

  // Middlewares state: initialize from presets with sensible storage
  const [middlewares, setMiddlewares] = useState<EdgeMiddleware[]>(() => {
    try {
      const saved = localStorage.getItem("hx_edge_middlewares");
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return PRESET_MIDDLEWARES;
  });

  const saveMiddlewares = (updated: EdgeMiddleware[]) => {
    setMiddlewares(updated);
    try {
      localStorage.setItem("hx_edge_middlewares", JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  // Selected middleware for inspecting snippet or editing
  const [selectedMiddlewareId, setSelectedMiddlewareId] = useState<string>(
    middlewares[0]?.id || "",
  );
  const [copiedCode, setCopiedCode] = useState(false);
  const [activeSyntax, setActiveSyntax] = useState<"caddy" | "nginx">(
    provider === "openresty" ? "nginx" : "caddy",
  );

  // Simulator State
  const [simIp, setSimIp] = useState("127.0.0.1");
  const [simPath, setSimPath] = useState("/");
  const [simMethod, setSimMethod] = useState("GET");
  const [simAuthUser, setSimAuthUser] = useState("admin");
  const [simAuthPass, setSimAuthPass] = useState("hosterax-staging-2026");
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);

  // Modal State for New/Edit Middleware
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formType, setFormType] = useState<MiddlewareType>("basic-auth");
  const [formConfig, setFormConfig] = useState<EdgeMiddleware["config"]>({});
  const [formAttached, setFormAttached] = useState<string[]>([]);

  const activeMiddleware = middlewares.find((m) => m.id === selectedMiddlewareId) || middlewares[0];

  const handleToggle = (id: string) => {
    const next = middlewares.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m));
    saveMiddlewares(next);
    toast.success("Middleware policy state updated");
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this edge middleware?")) return;
    const next = middlewares.filter((m) => m.id !== id);
    saveMiddlewares(next);
    if (selectedMiddlewareId === id && next.length > 0) {
      setSelectedMiddlewareId(next[0].id);
    }
    toast.info("Middleware deleted");
  };

  const copyConfigSnippet = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    toast.success("Snippet copied to clipboard!");
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleRunSimulation = () => {
    if (!activeMiddleware) return;

    const headers: Record<string, string> = {};
    if (simAuthUser && simAuthPass) {
      const token = btoa(`${simAuthUser}:${simAuthPass}`);
      headers["authorization"] = `Basic ${token}`;
    }

    const req: SimulationRequest = {
      ip: simIp,
      path: simPath,
      method: simMethod,
      headers,
    };

    const result = testMiddlewareEvaluation(activeMiddleware, req);
    setSimResult(result);
    if (result.allowed) {
      toast.success(`Request accepted (HTTP ${result.statusCode})`);
    } else {
      toast.warning(`Request blocked (HTTP ${result.statusCode}): ${result.reason}`);
    }
  };

  const openCreateModal = () => {
    setEditingId(null);
    setFormName("");
    setFormDesc("");
    setFormType("basic-auth");
    setFormConfig({ username: "admin", password: "password", realm: "Protected Area" });
    setFormAttached([]);
    setIsModalOpen(true);
  };

  const openEditModal = (m: EdgeMiddleware) => {
    setEditingId(m.id);
    setFormName(m.name);
    setFormDesc(m.description);
    setFormType(m.type);
    setFormConfig({ ...m.config });
    setFormAttached([...m.attachedDomains]);
    setIsModalOpen(true);
  };

  const handleSaveModal = () => {
    if (!formName.trim()) return toast.error("Please enter a middleware name");

    if (editingId) {
      const next = middlewares.map((m) =>
        m.id === editingId
          ? {
              ...m,
              name: formName.trim(),
              description: formDesc.trim(),
              type: formType,
              config: formConfig,
              attachedDomains: formAttached,
            }
          : m,
      );
      saveMiddlewares(next);
      toast.success(`Updated middleware "${formName.trim()}"`);
    } else {
      const newId = `mw-${Date.now().toString(36)}`;
      const newMw: EdgeMiddleware = {
        id: newId,
        name: formName.trim(),
        description: formDesc.trim() || "Custom edge middleware policy",
        type: formType,
        enabled: true,
        attachedDomains: formAttached,
        config: formConfig,
      };
      const next = [...middlewares, newMw];
      saveMiddlewares(next);
      setSelectedMiddlewareId(newId);
      toast.success(`Created middleware "${newMw.name}"`);
    }

    setIsModalOpen(false);
  };

  const toggleDomainAttachment = (hostname: string) => {
    if (formAttached.includes(hostname)) {
      setFormAttached(formAttached.filter((h) => h !== hostname));
    } else {
      setFormAttached([...formAttached, hostname]);
    }
  };

  const activeSnippet = activeMiddleware
    ? activeSyntax === "caddy"
      ? generateCaddySnippet(activeMiddleware)
      : generateNginxSnippet(activeMiddleware)
    : "";

  return (
    <div className="space-y-6">
      {/* Top Overview Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl border border-border/80 bg-card/70 backdrop-blur shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              Edge Middlewares & Security Gateway
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {provider === "openresty" ? "OpenResty Nginx Engine" : "Caddy 2 Engine"}
              </span>
            </h2>
            <p className="text-xs text-muted-foreground">
              Define reusable edge security policies, IP CIDR firewalls, HTTP Basic Auth, anti-DDoS
              rate limits, and attach them across any domain.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.99] transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>New Middleware</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Left Policies (6/12) + Right Inspector & Simulator (6/12) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Middlewares Catalog (6/12) */}
        <div className="lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Configured Policies ({middlewares.length})
            </span>
            <span className="text-xs text-muted-foreground">
              {middlewares.filter((m) => m.enabled).length} active
            </span>
          </div>

          <div className="space-y-3">
            {middlewares.map((mw) => {
              const isSelected = mw.id === selectedMiddlewareId;
              const meta = TYPE_METAS[mw.type] || TYPE_METAS["security-headers"];
              const Icon = meta.icon;

              return (
                <div
                  key={mw.id}
                  onClick={() => setSelectedMiddlewareId(mw.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                    isSelected
                      ? "bg-card border-primary shadow-md ring-1 ring-primary/40"
                      : "bg-card/50 border-border hover:bg-card hover:border-border/80"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center ${meta.bg} ${meta.color} ${meta.border} border flex-shrink-0 mt-0.5`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-sm text-foreground">{mw.name}</h4>
                          <span
                            className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${meta.bg} ${meta.color}`}
                          >
                            {meta.label}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          {mw.description}
                        </p>
                      </div>
                    </div>

                    {/* Enable Toggle & Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggle(mw.id);
                        }}
                        className={`w-8 h-4 rounded-full transition-colors relative flex items-center p-0.5 ${
                          mw.enabled ? "bg-emerald-500" : "bg-muted"
                        }`}
                        title={mw.enabled ? "Policy enabled" : "Policy disabled"}
                      >
                        <span
                          className={`w-3 h-3 rounded-full bg-white transition-transform ${
                            mw.enabled ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditModal(mw);
                        }}
                        className="text-muted-foreground/60 hover:text-foreground p-1 rounded hover:bg-accent transition-all"
                        title="Edit policy"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(mw.id);
                        }}
                        className="text-muted-foreground/60 hover:text-rose-400 p-1 rounded hover:bg-rose-500/10 transition-all"
                        title="Delete policy"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Attached Domains Chip */}
                  <div className="mt-3 pt-2.5 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5 text-[11px]">
                      <Globe className="w-3 h-3 text-primary" />
                      {mw.attachedDomains.length === 0 ? (
                        <span className="italic">Not attached to any domain</span>
                      ) : (
                        <span className="font-mono text-foreground font-medium">
                          {mw.attachedDomains.length} domain
                          {mw.attachedDomains.length > 1 ? "s" : ""} attached
                        </span>
                      )}
                    </span>

                    <span className="text-[10px] font-mono text-muted-foreground/70">
                      ID: {mw.id}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Code Generator & Request Simulator (6/12) */}
        <div className="lg:col-span-6 space-y-6">
          {activeMiddleware ? (
            <>
              {/* Box 1: Live Edge Proxy Snippet */}
              <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <Code2 className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-bold text-foreground">
                      Generated Edge Proxy Directives
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-lg border border-border bg-surface p-0.5 text-xs">
                      <button
                        onClick={() => setActiveSyntax("caddy")}
                        className={`px-2.5 py-0.5 rounded font-medium transition-all ${
                          activeSyntax === "caddy"
                            ? "bg-primary text-primary-foreground font-bold shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Caddyfile
                      </button>
                      <button
                        onClick={() => setActiveSyntax("nginx")}
                        className={`px-2.5 py-0.5 rounded font-medium transition-all ${
                          activeSyntax === "nginx"
                            ? "bg-primary text-primary-foreground font-bold shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        OpenResty Nginx
                      </button>
                    </div>

                    <button
                      onClick={() => copyConfigSnippet(activeSnippet)}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-accent text-foreground transition-all"
                    >
                      {copiedCode ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedCode ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-border/80 bg-[#0d1117] p-3.5 font-mono text-xs text-foreground/90 overflow-x-auto leading-relaxed shadow-inner">
                  <pre>{activeSnippet}</pre>
                </div>
              </div>

              {/* Box 2: Interactive Policy Simulator */}
              <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <Play className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-bold text-foreground">
                      Edge Request Simulator & Inspector
                    </h3>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-surface border border-border text-muted-foreground">
                    Simulating: {activeMiddleware.name}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground">
                  Simulate an incoming HTTP request hitting the edge gateway to verify that this
                  policy admits or rejects traffic as expected.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                      Client IP Address
                    </label>
                    <input
                      value={simIp}
                      onChange={(e) => setSimIp(e.target.value)}
                      placeholder="e.g. 127.0.0.1 or 198.51.100.22"
                      className="w-full px-3 py-1.5 font-mono text-xs bg-surface border border-border rounded-lg outline-none focus:border-primary text-foreground"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                      Request Path
                    </label>
                    <input
                      value={simPath}
                      onChange={(e) => setSimPath(e.target.value)}
                      placeholder="e.g. / or /api/v1"
                      className="w-full px-3 py-1.5 font-mono text-xs bg-surface border border-border rounded-lg outline-none focus:border-primary text-foreground"
                    />
                  </div>

                  {activeMiddleware.type === "basic-auth" && (
                    <>
                      <div>
                        <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                          Test Username
                        </label>
                        <input
                          value={simAuthUser}
                          onChange={(e) => setSimAuthUser(e.target.value)}
                          className="w-full px-3 py-1.5 font-mono text-xs bg-surface border border-border rounded-lg outline-none focus:border-primary text-foreground"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                          Test Password
                        </label>
                        <input
                          type="password"
                          value={simAuthPass}
                          onChange={(e) => setSimAuthPass(e.target.value)}
                          className="w-full px-3 py-1.5 font-mono text-xs bg-surface border border-border rounded-lg outline-none focus:border-primary text-foreground"
                        />
                      </div>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleRunSimulation}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-all shadow-sm"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Execute Simulated HTTP Evaluation</span>
                </button>

                {/* Simulation Output Card */}
                {simResult && (
                  <div
                    className={`p-3.5 rounded-xl border space-y-2 text-xs animate-in fade-in duration-200 ${
                      simResult.allowed
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                        : "bg-rose-500/10 border-rose-500/30 text-rose-300"
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span className="flex items-center gap-1.5">
                        {simResult.allowed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-400" />
                        )}
                        <span>
                          {simResult.allowed ? "Passed" : "Blocked"} — HTTP {simResult.statusCode}
                        </span>
                      </span>
                      <span className="font-mono text-[10px] uppercase">
                        {simResult.allowed ? "Allowed to Upstream" : "Halted at Edge"}
                      </span>
                    </div>

                    <p className="text-[11px] leading-relaxed text-foreground/90">
                      {simResult.reason}
                    </p>

                    {Object.keys(simResult.injectedHeaders).length > 0 && (
                      <div className="pt-2 border-t border-border/40 font-mono text-[10px] space-y-1 text-foreground/80">
                        <span className="font-sans font-bold text-muted-foreground block">
                          Response Headers Injected:
                        </span>
                        {Object.entries(simResult.injectedHeaders).map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between">
                            <span className="text-primary font-semibold">{k}:</span>
                            <span className="truncate max-w-[240px] text-foreground">{v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-8 rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground">
              Select a middleware on the left to inspect its directives and test requests.
            </div>
          )}
        </div>
      </div>

      {/* Create / Edit Modal Dialog */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">
                {editingId ? "Edit Edge Middleware Policy" : "Create New Edge Middleware Policy"}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="font-semibold text-foreground/90 block mb-1">Policy Name</label>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Production Staging Auth"
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg outline-none focus:border-primary text-foreground text-xs font-medium"
                />
              </div>

              <div>
                <label className="font-semibold text-foreground/90 block mb-1">Description</label>
                <input
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="e.g. Protects preview branches with HTTP Basic Auth"
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg outline-none focus:border-primary text-foreground text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-foreground/90 block mb-1">
                  Middleware Type
                </label>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as MiddlewareType)}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg outline-none focus:border-primary text-foreground text-xs"
                >
                  <option value="basic-auth">Basic Authentication</option>
                  <option value="rate-limit">Rate Limiting & Anti-DDoS</option>
                  <option value="ip-whitelist">IP & CIDR Firewall Allowlist</option>
                  <option value="security-headers">Enterprise Security Headers</option>
                  <option value="cors">CORS Access Control</option>
                  <option value="redirect-rewrite">Path Rewrite & Redirection</option>
                  <option value="body-limit">Payload Buffer Limit</option>
                </select>
              </div>

              {/* Type-specific inputs */}
              {formType === "basic-auth" && (
                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-border bg-surface/50">
                  <div>
                    <label className="font-semibold text-muted-foreground block mb-1">
                      Username
                    </label>
                    <input
                      value={formConfig.username || ""}
                      onChange={(e) => setFormConfig({ ...formConfig, username: e.target.value })}
                      placeholder="admin"
                      className="w-full px-2.5 py-1.5 font-mono bg-card border border-border rounded-md text-foreground"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-muted-foreground block mb-1">
                      Password
                    </label>
                    <input
                      value={formConfig.password || ""}
                      onChange={(e) => setFormConfig({ ...formConfig, password: e.target.value })}
                      placeholder="password"
                      className="w-full px-2.5 py-1.5 font-mono bg-card border border-border rounded-md text-foreground"
                    />
                  </div>
                </div>
              )}

              {formType === "rate-limit" && (
                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-border bg-surface/50">
                  <div>
                    <label className="font-semibold text-muted-foreground block mb-1">
                      Requests / Minute
                    </label>
                    <input
                      type="number"
                      value={formConfig.requestsPerMinute || 60}
                      onChange={(e) =>
                        setFormConfig({
                          ...formConfig,
                          requestsPerMinute: Number(e.target.value),
                        })
                      }
                      className="w-full px-2.5 py-1.5 font-mono bg-card border border-border rounded-md text-foreground"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-muted-foreground block mb-1">
                      Burst Limit
                    </label>
                    <input
                      type="number"
                      value={formConfig.burst || 10}
                      onChange={(e) =>
                        setFormConfig({ ...formConfig, burst: Number(e.target.value) })
                      }
                      className="w-full px-2.5 py-1.5 font-mono bg-card border border-border rounded-md text-foreground"
                    />
                  </div>
                </div>
              )}

              {formType === "ip-whitelist" && (
                <div className="p-3 rounded-lg border border-border bg-surface/50 space-y-2">
                  <label className="font-semibold text-muted-foreground block">
                    Permitted IPs or Subnets (comma or newline separated)
                  </label>
                  <textarea
                    rows={3}
                    value={(formConfig.allowedIps || ["127.0.0.1", "10.0.0.0/8"]).join("\n")}
                    onChange={(e) =>
                      setFormConfig({
                        ...formConfig,
                        allowedIps: e.target.value
                          .split(/[\n,]/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="127.0.0.1&#10;192.168.1.0/24&#10;10.0.0.0/8"
                    className="w-full px-2.5 py-1.5 font-mono bg-card border border-border rounded-md text-foreground resize-none"
                  />
                </div>
              )}

              {/* Attach to Domains */}
              <div className="space-y-2 pt-2 border-t border-border/60">
                <label className="font-semibold text-foreground/90 block">
                  Attach to Registered Domains ({availableDomains.length} available)
                </label>
                <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-1">
                  {availableDomains.map((dom) => {
                    const isAttached = formAttached.includes(dom.hostname);
                    return (
                      <button
                        key={dom.hostname}
                        type="button"
                        onClick={() => toggleDomainAttachment(dom.hostname)}
                        className={`px-2.5 py-1 rounded-lg border text-xs font-mono transition-all ${
                          isAttached
                            ? "bg-primary text-primary-foreground border-primary font-bold shadow-sm"
                            : "bg-surface border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {isAttached ? "✓ " : "+ "}
                        {dom.hostname}
                      </button>
                    );
                  })}
                  {availableDomains.length === 0 && (
                    <span className="text-muted-foreground italic text-xs">
                      No external domains registered yet. You can attach this policy anytime from
                      Domains & SSL.
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveModal}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-all shadow-sm"
              >
                {editingId ? "Save Changes" : "Create Policy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
