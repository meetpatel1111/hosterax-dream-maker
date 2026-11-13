import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEngine, useActiveOrgId } from "@/lib/engine";
import { confirmAction } from "@/components/hx/confirm-modal";
import {
  generateCaddySnippet,
  generateNginxSnippet,
  testMiddlewareEvaluation,
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
  ArrowRight,
  CheckCircle2,
  XCircle,
} from "lucide-react";

interface EdgeMiddlewaresManagerProps {
  availableDomains?: { hostname: string; project: string }[];
}

type BackendEdgeMiddleware = {
  id: string;
  org_id: string;
  name: string;
  kind: string;
  scope_type: string;
  scope_target: string;
  config: Record<string, any>;
  enabled: boolean;
  priority: number;
  created_at: number;
  updated_at: number;
};

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

function mapBackendMiddleware(row: BackendEdgeMiddleware): EdgeMiddleware {
  const attachedDomains =
    row.scope_type === "domain" && row.scope_target && row.scope_target !== "*"
      ? row.scope_target
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const cfg = row.config || {};
  return {
    id: row.id,
    name: row.name,
    description: String(cfg.description || "Engine-synced edge middleware policy"),
    type: (row.kind as MiddlewareType) || "security-headers",
    enabled: Boolean(row.enabled),
    attachedDomains,
    config: cfg,
  };
}

