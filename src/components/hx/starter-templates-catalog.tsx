import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  STARTER_TEMPLATES,
  STARTER_TEMPLATE_CATEGORIES,
  StarterTemplate,
} from "@/lib/stacks";
import { useEngine, useEngineHealth } from "@/lib/engine";
import {
  Search,
  Sparkles,
  Rocket,
  Filter,
  Layers,
  Code,
} from "lucide-react";

export function StarterTemplatesCatalog({
  onSelectTemplate,
  variant = "full",
}: {
  onSelectTemplate?: (template: StarterTemplate) => void;
  variant?: "full" | "compact" | "new-project-tab";
}) {
  const eng = useEngine();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: health } = useEngineHealth();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [installingId, setInstallingId] = useState<string | null>(null);

  const filteredItems = STARTER_TEMPLATES.filter((item) => {
    const matchesCat = selectedCategory === "all" || item.category === selectedCategory;
    const term = searchQuery.toLowerCase().trim();
    if (!term) return matchesCat;
    return (
      matchesCat &&
      (item.name.toLowerCase().includes(term) ||
        item.desc.toLowerCase().includes(term) ||
        item.tags.some((t) => t.toLowerCase().includes(term)) ||
        item.stack.toLowerCase().includes(term))
    );
  });

  async function handleAction(item: StarterTemplate) {
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

      // 1. Create first-class HosteraX project
      await eng.call("POST", "/api/projects", {
        name: projName,
        source: item.repo_url,
        buildCmd: "",
        startCmd: "",
        target: "process",
        port: item.port || 3000,
        env: item.env || {},
      });

      // 2. Queue immediate deployment
      await eng.call("POST", `/api/projects/${projName}/deploy`, {
        trigger: "template",
      });

      toast.success(`Template project "${item.name}" created & deploy queued!`);
      qc.invalidateQueries({ queryKey: ["engine-projects"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      nav({ to: "/p/$slug", params: { slug: projName } });
    } catch (err: any) {
      toast.error(err.message || `Failed to deploy ${item.name}`);
    } finally {
      setInstallingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Banner (if full variant) */}
      {variant === "full" && (
        <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-accent/5 to-transparent p-6 shadow-sm">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/20 text-primary mb-2">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Framework Starters & Scaffolding</span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                Starter Templates
              </h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                Kick off production-ready projects in Next.js, React, FastAPI, Astro, Go, or Rust with instant zero-config deployments.
              </p>
            </div>
            <div className="rounded-xl border border-border/80 bg-surface/60 p-4 text-xs">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <span>🐳</span> Looking for self-hosted apps?
              </div>
              <p className="text-muted-foreground mt-0.5">
                Browse our complete catalog of 2,550+ one-click applications.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Search & Category Filter Toolbar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          {STARTER_TEMPLATE_CATEGORIES.map((cat) => {
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-surface hover:bg-surface-2 text-muted-foreground hover:text-foreground border border-border/40"
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Search Bar */}
        <div className="relative min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-surface border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
          />
        </div>
      </div>

      {/* Templates Grid */}
      {filteredItems.length === 0 ? (
        <div className="p-12 text-center rounded-xl border border-dashed border-border/60 bg-surface/30">
          <Filter className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium text-foreground">No starter templates found</p>
          <p className="text-xs text-muted-foreground mt-1">
            Try adjusting your search query or category filter.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item) => {
            const isInstalling = installingId === item.id;

            return (
              <div
                key={item.id}
                className="group relative flex flex-col justify-between p-5 rounded-xl border border-border/50 bg-card hover:bg-surface-2/40 hover:border-primary/40 transition-all duration-200 shadow-sm hover:shadow-md"
              >
                <div>
                  {/* Top Bar: Icon + Badges */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-xl shadow-xs">
                      {item.icon}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {item.popular && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          <Sparkles className="w-2.5 h-2.5" /> Popular
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-secondary text-secondary-foreground border border-border/30">
                        <Code className="w-2.5 h-2.5" /> {item.stack.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {/* Title & Description */}
                  <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                    {item.name}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
                    {item.desc}
                  </p>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1 mt-3">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Bottom Action Footer */}
                <div className="mt-5 pt-3 border-t border-border/40 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Layers className="w-3 h-3 opacity-60" />
                    <span>Port :{item.port}</span>
                  </div>

                  <button
                    onClick={() => handleAction(item)}
                    disabled={isInstalling}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-xs disabled:opacity-50"
                  >
                    {isInstalling ? (
                      <>
                        <div className="w-3 h-3 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                        <span>Creating...</span>
                      </>
                    ) : (
                      <>
                        <Rocket className="w-3.5 h-3.5" />
                        <span>Use Template</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
