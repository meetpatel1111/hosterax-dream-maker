import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  UNIFIED_TEMPLATES_AND_APPS,
  TEMPLATE_CATEGORIES,
  TemplateCategory,
  UnifiedAppTemplate,
import { useEngine, useEngineHealth, useMagicDnsSettings, formatMagicDnsUrl } from "@/lib/engine";
import { AppLogo } from "@/components/hx/app-logo";
import {
  Package,
  Search,
  Sparkles,
  ExternalLink,
  Trash2,
  Rocket,
  Filter,
  CheckCircle2,
  Layers,
} from "lucide-react";

export function TemplatesAndAppsCatalog({
  onSelectTemplate,
  variant = "full",
}: {
  onSelectTemplate?: (template: UnifiedAppTemplate) => void;
  variant?: "full" | "compact" | "new-project-tab";
}) {
  const eng = useEngine();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: health } = useEngineHealth();
  const { data: magicDns } = useMagicDnsSettings();
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [installingId, setInstallingId] = useState<string | null>(null);

  // Query installed docker apps from engine
  const { data: installedApps = [] } = useQuery({
    queryKey: ["engine-apps", eng.url, eng.token],
    queryFn: async () => (await eng.call<any[]>("GET", "/api/apps").catch(() => [])) ?? [],
    enabled: !!health?.ok,
    refetchInterval: 3000,
  });

  const filteredItems = UNIFIED_TEMPLATES_AND_APPS.filter((item) => {
    const matchesCat = selectedCategory === "all" || item.category === selectedCategory;
    const term = searchQuery.toLowerCase().trim();
    if (!term) return matchesCat;
    const matchesSearch =
      item.name.toLowerCase().includes(term) ||
      item.desc.toLowerCase().includes(term) ||
      item.tags.some((t) => t.toLowerCase().includes(term)) ||
      (item.image && item.image.toLowerCase().includes(term)) ||
      (item.stack && item.stack.toLowerCase().includes(term));
    return matchesCat && matchesSearch;
  });

  async function handleAction(item: UnifiedAppTemplate) {
    if (onSelectTemplate) {
      return onSelectTemplate(item);
    }

    if (!health?.ok) {
      toast.error("HosteraX Engine must be connected to deploy");
      return;
    }

    try {
      setInstallingId(item.id);
      const projName = item.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
      const isDocker = item.kind === "one_click_app" || item.stack === "docker";
      const source = item.kind === "one_click_app" ? (item.image || "") : (item.repo_url || "./");

      // 1. Create first-class HosteraX project
      await eng.call("POST", "/api/projects", {
        name: projName,
        source,
        buildCmd: "",
        startCmd: "",
        target: isDocker ? "docker" : "process",
        port: item.port || 3000,
        env: item.env || {},
      });

      // 2. Queue immediate deployment
      await eng.call("POST", `/api/projects/${projName}/deploy`, {
        trigger: "template",
      });

      toast.success(`Project "${item.name}" created & deploy queued!`);
      qc.invalidateQueries({ queryKey: ["engine-projects"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      nav({ to: "/p/$slug", params: { slug: projName } });
    } catch (err: any) {
      toast.error(err.message || `Failed to deploy ${item.name}`);
    } finally {
      setInstallingId(null);
    }
  }

  async function uninstallApp(id: string, name: string) {
    if (!confirm(`Stop and remove container for "${name}"?`)) return;
    try {
      await eng.call("DELETE", `/api/apps/${id}`);
      toast.success(`Removed ${name}`);
      qc.invalidateQueries({ queryKey: ["engine-apps"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to remove app");
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Search */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <Layers className="h-5 w-5 text-primary" />
            Templates & One-Click Apps
          </h2>
          <p className="text-xs text-muted-foreground">
            Launch pre-configured Docker self-hosted applications and production starter frameworks in one click.
          </p>
        </div>

        {/* Search input */}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search templates, apps, tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border bg-background py-1.5 pl-9 pr-3 text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-3">
        {TEMPLATE_CATEGORIES.map((cat) => {
          const count =
            cat.id === "all"
              ? UNIFIED_TEMPLATES_AND_APPS.length
              : UNIFIED_TEMPLATES_AND_APPS.filter((t) => t.category === cat.id).length;
          const isActive = selectedCategory === cat.id;

          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
              }`}
            >
              <span>{cat.icon}</span>
              <span>{cat.label}</span>
              <span
                className={`ml-1 rounded-full px-1.5 py-0.2 text-[10px] ${
                  isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-border text-muted-foreground"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Grid of Templates & One-Click Apps */}
      {filteredItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <Package className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm font-medium">No templates or apps match your search</p>
          <p className="text-xs text-muted-foreground">Try clearing filters or search with another term.</p>
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => {
            const isInstalled = installedApps.some((a) => a.slug === item.id);
            const isBusy = installingId === item.id;

            return (
              <div
                key={item.id}
                className="group relative flex flex-col justify-between rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-md"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <AppLogo
                        name={item.name}
                        slug={item.slug || item.id}
                        website={item.website}
                        iconFallback={item.icon}
                        size="md"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-semibold text-sm group-hover:text-primary transition-colors">
                            {item.name}
                          </span>
                          {item.popular && (
                            <span className="rounded bg-amber-500/10 px-1.5 py-0.2 text-[9px] font-medium text-amber-500 border border-amber-500/20">
                              Popular
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          {item.kind === "one_click_app" ? (
                            <span className="font-mono text-cyan-500">🐳 Docker App</span>
                          ) : (
                            <span className="font-mono text-emerald-500">⚡ Starter Template</span>
                          )}
                          {item.port && <span>· :{item.port}</span>}
                        </div>
                      </div>
                    </div>
                  </div>

                  <p className="mt-2.5 line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                    {item.desc}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1">
                    {item.tags.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
                  <div className="text-[11px] text-muted-foreground font-mono">
                    {item.kind === "one_click_app" ? (
                      <span className="truncate max-w-[140px] block" title={item.image}>
                        {item.image?.split(":")[0]}
                      </span>
                    ) : (
                      <span>{item.stack || "auto"}</span>
                    )}
                  </div>

                  <button
                    onClick={() => handleAction(item)}
                    disabled={isBusy}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                      item.kind === "one_click_app"
                        ? "bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 border border-cyan-500/30"
                        : "bg-primary text-primary-foreground hover:opacity-90 shadow-sm"
                    }`}
                  >
                    {isBusy ? (
                      <Sparkles className="h-3.5 w-3.5 animate-spin" />
                    ) : item.kind === "one_click_app" ? (
                      <Rocket className="h-3.5 w-3.5" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {isBusy
                        ? "Deploying..."
                        : item.kind === "one_click_app"
                        ? "1-Click Deploy"
                        : "Use Template"}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Active Running Installed Docker Apps Section */}
      {installedApps.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5 mt-8">
          <div className="flex items-center justify-between mb-3 border-b border-border pb-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Active One-Click Apps ({installedApps.length})
            </h3>
            <span className="text-[11px] text-muted-foreground">Managed on local Docker daemon</span>
          </div>

          <div className="divide-y divide-border">
            {installedApps.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-sm">
                    🐳
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{a.name}</span>
                      <span
                        className={`rounded px-1.5 py-0.2 text-[10px] font-mono uppercase ${
                          a.status === "running"
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                            : "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                        }`}
                      >
                        {a.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono mt-0.5">
                      {a.container_id && (
                        <span>ID: {a.container_id.slice(0, 12)}</span>
                      )}
                      {a.port && (
                        <a
                          href={`http://${formatMagicDnsUrl(a.slug, magicDns?.activeProvider || "sslip.io", a.port)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline flex items-center gap-1 font-mono"
                        >
                          {formatMagicDnsUrl(a.slug, magicDns?.activeProvider || "sslip.io", a.port)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {a.port && (
                    <a
                      href={`http://localhost:${a.port}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded bg-surface-2 px-2 py-1 text-xs font-mono text-foreground hover:bg-surface-3 transition-colors"
                    >
                      Open : {a.port}
                    </a>
                  )}
                  <button
                    onClick={() => uninstallApp(a.id, a.name)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                    title="Remove App"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
