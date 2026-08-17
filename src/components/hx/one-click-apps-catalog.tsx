import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ONE_CLICK_APPS_CATALOG,
  ONE_CLICK_SOURCES,
  OneClickAppDef,
  OneClickAppSource,
} from "@/lib/stacks";
import { useEngine, useEngineHealth } from "@/lib/engine";
import { AppLogo } from "@/components/hx/app-logo";
import {
  Search,
  Sparkles,
  ExternalLink,
  Rocket,
  Filter,
  CheckCircle2,
  Container,
  Globe,
  Star,
  Tag,
  ChevronDown,
  Loader2,
  BookOpen,
  Github,
  Code2,
} from "lucide-react";

// Top featured categories for the quick bar
const FEATURED_TAGS = [
  { id: "all", label: "🌟 All (2,550+)", icon: "✨" },
  { id: "selfhst-software", label: "selfh.st (1,330+)", icon: "🚀" },
  { id: "analytics", label: "Analytics", icon: "📊" },
  { id: "automation", label: "Automation", icon: "⚡" },
  { id: "continuous-integration--continuous-deployment", label: "CI / CD", icon: "🚀" },
  { id: "blogging-platforms", label: "Blogging", icon: "✍️" },
  { id: "bookmarks-and-link-sharing", label: "Bookmarks", icon: "🔖" },
  { id: "content-management-systems-cms", label: "CMS & Backends", icon: "📦" },
  { id: "database-management", label: "Databases", icon: "🗄️" },
  { id: "document-management", label: "Documents", icon: "📄" },
  { id: "file-transfer-synchronization", label: "File Sync", icon: "☁️" },
  { id: "games", label: "Games", icon: "🎮" },
  { id: "generative-artificial-intelligence-genai", label: "GenAI & LLMs", icon: "🤖" },
  { id: "monitoring", label: "Monitoring", icon: "📶" },
  { id: "password-managers", label: "Password Managers", icon: "🔒" },
  { id: "photos-and-digital-audio-video-galleries", label: "Photos & Media", icon: "📸" },
  { id: "proxy", label: "Proxy & VPN", icon: "🛡️" },
  { id: "software-development", label: "Dev Tools", icon: "🛠️" },
  { id: "task-management-to-do-lists", label: "Tasks & To-Do", icon: "✅" },
  { id: "wikis", label: "Wikis", icon: "📚" },
];

