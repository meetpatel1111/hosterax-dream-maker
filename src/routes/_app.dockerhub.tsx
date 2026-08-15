import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useDeferredValue, useEffect, useRef } from "react";
import {
  Search,
  ArrowDownToLine,
  Star,
  Tag,
  Shield,
  ExternalLink,
  RefreshCw,
  Plus,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Terminal,
  ArrowRight,
  Filter,
  Play,
  Copy,
  Check,
  Layers,
  LayoutGrid,
} from "lucide-react";
import { toast } from "sonner";
import { useEngine } from "@/lib/engine";

export const Route = createFileRoute("/_app/dockerhub")({
  head: () => ({ meta: [{ title: "Registry Explorer (Docker Hub & GHCR) — HosteraX" }] }),
  component: ContainerRegistryExplorerPage,
});

interface RegistryResult {
  id: string;
  name: string;
  repoName?: string;
  repo?: string;
  image: string;
  tag: string;
  desc: string;
  stars: number | string;
  starCountFormatted?: string;
  pulls?: number | string;
  pullCountFormatted?: string;
  isOfficial?: boolean;
  official?: boolean;
  isAutomated?: boolean;
  hubUrl?: string;
  ghcrUrl?: string;
  logoUrl?: string;
  logoCandidates?: string[];
  icon: string;
  defaultPort?: number;
  category?: string;
}

function RegistryLogo({
  logoCandidates,
  logoUrl,
  fallbackEmoji,
  title,
}: {
  logoCandidates?: string[];
  logoUrl?: string;
  fallbackEmoji: string;
  title: string;
}) {
  const candidates = (logoCandidates && logoCandidates.length > 0)
    ? logoCandidates.filter(Boolean)
    : (logoUrl ? [logoUrl] : []);

  const [candidateIdx, setCandidateIdx] = useState(0);
  const [failedAll, setFailedAll] = useState(false);

  const currentSrc = candidates[candidateIdx];

  if (!currentSrc || failedAll) {
    return <span className="text-base select-none">{fallbackEmoji}</span>;
  }

  return (
    <img
      src={currentSrc}
      alt={title}
      className="h-full w-full object-contain"
      loading="lazy"
      onError={() => {
        if (candidateIdx + 1 < candidates.length) {
          setCandidateIdx((prev) => prev + 1);
        } else {
          setFailedAll(true);
        }
      }}
    />
  );
}

interface RegistryTag {
  name: string;
  tag: string;
  fullSize?: number;
  sizeFormatted: string;
  lastUpdated: string;
  lastUpdatedFormatted: string;
  architectures: string[];
  isSlim: boolean;
  isHardened: boolean;
  digest: string;
}

interface SearchResponse {
  total: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  rangeText?: string;
  results: RegistryResult[];
}

interface RegistryTagsResponse {
  repo: string;
  total: number;
  hardenedAlternative?: string | null;
  hasHardenedProfile?: boolean;
  tags: RegistryTag[];
}

const DOCKERHUB_CATEGORIES = [
  { id: "all", label: "🔥 All Categories", category: "" },
  { id: "databases-and-storage", label: "🗄️ Databases & Storage", category: "databases-and-storage" },
  { id: "machine-learning-and-ai", label: "🤖 Machine Learning & AI", category: "machine-learning-and-ai" },
  { id: "web-servers", label: "🌍 Web Servers", category: "web-servers" },
  { id: "languages-and-frameworks", label: "⚡ Languages & Frameworks", category: "languages-and-frameworks" },
  { id: "networking", label: "🌐 Networking", category: "networking" },
  { id: "api-management", label: "🔌 API Management", category: "api-management" },
  { id: "security", label: "🔐 Security", category: "security" },
  { id: "integration-and-delivery", label: "🚀 Integration & Delivery", category: "integration-and-delivery" },
  { id: "message-queues", label: "📨 Message Queues", category: "message-queues" },
  { id: "internet-of-things", label: "🏠 Internet of Things (IoT)", category: "internet-of-things" },
  { id: "developer-tools", label: "🛠️ Developer Tools", category: "developer-tools" },
  { id: "data-science", label: "📊 Data Science", category: "data-science" },
  { id: "operating-systems", label: "🖥️ Operating Systems", category: "operating-systems" },
  { id: "content-management-system", label: "📝 Content Management (CMS)", category: "content-management-system" },
  { id: "monitoring-and-observability", label: "📈 Monitoring & Observability", category: "monitoring-and-observability" },
  { id: "web-analytics", label: "📉 Web Analytics", category: "web-analytics" },
];

