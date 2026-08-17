// hosterax/engine/src/image-resolver.mjs
// Universal Autonomous Docker Image Resolver & Self-Healing Pull Engine for all 2,502+ apps

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Preloaded Awesome-Selfhosted / selfh.st Catalog
let catalogApps = [];
try {
  const dbPath = path.join(__dirname, "awesome-selfhosted-db.json");
  if (fs.existsSync(dbPath)) {
    const raw = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    catalogApps = raw.apps || [];
  }
} catch (err) {
  console.warn("image-resolver: Failed to load catalog:", err.message);
}

// Universal Well-Known Image Knowledge Base for top self-hosted applications
export const UNIVERSAL_IMAGE_MAP = {
  // Apache Ecosystem
  airflow: "apache/airflow:latest",
  apacheairflow: "apache/airflow:latest",
  "apache-airflow": "apache/airflow:latest",
  superset: "apache/superset:latest",
  apachesuperset: "apache/superset:latest",
  "apache-superset": "apache/superset:latest",
  kafka: "apache/kafka:latest",
  apachekafka: "apache/kafka:latest",
  "apache-kafka": "apache/kafka:latest",
  solr: "solr:latest",
  apachesolr: "solr:latest",
  "apache-solr": "solr:latest",
  spark: "apache/spark:latest",
  apachespark: "apache/spark:latest",
  "apache-spark": "apache/spark:latest",
  drill: "apache/drill:latest",
  apachedrill: "apache/drill:latest",
  "apache-drill": "apache/drill:latest",
  druid: "apache/druid:latest",
  apachedruid: "apache/druid:latest",
  "apache-druid": "apache/druid:latest",
  flink: "flink:latest",
  apacheflink: "flink:latest",
  "apache-flink": "flink:latest",

  // AI, LLMs & Automation
  ollama: "ollama/ollama:latest",
  "ollama/ollama": "ollama/ollama:latest",
  openwebui: "ghcr.io/open-webui/open-webui:main",
  "open-webui": "ghcr.io/open-webui/open-webui:main",
  n8n: "docker.n8n.io/n8nio/n8n:latest",
  "n8n-io": "docker.n8n.io/n8nio/n8n:latest",
  flowise: "flowiseai/flowise:latest",
  dify: "langgenius/dify-api:latest",
  activepieces: "activepieces/activepieces:latest",
  localai: "localai/localai:latest",
  textgenerationwebui: "oobabooga/text-generation-webui:latest",
  "text-generation-webui": "oobabooga/text-generation-webui:latest",

  // Security, Identity & Password Management
  vaultwarden: "vaultwarden/server:latest",
  bitwarden: "vaultwarden/server:latest",
  "vaultwarden/server": "vaultwarden/server:latest",
  authentik: "ghcr.io/goauthentik/server:latest",
  keycloak: "quay.io/keycloak/keycloak:latest",
  authelia: "authelia/authelia:latest",
  pocketid: "pocketid/pocketid:latest",
  passbolt: "passbolt/passbolt:latest",

  // Monitoring, Dashboards & Infra
  uptimekuma: "louislam/uptime-kuma:latest",
  "uptime-kuma": "louislam/uptime-kuma:latest",
  dockge: "louislam/dockge:latest",
  portainer: "portainer/portainer-ce:latest",
  "portainer-ce": "portainer/portainer-ce:latest",
  grafana: "grafana/grafana:latest",
  prometheus: "prom/prometheus:latest",
  victoriametrics: "victoriametrics/victoria-metrics:latest",
  "victoria-metrics": "victoriametrics/victoria-metrics:latest",
  beszel: "henrygd/beszel:latest",
  glances: "nicolargo/glances:latest",
  dozzle: "amir20/dozzle:latest",
  netdata: "netdata/netdata:latest",
  zabbix: "zabbix/zabbix-server-mysql:latest",

  // Networking, VPN & DNS
  wireguard: "linuxserver/wireguard:latest",
  wgdashboard: "donaldzou/wg-dashboard:latest",
  "wg-dashboard": "donaldzou/wg-dashboard:latest",
  pihole: "pihole/pihole:latest",
  "pi-hole": "pihole/pihole:latest",
  adguardhome: "adguard/adguardhome:latest",
  "adguard-home": "adguard/adguardhome:latest",
  blocky: "ghcr.io/0xerr0r/blocky:latest",
  headscale: "headscale/headscale:latest",
  traefik: "traefik:v3.1",
  caddy: "caddy:latest",
  nginx: "nginx:alpine",
  "nginx-proxy-manager": "jc21/nginx-proxy-manager:latest",
  npm: "jc21/nginx-proxy-manager:latest",

  // Databases, Search & Vector Engines
  redis: "redis:alpine",
  valkey: "valkey/valkey:latest",
  dragonfly: "docker.dragonflydb.io/dragonflydb/dragonfly:latest",
  postgres: "postgres:alpine",
  postgresql: "postgres:alpine",
  mariadb: "mariadb:latest",
  mysql: "mysql:8.4",
  mongodb: "mongo:latest",
  mongo: "mongo:latest",
  couchdb: "couchdb:latest",
  surrealdb: "surrealdb/surrealdb:latest",
  elasticsearch: "docker.elastic.co/elasticsearch/elasticsearch:8.15.0",
  "elasticsearch:latest": "docker.elastic.co/elasticsearch/elasticsearch:8.15.0",
  "elasticsearch:8": "docker.elastic.co/elasticsearch/elasticsearch:8.15.0",
  "elasticsearch:7": "docker.elastic.co/elasticsearch/elasticsearch:7.17.23",
  opensearch: "opensearchproject/opensearch:latest",
  "opensearchproject/opensearch": "opensearchproject/opensearch:latest",
  kibana: "docker.elastic.co/kibana/kibana:8.15.0",
  "kibana:latest": "docker.elastic.co/kibana/kibana:8.15.0",
  logstash: "docker.elastic.co/logstash/logstash:8.15.0",
  "logstash:latest": "docker.elastic.co/logstash/logstash:8.15.0",
  typesense: "typesense/typesense:latest",
  meilisearch: "getmeili/meilisearch:latest",
  qdrant: "qdrant/qdrant:latest",
  chromadb: "chromadb/chroma:latest",
  weaviate: "semitechnologies/weaviate:latest",
  milvus: "milvusdb/milvus:latest",
  clickhouse: "clickhouse/clickhouse-server:latest",

  // Media, Photos & Storage
  immich: "ghcr.io/immich-app/immich-server:latest",
  "immich-server": "ghcr.io/immich-app/immich-server:latest",
  photoprism: "photoprism/photoprism:latest",
  librephotos: "reallibrephotos/librephotos:latest",
  jellyfin: "jellyfin/jellyfin:latest",
  plex: "linuxserver/plex:latest",
  emby: "emby/embyserver:latest",
  audiobookshelf: "ghcr.io/advplyr/audiobookshelf:latest",
  navidrome: "deluan/navidrome:latest",
  calibreweb: "linuxserver/calibre-web:latest",
  "calibre-web": "linuxserver/calibre-web:latest",
  kavita: "jvmilazz0/kavita:latest",
  minio: "minio/minio:latest",
  "minio-storage": "minio/minio:latest",
  seafile: "seafileltd/seafile-mc:latest",
  nextcloud: "nextcloud:latest",
  owncloud: "owncloud/server:latest",

  // Productivity, Git, Docs & CMS
  ghost: "ghost:alpine",
  wordpress: "wordpress:latest",
  strapi: "strapi/strapi:latest",
  directus: "directus/directus:latest",
  pocketbase: "ghcr.io/muchobien/pocketbase:latest",
  appwrite: "appwrite/appwrite:latest",
  supabase: "supabase/postgres:latest",
  gitea: "gitea/gitea:latest",
  forgejo: "codeberg.org/forgejo/forgejo:latest",
  gitlab: "gitlab/gitlab-ce:latest",
  paperless: "ghcr.io/paperless-ngx/paperless-ngx:latest",
  "paperless-ngx": "ghcr.io/paperless-ngx/paperless-ngx:latest",
  stirlingpdf: "frooodle/s-pdf:latest",
  "stirling-pdf": "frooodle/s-pdf:latest",
  ittools: "corentinth/it-tools:latest",
  "it-tools": "corentinth/it-tools:latest",
  excalidraw: "excalidraw/excalidraw:latest",
  hedgedoc: "quay.io/hedgedoc/hedgedoc:latest",
  etherpad: "etherpad/etherpad:latest",
  wikijs: "ghcr.io/requarks/wiki:latest",
  bookstack: "linuxserver/bookstack:latest",
  trilium: "zadam/trilium:latest",
  memos: "neosmemo/memos:latest",
  affine: "ghcr.io/toeverything/affine-graphql:latest",
  plausible: "plausible/analytics:latest",
  umami: "ghcr.io/umami-software/umami:postgresql-latest",
  matomo: "matomo:latest",
  shlink: "shlinkio/shlink:latest",
  yourls: "yourls:latest",
  searxng: "searxng/searxng:latest",
  homeassistant: "homeassistant/home-assistant:latest",
  "home-assistant": "homeassistant/home-assistant:latest",
};

