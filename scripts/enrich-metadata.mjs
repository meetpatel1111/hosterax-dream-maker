#!/usr/bin/env node
// scripts/enrich-metadata.mjs
// Unified Metadata, GitHub Metrics, SVG Logos, & Docker Image Enricher for HosteraX

import fs from "node:fs";

const WELL_KNOWN_IMAGES = {
  nginx: "nginx:alpine",
  caddy: "caddy:latest",
  redis: "redis:alpine",
  postgres: "postgres:alpine",
  postgresql: "postgres:alpine",
  mariadb: "mariadb:latest",
  mysql: "mysql:8.4",
  sqlite: "keinos/sqlite3:latest",
  vaultwarden: "vaultwarden/server:latest",
  bitwarden: "vaultwarden/server:latest",
  nextcloud: "nextcloud:apache",
  owncloud: "owncloud/server:latest",
  gitea: "gitea/gitea:latest",
  forgejo: "codeberg.org/forgejo/forgejo:latest",
  gitlab: "gitlab/gitlab-ce:latest",
  grafana: "grafana/grafana:latest",
  prometheus: "prom/prometheus:latest",
  uptimekuma: "louislam/uptime-kuma:latest",
  "uptime-kuma": "louislam/uptime-kuma:latest",
  n8n: "docker.n8n.io/n8nio/n8n:latest",
  portainer: "portainer/portainer-ce:latest",
  dockge: "louislam/dockge:latest",
  traefik: "traefik:v3.1",
  jellyfin: "jellyfin/jellyfin:latest",
  plex: "plexinc/pms-docker:latest",
  emby: "emby/embyserver:latest",
  immich: "ghcr.io/immich-app/immich-server:latest",
  photoprism: "photoprism/photoprism:latest",
  paperless: "ghcr.io/paperless-ngx/paperless-ngx:latest",
  "paperless-ngx": "ghcr.io/paperless-ngx/paperless-ngx:latest",
  plausible: "plausible/analytics:latest",
  umami: "ghcr.io/umami-software/umami:postgresql-latest",
  matomo: "matomo:latest",
  ghost: "ghost:5-alpine",
  wordpress: "wordpress:php8.3-apache",
  meilisearch: "getmeili/meilisearch:latest",
  typesense: "typesense/typesense:27.1",
  qdrant: "qdrant/qdrant:latest",
  chroma: "chromadb/chroma:latest",
  minio: "minio/minio:latest",
  openwebui: "ghcr.io/open-webui/open-webui:main",
  "open-webui": "ghcr.io/open-webui/open-webui:main",
  ollama: "ollama/ollama:latest",
  searxng: "searxng/searxng:latest",
  calibre: "linuxserver/calibre-web:latest",
  "calibre-web": "linuxserver/calibre-web:latest",
  audiobookshelf: "ghcr.io/advplyr/audiobookshelf:latest",
  navidrome: "deluan/navidrome:latest",
  syncthing: "syncthing/syncthing:latest",
  filebrowser: "filebrowser/filebrowser:latest",
  netdata: "netdata/netdata:latest",
  zabbix: "zabbix/zabbix-appliance:latest",
  glances: "nicolargo/glances:latest",
  vikunja: "vikunja/api:latest",
  focalboard: "mattermost/focalboard:latest",
  plane: "makeplane/plane:latest",
  trilium: "zadam/trilium:latest",
  appwrite: "appwrite/appwrite:latest",
  pocketbase: "pocketbase/pocketbase:latest",
  directus: "directus/directus:latest",
  strapi: "strapi/strapi:latest",
  nocodb: "nocodb/nocodb:latest",
  activepieces: "activepieces/activepieces:latest",
  nodered: "nodered/node-red:latest",
  "node-red": "nodered/node-red:latest",
  gotify: "gotify/server:latest",
  ntfy: "binwiederhier/ntfy:latest",
  mattermost: "mattermost/mattermost-team-edition:latest",
  discourse: "discourse/discourse:latest",
  roundcube: "roundcube/roundcubemail:latest",
  stalwart: "stalwartlabs/mail-server:latest",
};

