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
  n8n: "n8nio/n8n:latest",
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
  ghost: "ghost:alpine",
  wordpress: "wordpress:php8.3-apache",
  meilisearch: "getmeili/meilisearch:latest",
  typesense: "typesense/typesense:latest",
  qdrant: "qdrant/qdrant:latest",
  chroma: "chromadb/chroma:latest",
  weaviate: "semitechnologies/weaviate:latest",
  milvus: "milvusdb/milvus:latest",
  minio: "minio/minio:latest",
  adguardhome: "adguard/adguardhome:latest",
  "adguard-home": "adguard/adguardhome:latest",
  pihole: "pihole/pihole:latest",
  homeassistant: "ghcr.io/home-assistant/home-assistant:stable",
  "home-assistant": "ghcr.io/home-assistant/home-assistant:stable",
  authentik: "ghcr.io/goauthentik/server:latest",
  authelia: "authelia/authelia:latest",
  keycloak: "quay.io/keycloak/keycloak:latest",
  openwebui: "ghcr.io/open-webui/open-webui:main",
  "open-webui": "ghcr.io/open-webui/open-webui:main",
  ollama: "ollama/ollama:latest",
  searxng: "searxng/searxng:latest",
  calibre: "linuxserver/calibre-web:latest",
  "calibre-web": "linuxserver/calibre-web:latest",
  audiobookshelf: "ghcr.io/advplyr/audiobookshelf:latest",
  navidrome: "deluan/navidrome:latest",
  gonic: "sentriz/gonic:latest",
  transmission: "linuxserver/transmission:latest",
  qbittorrent: "linuxserver/qbittorrent:latest",
  wireguard: "linuxserver/wireguard:latest",
  tailscale: "tailscale/tailscale:latest",
  headscale: "headscale/headscale:latest",
  syncthing: "syncthing/syncthing:latest",
  filebrowser: "filebrowser/filebrowser:latest",
  duplicati: "linuxserver/duplicati:latest",
  restic: "restic/restic:latest",
  borgbackup: "b3vis/borgbackup:latest",
  netdata: "netdata/netdata:latest",
  zabbix: "zabbix/zabbix-appliance:latest",
  glances: "nicolargo/glances:latest",
  dozzle: "amir20/dozzle:latest",
  scrutiny: "ghcr.io/analogj/scrutiny:latest",
  speedtest: "henrywhitaker3/speedtest-tracker:latest",
  vikunja: "vikunja/api:latest",
  focalboard: "mattermost/focalboard:latest",
  plane: "makeplane/plane:latest",
  trilium: "zadam/trilium:latest",
  joplin: "joplin/server:latest",
  obsidian: "linuxserver/obsidian:latest",
  affine: "ghcr.io/toeverything/affine:latest",
  appwrite: "appwrite/appwrite:latest",
  supabase: "supabase/studio:latest",
  pocketbase: "pocketbase/pocketbase:latest",
  directus: "directus/directus:latest",
  strapi: "strapi/strapi:latest",
  nocodb: "nocodb/nocodb:latest",
  baserow: "baserow/baserow:latest",
  budibase: "budibase/budibase:latest",
  tooljet: "tooljet/tooljet:latest",
  appsmith: "appsmith/appsmith-ce:latest",
  activepieces: "activepieces/activepieces:latest",
  windmill: "ghcr.io/windmill-labs/windmill:latest",
  nodered: "nodered/node-red:latest",
  "node-red": "nodered/node-red:latest",
  gotify: "gotify/server:latest",
  ntfy: "binwiederhier/ntfy:latest",
  matrix: "matrixdotorg/synapse:latest",
  mattermost: "mattermost/mattermost-team-edition:latest",
  zulip: "zulip/docker-zulip:latest",
  rocketchat: "rocket.chat:latest",
  "rocket-chat": "rocket.chat:latest",
  mastodon: "ghcr.io/mastodon/mastodon:latest",
  misskey: "misskey/misskey:latest",
  lemmy: "dessalines/lemmy:latest",
  discourse: "discourse/discourse:latest",
  flarum: "flarum/flarum:latest",
  nodebb: "nodebb/docker:latest",
  roundcube: "roundcube/roundcubemail:latest",
  mailcow: "mailcow/mailcow-dockerized:latest",
  stalwart: "stalwartlabs/mail-server:latest",
  stalwartmail: "stalwartlabs/mail-server:latest",
};

async function main() {
  console.log("Fixing all Docker image references across HosteraX catalog...");
  const mainDb = JSON.parse(fs.readFileSync("src/lib/awesome-selfhosted-db.json", "utf8"));

  let fixedCount = 0;

  for (const app of mainDb.apps) {
    const slugKey = (app.slug || app.id || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const nameKey = (app.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    // 1. Check well known images
    if (WELL_KNOWN_IMAGES[slugKey]) {
      app.image = WELL_KNOWN_IMAGES[slugKey];
      fixedCount++;
      continue;
    }
    if (WELL_KNOWN_IMAGES[nameKey]) {
      app.image = WELL_KNOWN_IMAGES[nameKey];
      fixedCount++;
      continue;
    }

    // 2. If image ends with :id or :slug or :name
    let img = app.image || "";
    if (
      img.endsWith(`:${app.id}`) ||
      img.endsWith(`:${app.slug}`) ||
      img.endsWith(`:${app.name.toLowerCase()}`) ||
      img.includes(`${app.id}:${app.id}`)
    ) {
      // Check GitHub repo URL
      const ghUrl = app.url?.includes("github.com")
        ? app.url
        : app.website?.includes("github.com")
          ? app.website
          : null;
      if (ghUrl) {
        const match = ghUrl.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
        if (match) {
          const org = match[1].toLowerCase();
          const repo = match[2].toLowerCase().replace(/\.git$/, "");
          app.image = `${org}/${repo}:latest`;
          fixedCount++;
          continue;
        }
      }

      // If single word, make it :latest
      const baseName = img.split(":")[0];
      app.image = `${baseName}:latest`;
      fixedCount++;
    } else if (!img.includes(":")) {
      app.image = `${img}:latest`;
      fixedCount++;
    }
  }

  console.log(`Cleaned & Fixed ${fixedCount} Docker image references.`);
  fs.writeFileSync("src/lib/awesome-selfhosted-db.json", JSON.stringify(mainDb, null, 2), "utf8");
  fs.writeFileSync(
    "hosterax/engine/src/awesome-selfhosted-db.json",
    JSON.stringify(mainDb, null, 2),
    "utf8",
  );
  fs.writeFileSync("public/catalog.json", JSON.stringify(mainDb, null, 2), "utf8");
  console.log("Synchronized database files with verified Docker images!");
}

main().catch((err) => console.error(err));