/**
 * Searches the Docker Hub API for verified public repositories matching the query.
 */
async function searchDockerHub(query) {
  try {
    const qClean = query.replace(/[^a-zA-Z0-9_\-\s]/g, "").trim();
    if (!qClean) return null;
    const url = `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(qClean)}&page_size=6`;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "HosteraX-UniversalResolver/1.0" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.results || [];
    if (results.length === 0) return null;

    // Prioritize official repositories, then highest star count
    const sorted = results.sort((a, b) => {
      if (a.is_official && !b.is_official) return -1;
      if (!a.is_official && b.is_official) return 1;
      return (b.star_count || 0) - (a.star_count || 0);
    });

    return sorted.map((r) => r.repo_name);
  } catch (err) {
    return null;
  }
}

/**
 * Generates an ordered, comprehensive list of candidate Docker image tags for any given target/project name.
 */
export function generateCandidateImageTags(rawTarget, projectName = "") {
  const candidates = new Set();
  const raw = (rawTarget || projectName || "").trim();
  if (!raw) return [];

  // Normalize duplicate colons e.g. apacheairflow:apacheairflow -> apacheairflow
  let cleaned = raw;
  const parts = raw.split(":");
  if (parts.length === 2 && parts[0] === parts[1]) {
    cleaned = parts[0];
  }

  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const normKey = norm(cleaned);
  const baseName = cleaned.split(":")[0];
  const baseNorm = norm(baseName);
  const projNorm = norm(projectName);

  // 1. Direct Universal Map Lookup
  if (UNIVERSAL_IMAGE_MAP[cleaned.toLowerCase()]) {
    candidates.add(UNIVERSAL_IMAGE_MAP[cleaned.toLowerCase()]);
  }
  if (UNIVERSAL_IMAGE_MAP[normKey]) {
    candidates.add(UNIVERSAL_IMAGE_MAP[normKey]);
  }
  if (UNIVERSAL_IMAGE_MAP[baseNorm]) {
    candidates.add(UNIVERSAL_IMAGE_MAP[baseNorm]);
  }
  if (UNIVERSAL_IMAGE_MAP[projNorm]) {
    candidates.add(UNIVERSAL_IMAGE_MAP[projNorm]);
  }

  // 2. Catalog lookup in 2,502 applications
  if (catalogApps.length > 0) {
    for (const app of catalogApps) {
      if (
        (app.image && norm(app.slug) === normKey) ||
        norm(app.name) === normKey ||
        norm(app.slug) === projNorm ||
        norm(app.name) === projNorm
      ) {
        if (app.image) candidates.add(app.image);
        break;
      }
    }
  }

  // 3. Exact provided tag if specified
  if (cleaned.includes("/") && cleaned.includes(":")) {
    candidates.add(cleaned);
  }

  // 4. Intelligent Compound Splitting (e.g. apache-airflow -> apache/airflow:latest)
  if (baseName.includes("-") || baseName.includes("_")) {
    const splitParts = baseName.split(/[-_]/);
    if (splitParts.length >= 2) {
      const org = splitParts[0];
      const repo = splitParts.slice(1).join("-");
      candidates.add(`${org}/${repo}:latest`);
      candidates.add(`${org}/${repo}:alpine`);
    }
  }

  // 5. Prefix-based compound heuristics
  const KNOWN_PREFIXES = [
    "apache",
    "linuxserver",
    "bitnami",
    "cloudpirates",
    "prom",
    "victoriametrics",
  ];
  for (const pfx of KNOWN_PREFIXES) {
    if (baseNorm.startsWith(pfx) && baseNorm.length > pfx.length) {
      const remainder = baseNorm.slice(pfx.length);
      candidates.add(`${pfx}/${remainder}:latest`);
      candidates.add(`${pfx}/${remainder}:alpine`);
    }
  }

  // 6. Common Namespaces
  candidates.add(`${baseName}/${baseName}:latest`);
  candidates.add(`linuxserver/${baseName}:latest`);
  candidates.add(`bitnami/${baseName}:latest`);
  candidates.add(`library/${baseName}:latest`);
  candidates.add(`${baseName}:latest`);
  candidates.add(`${baseName}:alpine`);

  // Filter and deduplicate
  return Array.from(candidates).filter(Boolean);
}