function extractGitHubRepo(url, desc, website) {
  const allText = `${url || ""} ${desc || ""} ${website || ""}`;
  const m = allText.match(/github\.com\/([^/)\s#"']+)\/([^/)\s#"']+)/i);
  if (m) {
    const owner = m[1].replace(/[^a-zA-Z0-9_.-]/g, "");
    const repo = m[2].replace(/\.git$/, "").replace(/[^a-zA-Z0-9_.-]/g, "");
    if (
      owner &&
      repo &&
      ![
        "topics",
        "sponsors",
        "marketplace",
        "features",
        "trending",
        "collections",
        "awesome-selfhosted",
        "awesome-foss",
      ].includes(owner.toLowerCase())
    ) {
      return `${owner}/${repo}`;
    }
  }
  return null;
}

export async function fetchLiveRepoStars(repo) {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        "User-Agent": "HosteraX-Star-Enricher/1.0",
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (res.status === 200) {
      const data = await res.json();
      return { stars: String(data.stargazers_count), forks: String(data.forks_count) };
    }
    // Fallback to Shields.io on rate limit
    if (res.status === 403 || res.status === 429) {
      const sRes = await fetch(`https://img.shields.io/github/stars/${repo}.json`);
      if (sRes.status === 200) {
        const sData = await sRes.json();
        const raw = sData.value || sData.message || "";
        let num = 0;
        if (raw.endsWith("k")) num = Math.round(parseFloat(raw) * 1000);
        else if (raw.endsWith("M")) num = Math.round(parseFloat(raw) * 1000000);
        else num = parseInt(raw, 10);
        if (!isNaN(num) && num > 0) return { stars: String(num) };
      }
    }
  } catch {}
  return null;
}

export async function enrichMetadata(db, options = {}) {
  console.log("⚡ [HosteraX Enricher] Starting Live Metadata, Logos & Docker Image Resolution...");

  let logoEnriched = 0;
  let dockerFixed = 0;
  let starsEnriched = 0;

  for (const app of db.apps) {
    const slugKey = (app.slug || app.id || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const nameKey = (app.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const ghRepo = extractGitHubRepo(app.url, app.desc, app.website);

    // 1. Resolve & Fix Docker Images
    if (WELL_KNOWN_IMAGES[slugKey]) {
      app.image = WELL_KNOWN_IMAGES[slugKey];
      dockerFixed++;
    } else if (WELL_KNOWN_IMAGES[nameKey]) {
      app.image = WELL_KNOWN_IMAGES[nameKey];
      dockerFixed++;
    } else if (ghRepo) {
      app.image = `${ghRepo.toLowerCase()}:latest`;
      dockerFixed++;
    } else if (app.image && !app.image.includes(":")) {
      app.image = `${app.image}:latest`;
      dockerFixed++;
    }

    // 2. High-Res SVG Logo & Favicon Mapping
    const cleanSlug = (app.slug || app.id || "").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const candidateSvg = `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/${cleanSlug}.svg`;
    const simpleIconSvg = `https://cdn.simpleicons.org/${cleanSlug}`;

    let ghAvatar = null;
    if (ghRepo) {
      const org = ghRepo.split("/")[0];
      ghAvatar = `https://github.com/${org}.png?size=128`;
    }

    let siteFavicon = null;
    try {
      const host = new URL(app.website || app.url).hostname;
      if (host && !host.includes("github.com") && !host.includes("gitlab.com")) {
        siteFavicon = `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
      }
    } catch {}

    if (!app.logoUrl || app.logoUrl.includes("placeholder")) {
      app.logoUrl =
        app.svgUrl ||
        candidateSvg ||
        ghAvatar ||
        siteFavicon ||
        `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/${cleanSlug}.svg`;
      app.svgUrl = app.svgUrl || candidateSvg;
      app.ghAvatar = ghAvatar;
      app.favicon = siteFavicon;
      logoEnriched++;
    }

    // 3. Optional live star fetcher if requested
    if (options.fetchStars && ghRepo && (!app.stars || Number(app.stars) <= 0)) {
      const starData = await fetchLiveRepoStars(ghRepo);
      if (starData) {
        if (starData.stars) app.stars = starData.stars;
        if (starData.forks) app.forks = starData.forks;
        starsEnriched++;
      }
    }
  }

  console.log(`✓ Docker Images Verified: ${dockerFixed}`);
  console.log(`✓ Logos & Icons Enriched: ${logoEnriched}`);
  if (starsEnriched > 0) console.log(`✓ Live GitHub Stars Enriched: ${starsEnriched}`);
  return db;
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("enrich-metadata.mjs")
) {
  const db = JSON.parse(fs.readFileSync("public/catalog.json", "utf8"));
  const fetchStars = process.argv.includes("--fetch-stars");
  enrichMetadata(db, { fetchStars }).then((enrichedDb) => {
    fs.writeFileSync("public/catalog.json", JSON.stringify(enrichedDb, null, 2), "utf8");
    fs.writeFileSync(
      "src/lib/awesome-selfhosted-db.json",
      JSON.stringify(enrichedDb, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      "hosterax/engine/src/awesome-selfhosted-db.json",
      JSON.stringify(enrichedDb, null, 2),
      "utf8",
    );
    console.log("✓ Enriched dataset saved successfully!");
  });
}
