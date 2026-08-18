// hosterax/engine/src/catalog-api.mjs
// Dynamic Catalog API for Awesome-Selfhosted, selfh.st, and fail-safe Docker image inspection

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let catalogData = { tags: [], apps: [], totalApps: 0, totalTags: 0 };
const DOCKERHUB_CATEGORY_CACHE = new Map();

try {
  const dbPath = path.join(__dirname, "awesome-selfhosted-db.json");
  if (fs.existsSync(dbPath)) {
    catalogData = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  }
} catch (err) {
  console.warn("Failed to load awesome-selfhosted-db.json:", err);
}

export function createCatalogApi({ db, HOME, readBody }) {
  return async function handleCatalog(req, res, pathname) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const p = pathname || url.pathname;

    // Helper to send json
    const sendJson = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      res.end(JSON.stringify(data));
      return true;
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      res.end();
      return true;
    }

    function formatCount(num) {
      if (!num || isNaN(num)) return "0";
      if (num >= 1000000000) return (num / 1000000000).toFixed(1) + "B+";
      if (num >= 1000000) return (num / 1000000).toFixed(1) + "M+";
      if (num >= 1000) return (num / 1000).toFixed(1) + "K+";
      return String(num);
    }

    function getLogoCandidates(cleanRepo) {
      const clean = cleanRepo.toLowerCase().replace(/^library\//, "");
      const parts = clean.split("/");
      const owner = parts.length > 1 ? parts[0] : null;
      const name = parts.length > 1 ? parts[1] : parts[0];
      const simpleName = name.replace(/[^a-z0-9]/g, "");
      const candidates = [
        `https://raw.githubusercontent.com/docker-library/docs/master/${simpleName}/logo.png`,
        `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${simpleName}.png`,
        `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/${simpleName}.svg`,
        `https://cdn.simpleicons.org/${simpleName}`,
      ];
      if (owner) {
        candidates.push(`https://github.com/${owner}.png?size=128`);
        candidates.push(`https://raw.githubusercontent.com/${owner}/${name}/main/logo.png`);
        candidates.push(`https://raw.githubusercontent.com/${owner}/${name}/master/logo.png`);
      }
      return candidates;
    }

    // Get all tags from awesome-selfhosted.net
    if (p === "/api/catalog/tags" && req.method === "GET") {
      return sendJson(200, {
        total: catalogData.tags.length,
        tags: catalogData.tags,
      });
    }

    // Search and filter apps across all awesome-selfhosted tags
    if ((p === "/api/catalog/apps" || p === "/api/catalog/search") && req.method === "GET") {
      const tag = url.searchParams.get("tag")?.toLowerCase();
      const source = url.searchParams.get("source")?.toLowerCase();
      const q = url.searchParams.get("q")?.toLowerCase().trim();
      const limit = parseInt(url.searchParams.get("limit") || "5000", 10);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);

      let filtered = catalogData.apps;

      if (source && source !== "all") {
        if (source === "selfhst") {
          filtered = filtered.filter((a) => a.source === "selfhst" || a.tags?.includes("selfhst"));
        } else if (source === "awesome_sysadmin") {
          filtered = filtered.filter(
            (a) => a.source === "awesome_sysadmin" || a.tags?.includes("sysadmin"),
          );
        } else if (source === "awesome_selfhosted") {
          filtered = filtered.filter((a) => a.source === "awesome_selfhosted");
        } else if (source === "verified") {
          filtered = filtered.filter((a) => a.source === "verified");
        } else {
          filtered = filtered.filter((a) => a.source === source);
        }
      }

      if (tag && tag !== "all") {
        filtered = filtered.filter(
          (a) =>
            a.category?.toLowerCase() === tag ||
            a.categoryLabel?.toLowerCase() === tag ||
            a.tags?.some((t) => t.toLowerCase() === tag),
        );
      }

      if (q) {
        filtered = filtered.filter(
          (a) =>
            a.name.toLowerCase().includes(q) ||
            a.desc.toLowerCase().includes(q) ||
            a.categoryLabel?.toLowerCase().includes(q) ||
            a.image?.toLowerCase().includes(q) ||
            a.tags?.some((t) => t.toLowerCase().includes(q)),
        );
      }

      const paginated = filtered.slice(offset, offset + limit);

      return sendJson(200, {
        total: filtered.length,
        limit,
        offset,
        apps: paginated,
      });
    }

    async function fetchLiveDockerHubCategory(categorySlug) {
      if (!categorySlug || categorySlug === "all" || categorySlug === "_search") return [];
      const cacheKey = categorySlug.toLowerCase();
      const cached = DOCKERHUB_CATEGORY_CACHE.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < 3600 * 1000) {
        return cached.items;
      }

      try {
        const catUrl = `https://hub.docker.com/categories/${encodeURIComponent(categorySlug)}`;
        const res = await fetch(catUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });

        if (!res.ok) return [];
        const html = await res.text();
        const officialMatches = [...html.matchAll(/href="\/_\/([a-zA-Z0-9_-]+)"/g)].map(
          (m) => m[1],
        );
        const communityMatches = [...html.matchAll(/href="\/r\/([a-zA-Z0-9_\/-]+)"/g)].map(
          (m) => m[1],
        );
        const uniqueRepos = [...new Set([...officialMatches, ...communityMatches])];

        const items = await Promise.all(
          uniqueRepos.slice(0, 30).map(async (cleanRepo) => {
            const isLib = !cleanRepo.includes("/");
            const metaUrl = isLib
              ? `https://hub.docker.com/v2/repositories/library/${cleanRepo}/`
              : `https://hub.docker.com/v2/repositories/${cleanRepo}/`;

            let meta = {
              star_count: 0,
              pull_count: 0,
              description: "Official container image from Docker Hub.",
            };
            try {
              const metaRes = await fetch(metaUrl, { headers: { "User-Agent": "HosteraX/1.0" } });
              if (metaRes.ok) {
                meta = await metaRes.json();
              }
            } catch (err) {
              // Ignore single repo meta fetch error
            }

            const imageTag = cleanRepo.includes(":") ? cleanRepo : `${cleanRepo}:latest`;
            const logoCandidates = getLogoCandidates(cleanRepo);

            return {
              id: cleanRepo.replace(/[^a-zA-Z0-9_-]/g, "_"),
              name: cleanRepo,
              repoName: cleanRepo,
              image: imageTag,
              tag: imageTag,
              desc:
                meta.description ||
                meta.short_description ||
                "Public Docker container image from Docker Hub.",
              stars: meta.star_count || 0,
              starCountFormatted: formatCount(meta.star_count || 0),
              pulls: meta.pull_count || 0,
              pullCountFormatted: formatCount(meta.pull_count || 0),
              isOfficial: isLib || !!meta.is_official,
              isAutomated: !!meta.is_automated,
              hubUrl: `https://hub.docker.com/r/${cleanRepo.includes("/") ? cleanRepo : `_/${cleanRepo}`}`,
              logoUrl: logoCandidates[0],
              logoCandidates,
              icon: isLib ? "🛡️" : "🐳",
              category: categorySlug,
            };
          }),
        );

        DOCKERHUB_CATEGORY_CACHE.set(cacheKey, { timestamp: Date.now(), items });
        return items;
      } catch (e) {
        console.warn(`[live-category-fetch] Failed to fetch category ${categorySlug}:`, e.message);
        return [];
      }
    }

    // Live Docker Hub Search API (https://hub.docker.com/search?q=...)
    if (p === "/api/catalog/dockerhub-search" && req.method === "GET") {
      const rawQ = url.searchParams.get("q")?.trim() || "";
      const category = url.searchParams.get("category")?.trim() || "";
      const badges = url.searchParams.get("badges")?.trim() || "";
      const isOfficialBadge = badges === "official" || url.searchParams.get("official") === "true";
      const isHardenedBadge = badges === "hardened";
      const isVerifiedPublisherBadge = badges === "verified_publisher";
      const isOpenSourceBadge = badges === "open_source";
      const os = (url.searchParams.get("operating_system") || url.searchParams.get("os") || "")
        .trim()
        .toLowerCase();
      const isWindowsOS = os === "windows";
      const isLinuxOS = os === "linux";

      const arch = (url.searchParams.get("architecture") || url.searchParams.get("arch") || "")
        .trim()
        .toLowerCase();
      const sort = (url.searchParams.get("sort") || "pulls").trim().toLowerCase();

      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const pageSize = Math.min(
        100,
        Math.max(
          1,
          parseInt(
            url.searchParams.get("page_size") || url.searchParams.get("per_page") || "30",
            10,
          ),
        ),
      );

      // Map official Docker Hub category slugs to search keywords for live search
      const CATEGORY_SEARCH_MAP = {
        networking: "network",
        "api-management": "api gateway",
        security: "security",
        "languages-and-frameworks": "programming language",
        "integration-and-delivery": "ci cd",
        "message-queues": "message broker",
        "internet-of-things": "iot",
        "machine-learning-and-ai": "ai",
        "developer-tools": "developer",
        "data-science": "data science",
        "web-servers": "web server",
        "operating-systems": "linux",
        "content-management-system": "cms",
        "databases-and-storage": "database",
        "monitoring-and-observability": "monitoring",
        "web-analytics": "analytics",
      };

      // Determine Docker Hub Search Query (defaults to '*' to browse all 13.2M+ images)
      let hubQuery = "*";
      let hubPage = page;
      if (rawQ && rawQ !== "__ALL__") {
        hubQuery = rawQ;
      } else if (isWindowsOS) {
        hubQuery = "windows";
      } else if (isHardenedBadge) {
        hubQuery = "hardened";
      } else if (isVerifiedPublisherBadge) {
        hubQuery = "verified";
      } else if (isOpenSourceBadge) {
        hubQuery = "open-source";
      } else if (category && CATEGORY_SEARCH_MAP[category]) {
        hubQuery = CATEGORY_SEARCH_MAP[category];
      }

      // Universal multi-strategy sharding to bypass Docker Hub's 200-item single-query anonymous limit:
      if ((page - 1) * pageSize >= 180) {
        const pagesPerShard = Math.max(1, Math.floor(180 / pageSize)); // e.g. 6 pages of 30
        const offsetPastInitial = (page - 1) * pageSize - 180;

        if (rawQ && rawQ !== "__ALL__") {
          // Shard specific keyword search with contextual sub-qualifiers
          const SEARCH_MODIFIERS = [
            "",
            "server",
            "alpine",
            "cluster",
            "backup",
            "client",
            "exporter",
            "proxy",
            "latest",
            "dev",
            "app",
            "ui",
            "node",
            "tools",
            "web",
            "cloud",
          ];
          const modIndex =
            Math.floor(offsetPastInitial / (pagesPerShard * pageSize)) % SEARCH_MODIFIERS.length;
          const modifier = SEARCH_MODIFIERS[modIndex];
          hubQuery = modifier ? `${rawQ} ${modifier}` : rawQ;
          hubPage = (Math.floor(offsetPastInitial / pageSize) % pagesPerShard) + 1;
        } else if (isWindowsOS) {
          const WIN_SHARDS = [
            "windows",
            "nanoserver",
            "servercore",
            "dotnet-framework",
            "iis",
            "powershell",
            "windows-server",
            "aspnet-framework",
            "mcr",
          ];
          const shardIndex =
            Math.floor(offsetPastInitial / (pagesPerShard * pageSize)) % WIN_SHARDS.length;
          hubQuery = WIN_SHARDS[shardIndex];
          hubPage = (Math.floor(offsetPastInitial / pageSize) % pagesPerShard) + 1;
        } else if (isHardenedBadge) {
          const HARDENED_SHARDS = [
            "hardened",
            "dhi",
            "chainguard",
            "distroless",
            "minimal",
            "rootless",
            "cgr",
            "secure",
            "wolfi",
          ];
          const shardIndex =
            Math.floor(offsetPastInitial / (pagesPerShard * pageSize)) % HARDENED_SHARDS.length;
          hubQuery = HARDENED_SHARDS[shardIndex];
          hubPage = (Math.floor(offsetPastInitial / pageSize) % pagesPerShard) + 1;
        } else if (isVerifiedPublisherBadge) {
          const VP_SHARDS = [
            "publisher",
            "bitnami",
            "grafana",
            "hashicorp",
            "elastic",
            "portainer",
            "kong",
            "keycloak",
            "minio",
            "qdrant",
            "apache",
          ];
          const shardIndex =
            Math.floor(offsetPastInitial / (pagesPerShard * pageSize)) % VP_SHARDS.length;
          hubQuery = VP_SHARDS[shardIndex];
          hubPage = (Math.floor(offsetPastInitial / pageSize) % pagesPerShard) + 1;
        } else if (category) {
          // Shard category with related keywords pool
          const CAT_EXPANSION_MAP = {
            "databases-and-storage": [
              "database",
              "postgres",
              "redis",
              "mysql",
              "mongodb",
              "sqlite",
              "mariadb",
              "vector",
              "cache",
              "storage",
              "s3",
              "minio",
            ],
            "machine-learning-and-ai": [
              "ai",
              "ollama",
              "llm",
              "vllm",
              "pytorch",
              "tensorflow",
              "whisper",
              "rag",
              "embeddings",
              "openai",
              "deeplearning",
            ],
            "web-servers": [
              "web server",
              "nginx",
              "httpd",
              "caddy",
              "apache",
              "traefik",
              "reverse proxy",
              "ingress",
              "gateway",
              "tls",
              "ssl",
            ],
            "languages-and-frameworks": [
              "runtime",
              "node",
              "python",
              "golang",
              "rust",
              "openjdk",
              "php",
              "ruby",
              "bun",
              "deno",
              "dotnet",
            ],
            networking: [
              "network",
              "traefik",
              "wireguard",
              "tailscale",
              "vpn",
              "proxy",
              "dns",
              "pihole",
              "firewall",
              "router",
            ],
            security: [
              "security",
              "vault",
              "auth",
              "keycloak",
              "sso",
              "identity",
              "oauth",
              "crowdsec",
              "firewall",
              "certs",
            ],
            "integration-and-delivery": [
              "ci cd",
              "jenkins",
              "gitea",
              "drone",
              "runner",
              "gitlab",
              "pipeline",
              "builder",
              "actions",
            ],
            "message-queues": [
              "message broker",
              "rabbitmq",
              "kafka",
              "nats",
              "mqtt",
              "mosquitto",
              "redis pubsub",
              "sqs",
              "queues",
            ],
            "internet-of-things": [
              "iot",
              "home assistant",
              "nodered",
              "zigbee",
              "matter",
              "sensor",
              "smart home",
              "mqtt client",
            ],
            "developer-tools": [
              "developer",
              "code server",
              "vscode",
              "portainer",
              "dind",
              "cli",
              "git",
              "terminal",
              "debugger",
            ],
            "data-science": [
              "data science",
              "airflow",
              "jupyter",
              "pandas",
              "superset",
              "metabase",
              "spark",
              "hadoop",
              "etl",
            ],
            "operating-systems": [
              "linux",
              "alpine",
              "ubuntu",
              "debian",
              "fedora",
              "archlinux",
              "centos",
              "busybox",
              "coreos",
            ],
            "content-management-system": [
              "cms",
              "wordpress",
              "ghost",
              "strapi",
              "directus",
              "drupal",
              "blog",
              "markdown",
            ],
            "monitoring-and-observability": [
              "monitoring",
              "grafana",
              "prometheus",
              "uptime",
              "netdata",
              "vector",
              "loki",
              "jaeger",
              "metrics",
            ],
            "web-analytics": [
              "analytics",
              "matomo",
              "plausible",
              "umami",
              "traffic",
              "telemetry",
              "counter",
              "shlink",
            ],
          };
          const pool = CAT_EXPANSION_MAP[category] || [CATEGORY_SEARCH_MAP[category] || category];
          const poolIndex =
            Math.floor(offsetPastInitial / (pagesPerShard * pageSize)) % pool.length;
          hubQuery = pool[poolIndex];
          hubPage = (Math.floor(offsetPastInitial / pageSize) % pagesPerShard) + 1;
        } else {
          // Shard global wildcard browsing across alphabetical sets
          const SHARDS = [
            "a",
            "b",
            "c",
            "d",
            "e",
            "f",
            "g",
            "h",
            "i",
            "j",
            "k",
            "l",
            "m",
            "n",
            "o",
            "p",
            "q",
            "r",
            "s",
            "t",
            "u",
            "v",
            "w",
            "x",
            "y",
            "z",
          ];
          const shardIndex =
            Math.floor(offsetPastInitial / (pagesPerShard * pageSize)) % SHARDS.length;
          hubQuery = SHARDS[shardIndex];
          hubPage = (Math.floor(offsetPastInitial / pageSize) % pagesPerShard) + 1;
        }
      }

      // Query Live Docker Hub Search API (https://hub.docker.com/search?)
      try {
        const officialParam = isOfficialBadge ? "&is_official=true" : "";
        const osParam = os ? `&operating_system=${encodeURIComponent(os)}` : "";
        const archParam = arch ? `&architecture=${encodeURIComponent(arch)}` : "";
        const targetUrl = `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(hubQuery)}${officialParam}${osParam}${archParam}&page=${hubPage}&page_size=${pageSize}`;
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 4500);
        const hubRes = await fetch(targetUrl, {
          signal: ctrl.signal,
          headers: {
            "User-Agent": "HosteraX-DockerHubSearch/1.0",
            Accept: "application/json",
          },
        });
        clearTimeout(timeout);

        if (hubRes.ok) {
          const data = await hubRes.json();
          const rawResults = data.results || [];

          let results = rawResults.map((r) => {
            const isOfficial =
              !!r.is_official || r.repo_name.startsWith("library/") || !r.repo_name.includes("/");
            const cleanRepo = r.repo_name.startsWith("library/")
              ? r.repo_name.slice("library/".length)
              : r.repo_name;
            const imageTag = cleanRepo.includes(":") ? cleanRepo : `${cleanRepo}:latest`;
            const logoCandidates = getLogoCandidates(cleanRepo);

            return {
              id: cleanRepo.replace(/[^a-zA-Z0-9_-]/g, "_"),
              name: cleanRepo,
              repoName: cleanRepo,
              image: imageTag,
              tag: imageTag,
              desc: r.short_description || "Public Docker container image from Docker Hub.",
              stars: r.star_count || 0,
              starCountFormatted: formatCount(r.star_count || 0),
              pulls: r.pull_count || 0,
              pullCountFormatted: formatCount(r.pull_count || 0),
              isOfficial,
              isAutomated: !!r.is_automated,
              hubUrl: `https://hub.docker.com/r/${cleanRepo.includes("/") ? cleanRepo : `_/${cleanRepo}`}`,
              logoUrl: logoCandidates[0],
              logoCandidates,
              icon: isOfficial ? "🛡️" : "🐳",
              category,
            };
          });

          if (isOfficialBadge) {
            results = results.filter((r) => r.isOfficial);
          }

          // Live dynamic scraper integration: When category is active without a raw query on page 1, fetch directly from https://hub.docker.com/categories/<category>
          if (category && !rawQ && page === 1) {
            const liveCategoryItems = await fetchLiveDockerHubCategory(category);
            if (liveCategoryItems && liveCategoryItems.length > 0) {
              const liveNames = new Set(liveCategoryItems.map((c) => c.name.toLowerCase()));
              results = [
                ...liveCategoryItems,
                ...results.filter((r) => !liveNames.has(r.name.toLowerCase())),
              ];
            }
          }

          // In-memory sorting if requested
          if (sort === "stars") {
            results.sort((a, b) => b.stars - a.stars);
          } else if (sort === "name") {
            results.sort((a, b) => a.name.localeCompare(b.name));
          } else if (sort === "pulls") {
            results.sort((a, b) => b.pulls - a.pulls);
          }

          const total = data.count || results.length;
          const startIdx = (page - 1) * pageSize + 1;
          const endIdx = Math.min(page * pageSize, total);

          return sendJson(200, {
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
            query: rawQ,
            category,
            rangeText: `${startIdx} - ${endIdx} of ${total.toLocaleString()} available results`,
            results,
          });
        }
      } catch (err) {
        console.warn(`[dockerhub-search] Live API error:`, err.message);
      }

      // Fallback: empty results if live API fails
      const filtered = [];
      const offset = (page - 1) * pageSize;
      const results = filtered.slice(offset, offset + pageSize).map((item) => {
        const cleanRepo = item.name;
        const imageTag = cleanRepo.includes(":") ? cleanRepo : `${cleanRepo}:latest`;
        const logoCandidates = getLogoCandidates(cleanRepo);
        return {
          id: cleanRepo.replace(/[^a-zA-Z0-9_-]/g, "_"),
          name: cleanRepo,
          repoName: cleanRepo,
          image: imageTag,
          tag: imageTag,
          desc: item.desc,
          stars: item.stars,
          starCountFormatted: `${item.stars} stars`,
          pulls: item.pulls,
          pullCountFormatted: `${item.pulls} pulls`,
          isOfficial: item.isOfficial,
          isAutomated: false,
          hubUrl: `https://hub.docker.com/r/${cleanRepo.includes("/") ? cleanRepo : `_/${cleanRepo}`}`,
          logoUrl: logoCandidates[0],
          logoCandidates,
          icon: item.isOfficial ? "🛡️" : "🐳",
          defaultPort: item.defaultPort,
          category: item.category,
        };
      });

      return sendJson(200, {
        total: filtered.length,
        page,
        pageSize,
        totalPages: Math.ceil(filtered.length / pageSize),
        query: rawQ,
        category,
        results,
      });
    }

    // Live Docker Hub Repository Tags Explorer (https://hub.docker.com/r/.../tags)
    if (p === "/api/catalog/dockerhub-tags" && req.method === "GET") {
      let repo = url.searchParams.get("repo")?.trim();
      if (!repo) {
        return sendJson(400, { error: "repo parameter is required" });
      }

      // Handle official images without namespace (e.g. redis -> library/redis)
      let apiUrlRepo = repo;
      if (!apiUrlRepo.includes("/")) {
        apiUrlRepo = `library/${apiUrlRepo}`;
      }

      try {
        const targetUrl = `https://hub.docker.com/v2/repositories/${apiUrlRepo}/tags/?page_size=25`;
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 4500);
        const tagsRes = await fetch(targetUrl, {
          signal: ctrl.signal,
          headers: { "User-Agent": "HosteraX-DockerHubExplorer/1.0" },
        });
        clearTimeout(timeout);

        if (!tagsRes.ok) {
          return sendJson(200, {
            repo,
            total: 0,
            tags: [],
            error: `Docker Hub HTTP ${tagsRes.status}`,
          });
        }

        const data = await tagsRes.json();
        const rawTags = data.results || [];

        const formatSize = (bytes) => {
          if (!bytes || isNaN(bytes)) return "Unknown size";
          const mb = bytes / (1024 * 1024);
          if (mb >= 1024) return (mb / 1024).toFixed(2) + " GB";
          return mb.toFixed(1) + " MB";
        };

        const tags = rawTags.map((t) => {
          const architectures = [];
          if (t.images && Array.isArray(t.images)) {
            for (const img of t.images) {
              if (img.architecture && !architectures.includes(img.architecture)) {
                architectures.push(img.architecture);
              }
            }
          }

          const isSlim = t.name.includes("slim") || t.name.includes("alpine");
          const isHardened =
            t.name.includes("hardened") || t.name.includes("dhi") || repo.startsWith("dhi/");

          return {
            name: t.name,
            tag: `${repo}:${t.name}`,
            fullSize: t.full_size || 0,
            sizeFormatted: formatSize(t.full_size),
            lastUpdated: t.last_updated,
            lastUpdatedFormatted: t.last_updated
              ? new Date(t.last_updated).toLocaleDateString()
              : "",
            architectures: architectures.length > 0 ? architectures : ["amd64"],
            isSlim,
            isHardened,
            digest: t.digest || "",
          };
        });

        // Check if there is a known Hardened Image (DHI) alternative for this repo
        const baseName = repo
          .split("/")
          .pop()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        const HARDENED_EQUIVALENTS = {
          airflow: "dhi/airflow",
          redis: "dhi/redis",
          postgres: "dhi/postgres",
          postgresql: "dhi/postgres",
          nginx: "dhi/nginx",
          node: "dhi/node",
          python: "dhi/python",
          golang: "dhi/golang",
          vault: "dhi/vault",
          grafana: "dhi/grafana",
          prometheus: "dhi/prometheus",
          caddy: "dhi/caddy",
          traefik: "dhi/traefik",
          mariadb: "dhi/mariadb",
          mysql: "dhi/mysql",
        };

        const hardenedAlternative =
          HARDENED_EQUIVALENTS[baseName] || (repo.startsWith("dhi/") ? repo : null);

        return sendJson(200, {
          repo,
          total: data.count || tags.length,
          hardenedAlternative,
          hasHardenedProfile: !!hardenedAlternative,
          tags,
        });
      } catch (err) {
        return sendJson(200, { repo, total: 0, tags: [], error: err.message });
      }
    }

    // Popular and searchable GitHub Container Registry (ghcr.io) Packages
    const POPULAR_GHCR_PACKAGES = [
      {
        id: "immich_server",
        repo: "immich-app/immich-server",
        name: "Immich Server",
        category: "media",
        desc: "High performance self-hosted photo & video backup solution (Google Photos replacement).",
        stars: "50K+",
        official: true,
        defaultPort: 2283,
        icon: "🖼️",
      },
      {
        id: "home_assistant",
        repo: "home-assistant/home-assistant",
        name: "Home Assistant Core",
        category: "automation",
        desc: "Open-source home automation platform putting local control and privacy first.",
        stars: "70K+",
        official: true,
        defaultPort: 8123,
        icon: "🏠",
      },
      {
        id: "paperless_ngx",
        repo: "paperless-ngx/paperless-ngx",
        name: "Paperless-ngx",
        category: "productivity",
        desc: "Document management system that transforms physical documents into searchable digital archives.",
        stars: "24K+",
        official: true,
        defaultPort: 8000,
        icon: "📄",
      },
      {
        id: "authentik_server",
        repo: "goauthentik/server",
        name: "Authentik",
        category: "security",
        desc: "Open-source Identity Provider focused on flexibility, multi-factor auth, and enterprise SSO.",
        stars: "15K+",
        official: true,
        defaultPort: 9000,
        icon: "🔐",
      },
      {
        id: "sftpgo",
        repo: "drakkan/sftpgo",
        name: "SFTPGo",
        category: "storage",
        desc: "Fully featured and highly configurable SFTP, HTTP/S, FTP/S server with S3 and Azure backends.",
        stars: "9K+",
        official: true,
        defaultPort: 8080,
        icon: "📁",
      },
      {
        id: "open_webui",
        repo: "open-webui/open-webui",
        name: "Open WebUI",
        category: "ai",
        desc: "User-friendly AI interface for local LLMs, Ollama, and OpenAI-compatible inference.",
        stars: "45K+",
        official: true,
        defaultPort: 8080,
        icon: "🤖",
      },
      {
        id: "pocketbase",
        repo: "pocketbase/pocketbase",
        name: "PocketBase",
        category: "backend",
        desc: "Open source backend for SaaS and mobile apps in 1 single binary with embedded SQLite.",
        stars: "42K+",
        official: true,
        defaultPort: 8090,
        icon: "⚡",
      },
      {
        id: "jellyfin",
        repo: "linuxserver/jellyfin",
        name: "Jellyfin (LinuxServer)",
        category: "media",
        desc: "The Free Software Media System for streaming movies, music, and live TV.",
        stars: "33K+",
        official: false,
        defaultPort: 8096,
        icon: "🍿",
      },
      {
        id: "wireguard",
        repo: "linuxserver/wireguard",
        name: "WireGuard VPN",
        category: "security",
        desc: "Extremely simple yet fast and modern VPN that utilizes state-of-the-art cryptography.",
        stars: "18K+",
        official: false,
        defaultPort: 51820,
        icon: "🛡️",
      },
      {
        id: "searxng",
        repo: "searxng/searxng",
        name: "SearXNG",
        category: "search",
        desc: "Privacy-respecting, open-source metasearch engine combining 70+ search engines.",
        stars: "14K+",
        official: true,
        defaultPort: 8080,
        icon: "🔍",
      },
      {
        id: "authelia",
        repo: "authelia/authelia",
        name: "Authelia",
        category: "security",
        desc: "The Single Sign-On Multi-Factor portal for modern reverse proxies.",
        stars: "21K+",
        official: true,
        defaultPort: 9091,
        icon: "🔒",
      },
      {
        id: "glance",
        repo: "glanceapp/glance",
        name: "Glance",
        category: "dashboard",
        desc: "Self-hosted feed dashboard aggregating RSS, GitHub releases, weather, and calendars.",
        stars: "7K+",
        official: true,
        defaultPort: 8080,
        icon: "✨",
      },
      {
        id: "twenty",
        repo: "twentyhq/twenty",
        name: "Twenty CRM",
        category: "productivity",
        desc: "Building a modern, open source alternative to Salesforce. Powerful CRM for modern teams.",
        stars: "26K+",
        official: true,
        defaultPort: 3000,
        icon: "💼",
      },
      {
        id: "lobe_chat",
        repo: "lobehub/lobe-chat",
        name: "LobeChat",
        category: "ai",
        desc: "An open-source, modern-design LLMs/AI agent UI supporting Multi-modal, TTS and plugins.",
        stars: "53K+",
        official: true,
        defaultPort: 3210,
        icon: "🤖",
      },
      {
        id: "hoppscotch",
        repo: "hoppscotch/hoppscotch",
        name: "Hoppscotch",
        category: "developer",
        desc: "Open source API development ecosystem — lightweight, fast, and beautiful Postman alternative.",
        stars: "66K+",
        official: true,
        defaultPort: 3000,
        icon: "🚀",
      },
      {
        id: "calcom",
        repo: "calcom/cal.com",
        name: "Cal.com",
        category: "productivity",
        desc: "Scheduling infrastructure for everyone. Open-source Calendly alternative.",
        stars: "34K+",
        official: true,
        defaultPort: 3000,
        icon: "📅",
      },
      {
        id: "directus",
        repo: "directus/directus",
        name: "Directus",
        category: "backend",
        desc: "The Modern Data Stack in a single open source platform. Instant REST & GraphQL APIs.",
        stars: "29K+",
        official: true,
        defaultPort: 8055,
        icon: "🐰",
      },
      {
        id: "mattermost",
        repo: "mattermost/mattermost-team-edition",
        name: "Mattermost",
        category: "productivity",
        desc: "Open source platform for secure collaboration across the entire software development lifecycle.",
        stars: "31K+",
        official: true,
        defaultPort: 8065,
        icon: "💬",
      },
      {
        id: "kestra",
        repo: "kestra-io/kestra",
        name: "Kestra",
        category: "automation",
        desc: "Infinitely scalable orchestration and scheduling platform to build complex workflows as code.",
        stars: "16K+",
        official: true,
        defaultPort: 8080,
        icon: "⚡",
      },
    ];

    // Live GHCR & GitHub Repository Packages Search API (https://api.github.com/search/repositories)
    if (p === "/api/catalog/ghcr-search" && req.method === "GET") {
      const rawQ = url.searchParams.get("q")?.trim() || "";
      const q = rawQ === "__ALL__" ? "" : rawQ;
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const perPage = Math.min(
        100,
        Math.max(
          1,
          parseInt(
            url.searchParams.get("per_page") || url.searchParams.get("page_size") || "24",
            10,
          ),
        ),
      );

      // If empty query, return featured packages with proper pagination & logo candidates
      if (!q) {
        const offset = (page - 1) * perPage;
        const paged = POPULAR_GHCR_PACKAGES.slice(offset, offset + perPage);
        const results = paged.map((r) => {
          const owner = r.repo.split("/")[0];
          const cleanName = r.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          const logoCandidates = [
            `https://github.com/${owner}.png?size=128`,
            `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${cleanName}.png`,
            `https://cdn.simpleicons.org/${cleanName}`,
            `https://raw.githubusercontent.com/${r.repo}/main/logo.png`,
            `https://raw.githubusercontent.com/${r.repo}/master/logo.png`,
          ];

          return {
            ...r,
            image: `ghcr.io/${r.repo}:latest`,
            tag: `ghcr.io/${r.repo}:latest`,
            ghcrUrl: `https://github.com/${r.repo}`,
            hubUrl: `https://github.com/${r.repo}`,
            starCountFormatted: `${r.stars} stars`,
            logoUrl: logoCandidates[0],
            logoCandidates,
          };
        });

        return sendJson(200, {
          total: POPULAR_GHCR_PACKAGES.length,
          page,
          pageSize: perPage,
          totalPages: Math.ceil(POPULAR_GHCR_PACKAGES.length / perPage),
          query: "",
          results,
        });
      }

      // Query Live GitHub Search API
      try {
        const ghSearchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&page=${page}&per_page=${perPage}`;
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 4500);
        const ghRes = await fetch(ghSearchUrl, {
          signal: ctrl.signal,
          headers: {
            "User-Agent": "HosteraX-UniversalRegistry/1.0",
            Accept: "application/vnd.github.v3+json",
          },
        });
        clearTimeout(timeout);

        if (ghRes.ok) {
          const ghData = await ghRes.json();
          const formatCount = (num) => {
            if (!num || isNaN(num)) return "0";
            if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
            if (num >= 1000) return (num / 1000).toFixed(1) + "K";
            return String(num);
          };

          const results = (ghData.items || []).map((item) => {
            const owner = item.owner?.login || item.full_name.split("/")[0];
            const cleanName = item.name.toLowerCase().replace(/[^a-z0-9]/g, "");
            const logoCandidates = [
              item.owner?.avatar_url || `https://github.com/${owner}.png?size=128`,
              `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${cleanName}.png`,
              `https://cdn.simpleicons.org/${cleanName}`,
              `https://raw.githubusercontent.com/${item.full_name}/main/logo.png`,
              `https://raw.githubusercontent.com/${item.full_name}/master/logo.png`,
            ];

            return {
              id: item.full_name.replace(/[^a-zA-Z0-9_-]/g, "_"),
              repo: item.full_name,
              name: item.name,
              image: `ghcr.io/${item.full_name}:latest`,
              tag: `ghcr.io/${item.full_name}:latest`,
              desc: item.description || `GitHub repository ${item.full_name}`,
              stars: formatCount(item.stargazers_count),
              starCountFormatted: `${formatCount(item.stargazers_count)} stars`,
              official: item.stargazers_count > 5000,
              ghcrUrl: item.html_url,
              hubUrl: item.html_url,
              defaultPort: 8080,
              logoUrl: logoCandidates[0],
              logoCandidates,
              icon: "🐙",
            };
          });

          const total = ghData.total_count || results.length;

          return sendJson(200, {
            total,
            page,
            pageSize: perPage,
            totalPages: Math.ceil(total / perPage),
            query: q,
            results,
          });
        }
      } catch (err) {}

      // Fallback filter over curated list if GitHub API fails
      const fallbackResults = POPULAR_GHCR_PACKAGES.filter(
        (p) =>
          p.repo.toLowerCase().includes(q.toLowerCase()) ||
          p.name.toLowerCase().includes(q.toLowerCase()) ||
          p.desc.toLowerCase().includes(q.toLowerCase()),
      );

      return sendJson(200, {
        total: fallbackResults.length,
        query: q,
        results: fallbackResults.map((r) => ({
          ...r,
          image: `ghcr.io/${r.repo}:latest`,
          tag: `ghcr.io/${r.repo}:latest`,
          ghcrUrl: `https://github.com/${r.repo}`,
        })),
      });
    }

    // Live GHCR Repository Tags Explorer (https://ghcr.io/v2/.../tags/list)
    if (p === "/api/catalog/ghcr-tags" && req.method === "GET") {
      let repo = url.searchParams.get("repo")?.trim();
      if (!repo) {
        return sendJson(400, { error: "repo parameter is required" });
      }

      // Strip optional ghcr.io/ prefix
      repo = repo.replace(/^ghcr\.io\//i, "");

      try {
        // Step 1: Obtain anonymous OCI pull token from ghcr.io
        const tokenUrl = `https://ghcr.io/token?service=ghcr.io&scope=repository:${repo}:pull`;
        const ctrlTok = new AbortController();
        const t1 = setTimeout(() => ctrlTok.abort(), 4000);
        const tokRes = await fetch(tokenUrl, {
          signal: ctrlTok.signal,
          headers: { "User-Agent": "HosteraX-GHCRExplorer/1.0" },
        });
        clearTimeout(t1);

        let token = "";
        if (tokRes.ok) {
          const tokData = await tokRes.json();
          token = tokData.token || "";
        }

        // Step 2: Query OCI tags list
        const tagsUrl = `https://ghcr.io/v2/${repo}/tags/list`;
        const ctrlTags = new AbortController();
        const t2 = setTimeout(() => ctrlTags.abort(), 4500);
        const headers = { "User-Agent": "HosteraX-GHCRExplorer/1.0" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const tagsRes = await fetch(tagsUrl, { signal: ctrlTags.signal, headers });
        clearTimeout(t2);

        if (!tagsRes.ok) {
          // Fallback to default tag set if rate limited or private
          return sendJson(200, {
            repo: `ghcr.io/${repo}`,
            total: 1,
            tags: [
              {
                name: "latest",
                tag: `ghcr.io/${repo}:latest`,
                fullSize: 0,
                sizeFormatted: "OCI Container",
                lastUpdated: new Date().toISOString(),
                lastUpdatedFormatted: "Current",
                architectures: ["amd64", "arm64"],
                isSlim: false,
                isHardened: false,
                digest: "",
              },
            ],
          });
        }

        const data = await tagsRes.json();
        const rawTags = (data.tags || []).reverse(); // newest first

        const tags = rawTags.slice(0, 30).map((tagName) => ({
          name: tagName,
          tag: `ghcr.io/${repo}:${tagName}`,
          fullSize: 0,
          sizeFormatted: "OCI Multi-Arch",
          lastUpdated: new Date().toISOString(),
          lastUpdatedFormatted: "Published",
          architectures: ["amd64", "arm64"],
          isSlim: tagName.includes("slim") || tagName.includes("alpine"),
          isHardened:
            tagName.includes("hardened") || tagName.includes("dhi") || tagName.includes("rootless"),
          digest: "",
        }));

        return sendJson(200, {
          repo: `ghcr.io/${repo}`,
          total: data.tags?.length || tags.length,
          tags,
        });
      } catch (err) {
        return sendJson(200, {
          repo: `ghcr.io/${repo}`,
          total: 1,
          tags: [
            {
              name: "latest",
              tag: `ghcr.io/${repo}:latest`,
              fullSize: 0,
              sizeFormatted: "OCI Container",
              lastUpdated: new Date().toISOString(),
              lastUpdatedFormatted: "Current",
              architectures: ["amd64", "arm64"],
              isSlim: false,
              isHardened: false,
              digest: "",
            },
          ],
        });
      }
    }

    // Inspect Docker Image
    if (p === "/api/catalog/inspect" && req.method === "POST") {
      let body = {};
      try {
        body = await readBody(req);
      } catch {}

      const rawImage = body.image?.trim();
      if (!rawImage) {
        return sendJson(400, { error: "image is required" });
      }

      const WELL_KNOWN_MAP = {
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

      const cleanKey = rawImage.toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const baseKey = rawImage
        .split(":")[0]
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "");
      let imageTag = WELL_KNOWN_MAP[cleanKey] || WELL_KNOWN_MAP[baseKey] || rawImage;
      if (!imageTag.includes(":")) imageTag = `${imageTag}:latest`;

      try {
        // Run docker image inspect locally first
        let insp = spawnSync("docker", ["image", "inspect", imageTag], {
          encoding: "utf8",
          timeout: 4000,
        });

        // If not found locally, attempt manifest inspection with timeout
        if (insp.status !== 0) {
          insp = spawnSync("docker", ["manifest", "inspect", imageTag], {
            encoding: "utf8",
            timeout: 4000,
          });
        }

        let exposedPorts = [];
        let volumes = [];
        let env = [];

        if (insp.stdout) {
          try {
            const raw = JSON.parse(insp.stdout.trim());
            const data = Array.isArray(raw) ? raw[0] : raw;
            const cfg = data?.Config || data || {};
            if (cfg.ExposedPorts) {
              for (const pr of Object.keys(cfg.ExposedPorts)) {
                const m = pr.match(/^(\d+)/);
                if (m) exposedPorts.push(parseInt(m[1], 10));
              }
            }
            if (cfg.Volumes) {
              for (const v of Object.keys(cfg.Volumes)) {
                volumes.push(v);
              }
            }
            if (cfg.Env) env = cfg.Env;
          } catch {}
        }

        const WELL_KNOWN_PORTS = {
          ollama: 11434,
          "ollama/ollama": 11434,
          vaultwarden: 80,
          nginx: 80,
          caddy: 80,
          redis: 6379,
          postgres: 5432,
          postgresql: 5432,
          mariadb: 3306,
          mysql: 3306,
          grafana: 3000,
          prometheus: 9090,
          uptimekuma: 3001,
          "uptime-kuma": 3001,
          n8n: 5678,
          portainer: 9000,
          dockge: 5001,
          searxng: 8080,
          audiobookshelf: 13378,
          "it-tools": 80,
        };

        const defaultPort = WELL_KNOWN_PORTS[cleanKey] || WELL_KNOWN_PORTS[baseKey] || 3000;

        // Priority web ports: 80, 8080, 3000, 5000, 8000, 5678, 8090, 8055, 8096, 2368, 2283, 9000, 8108, 6333, 11434
        const priority = [
          80, 8080, 3000, 5000, 8000, 5678, 8090, 8055, 8096, 2368, 2283, 9000, 8108, 6333, 11434,
        ];
        let detectedPort = defaultPort;
        for (const p of priority) {
          if (exposedPorts.includes(p)) {
            detectedPort = p;
            break;
          }
        }
        if (detectedPort === 3000 && exposedPorts.length > 0) {
          detectedPort = exposedPorts[0];
        }

        return sendJson(200, {
          image: imageTag,
          exposedPorts: exposedPorts.length > 0 ? exposedPorts : [defaultPort],
          volumes,
          env,
          detectedPort,
        });
      } catch (err) {
        return sendJson(200, {
          image: imageTag,
          exposedPorts: [3000],
          volumes: [],
          detectedPort: 3000,
        });
      }
    }

    // Multi-category Docker Hub search — aggregates all categories, deduplicates, returns paginated
    if (p === "/api/catalog/dockerhub-all" && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const pageSize = Math.min(
        100,
        Math.max(1, parseInt(url.searchParams.get("page_size") || "24", 10)),
      );
      const sort = url.searchParams.get("sort") || "stars";

      const QUERIES = [
        // Docker Hub Official Categories (16)
        "traefik",
        "envoy",
        "haproxy",
        "nginx",
        "dns",
        "api-management",
        "kong",
        "apigee",
        "vault",
        "auth",
        "oauth",
        "sso",
        "keycloak",
        "crowdsec",
        "fail2ban",
        "clamav",
        "node",
        "python",
        "golang",
        "java",
        "php",
        "ruby",
        "rust",
        "dotnet",
        "swift",
        "kotlin",
        "typescript",
        "elixir",
        "haskell",
        "dart",
        "zig",
        "jenkins",
        "gitlab",
        "gitea",
        "drone",
        "argo",
        "tekton",
        "flux",
        "tekton",
        "github-actions",
        "rabbitmq",
        "kafka",
        "nats",
        "mosquitto",
        "emqx",
        "zeromq",
        "pulsar",
        "mqtt",
        "iot",
        "home-assistant",
        "openhab",
        "domoticz",
        "node-red",
        "tasmota",
        "ollama",
        "llama",
        "open-webui",
        "stable-diffusion",
        "whisper",
        "tensorflow",
        "pytorch",
        "jupyter",
        "mlflow",
        "kubeflow",
        "ray",
        "vllm",
        "vscode",
        "git",
        "docker",
        "kubectl",
        "helm",
        "terraform",
        "ansible",
        "pulumi",
        "vagrant",
        "jupyter",
        "pandas",
        "spark",
        "airflow",
        "dbt",
        "superset",
        "metabase",
        "grafana",
        "prometheus",
        "nginx",
        "apache",
        "caddy",
        "lighttpd",
        "tomcat",
        "openresty",
        "alpine",
        "ubuntu",
        "debian",
        "centos",
        "fedora",
        "archlinux",
        "void",
        "wordpress",
        "drupal",
        "joomla",
        "ghost",
        "strapi",
        "directus",
        "cockpit",
        "keystonejs",
        "postgres",
        "mysql",
        "mongo",
        "mariadb",
        "redis",
        "elasticsearch",
        "cassandra",
        "couchdb",
        "influxdb",
        "clickhouse",
        "timescaledb",
        "meilisearch",
        "typesense",
        "minio",
        "neo4j",
        "dgraph",
        "arangodb",
        "vitess",
        "grafana",
        "prometheus",
        "zabbix",
        "netdata",
        "datadog",
        "nagios",
        "icinga",
        "checkmk",
        "uptime-kuma",
        "statping",
        "gatus",
        "matomo",
        "plausible",
        "umami",
        "goaccess",
        "shlink",
        // Popular self-hosted images
        "nextcloud",
        "owncloud",
        "seafile",
        "gitea",
        "forgejo",
        "plex",
        "jellyfin",
        "emby",
        "navidrome",
        "sonarr",
        "radarr",
        "lidarr",
        "prowlarr",
        "overseerr",
        "portainer",
        "dockge",
        "watchtower",
        "linuxserver",
        "vaultwarden",
        "bitwarden",
        "paperless",
        "immich",
        "photoprism",
        "n8n",
        "duplicati",
        "pi-hole",
        "adguard",
        "blocky",
        "mattermost",
        "rocketchat",
        "zulip",
        "element",
        "drawio",
        "excalidraw",
        "stirling-pdf",
        "mealie",
        "linkding",
        "calcom",
        "focalboard",
        "planka",
        "vikunja",
        "mailhog",
        "mailu",
        "docker-mailserver",
        "code-server",
        "openvscode",
        "comfyui",
        "automatic1111",
        "localai",
        "kobold",
        "duplicati",
        "restic",
        "borg",
        "kopia",
        "zammad",
        "osticket",
        "sabnzbd",
        "nzbget",
        "qbittorrent",
        "transmission",
        "deluge",
        "jackett",
      ];

      const seen = new Set();
      const allResults = [];

      const fetchOne = async (q) => {
        try {
          const targetUrl = `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(q)}&page=1&page_size=100`;
          const ctrl = new AbortController();
          const timeout = setTimeout(() => ctrl.abort(), 3500);
          const res = await fetch(targetUrl, {
            signal: ctrl.signal,
            headers: { "User-Agent": "HosteraX-DockerHubExplorer/1.0" },
          });
          clearTimeout(timeout);
          if (!res.ok) return [];
          const data = await res.json();
          return data.results || [];
        } catch {
          return [];
        }
      };

      // Fetch in parallel batches of 20
      const batchSize = 20;
      for (let i = 0; i < Math.min(QUERIES.length, 120); i += batchSize) {
        const batch = QUERIES.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(fetchOne));
        for (const results of batchResults) {
          for (const r of results) {
            const cleanRepo = r.repo_name.startsWith("library/")
              ? r.repo_name.slice("library/".length)
              : r.repo_name;
            if (seen.has(cleanRepo)) continue;
            seen.add(cleanRepo);
            const isOfficial =
              !!r.is_official || r.repo_name.startsWith("library/") || !r.repo_name.includes("/");
            const logoCandidates = getLogoCandidates(cleanRepo);
            allResults.push({
              id: cleanRepo.replace(/[^a-zA-Z0-9_-]/g, "_"),
              name: cleanRepo,
              repoName: cleanRepo,
              image: cleanRepo.includes(":") ? cleanRepo : `${cleanRepo}:latest`,
              tag: cleanRepo.includes(":") ? cleanRepo : `${cleanRepo}:latest`,
              desc: r.short_description || "Public Docker container image.",
              stars: r.star_count || 0,
              starCountFormatted: formatCount(r.star_count || 0),
              pulls: r.pull_count || 0,
              pullCountFormatted: formatCount(r.pull_count || 0),
              isOfficial,
              isAutomated: !!r.is_automated,
              hubUrl: `https://hub.docker.com/r/${cleanRepo.includes("/") ? cleanRepo : `_/${cleanRepo}`}`,
              logoUrl: logoCandidates[0],
              logoCandidates,
              icon: isOfficial ? "🛡️" : "🐳",
            });
          }
        }
      }

      // Sort
      if (sort === "pulls") {
        allResults.sort((a, b) => (b.pulls || 0) - (a.pulls || 0));
      } else if (sort === "name") {
        allResults.sort((a, b) => a.name.localeCompare(b.name));
      } else {
        allResults.sort((a, b) => (b.stars || 0) - (a.stars || 0));
      }

      const total = allResults.length;
      const start = (page - 1) * pageSize;
      const paged = allResults.slice(start, start + pageSize);

      return sendJson(200, {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        results: paged,
        categoriesLoaded: Math.min(QUERIES.length, 120),
      });
    }

    return false;
  };
}