/**
 * Universal Pull Engine: Pulls image with progressive fallback, live Docker Hub discovery, and platform emulation.
 */
export async function pullWithUniversalHealing({
  deploymentId,
  workdir,
  initialTag,
  projectName,
  publish,
  runStep,
}) {
  const initialCandidates = generateCandidateImageTags(initialTag, projectName);
  const attempted = new Set();

  publish(deploymentId, {
    ts: Date.now(),
    stream: "system",
    text: `[docker] Initializing Universal Image Resolver for "${initialTag || projectName}"...`,
  });

  // Phase 1: Try static & heuristic candidates
  for (const candidate of initialCandidates) {
    if (attempted.has(candidate)) continue;
    attempted.add(candidate);

    publish(deploymentId, {
      ts: Date.now(),
      stream: "system",
      text: `[docker] Pulling verified candidate: ${candidate}...`,
    });

    let rc = await runStep(deploymentId, workdir, `docker pull ${candidate}`, {});
    if (rc === 0) {
      publish(deploymentId, {
        ts: Date.now(),
        stream: "system",
        text: `[docker] Successfully pulled and verified: ${candidate}`,
      });
      return { ok: true, tag: candidate };
    }
  }

  // Phase 2: Live Docker Hub Registry Search Discovery
  publish(deploymentId, {
    ts: Date.now(),
    stream: "system",
    text: `[docker] Direct candidates exhausted. Querying Docker Hub Registry API for "${initialTag || projectName}"...`,
  });

  const searchTerms = [
    (initialTag || projectName).replace(/[:_-]/g, " "),
    (initialTag || projectName).replace(/apache|linuxserver|bitnami/gi, "").trim(),
  ];

  for (const term of searchTerms) {
    if (!term) continue;
    const hubRepos = await searchDockerHub(term);
    if (hubRepos && hubRepos.length > 0) {
      for (const repo of hubRepos) {
        const hubTag = `${repo}:latest`;
        if (attempted.has(hubTag)) continue;
        attempted.add(hubTag);

        publish(deploymentId, {
          ts: Date.now(),
          stream: "system",
          text: `[docker] Discovered on Docker Hub: ${hubTag}. Attempting pull...`,
        });

        const hubRc = await runStep(deploymentId, workdir, `docker pull ${hubTag}`, {});
        if (hubRc === 0) {
          publish(deploymentId, {
            ts: Date.now(),
            stream: "system",
            text: `[docker] Successfully pulled discovered registry image: ${hubTag}`,
          });
          return { ok: true, tag: hubTag };
        }
      }
    }
  }

  // Phase 3: Platform Architecture Emulation (--platform linux/amd64)
  for (const candidate of initialCandidates.slice(0, 3)) {
    publish(deploymentId, {
      ts: Date.now(),
      stream: "system",
      text: `[docker] Retrying with cross-architecture emulation: --platform linux/amd64 ${candidate}...`,
    });
    const platRc = await runStep(
      deploymentId,
      workdir,
      `docker pull --platform linux/amd64 ${candidate}`,
      {},
    );
    if (platRc === 0) {
      publish(deploymentId, {
        ts: Date.now(),
        stream: "system",
        text: `[docker] Successfully pulled under linux/amd64 emulation: ${candidate}`,
      });
      return { ok: true, tag: candidate };
    }
  }

  publish(deploymentId, {
    ts: Date.now(),
    stream: "stderr",
    text: `[docker] ERROR: Failed to pull image across all ${attempted.size} candidate registries, permutations, and search queries.`,
  });

  return { ok: false, error: "Image pull failed across all candidate registries" };
}