const DOCKERHUB_BADGES = [
  { id: "", label: "🌐 All Badges" },
  { id: "official", label: "🛡️ Docker Official", icon: "🛡️" },
  { id: "hardened", label: "🔒 Docker Hardened (DHI)", icon: "🔒" },
  { id: "verified_publisher", label: "✅ Verified Publisher", icon: "✅" },
  { id: "open_source", label: "🌟 Sponsored OSS", icon: "🌟" },
];

const DOCKERHUB_OS_FILTERS = [
  { id: "", label: "🌐 All OS" },
  { id: "linux", label: "🐧 Linux", icon: "🐧" },
  { id: "windows", label: "🪟 Windows", icon: "🪟" },
];

const DOCKERHUB_ARCHITECTURES = [
  { id: "", label: "🌐 All Arch" },
  { id: "arm64", label: "⚡ ARM64", icon: "⚡" },
  { id: "amd64", label: "💻 AMD64 (x86_64)", icon: "💻" },
  { id: "arm", label: "🦾 ARM (v7)", icon: "🦾" },
];

const SORT_OPTIONS = [
  { id: "pulls", label: "🔥 Most Popular (Pulls)" },
  { id: "stars", label: "⭐ Most Starred" },
  { id: "name", label: "🔤 Alphabetical (A-Z)" },
];

const GHCR_CATEGORIES = [
  { id: "all", label: "🐙 All GHCR Featured", category: "" },
  { id: "ai", label: "🤖 AI & LLMs", category: "ai" },
  { id: "automation", label: "🏠 Home & Automation", category: "automation" },
  { id: "productivity", label: "📄 Document & Notes", category: "productivity" },
  { id: "media", label: "🖼️ Photos & Media", category: "media" },
  { id: "security", label: "🔐 Security & SSO", category: "security" },
  { id: "backend", label: "⚡ Backend & Storage", category: "backend" },
  { id: "developer", label: "🛠️ Dev Tools", category: "developer" },
];