export function OneClickAppsCatalog({
  onSelectApp,
  variant = "full",
}: {
  onSelectApp?: (app: OneClickAppDef) => void;
  variant?: "full" | "compact" | "new-project-tab";
}) {
  const eng = useEngine();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: health } = useEngineHealth();

  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [selectedSource, setSelectedSource] = useState<OneClickAppSource>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState<number>(48);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(48);
  const [viewMode, setViewMode] = useState<"scroll" | "page">("scroll");

  // Custom Docker Image Input
  const [customImage, setCustomImage] = useState("");
  const [inspectingCustom, setInspectingCustom] = useState(false);
  const [customInspectResult, setCustomInspectResult] = useState<any | null>(null);

  // Query installed docker apps from engine
  const { data: installedApps = [] } = useQuery({
    queryKey: ["engine-apps", eng.url, eng.token],
    queryFn: async () => (await eng.call<any[]>("GET", "/api/apps").catch(() => [])) ?? [],
    enabled: !!health?.ok,
    refetchInterval: 3000,
  });

  // Query all tags with automatic fallback to static asset
  const { data: tagsData } = useQuery({
    queryKey: ["catalog-tags", eng.url],
    queryFn: async () => {
      try {
        const res = await eng.call<any>("GET", "/api/catalog/tags");
        if (res && res.tags?.length > 0) return res;
      } catch {}
      try {
        const r = await fetch("/catalog.json");
        const data = await r.json();
        return { total: data.tags?.length || 0, tags: data.tags || [] };
      } catch {}
      return null;
    },
    staleTime: 60000,
  });

  // Query all apps with automatic fallback to static asset
  const { data: catalogData, isLoading: catalogLoading } = useQuery({
    queryKey: ["catalog-apps", eng.url, selectedTag, selectedSource, searchQuery],
    queryFn: async () => {
      // 1. Try engine endpoint
      try {
        const params = new URLSearchParams();
        if (selectedTag && selectedTag !== "all") params.set("tag", selectedTag);
        if (selectedSource && selectedSource !== "all") params.set("source", selectedSource);
        if (searchQuery) params.set("q", searchQuery);
        params.set("limit", "5000");
        const res = await eng.call<any>("GET", `/api/catalog/apps?${params.toString()}`);
        if (res && res.apps?.length > 0) return res;
      } catch {}

      // 2. Fallback to /catalog.json static asset
      try {
        const r = await fetch("/catalog.json");
        const data = await r.json();
        const apps = data.apps || [];
        return { total: apps.length, apps };
      } catch {}

      return null;
    },
    staleTime: 60000,
  });

  // Combine curated verified apps with engine results with zero duplicate entries
  const allMergedApps = useMemo(() => {
    const map = new Map<string, any>();
    const normKey = (str: string) => (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    // 1. Add verified one-click apps first
    for (const app of ONE_CLICK_APPS_CATALOG) {
      const k = normKey(app.name) || normKey(app.id);
      map.set(k, {
        ...app,
        source: app.source || "verified",
        sources: ["verified"],
      });
    }

    // 2. Add fetched catalog apps
    const rawList = catalogData?.apps || [];
    for (const app of rawList) {
      const k = normKey(app.name) || normKey(app.slug || app.id);
      const existing = map.get(k);
      if (existing) {
        // Merge sources
        if (!existing.sources) existing.sources = [existing.source];
        if (app.sources) {
          for (const s of app.sources) {
            if (!existing.sources.includes(s)) existing.sources.push(s);
          }
        } else if (app.source && !existing.sources.includes(app.source)) {
          existing.sources.push(app.source);
        }
        if (app.stars && !existing.stars) existing.stars = app.stars;
        if (app.svgUrl && !existing.svgUrl) existing.svgUrl = app.svgUrl;
        if (app.logoUrl && !existing.logoUrl) existing.logoUrl = app.logoUrl;
        if (app.language && !existing.language) existing.language = app.language;
        if (app.license && !existing.license) existing.license = app.license;
        if (app.updatedAt && !existing.updatedAt) existing.updatedAt = app.updatedAt;
        if (app.website && !existing.website) existing.website = app.website;
        if (app.url && !existing.url) existing.url = app.url;
      } else {
        map.set(k, {
          id: app.id,
          slug: app.slug,
          name: app.name,
          category: app.category,
          categoryLabel: app.categoryLabel,
          desc: app.desc,
          icon: app.icon || "📦",
          image: app.image,
          port: app.port || 3000,
          tags: app.tags || [app.category],
          website: app.website || app.url,
          url: app.url || app.website,
          source: app.source || "awesome_selfhosted",
          sources: app.sources || [app.source || "awesome_selfhosted"],
          logoUrl: app.logoUrl,
          svgUrl: app.svgUrl,
          stars: app.stars,
          forks: app.forks,
          language: app.language,
          license: app.license,
          updatedAt: app.updatedAt,
        });
      }
    }

    return Array.from(map.values());
  }, [catalogData]);

  // Filter apps locally by source and query
  const filteredItems = useMemo(() => {
    return allMergedApps.filter((item) => {
      // Source filter
      const matchesSource =
        selectedSource === "all" ||
        (selectedSource === "verified" && item.source === "verified") ||
        (selectedSource === "selfhst" &&
          (item.source === "selfhst" || item.tags?.includes("selfhst"))) ||
        (selectedSource === "awesome_sysadmin" &&
          (item.source === "awesome_sysadmin" || item.tags?.includes("sysadmin"))) ||
        (selectedSource === "awesome_selfhosted" &&
          (item.source === "awesome_selfhosted" || item.source === "verified")) ||
        item.source === selectedSource;

      // Tag / Category filter
      const matchesTag =
        selectedTag === "all" ||
        item.category === selectedTag ||
        item.tags?.includes(selectedTag) ||
        item.categoryLabel?.toLowerCase() === selectedTag.toLowerCase();

      // Search Query
      const term = searchQuery.toLowerCase().trim();
      if (!term) return matchesSource && matchesTag;

      const matchesSearch =
        item.name.toLowerCase().includes(term) ||
        item.desc.toLowerCase().includes(term) ||
        item.categoryLabel?.toLowerCase().includes(term) ||
        item.tags?.some((t: string) => t.toLowerCase().includes(term)) ||
        item.image?.toLowerCase().includes(term);

      return matchesSource && matchesTag && matchesSearch;
    });
  }, [allMergedApps, selectedSource, selectedTag, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);

  const visibleItems = useMemo(() => {
    if (viewMode === "scroll") {
      return filteredItems.slice(0, visibleCount);
    }
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, viewMode, visibleCount, currentPage, pageSize]);

  async function handleInspectCustomImage() {
    if (!customImage.trim()) return;
    if (!health?.ok) {
      toast.error("HosteraX Engine must be connected to inspect images");
      return;
    }
    try {
      setInspectingCustom(true);
      const res = await eng.call<any>("POST", "/api/catalog/inspect", {
        image: customImage.trim(),
      });
      setCustomInspectResult(res);
      toast.success(
        `Discovered ports: ${res.exposedPorts?.join(", ") || res.detectedPort || 3000}`,
      );
    } catch (err: any) {
      toast.error(err.message || "Failed to inspect image");
    } finally {
      setInspectingCustom(false);
    }
  }

  async function handleDeployCustomImage() {
    const tag = customImage.trim();
    if (!tag) {
      toast.error("Please enter a Docker image tag (e.g. caddy:latest)");
      return;
    }
    if (!health?.ok) {
      toast.error("HosteraX Engine must be connected to deploy");
      return;
    }

    try {
      setInspectingCustom(true);
      const WELL_KNOWN_MAP: Record<string, string> = {
        ollama: "ollama/ollama:latest",
        "ollama/ollama": "ollama/ollama:latest",
        vaultwarden: "vaultwarden/server:latest",
        nginx: "nginx:alpine",
        caddy: "caddy:latest",
        redis: "redis:alpine",
        postgres: "postgres:alpine",
        grafana: "grafana/grafana:latest",
        prometheus: "prom/prometheus:latest",
        uptimekuma: "louislam/uptime-kuma:latest",
        "uptime-kuma": "louislam/uptime-kuma:latest",
        n8n: "n8nio/n8n:latest",
        portainer: "portainer/portainer-ce:latest",
        dockge: "louislam/dockge:latest",
        traefik: "traefik:v3.1",
        jellyfin: "jellyfin/jellyfin:latest",
        immich: "ghcr.io/immich-app/immich-server:latest",
        paperless: "ghcr.io/paperless-ngx/paperless-ngx:latest",
        "paperless-ngx": "ghcr.io/paperless-ngx/paperless-ngx:latest",
        "it-tools": "corentinth/it-tools:latest",
      };
      const cleanInputKey = tag.toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const baseInputKey = tag
        .split(":")[0]
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "");
      let resolvedSource = WELL_KNOWN_MAP[cleanInputKey] || WELL_KNOWN_MAP[baseInputKey] || tag;
      if (!resolvedSource.includes(":") && !resolvedSource.includes("/")) {
        resolvedSource = `${resolvedSource}:latest`;
      }

      const cleanName =
        tag
          .split("/")
          .pop()
          ?.split(":")[0]
          ?.replace(/[^a-z0-9_-]/gi, "-")
          .toLowerCase() || "custom-app";

      const projName = `${cleanName}-${Math.random().toString(36).substring(2, 6)}`;
      const targetPort =
        customInspectResult?.detectedPort || (cleanInputKey === "ollama" ? 11434 : 3000);

      // 1. Create project
      await eng.call("POST", "/api/projects", {
        name: projName,
        source: resolvedSource,
        buildCmd: "",
        startCmd: "",
        target: "docker",
        port: targetPort,
        env: {},
      });

      // 2. Queue immediate deployment
      await eng.call("POST", `/api/projects/${projName}/deploy`, {
        trigger: "custom-docker",
      });

      toast.success(`Custom image "${tag}" deployed successfully!`);
      qc.invalidateQueries({ queryKey: ["engine-projects"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      nav({ to: "/p/$slug", params: { slug: projName } });
    } catch (err: any) {
      toast.error(err.message || `Failed to deploy custom image ${tag}`);
    } finally {
      setInspectingCustom(false);
    }
  }

  async function handleAction(item: OneClickAppDef) {
    if (onSelectApp) {
      return onSelectApp(item);
    }

    if (!health?.ok) {
      toast.error("HosteraX Engine must be connected to deploy");
      return;
    }

    try {
      setInstallingId(item.id);
      const projName = item.slug || item.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-");

      // 1. Create first-class HosteraX project
      await eng.call("POST", "/api/projects", {
        name: projName,
        source: item.image,
        buildCmd: "",
        startCmd: "",
        target: "docker",
        port: item.port || 3000,
        env: item.env || {},
      });

      // 2. Queue immediate deployment
      await eng.call("POST", `/api/projects/${projName}/deploy`, {
        trigger: "one-click",
      });

      toast.success(`App project "${item.name}" created & deploy queued!`);
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
                <span>Complete 2,550+ Awesome-Selfhosted, SysAdmin & selfh.st Directory</span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                One-Click Self-Hosted Software Catalog
              </h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                Browse 112+ tags and categories from <strong>awesome-selfhosted.net</strong>,{" "}
                <strong>sysadmin.awesome-selfhosted.net</strong>, and <strong>selfh.st/apps</strong>
                . Launch any application instantly with smart zero-config port discovery, persistent
                volumes, and custom domains.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href="https://selfh.st/apps/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface hover:bg-surface-2 text-foreground border border-border/50 transition-colors shadow-sm"
              >
                <Globe className="w-3.5 h-3.5 text-primary" />
                <span>selfh.st/apps</span>
                <ExternalLink className="w-3 h-3 text-muted-foreground" />
              </a>
              <a
                href="https://awesome-selfhosted.net"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface hover:bg-surface-2 text-foreground border border-border/50 transition-colors shadow-sm"
              >
                <BookOpen className="w-3.5 h-3.5 text-primary" />
                <span>awesome-selfhosted.net</span>
                <ExternalLink className="w-3 h-3 text-muted-foreground" />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Quick Deploy Any Custom Docker Image Box */}
      <div className="rounded-xl border border-border/70 bg-surface/50 p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Container className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Deploy Any Docker Image (Docker Hub / GHCR / Self-Hosted)
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
            ⚡ Smart Auto-Port & Auto-Volume
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-2.5">
          <div className="relative flex-1 w-full">
            <input
              type="text"
              placeholder="e.g. caddy:latest, nginx:alpine, prom/prometheus:latest, valkey/valkey:latest..."
              value={customImage}
              onChange={(e) => setCustomImage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleDeployCustomImage()}
              className="w-full pl-3 pr-24 py-2 text-xs rounded-lg bg-surface border border-border/60 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
            />
            <button
              onClick={handleInspectCustomImage}
              disabled={inspectingCustom || !customImage.trim()}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-1 text-[11px] font-medium rounded-md bg-surface-2 hover:bg-surface-3 text-muted-foreground hover:text-foreground border border-border/40 transition-all disabled:opacity-50 flex items-center gap-1"
            >
              {inspectingCustom ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Search className="w-3 h-3" />
              )}
              <span>Inspect</span>
            </button>
          </div>

          <button
            onClick={handleDeployCustomImage}
            disabled={inspectingCustom || !customImage.trim()}
            className="w-full sm:w-auto px-4 py-2 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-sm flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-50"
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>Launch Image</span>
          </button>
        </div>

        {customInspectResult && (
          <div className="mt-2.5 p-2 rounded-lg bg-surface-2/60 border border-border/40 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Discovered Port:</span>
              <span className="font-mono text-primary font-bold">
                :{customInspectResult.detectedPort}
              </span>
              {customInspectResult.volumes?.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  • {customInspectResult.volumes.length} volume(s)
                </span>
              )}
            </div>
            <span className="text-[11px] text-emerald-500 font-medium">✓ Ready to deploy</span>
          </div>
        )}
      </div>

      {/* Catalog Source Selector */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none border-b border-border/40 pb-2">
        <span className="text-xs text-muted-foreground font-medium mr-1 flex items-center gap-1">
          <Filter className="w-3 h-3" /> Source:
        </span>
        {ONE_CLICK_SOURCES.map((src) => {
          const isActive = selectedSource === src.id;
          return (
            <button
              key={src.id}
              onClick={() => {
                setSelectedSource(src.id as OneClickAppSource);
                setVisibleCount(48);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                isActive
                  ? "bg-foreground text-background shadow-sm"
                  : "bg-surface hover:bg-surface-2 text-muted-foreground hover:text-foreground border border-border/40"
              }`}
            >
              <span>{src.label}</span>
            </button>
          );
        })}
      </div>

      {/* Featured Tag Quick Switcher + Tag Dropdown & Search */}
      <div className="space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Quick Tag Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
            {FEATURED_TAGS.slice(0, 9).map((cat) => {
              const isActive = selectedTag === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => {
                    setSelectedTag(cat.id);
                    setVisibleCount(48);
                  }}
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
          <div className="relative min-w-[260px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search across 2,550+ self-hosted apps..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setVisibleCount(48);
              }}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg bg-surface border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all"
            />
          </div>
        </div>

        {/* All 112 Tags Dropdown Selector & Navigation Toolbar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-surface/30 p-2.5 rounded-lg border border-border/30 text-xs">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Tag className="w-3.5 h-3.5 text-primary shrink-0" />
            <select
              value={selectedTag}
              onChange={(e) => {
                setSelectedTag(e.target.value);
                setVisibleCount(48);
                setPage(1);
              }}
              className="flex-1 bg-surface border border-border/50 rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-medium truncate"
            >
              <option value="all">🌟 All Categories (2,550+ Apps)</option>
              {(tagsData?.tags || []).map((t: any, idx: number) => (
                <option key={`${t.slug || t.id}-${idx}`} value={t.slug || t.id}>
                  {t.icon || "📦"} {t.label} ({t.count} apps)
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 shrink-0">
            {/* View Mode Toggle */}
            <div className="flex items-center rounded-lg border border-border/50 bg-surface p-0.5 text-[11px]">
              <button
                onClick={() => setViewMode("scroll")}
                className={`px-2 py-0.5 rounded font-medium transition-colors ${
                  viewMode === "scroll"
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Infinite / Load More
              </button>
              <button
                onClick={() => setViewMode("page")}
                className={`px-2 py-0.5 rounded font-medium transition-colors ${
                  viewMode === "page"
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Page Numbers
              </button>
            </div>

            {/* Quick Page Size */}
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span>Show:</span>
              {[48, 96, 240].map((sz) => (
                <button
                  key={sz}
                  onClick={() => {
                    setPageSize(sz);
                    setVisibleCount(sz);
                  }}
                  className={`px-1.5 py-0.5 rounded border transition-colors ${
                    pageSize === sz && visibleCount === sz
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : "border-border/40 hover:bg-surface text-muted-foreground"
                  }`}
                >
                  {sz}
                </button>
              ))}
              <button
                onClick={() => {
                  setVisibleCount(filteredItems.length);
                  setPageSize(filteredItems.length);
                }}
                className="px-1.5 py-0.5 rounded border border-border/40 hover:bg-surface text-muted-foreground hover:text-foreground"
                title="Display all applications at once"
              >
                All ({filteredItems.length})
              </button>
            </div>

            {/* Quick Page Step */}
            {viewMode === "page" && totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="px-2 py-0.5 rounded border border-border/50 bg-surface text-xs disabled:opacity-40"
                >
                  ◀
                </button>
                <span className="font-mono text-[11px] text-foreground">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="px-2 py-0.5 rounded border border-border/50 bg-surface text-xs disabled:opacity-40"
                >
                  ▶
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Apps Grid */}
      {catalogLoading ? (
        <div className="p-12 text-center rounded-xl border border-dashed border-border/60 bg-surface/30">
          <Loader2 className="w-8 h-8 text-primary mx-auto mb-2 animate-spin" />
          <p className="text-sm font-medium text-foreground">Loading catalog...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="p-12 text-center rounded-xl border border-dashed border-border/60 bg-surface/30">
          <Filter className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium text-foreground">No applications found</p>
          <p className="text-xs text-muted-foreground mt-1">
            Try adjusting your search query, category, or catalog source filter.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visibleItems.map((item) => {
              const isInstalled = installedApps.some(
                (app) => app.id === item.id || app.name?.toLowerCase() === item.id.toLowerCase(),
              );
              const isInstalling = installingId === item.id;

              return (
                <div
                  key={item.id}
                  className="group relative flex flex-col justify-between rounded-xl border border-border/60 bg-card p-5 transition-all duration-200 hover:border-primary/50 hover:shadow-md"
                >
                  <div>
                    {/* Top Badges */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3">
                        <AppLogo
                          name={item.name}
                          slug={item.slug || item.id}
                          logoUrl={item.logoUrl}
                          svgUrl={item.svgUrl}
                          website={item.website || item.url}
                          iconFallback={item.icon}
                          size="md"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <a
                              href={item.website || item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-bold text-foreground hover:text-primary transition-colors inline-flex items-center gap-1 group/title"
                            >
                              <span>{item.name}</span>
                              <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover/title:opacity-100 transition-opacity text-primary" />
                            </a>
                            {(() => {
                              const sNum =
                                typeof item.stars === "number" ? item.stars : Number(item.stars);
                              if (isNaN(sNum) || sNum <= 0) return null;
                              const formatted =
                                sNum >= 1000000
                                  ? `${(sNum / 1000000).toFixed(1).replace(/\.0$/, "")}M`
                                  : sNum >= 1000
                                    ? `${(sNum / 1000).toFixed(1).replace(/\.0$/, "")}k`
                                    : sNum.toLocaleString();
                              return (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500 border border-amber-500/20">
                                  <Star className="w-2.5 h-2.5 fill-amber-500" />
                                  {formatted}
                                </span>
                              );
                            })()}
                          </div>

                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] font-mono text-muted-foreground">
                              :{item.port || 3000}
                            </span>
                            {item.categoryLabel && (
                              <span className="text-[10px] text-muted-foreground/80 truncate max-w-[150px]">
                                • {item.categoryLabel}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Source Badge */}
                      <div className="flex flex-col items-end gap-1">
                        {isInstalled ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500 border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3" />
                            Running
                          </span>
                        ) : (
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            {(item.sources || [item.source]).map((s: string) => (
                              <span
                                key={s}
                                className="text-[9px] px-1.5 py-0.5 rounded-md bg-surface-2 text-muted-foreground border border-border/40 font-mono"
                              >
                                {s === "selfhst"
                                  ? "selfh.st"
                                  : s === "awesome_sysadmin"
                                    ? "sysadmin"
                                    : s === "awesome_selfhosted"
                                      ? "awesome"
                                      : "1-click"}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mb-3">
                      {item.desc}
                    </p>

                    {/* Docker Image Tag */}
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground/80 bg-surface-2/50 px-2 py-1 rounded-md border border-border/30 mb-3 truncate">
                      <Container className="w-3 h-3 shrink-0 text-primary/70" />
                      <span className="truncate">{item.image}</span>
                    </div>

                    {/* Language & License & Updated Badges */}
                    {(item.language || item.license || item.updatedAt) && (
                      <div className="flex flex-wrap items-center gap-1.5 mb-2.5 text-[10px] font-medium">
                        {item.language && (
                          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
                            {item.language}
                          </span>
                        )}
                        {item.license && (
                          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/20">
                            ⚖️ {item.license}
                          </span>
                        )}
                        {item.updatedAt && (
                          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-surface-2 text-muted-foreground border border-border/30 font-mono text-[9px]">
                            🕒 {item.updatedAt}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Tags */}
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {item.tags?.slice(0, 3).map((tag: string) => (
                        <span
                          key={tag}
                          className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted-foreground border border-border/30"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-3 border-t border-border/40">
                    {isInstalled ? (
                      <button
                        onClick={() => nav({ to: "/p/$slug", params: { slug: item.slug } })}
                        className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 px-3 py-1.5 text-xs font-medium text-foreground transition-all border border-border/50"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>Manage Project</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAction(item)}
                        disabled={isInstalling}
                        className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-primary hover:bg-primary/90 px-3 py-1.5 text-xs font-medium text-primary-foreground transition-all shadow-sm disabled:opacity-50"
                      >
                        {isInstalling ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                            <span>Deploying...</span>
                          </div>
                        ) : (
                          <>
                            <Rocket className="w-3.5 h-3.5" />
                            <span>1-Click Deploy</span>
                          </>
                        )}
                      </button>
                    )}

                    {/* Official Website Link */}
                    {item.website && (
                      <a
                        href={item.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg bg-surface hover:bg-surface-2 text-muted-foreground hover:text-primary border border-border/40 transition-colors"
                        title={`Official Website: ${item.website}`}
                      >
                        <Globe className="w-3.5 h-3.5" />
                      </a>
                    )}

                    {/* Source Code / GitHub Repo Link */}
                    {item.url && item.url !== item.website && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg bg-surface hover:bg-surface-2 text-muted-foreground hover:text-foreground border border-border/40 transition-colors"
                        title={`Source Repository: ${item.url}`}
                      >
                        {item.url.includes("github.com") ? (
                          <Github className="w-3.5 h-3.5" />
                        ) : (
                          <Code2 className="w-3.5 h-3.5" />
                        )}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Enhanced Load More & Numbered Pagination Navigation Controls */}
          {viewMode === "scroll" ? (
            visibleCount < filteredItems.length ? (
              <div className="mt-8 rounded-xl border border-border/80 bg-card p-6 shadow-sm text-center space-y-4">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 max-w-xl mx-auto text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Showing{" "}
                    <span className="font-mono text-primary font-bold">{visibleItems.length}</span>{" "}
                    of <span className="font-mono font-bold">{filteredItems.length}</span>{" "}
                    applications
                  </span>
                  <span className="font-mono text-[11px]">
                    {filteredItems.length - visibleCount} apps remaining
                  </span>
                </div>

                {/* Progress bar */}
                <div className="max-w-xl mx-auto h-2 bg-surface-2 rounded-full overflow-hidden border border-border/40">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, Math.round((visibleItems.length / filteredItems.length) * 100))}%`,
                    }}
                  />
                </div>

                {/* Buttons */}
                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  <button
                    onClick={() => setVisibleCount((c) => Math.min(filteredItems.length, c + 48))}
                    className="px-5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-xs font-semibold text-primary-foreground shadow-sm transition-all inline-flex items-center gap-2"
                  >
                    <span>Load Next 48 Apps</span>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setVisibleCount((c) => Math.min(filteredItems.length, c + 120))}
                    className="px-5 py-2 rounded-xl bg-surface-2 hover:bg-surface-3 text-xs font-semibold text-foreground border border-border/60 shadow-sm transition-all inline-flex items-center gap-2"
                  >
                    <span>Load Next 120 Apps</span>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => setVisibleCount(filteredItems.length)}
                    className="px-5 py-2 rounded-xl bg-surface hover:bg-surface-2 text-xs font-semibold text-muted-foreground hover:text-foreground border border-border/50 transition-all inline-flex items-center gap-2"
                  >
                    <span>Show All ({filteredItems.length})</span>
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-8 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground font-mono bg-surface/30 p-4 rounded-xl border border-border/40 max-w-md mx-auto">
                <span>✨ All {filteredItems.length} applications loaded.</span>
                <button
                  onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                  className="text-primary hover:underline text-[11px]"
                >
                  ↑ Back to top
                </button>
              </div>
            )
          ) : (
            <div className="mt-8 rounded-xl border border-border/80 bg-card p-5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-xs text-muted-foreground">
                Page <span className="font-mono font-bold text-foreground">{currentPage}</span> of{" "}
                <span className="font-mono font-bold text-foreground">{totalPages}</span> (
                {filteredItems.length} total apps)
              </div>

              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <button
                  onClick={() => {
                    setPage(1);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  disabled={currentPage <= 1}
                  className="px-2.5 py-1.5 rounded-lg border border-border/60 bg-surface text-xs font-medium hover:bg-surface-2 disabled:opacity-40"
                >
                  « First
                </button>
                <button
                  onClick={() => {
                    setPage((p) => Math.max(1, p - 1));
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  disabled={currentPage <= 1}
                  className="px-2.5 py-1.5 rounded-lg border border-border/60 bg-surface text-xs font-medium hover:bg-surface-2 disabled:opacity-40"
                >
                  ‹ Prev
                </button>

                {/* Page Number Buttons */}
                {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                  let pNum = currentPage;
                  if (currentPage <= 3) pNum = idx + 1;
                  else if (currentPage >= totalPages - 2) pNum = totalPages - 4 + idx;
                  else pNum = currentPage - 2 + idx;
                  if (pNum < 1 || pNum > totalPages) return null;

                  return (
                    <button
                      key={pNum}
                      onClick={() => {
                        setPage(pNum);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className={`h-8 w-8 rounded-lg text-xs font-mono font-semibold transition-all ${
                        currentPage === pNum
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "border border-border/50 bg-surface hover:bg-surface-2 text-foreground"
                      }`}
                    >
                      {pNum}
                    </button>
                  );
                })}

                <button
                  onClick={() => {
                    setPage((p) => Math.min(totalPages, p + 1));
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  disabled={currentPage >= totalPages}
                  className="px-2.5 py-1.5 rounded-lg border border-border/60 bg-surface text-xs font-medium hover:bg-surface-2 disabled:opacity-40"
                >
                  Next ›
                </button>
                <button
                  onClick={() => {
                    setPage(totalPages);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  disabled={currentPage >= totalPages}
                  className="px-2.5 py-1.5 rounded-lg border border-border/60 bg-surface text-xs font-medium hover:bg-surface-2 disabled:opacity-40"
                >
                  Last »
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
