import fs from 'node:fs';

const dbPath = 'src/lib/awesome-selfhosted-db.json';
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

// Curated high-res brand logos mapping (SimpleIcons / Dashboard Icons / Official SVGs)
const CURATED_LOGOS = {
  "n8n": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/n8n.png",
  "plausible": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/plausible-analytics.png",
  "plausible analytics": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/plausible-analytics.png",
  "umami": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/umami.png",
  "matomo": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/matomo.png",
  "ghost": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/ghost.png",
  "wordpress": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/wordpress.png",
  "directus": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/directus.png",
  "strapi": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/strapi.png",
  "pocketbase": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/pocketbase.png",
  "nocodb": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/nocodb.png",
  "appwrite": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/appwrite.png",
  "gitea": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/gitea.png",
  "forgejo": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/forgejo.png",
  "gitlab": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/gitlab.png",
  "uptime kuma": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/uptime-kuma.png",
  "dockge": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/dockge.png",
  "portainer": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/portainer.png",
  "stirling pdf": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/stirling-pdf.png",
  "vaultwarden": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/vaultwarden.png",
  "bitwarden": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/bitwarden.png",
  "immich": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/immich.png",
  "photoprism": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/photoprism.png",
  "jellyfin": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/jellyfin.png",
  "navidrome": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/navidrome.png",
  "audiobookshelf": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/audiobookshelf.png",
  "kavita": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/kavita.png",
  "paperless-ngx": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/paperless-ngx.png",
  "nextcloud": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/nextcloud.png",
  "owncloud": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/owncloud.png",
  "syncthing": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/syncthing.png",
  "filebrowser": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/filebrowser.png",
  "grafana": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/grafana.png",
  "prometheus": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/prometheus.png",
  "netdata": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/netdata.png",
  "zabbix": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/zabbix.png",
  "jenkins": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/jenkins.png",
  "drone": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/drone.png",
  "woodpecker ci": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/woodpecker.png",
  "ansible": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/ansible.png",
  "keycloak": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/keycloak.png",
  "authelia": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/authelia.png",
  "authentik": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/authentik.png",
  "wireguard": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/wireguard.png",
  "wg-easy": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/wireguard.png",
  "pi-hole": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/pi-hole.png",
  "adguard home": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/adguard-home.png",
  "searxng": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/searxng.png",
  "whoogle": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/whoogle.png",
  "firefly iii": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/firefly-iii.png",
  "actual budget": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/actual-budget.png",
  "vikunja": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/vikunja.png",
  "planka": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/planka.png",
  "focalboard": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/focalboard.png",
  "docmost": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/docmost.png",
  "bookstack": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/bookstack.png",
  "wiki.js": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/wikijs.png",
  "outline": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/outline.png",
  "redis": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/redis.png",
  "redis commander": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/redis.png",
  "meilisearch": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/meilisearch.png",
  "typesense": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/typesense.png",
  "minio": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/minio.png",
  "metabase": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/metabase.png",
  "open-webui": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/open-webui.png",
  "ollama": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/ollama.png",
  "traefik": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/traefik.png",
  "caddy": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/caddy.png",
  "nginx proxy manager": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/nginx-proxy-manager.png",
  "tailscale": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/tailscale.png",
  "rabbitmq": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/rabbitmq.png",
  "apache kafka": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/apache-kafka.png",
  "proxmox": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/proxmox.png",
  "pterodactyl": "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/pterodactyl.png"
};

function resolveLogo(app) {
  const lowerName = app.name.toLowerCase();
  const slug = app.slug.toLowerCase();
  
  if (CURATED_LOGOS[lowerName]) return CURATED_LOGOS[lowerName];
  if (CURATED_LOGOS[slug]) return CURATED_LOGOS[slug];

  // Try GitHub org avatar if repo URL
  const ghMatch = app.url?.match(/github\.com\/([^/]+)/);
  if (ghMatch && !['github.com/torvalds', 'github.com/awesome-selfhosted'].includes(ghMatch[0])) {
    const org = ghMatch[1];
    return `https://github.com/${org}.png?size=128`;
  }

  // Try dashboard-icons by clean slug
  const cleanSlug = slug.replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  
  // Try domain favicon if official website
  try {
    const host = new URL(app.website || app.url).hostname;
    if (host && !host.includes('github.com') && !host.includes('gitlab.com')) {
      return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
    }
  } catch {}

  return `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${cleanSlug}.png`;
}

let enrichedCount = 0;
for (const app of db.apps) {
  app.logoUrl = resolveLogo(app);
  enrichedCount++;
}

console.log(`Enriched ${enrichedCount} applications with real logos!`);

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
fs.writeFileSync('hosterax/engine/src/awesome-selfhosted-db.json', JSON.stringify(db, null, 2), 'utf8');
console.log('Saved enriched databases!');