function ContainerRegistryExplorerPage() {
  const engine = useEngine();
  const nav = useNavigate();
  const qc = useQueryClient();

  // Helper to read initial URL search parameters
  const getInitialParam = (key: string, defaultVal: string = "") => {
    if (typeof window === "undefined") return defaultVal;
    const sp = new URLSearchParams(window.location.search);
    return sp.get(key) || defaultVal;
  };

  const [activeRegistry, setActiveRegistry] = useState<"dockerhub" | "ghcr">(() => (getInitialParam("registry") === "ghcr" ? "ghcr" : "dockerhub"));
  const [searchQuery, setSearchQuery] = useState(() => getInitialParam("q", ""));
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [activeCategory, setActiveCategory] = useState(() => getInitialParam("category", "all"));
  const [activeBadge, setActiveBadge] = useState<string>(() => getInitialParam("badges", ""));
  const [activeOS, setActiveOS] = useState<string>(() => getInitialParam("operating_system", getInitialParam("os", "")));
  const [activeArch, setActiveArch] = useState<string>(() => getInitialParam("architecture", getInitialParam("arch", "")));
  const [activeSort, setActiveSort] = useState<string>(() => getInitialParam("sort", "pulls"));
  const [officialOnly, setOfficialOnly] = useState(false);
  const [selectedRepoForTags, setSelectedRepoForTags] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(() => {
    const p = parseInt(getInitialParam("page", "1"), 10);
    return isNaN(p) || p < 1 ? 1 : p;
  });
  const [pageSize, setPageSize] = useState<number>(() => {
    const ps = parseInt(getInitialParam("page_size", getInitialParam("per_page", "30")), 10);
    return isNaN(ps) ? 30 : ps;
  });
  const [viewMode, setViewMode] = useState<"stream" | "pages">(() => (getInitialParam("mode") === "pages" ? "pages" : "stream"));
  const [directImageInput, setDirectImageInput] = useState("");
  const [copiedImage, setCopiedImage] = useState<string | null>(null);

  // Synchronize state with browser URL search parameters in real time
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams();

    if (activeRegistry && activeRegistry !== "dockerhub") sp.set("registry", activeRegistry);
    if (deferredSearchQuery.trim()) sp.set("q", deferredSearchQuery.trim());
    if (activeCategory && activeCategory !== "all" && activeCategory !== "_search") sp.set("category", activeCategory);
    if (activeBadge) sp.set("badges", activeBadge);
    if (activeOS) sp.set("operating_system", activeOS);
    if (activeArch) sp.set("architecture", activeArch);
    if (activeSort && activeSort !== "pulls") sp.set("sort", activeSort);
    if (currentPage > 1) sp.set("page", String(currentPage));
    if (pageSize !== 30) sp.set("page_size", String(pageSize));
    if (viewMode !== "stream") sp.set("mode", viewMode);

    const queryString = sp.toString();
    const newUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ""}`;
    if (window.location.search !== (queryString ? `?${queryString}` : "")) {
      window.history.replaceState(null, "", newUrl);
    }
  }, [activeRegistry, deferredSearchQuery, activeCategory, activeBadge, activeOS, activeArch, activeSort, currentPage, pageSize, viewMode]);

  // Handle browser Back / Forward buttons
  useEffect(() => {
    const handlePopState = () => {
      const sp = new URLSearchParams(window.location.search);
      setActiveRegistry(sp.get("registry") === "ghcr" ? "ghcr" : "dockerhub");
      setSearchQuery(sp.get("q") || "");
      setActiveCategory(sp.get("category") || "all");
      setActiveBadge(sp.get("badges") || "");
      setActiveOS(sp.get("operating_system") || sp.get("os") || "");
      setActiveArch(sp.get("architecture") || sp.get("arch") || "");
      setActiveSort(sp.get("sort") || "pulls");
      setCurrentPage(parseInt(sp.get("page") || "1", 10) || 1);
      setPageSize(parseInt(sp.get("page_size") || sp.get("per_page") || "30", 10) || 30);
      setViewMode(sp.get("mode") === "pages" ? "pages" : "stream");
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Deploy Dialog State
  const [deployModalImage, setDeployModalImage] = useState<string | null>(null);
  const [deployProjectName, setDeployProjectName] = useState("");
  const [deployPort, setDeployPort] = useState(8080);

  // Infinite Query for Stream / Infinite Scroll mode
  const infiniteQuery = useInfiniteQuery<SearchResponse>({
    queryKey: ["registry-infinite-v5", activeRegistry, deferredSearchQuery.trim(), activeCategory, activeBadge, activeOS, activeArch, activeSort, officialOnly, pageSize, engine.url],
    queryFn: async ({ pageParam = 1 }) => {
      if (activeRegistry === "ghcr") {
        return engine.call<SearchResponse>(
          "GET",
          `/api/catalog/ghcr-search?q=${encodeURIComponent(deferredSearchQuery.trim())}&page=${pageParam}&per_page=${pageSize}`
        );
      }
      const catParam = activeCategory !== "all" && activeCategory !== "_search" ? `&category=${encodeURIComponent(activeCategory)}` : "";
      const badgeParam = activeBadge ? `&badges=${encodeURIComponent(activeBadge)}` : "";
      const osParam = activeOS ? `&operating_system=${encodeURIComponent(activeOS)}` : "";
      const archParam = activeArch ? `&architecture=${encodeURIComponent(activeArch)}` : "";
      const sortParam = activeSort ? `&sort=${encodeURIComponent(activeSort)}` : "";
      const offParam = officialOnly ? "&official=true" : "";
      return engine.call<SearchResponse>(
        "GET",
        `/api/catalog/dockerhub-search?q=${encodeURIComponent(deferredSearchQuery.trim())}${catParam}${badgeParam}${osParam}${archParam}${sortParam}${offParam}&page=${pageParam}&page_size=${pageSize}`
      );
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (!lastPage || !lastPage.results || lastPage.results.length === 0) return undefined;
      const curPage = lastPage.page || 1;
      const totalPages = lastPage.totalPages || Math.ceil((lastPage.total || 0) / pageSize);
      return curPage < totalPages ? curPage + 1 : undefined;
    },
    enabled: viewMode === "stream",
    staleTime: 5 * 60 * 1000,
  });

  // Single Page Query for Paginated Mode
  const pagedQuery = useQuery<SearchResponse>({
    queryKey: ["registry-paged-v5", activeRegistry, deferredSearchQuery.trim(), activeCategory, activeBadge, activeOS, activeArch, activeSort, officialOnly, currentPage, pageSize, engine.url],
    queryFn: async () => {
      if (activeRegistry === "ghcr") {
        return engine.call<SearchResponse>(
          "GET",
          `/api/catalog/ghcr-search?q=${encodeURIComponent(deferredSearchQuery.trim())}&page=${currentPage}&per_page=${pageSize}`
        );
      }
      const catParam = activeCategory !== "all" && activeCategory !== "_search" ? `&category=${encodeURIComponent(activeCategory)}` : "";
      const badgeParam = activeBadge ? `&badges=${encodeURIComponent(activeBadge)}` : "";
      const osParam = activeOS ? `&operating_system=${encodeURIComponent(activeOS)}` : "";
      const archParam = activeArch ? `&architecture=${encodeURIComponent(activeArch)}` : "";
      const sortParam = activeSort ? `&sort=${encodeURIComponent(activeSort)}` : "";
      const offParam = officialOnly ? "&official=true" : "";
      return engine.call<SearchResponse>(
        "GET",
        `/api/catalog/dockerhub-search?q=${encodeURIComponent(deferredSearchQuery.trim())}${catParam}${badgeParam}${osParam}${archParam}${sortParam}${offParam}&page=${currentPage}&page_size=${pageSize}`
      );
    },
    enabled: viewMode === "pages",
    staleTime: 5 * 60 * 1000,
  });

  // Aggregate results based on mode
  const allStreamResults = infiniteQuery.data?.pages?.flatMap((p) => p.results || []) || [];
  const latestPage = infiniteQuery.data?.pages?.[infiniteQuery.data.pages.length - 1];
  const totalCount = viewMode === "stream" ? (latestPage?.total || allStreamResults.length) : (pagedQuery.data?.total || 0);
  const searchLoading = viewMode === "stream" ? infiniteQuery.isLoading : pagedQuery.isLoading;
  const isFetchingNext = infiniteQuery.isFetchingNextPage;
  const hasMore = infiniteQuery.hasNextPage;

  // Active results list
  const displayResults = viewMode === "stream" ? allStreamResults : (pagedQuery.data?.results || []);

  // Infinite scroll trigger on window scroll
  useEffect(() => {
    if (viewMode !== "stream" || !hasMore || isFetchingNext) return;
    const handleScroll = () => {
      const scrollBottom = window.innerHeight + window.scrollY;
      const docHeight = document.documentElement.scrollHeight;
      if (docHeight - scrollBottom < 900 && !isFetchingNext && hasMore) {
        infiniteQuery.fetchNextPage();
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [viewMode, hasMore, isFetchingNext, infiniteQuery]);

  // Query live tags for expanded repository
  const { data: tagsData, isLoading: tagsLoading } = useQuery<RegistryTagsResponse | null>({
    queryKey: ["registry-tags-v5", activeRegistry, selectedRepoForTags, engine.url],
    queryFn: async () => {
      if (!selectedRepoForTags) return null;
      if (activeRegistry === "ghcr") {
        return engine.call<RegistryTagsResponse>(
          "GET",
          `/api/catalog/ghcr-tags?repo=${encodeURIComponent(selectedRepoForTags)}`
        );
      }
      return engine.call<RegistryTagsResponse>(
        "GET",
        `/api/catalog/dockerhub-tags?repo=${encodeURIComponent(selectedRepoForTags)}`
      );
    },
    enabled: !!selectedRepoForTags,
  });

  // Deploy Mutation
  const deployMutation = useMutation({
    mutationFn: async ({ name, image, port }: { name: string; image: string; port: number }) => {
      const cleanProjName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
      // 1. Create project
      await engine.call("POST", "/api/projects", {
        name: cleanProjName,
        source: image,
        target: "docker",
        port,
      });
      // 2. Trigger deployment
      return engine.call("POST", `/api/projects/${encodeURIComponent(cleanProjName)}/deploy`, {
        trigger: "container-explorer",
      });
    },
    onSuccess: (_, vars) => {
      const cleanProjName = vars.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
      toast.success(`Launched container project "${cleanProjName}" with image "${vars.image}"!`);
      setDeployModalImage(null);
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["engine-projects"] });
      nav({ to: `/p/${cleanProjName}` });
    },
    onError: (err: any) => {
      toast.error(`Deploy failed: ${err.message}`);
    },
  });

  const handleOpenDeploy = (imageTag: string, defaultPort: number = 8080) => {
    setDeployModalImage(imageTag);
    const baseSlug = imageTag
      .split(":")[0]
      .split("/")
      .pop()!
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-");
    setDeployProjectName(baseSlug);
    setDeployPort(defaultPort);
  };

  const handleRegistrySwitch = (reg: "dockerhub" | "ghcr") => {
    setActiveRegistry(reg);
    setSelectedRepoForTags(null);
    setCurrentPage(1);
    setSearchQuery("");
    setActiveCategory("all");
  };

  const handleDirectLaunch = () => {
    const trimmed = directImageInput.trim();
    if (!trimmed) {
      toast.error("Please enter a valid container image (e.g. redis:alpine, quay.io/coreos/etcd:latest)");
      return;
    }
    handleOpenDeploy(trimmed, 8080);
  };

  const handleCopyTag = (tagStr: string) => {
    navigator.clipboard.writeText(tagStr);
    setCopiedImage(tagStr);
    toast.success(`Copied "${tagStr}" to clipboard`);
    setTimeout(() => setCopiedImage(null), 2000);
  };

  const categories = activeRegistry === "ghcr" ? GHCR_CATEGORIES : DOCKERHUB_CATEGORIES;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Container Registries Explorer</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
              <Boxes className="h-3.5 w-3.5" /> Docker Hub + GHCR
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Discover, search all 13.2M+ public container images from Docker Hub and GitHub Container Registry, inspect version tags, and 1-click deploy to HosteraX.
          </p>
        </div>

        {/* Registry Switcher */}
        <div className="flex items-center gap-1.5 rounded-xl border border-border bg-card p-1 shadow-sm shrink-0">
          <button
            onClick={() => handleRegistrySwitch("dockerhub")}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeRegistry === "dockerhub"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-surface"
            }`}
          >
            <span>🐳</span>
            <span>Docker Hub</span>
          </button>
          <button
            onClick={() => handleRegistrySwitch("ghcr")}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeRegistry === "ghcr"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-surface"
            }`}
          >
            <span>🐙</span>
            <span>GitHub (ghcr.io)</span>
          </button>
        </div>
      </div>

      {/* Direct Image Launcher & Quick Pull */}
      <div className="rounded-xl border border-border/80 bg-surface/50 p-4 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center text-primary shrink-0">
            <Terminal className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <span>Quick Launch Any Container Image</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-success/15 text-success font-mono font-medium">OCI Ready</span>
            </div>
            <p className="text-[11px] text-muted-foreground">Pull from any public or private registry directly (Docker Hub, GHCR, Quay, ECR, GCR)</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-1 max-w-xl">
          <input
            type="text"
            placeholder="e.g. docker.io/library/alpine:latest, quay.io/coreos/etcd:latest, nginx:alpine"
            value={directImageInput}
            onChange={(e) => setDirectImageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleDirectLaunch();
            }}
            className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-input bg-card font-mono placeholder:font-sans focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={handleDirectLaunch}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity shrink-0 shadow-sm"
          >
            <Play className="h-3 w-3 fill-current" />
            <span>Launch</span>
          </button>
        </div>
      </div>

      {/* Search Bar & Categories */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={
                activeRegistry === "ghcr"
                  ? "Search all GHCR packages (e.g. immich-app/immich-server, home-assistant, twenty, jellyfin)..."
                  : "Search all 13,298,000+ Docker Hub images (e.g. postgres, redis, apache/airflow, ollama, nginx)..."
              }
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
                setActiveCategory("_search");
              }}
              className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-input bg-surface focus:outline-none focus:ring-2 focus:ring-primary font-mono placeholder:font-sans"
            />
          </div>
          <button
            onClick={() => {
              setCurrentPage(1);
              if (viewMode === "stream") infiniteQuery.refetch();
              else pagedQuery.refetch();
            }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-surface border border-border text-sm font-medium hover:bg-surface-2 transition-colors shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${searchLoading ? "animate-spin text-primary" : ""}`} />
            <span>Search {activeRegistry === "ghcr" ? "GHCR" : "Docker Hub"}</span>
          </button>
        </div>

        {/* Docker Hub Badges & Multi-Facet Header */}
        {activeRegistry === "dockerhub" && (
          <div className="space-y-2.5 border-b border-border/50 pb-3 text-xs">
            {/* Row 1: Badges */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <span className="text-muted-foreground mr-1 flex items-center gap-1 shrink-0 font-medium">
                <Shield className="h-3.5 w-3.5 text-primary" /> Badges:
              </span>
              {DOCKERHUB_BADGES.map((b) => (
                <button
                  key={b.id}
                  onClick={() => {
                    setActiveBadge(b.id);
                    setCurrentPage(1);
                  }}
                  className={`px-3 py-1 rounded-lg text-xs transition-all whitespace-nowrap font-medium flex items-center gap-1.5 ${
                    activeBadge === b.id
                      ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                      : "bg-surface text-muted-foreground hover:text-foreground border border-border/60 hover:bg-surface-2"
                  }`}
                >
                  <span>{b.label}</span>
                </button>
              ))}
            </div>

            {/* Row 2: OS, Architecture & Sorting */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-border/30">
              {/* Operating System */}
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <span className="text-muted-foreground mr-1 flex items-center gap-1 shrink-0 font-medium">
                  <span>💻</span> OS:
                </span>
                {DOCKERHUB_OS_FILTERS.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => {
                      setActiveOS(o.id);
                      setCurrentPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs transition-all whitespace-nowrap font-medium flex items-center gap-1 ${
                      activeOS === o.id
                        ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                        : "bg-surface text-muted-foreground hover:text-foreground border border-border/60 hover:bg-surface-2"
                    }`}
                  >
                    <span>{o.label}</span>
                  </button>
                ))}
              </div>

              {/* Architectures */}
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <span className="text-muted-foreground mr-1 flex items-center gap-1 shrink-0 font-medium">
                  <span>⚡</span> Arch:
                </span>
                {DOCKERHUB_ARCHITECTURES.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      setActiveArch(a.id);
                      setCurrentPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs transition-all whitespace-nowrap font-medium flex items-center gap-1 ${
                      activeArch === a.id
                        ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                        : "bg-surface text-muted-foreground hover:text-foreground border border-border/60 hover:bg-surface-2"
                    }`}
                  >
                    <span>{a.label}</span>
                  </button>
                ))}
              </div>

              {/* Sort Selector */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-muted-foreground mr-1 font-medium">Sort:</span>
                <select
                  value={activeSort}
                  onChange={(e) => {
                    setActiveSort(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium bg-surface border border-border/80 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {SORT_OPTIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Quick Category Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <span className="text-muted-foreground mr-1 flex items-center gap-1 shrink-0">
            <Filter className="h-3 w-3" /> Categories:
          </span>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                setActiveCategory(cat.id);
                setSearchQuery("");
                setCurrentPage(1);
              }}
              className={`px-2.5 py-1 rounded-md transition-all whitespace-nowrap ${
                activeCategory === cat.id
                  ? "bg-primary/20 text-primary font-semibold border border-primary/30"
                  : "bg-surface text-muted-foreground hover:text-foreground border border-border/50 hover:bg-surface-2"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results Header & Controls */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-muted-foreground font-mono">
          <div className="flex items-center gap-2 flex-wrap">
            {searchLoading && displayResults.length === 0 ? (
              <span>Searching 13,298,370+ container images...</span>
            ) : (
              <span>
                {activeRegistry === "dockerhub" ? (
                  <>
                    Showing <span className="text-foreground font-semibold font-mono">{viewMode === "stream" ? `1 - ${displayResults.length} of ${(totalCount || 0).toLocaleString()}` : `${(currentPage - 1) * pageSize + 1} - ${Math.min(currentPage * pageSize, totalCount || 0)} of ${(totalCount || 0).toLocaleString()}`} available results</span> on Docker Hub
                  </>
                ) : (
                  <>
                    Showing <span className="text-foreground font-semibold font-mono">{displayResults.length} of {(totalCount || 0).toLocaleString()}</span> available packages on GitHub Container Registry (ghcr.io)
                  </>
                )}
                {deferredSearchQuery && (
                  <span> for "{deferredSearchQuery}"</span>
                )}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* View Mode Switcher */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
              <button
                onClick={() => setViewMode("stream")}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                  viewMode === "stream" ? "bg-card text-foreground shadow-sm font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
                title="Continuous Infinite Stream (auto-load as you scroll)"
              >
                Stream ({displayResults.length})
              </button>
              <button
                onClick={() => setViewMode("pages")}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                  viewMode === "pages" ? "bg-card text-foreground shadow-sm font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
                title="Paginated View"
              >
                Pages
              </button>
            </div>

            {/* Batch Size Selector */}
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-2 py-1 rounded-lg bg-surface border border-border text-xs font-mono"
            >
              <option value={30}>30 per batch</option>
              <option value={60}>60 per batch</option>
              <option value={100}>100 per batch</option>
            </select>

            {/* Official Filter Toggle */}
            {activeRegistry === "dockerhub" && (
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs select-none hover:text-foreground">
                <input
                  type="checkbox"
                  checked={officialOnly}
                  onChange={(e) => {
                    setOfficialOnly(e.target.checked);
                    setCurrentPage(1);
                  }}
                  className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5"
                />
                <span>🛡️ Official Only</span>
              </label>
            )}

            <span className="text-primary flex items-center gap-1">
              <Shield className="h-3.5 w-3.5" /> Direct OCI Pull Ready
            </span>
          </div>
        </div>

        {searchLoading && displayResults.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-44 rounded-xl border border-border bg-card/50 animate-pulse p-5" />
            ))}
          </div>
        ) : displayResults.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground">
            <Boxes className="mx-auto h-12 w-12 opacity-20 mb-3" />
            <p className="text-base font-medium text-foreground">No container repositories found for "{searchQuery}"</p>
            <p className="text-xs mt-1">Try searching by package name or owner, or use the Quick Launch input above to run any container image directly.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayResults.map((r, idx) => {
              const isSelected = selectedRepoForTags === (r.repo || r.repoName || r.name);
              const targetRepo = r.repo || r.repoName || r.name;
              const fullImageUri = activeRegistry === "ghcr" ? `ghcr.io/${targetRepo}:latest` : (r.image || `${targetRepo}:latest`);

              return (
                <div
                  key={`${r.id || targetRepo}-${idx}`}
                  className={`rounded-xl border transition-all flex flex-col justify-between bg-card p-5 ${
                    isSelected ? "border-primary ring-1 ring-primary shadow-md" : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="space-y-2.5">
                    {/* Top Row: Logo, Name, Badge, URL */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <div className="h-9 w-9 rounded-lg border border-border/80 bg-surface flex items-center justify-center p-1 overflow-hidden shrink-0 mt-0.5 shadow-sm">
                          <RegistryLogo
                            logoCandidates={r.logoCandidates}
                            logoUrl={r.logoUrl}
                            fallbackEmoji={r.icon || (activeRegistry === "ghcr" ? "🐙" : "🐳")}
                            title={r.name || targetRepo}
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-sm truncate text-foreground">{r.name || targetRepo}</span>
                            {(r.isOfficial || r.official) && (
                              <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.2 text-[10px] font-semibold text-primary">
                                <CheckCircle2 className="h-2.5 w-2.5" /> Verified
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-3 text-xs font-mono text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Star className="h-3.5 w-3.5 text-warning fill-warning" />
                              {r.starCountFormatted || String(r.stars || "Popular")}
                            </span>
                            {r.pullCountFormatted && (
                              <span className="flex items-center gap-1">
                                <ArrowDownToLine className="h-3.5 w-3.5 text-primary" />
                                {r.pullCountFormatted}
                              </span>
                            )}
                            {activeRegistry === "ghcr" && (
                              <span className="text-primary font-medium">ghcr.io</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleCopyTag(fullImageUri)}
                          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                          title="Copy full image URI"
                        >
                          {copiedImage === fullImageUri ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                        <a
                          href={r.ghcrUrl || r.hubUrl || `https://github.com/${targetRepo}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                          title="View on Registry / GitHub"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {r.desc || `Public container image from ${activeRegistry === "ghcr" ? "GitHub Container Registry" : "Docker Hub"}.`}
                    </p>
                  </div>

                  {/* Actions & Tag Exploration */}
                  <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between gap-2">
                    <button
                      onClick={() => setSelectedRepoForTags(isSelected ? null : targetRepo)}
                      className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
                        isSelected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-surface"
                      }`}
                    >
                      <Tag className="h-3 w-3" />
                      <span>Explore Tags</span>
                      {isSelected ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>

                    <button
                      onClick={() => handleOpenDeploy(fullImageUri, r.defaultPort || 8080)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Deploy</span>
                    </button>
                  </div>

                  {/* Expandable Tags Drawer */}
                  {isSelected && (
                    <div className="mt-4 pt-3 border-t border-primary/30 space-y-2.5 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-muted-foreground">Available Tags for {targetRepo}:</span>
                        {tagsLoading && <RefreshCw className="h-3 w-3 animate-spin text-primary" />}
                      </div>

                      {tagsLoading ? (
                        <div className="py-4 text-center text-xs text-muted-foreground font-mono">Loading tags from {activeRegistry === "ghcr" ? "ghcr.io" : "Docker Hub"}...</div>
                      ) : tagsData?.tags?.length === 0 ? (
                        <div className="py-2 text-xs text-muted-foreground font-mono">No tags discovered.</div>
                      ) : (
                        <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                          {tagsData?.tags.map((t) => (
                            <div
                              key={t.name}
                              className="flex items-center justify-between p-2 rounded-lg bg-surface border border-border/70 text-xs font-mono hover:border-primary/50 transition-colors"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-semibold text-foreground truncate">{t.name}</span>
                                  {t.isHardened && (
                                    <span className="px-1.5 py-0.2 rounded bg-success/15 text-[10px] font-semibold text-success">
                                      Hardened
                                    </span>
                                  )}
                                  {t.isSlim && (
                                    <span className="px-1.5 py-0.2 rounded bg-primary/15 text-[10px] font-semibold text-primary">
                                      Slim
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                                  <span>{t.sizeFormatted}</span>
                                  <span>·</span>
                                  <span>{t.architectures.join(", ")}</span>
                                </div>
                              </div>

                              <button
                                onClick={() => handleOpenDeploy(t.tag, r.defaultPort || 8080)}
                                className="ml-2 px-2 py-1 rounded bg-primary/15 hover:bg-primary hover:text-primary-foreground text-primary text-[11px] font-semibold transition-colors shrink-0"
                              >
                                Run
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Continuous Stream Load More / Pagination */}
        {viewMode === "stream" ? (
          <div className="py-6 space-y-3">
            <div className="flex items-center justify-center">
              {isFetchingNext && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                  <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                  <span>Loading more container repositories from Docker Hub...</span>
                </div>
              )}
            </div>

            {hasMore && !isFetchingNext && (
              <div className="flex justify-center">
                <button
                  onClick={() => infiniteQuery.fetchNextPage()}
                  className="inline-flex items-center gap-2 px-6 py-2.5 text-xs font-semibold rounded-xl border border-border bg-card hover:bg-surface transition-all shadow-sm glow-primary"
                >
                  <Plus className="h-4 w-4 text-primary" />
                  <span>Load More (Showing {displayResults.length} of {totalCount.toLocaleString()} available results)</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          totalCount > pageSize && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4 px-2 border-t border-border mt-4">
              <div className="text-xs text-muted-foreground font-mono">
                Showing <span className="text-foreground font-semibold">{(currentPage - 1) * pageSize + 1}</span> to{" "}
                <span className="text-foreground font-semibold">
                  {Math.min(currentPage * pageSize, totalCount)}
                </span>{" "}
                of <span className="text-foreground font-semibold">{totalCount.toLocaleString()}</span> container repositories
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setCurrentPage((p) => Math.max(1, p - 1));
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  disabled={currentPage <= 1 || searchLoading}
                  className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-surface disabled:opacity-40 transition-colors shadow-sm"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>Previous</span>
                </button>

                <span className="px-3.5 py-1.5 text-xs font-mono text-foreground font-medium rounded-lg bg-surface border border-border">
                  Page {currentPage} of {Math.ceil(totalCount / pageSize)}
                </span>

                <button
                  onClick={() => {
                    setCurrentPage((p) => Math.min(Math.ceil(totalCount / pageSize), p + 1));
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  disabled={currentPage >= Math.ceil(totalCount / pageSize) || searchLoading}
                  className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-surface disabled:opacity-40 transition-colors shadow-sm"
                >
                  <span>Next</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )
        )}
      </div>

      {/* Deploy Modal Dialog */}
      {deployModalImage && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold tracking-tight">Deploy Container Image</h3>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                  Target: {deployModalImage}
                </p>
              </div>
              <button
                onClick={() => setDeployModalImage(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-mono p-1 rounded-md hover:bg-surface"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  value={deployProjectName}
                  onChange={(e) => setDeployProjectName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-surface font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Container Port
                </label>
                <input
                  type="number"
                  value={deployPort}
                  onChange={(e) => setDeployPort(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-surface font-mono"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  HosteraX will automatically map this to a verified free host port and configure your wildcard domain.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setDeployModalImage(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-border hover:bg-surface transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  deployMutation.mutate({
                    name: deployProjectName,
                    image: deployModalImage,
                    port: deployPort,
                  })
                }
                disabled={deployMutation.isPending || !deployProjectName.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity shadow-sm disabled:opacity-50"
              >
                {deployMutation.isPending && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                <span>{deployMutation.isPending ? "Launching Project..." : "Deploy Container"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