export function EdgeMiddlewaresManager({ availableDomains = [] }: EdgeMiddlewaresManagerProps) {
  const engine = useEngine();
  const orgId = useActiveOrgId();
  const qc = useQueryClient();

  const { data: edgeStatus } = useQuery<any>({
    queryKey: ["edge-status-mw", engine.url],
    queryFn: () => engine.call<any>("GET", "/api/edge/status"),
    refetchInterval: 10000,
  });

  const provider = edgeStatus?.provider === "openresty" ? "openresty" : "caddy";

  const { data: rawMiddlewares = [], isLoading } = useQuery<BackendEdgeMiddleware[]>({
    queryKey: ["edge-middlewares", engine.url, engine.token, orgId],
    queryFn: () => engine.call<BackendEdgeMiddleware[]>("GET", "/api/edge/middlewares"),
  });

  const middlewares = useMemo(() => rawMiddlewares.map(mapBackendMiddleware), [rawMiddlewares]);

  const [selectedMiddlewareId, setSelectedMiddlewareId] = useState<string>("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [activeSyntax, setActiveSyntax] = useState<"caddy" | "nginx">(
    provider === "openresty" ? "nginx" : "caddy",
  );

  // Simulator State
  const [simIp, setSimIp] = useState("127.0.0.1");
  const [simPath, setSimPath] = useState("/");
  const [simAuthUser, setSimAuthUser] = useState("admin");
  const [simAuthPass, setSimAuthPass] = useState("");
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formType, setFormType] = useState<MiddlewareType>("basic-auth");
  const [formConfig, setFormConfig] = useState<EdgeMiddleware["config"]>({});
  const [formAttached, setFormAttached] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const activeMiddleware =
    middlewares.find((m) => m.id === selectedMiddlewareId) || middlewares[0] || null;

  const handleToggle = async (mw: EdgeMiddleware) => {
    await engine.call("PATCH", `/api/edge/middlewares/${encodeURIComponent(mw.id)}`, {
      enabled: !mw.enabled,
    });
    await qc.invalidateQueries({ queryKey: ["edge-middlewares"] });
    toast.success(`Middleware "${mw.name}" ${!mw.enabled ? "enabled" : "disabled"}`);
  };

  const handleDelete = async (mw: EdgeMiddleware) => {
    const ok = await confirmAction({
      title: `Delete Edge Middleware "${mw.name}"`,
      description: "Are you sure you want to remove this edge proxy policy from HosteraX?",
      variant: "destructive",
      confirmLabel: "Delete Policy",
    });
    if (!ok) return;
    await engine.call("DELETE", `/api/edge/middlewares/${encodeURIComponent(mw.id)}`);
    await qc.invalidateQueries({ queryKey: ["edge-middlewares"] });
    toast.success("Middleware deleted and edge routes resynced");
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
      headers["authorization"] = `Basic ${btoa(`${simAuthUser}:${simAuthPass}`)}`;
    }
    const req: SimulationRequest = { ip: simIp, path: simPath, method: "GET", headers };
    const result = testMiddlewareEvaluation(activeMiddleware, req);
    setSimResult(result);
    if (result.allowed) toast.success(`Request accepted (HTTP ${result.statusCode})`);
    else toast.warning(`Request blocked (HTTP ${result.statusCode}): ${result.reason}`);
  };

  const openCreateModal = () => {
    setEditingId(null);
    setFormName("");
    setFormDesc("");
    setFormType("basic-auth");
    setFormConfig({ username: "admin", password: "", realm: "Protected Area" });
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

  const handleSaveModal = async () => {
    if (!formName.trim()) return toast.error("Please enter a middleware name");
    setIsSaving(true);
    try {
      const payload = {
        name: formName.trim(),
        kind: formType,
        scopeType: formAttached.length > 0 ? "domain" : "global",
        scopeTarget: formAttached.length > 0 ? formAttached.join(",") : "*",
        config: {
          ...formConfig,
          description: formDesc.trim() || "Custom edge middleware policy",
        },
      };

      if (editingId) {
        await engine.call(
          "PATCH",
          `/api/edge/middlewares/${encodeURIComponent(editingId)}`,
          payload,
        );
        toast.success(`Updated middleware "${payload.name}"`);
      } else {
        const created = await engine.call<BackendEdgeMiddleware>(
          "POST",
          "/api/edge/middlewares",
          payload,
        );
        setSelectedMiddlewareId(created.id);
        toast.success(`Created middleware "${payload.name}"`);
      }

      await qc.invalidateQueries({ queryKey: ["edge-middlewares"] });
      setIsModalOpen(false);
    } finally {
      setIsSaving(false);
    }
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
    <div className="space-y-6" data-testid="edge-middlewares-manager">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl border border-border/80 bg-card/70 backdrop-blur shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              Edge Middlewares &amp; Security Gateway
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {provider === "openresty" ? "OpenResty Nginx Engine" : "Caddy 2 Engine"}
              </span>
            </h2>
            <p className="text-xs text-muted-foreground">
              Persisted edge policies synced directly into the HosteraX proxy configuration.
            </p>
          </div>
        </div>

        <button
          type="button"
          data-testid="btn-new-middleware"
          onClick={openCreateModal}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.99] transition-all shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>New Middleware</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
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
            {isLoading ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                Loading edge middleware policies...
              </div>
            ) : middlewares.length === 0 ? (
              <div className="p-8 rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground">
                No edge middlewares configured yet. Create a policy to inject Caddy or OpenResty
                rules.
              </div>
            ) : (
              middlewares.map((mw) => {
                const isSelected = mw.id === activeMiddleware?.id;
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
                          <div className="flex items-center flex-wrap gap-2">
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

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggle(mw);
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
                            handleDelete(mw);
                          }}
                          className="text-muted-foreground/60 hover:text-rose-400 p-1 rounded hover:bg-rose-500/10 transition-all"
                          title="Delete policy"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5 text-[11px]">
                        <Globe className="w-3 h-3 text-primary" />
                        {mw.attachedDomains.length === 0 ? (
                          <span>Global (*)</span>
                        ) : (
                          <span className="font-mono text-foreground font-medium">
                            {mw.attachedDomains.join(", ")}
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground/70">
                        {mw.id}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="lg:col-span-6 space-y-6">
          {activeMiddleware ? (
            <>
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
                        type="button"
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
                        type="button"
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
                      type="button"
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

              <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <Play className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-bold text-foreground">
                      Policy Dry-Run Evaluator
                    </h3>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-surface border border-border text-muted-foreground">
                    {activeMiddleware.name}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                      Client IP Address
                    </label>
                    <input
                      value={simIp}
                      onChange={(e) => setSimIp(e.target.value)}
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
                  <span>Test Policy Match</span>
                </button>

                {simResult && (
                  <div
                    className={`p-3.5 rounded-xl border space-y-2 text-xs ${
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
                    </div>
                    <p className="text-[11px] leading-relaxed text-foreground/90">
                      {simResult.reason}
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-8 rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground">
              Select a middleware on the left to inspect its generated edge proxy directives.
            </div>
          )}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">
                {editingId ? "Edit Edge Middleware Policy" : "Create New Edge Middleware Policy"}
              </h3>
              <button
                type="button"
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
                  <option value="rate-limit">Rate Limiting &amp; Anti-DDoS</option>
                  <option value="ip-whitelist">IP &amp; CIDR Firewall Allowlist</option>
                  <option value="security-headers">Enterprise Security Headers</option>
                  <option value="cors">CORS Access Control</option>
                  <option value="redirect-rewrite">Path Rewrite &amp; Redirection</option>
                  <option value="body-limit">Payload Buffer Limit</option>
                </select>
              </div>

              {formType === "basic-auth" && (
                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-border bg-surface/50">
                  <div>
                    <label className="font-semibold text-muted-foreground block mb-1">
                      Username
                    </label>
                    <input
                      value={formConfig.username || ""}
                      onChange={(e) => setFormConfig({ ...formConfig, username: e.target.value })}
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
                        setFormConfig({ ...formConfig, requestsPerMinute: Number(e.target.value) })
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
                    Permitted IPs or Subnets
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
                    className="w-full px-2.5 py-1.5 font-mono bg-card border border-border rounded-md text-foreground resize-none"
                  />
                </div>
              )}

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
                      Applies globally (*) when no specific domain is selected.
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
                disabled={isSaving}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-all shadow-sm disabled:opacity-50"
              >
                {isSaving ? "Saving..." : editingId ? "Save Changes" : "Create Policy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
