import fs from "node:fs";
import path from "node:path";

const content = fs.readFileSync("awesome_raw.md", "utf8");

// Canonical list of tags from awesome-selfhosted.net
const CANONICAL_TAGS = [
  { label: "Analytics", slug: "analytics", icon: "📊" },
  {
    label: "Archiving and Digital Preservation (DP)",
    slug: "archiving-and-digital-preservation-dp",
    icon: "🏛️",
  },
  { label: "Automation", slug: "automation", icon: "⚡" },
  { label: "Backup", slug: "backup", icon: "💾" },
  { label: "Blogging Platforms", slug: "blogging-platforms", icon: "✍️" },
  { label: "Booking and Scheduling", slug: "booking-and-scheduling", icon: "📅" },
  { label: "Bookmarks and Link Sharing", slug: "bookmarks-and-link-sharing", icon: "🔖" },
  { label: "Calendar & Contacts", slug: "calendar--contacts", icon: "📆" },
  {
    label: "Communication - Custom Communication Systems",
    slug: "communication---custom-communication-systems",
    icon: "💬",
  },
  {
    label: "Communication - Email - Complete Solutions",
    slug: "communication---email---complete-solutions",
    icon: "✉️",
  },
  {
    label: "Communication - Email - Mail Delivery Agents",
    slug: "communication---email---mail-delivery-agents",
    icon: "📬",
  },
  {
    label: "Communication - Email - Mail Transfer Agents",
    slug: "communication---email---mail-transfer-agents",
    icon: "📨",
  },
  {
    label: "Communication - Email - Mailing Lists and Newsletters",
    slug: "communication---email---mailing-lists-and-newsletters",
    icon: "📧",
  },
  {
    label: "Communication - Email - Webmail Clients",
    slug: "communication---email---webmail-clients",
    icon: "🖥️",
  },
  { label: "Communication - IRC", slug: "communication---irc", icon: "🗨️" },
  { label: "Communication - SIP", slug: "communication---sip", icon: "📞" },
  {
    label: "Communication - Social Networks and Forums",
    slug: "communication---social-networks-and-forums",
    icon: "👥",
  },
  {
    label: "Communication - Video Conferencing",
    slug: "communication---video-conferencing",
    icon: "📹",
  },
  { label: "Communication - XMPP - Servers", slug: "communication---xmpp---servers", icon: "🔌" },
  {
    label: "Communication - XMPP - Web Clients",
    slug: "communication---xmpp---web-clients",
    icon: "💻",
  },
  {
    label: "Community-Supported Agriculture (CSA)",
    slug: "community-supported-agriculture-csa",
    icon: "🌱",
  },
  { label: "Conference Management", slug: "conference-management", icon: "🎤" },
  { label: "Content Management Systems (CMS)", slug: "content-management-systems-cms", icon: "📦" },
  {
    label: "Customer Relationship Management (CRM)",
    slug: "customer-relationship-management-crm",
    icon: "💼",
  },
  { label: "Database Management", slug: "database-management", icon: "🗄️" },
  { label: "DNS", slug: "dns", icon: "🌐" },
  { label: "Document Management", slug: "document-management", icon: "📑" },
  { label: "Document Management - E-books", slug: "document-management---e-books", icon: "📖" },
  {
    label: "Document Management - Institutional Repository and Digital Library Software",
    slug: "document-management---institutional-repository-and-digital-library-software",
    icon: "📚",
  },
  {
    label: "Document Management - Integrated Library Systems (ILS)",
    slug: "document-management---integrated-library-systems-ils",
    icon: "🏫",
  },
  { label: "E-commerce", slug: "e-commerce", icon: "🛍️" },
  {
    label: "Federated Identity & Authentication",
    slug: "federated-identity--authentication",
    icon: "🔑",
  },
  { label: "Feed Readers", slug: "feed-readers", icon: "📰" },
  { label: "File Transfer & Synchronization", slug: "file-transfer--synchronization", icon: "🔄" },
  {
    label: "File Transfer - Distributed Filesystems",
    slug: "file-transfer---distributed-filesystems",
    icon: "📁",
  },
  {
    label: "File Transfer - Object Storage & File Servers",
    slug: "file-transfer---object-storage--file-servers",
    icon: "🪣",
  },
  {
    label: "File Transfer - Peer-to-peer Filesharing",
    slug: "file-transfer---peer-to-peer-filesharing",
    icon: "🧲",
  },
  {
    label: "File Transfer - Single-click & Drag-n-drop Upload",
    slug: "file-transfer---single-click--drag-n-drop-upload",
    icon: "📤",
  },
  {
    label: "File Transfer - Web-based File Managers",
    slug: "file-transfer---web-based-file-managers",
    icon: "📂",
  },
  { label: "Games", slug: "games", icon: "🎮" },
  {
    label: "Games - Administrative Utilities & Control Panels",
    slug: "games---administrative-utilities--control-panels",
    icon: "🕹️",
  },
  { label: "Genealogy", slug: "genealogy", icon: "🌳" },
  {
    label: "Generative Artificial Intelligence (GenAI)",
    slug: "generative-artificial-intelligence-genai",
    icon: "🤖",
  },
  { label: "Groupware", slug: "groupware", icon: "🏢" },
  { label: "Health and Fitness", slug: "health-and-fitness", icon: "🏃" },
  { label: "Human Resources Management (HRM)", slug: "human-resources-management-hrm", icon: "👔" },
  { label: "Identity Management", slug: "identity-management", icon: "🪪" },
  { label: "Internet of Things (IoT)", slug: "internet-of-things-iot", icon: "💡" },
  { label: "Inventory Management", slug: "inventory-management", icon: "📋" },
  { label: "Knowledge Management Tools", slug: "knowledge-management-tools", icon: "🧠" },
  { label: "Learning and Courses", slug: "learning-and-courses", icon: "🎓" },
  { label: "Manufacturing", slug: "manufacturing", icon: "🏭" },
  {
    label: "Maps and Global Positioning System (GPS)",
    slug: "maps-and-global-positioning-system-gps",
    icon: "🗺️",
  },
  { label: "Media Management", slug: "media-management", icon: "🎬" },
  { label: "Media Streaming", slug: "media-streaming", icon: "📺" },
  {
    label: "Media Streaming - Audio Streaming",
    slug: "media-streaming---audio-streaming",
    icon: "🎵",
  },
  {
    label: "Media Streaming - Multimedia Streaming",
    slug: "media-streaming---multimedia-streaming",
    icon: "📽️",
  },
  {
    label: "Media Streaming - Video Streaming",
    slug: "media-streaming---video-streaming",
    icon: "🍿",
  },
  { label: "Miscellaneous", slug: "miscellaneous", icon: "🧰" },
  { label: "Money, Budgeting & Management", slug: "money-budgeting--management", icon: "💰" },
  { label: "Monitoring & Status Pages", slug: "monitoring--status-pages", icon: "📶" },
  { label: "Network Utilities", slug: "network-utilities", icon: "🔧" },
  { label: "Note-taking & Editors", slug: "note-taking--editors", icon: "📝" },
  { label: "Office Suites", slug: "office-suites", icon: "📑" },
  { label: "Password Managers", slug: "password-managers", icon: "🔒" },
  { label: "Pastebins", slug: "pastebins", icon: "📋" },
  { label: "Personal Dashboards", slug: "personal-dashboards", icon: "🏠" },
  { label: "Photo Galleries", slug: "photo-galleries", icon: "🖼️" },
  { label: "Polls and Events", slug: "polls-and-events", icon: "🗳️" },
  { label: "Proxy", slug: "proxy", icon: "🛡️" },
  { label: "Recipe Management", slug: "recipe-management", icon: "🍳" },
  { label: "Remote Access", slug: "remote-access", icon: "🖥️" },
  { label: "Resource Planning", slug: "resource-planning", icon: "📊" },
  { label: "Search Engines", slug: "search-engines", icon: "🔍" },
  { label: "Self-hosting Solutions", slug: "self-hosting-solutions", icon: "☁️" },
  { label: "Software Development", slug: "software-development", icon: "💻" },
  {
    label: "Software Development - API Management",
    slug: "software-development---api-management",
    icon: "🔌",
  },
  {
    label: "Software Development - Continuous Integration & Deployment",
    slug: "software-development---continuous-integration--deployment",
    icon: "🚀",
  },
  {
    label: "Software Development - FaaS & Serverless",
    slug: "software-development---faas--serverless",
    icon: "⚡",
  },
  {
    label: "Software Development - Feature Toggle",
    slug: "software-development---feature-toggle",
    icon: "🎛️",
  },
  {
    label: "Software Development - IDE & Tools",
    slug: "software-development---ide--tools",
    icon: "🛠️",
  },
  {
    label: "Software Development - Localization",
    slug: "software-development---localization",
    icon: "🌐",
  },
  { label: "Software Development - Low Code", slug: "software-development---low-code", icon: "🧱" },
  {
    label: "Software Development - Project Management",
    slug: "software-development---project-management",
    icon: "📋",
  },
  { label: "Software Development - Testing", slug: "software-development---testing", icon: "🧪" },
  { label: "Static Site Generators", slug: "static-site-generators", icon: "📄" },
  { label: "Task Management & To-do Lists", slug: "task-management--to-do-lists", icon: "✅" },
  { label: "Ticketing", slug: "ticketing", icon: "🎫" },
  { label: "Time Tracking", slug: "time-tracking", icon: "⏱️" },
  { label: "Travel Organization", slug: "travel-organization", icon: "✈️" },
  { label: "URL Shorteners", slug: "url-shorteners", icon: "🔗" },
  { label: "Video Surveillance", slug: "video-surveillance", icon: "📹" },
  { label: "VPN", slug: "vpn", icon: "🛡️" },
  { label: "Web Servers", slug: "web-servers", icon: "🌐" },
  { label: "Wikis", slug: "wikis", icon: "📚" },
];

// Map lookup by lowercase normalized name/slug
const TAG_LOOKUP = new Map();
for (const t of CANONICAL_TAGS) {
  TAG_LOOKUP.set(t.label.toLowerCase(), t);
  TAG_LOOKUP.set(t.slug.toLowerCase(), t);
  TAG_LOOKUP.set(t.label.toLowerCase().replace(/[^a-z0-9]/g, ""), t);
}

// Known official Docker image mappings
const KNOWN_DOCKER_IMAGES = {
  "plausible analytics": "plausible/analytics:latest",
  umami: "ghcr.io/umami-software/umami:postgresql-latest",
  matomo: "matomo:latest",
  ackee: "electerious/ackee:latest",
  goatcounter: "zgoat/goatcounter:latest",
  shynet: "milesmcc/shynet:latest",
  n8n: "docker.n8n.io/n8nio/n8n",
  activepieces: "activepieces/activepieces:latest",
  nodered: "nodered/node-red:latest",
  "node-red": "nodered/node-red:latest",
  huginn: "huginn/huginn:latest",
  ghost: "ghost:5",
  wordpress: "wordpress:latest",
  writefreely: "writeas/writefreely:latest",
  linkding: "sissbruecker/linkding:latest",
  linkwarden: "ghcr.io/linkwarden/linkwarden:latest",
  wallabag: "wallabag/wallabag:latest",
  shiori: "ghcr.io/go-shiori/shiori:latest",
  nextcloud: "nextcloud:latest",
  owncloud: "owncloud/server:latest",
  syncthing: "syncthing/syncthing:latest",
  seafile: "seafileltd/seafile-mc:latest",
  filebrowser: "filebrowser/filebrowser:latest",
  pocketbase: "ghcr.io/muchobien/pocketbase:latest",
  directus: "directus/directus:latest",
  strapi: "strapi/strapi:latest",
  nocodb: "nocodb/nocodb:latest",
  appwrite: "appwrite/appwrite:latest",
  gitea: "gitea/gitea:latest",
  forgejo: "codeberg.org/forgejo/forgejo:latest",
  gitlab: "gitlab/gitlab-ce:latest",
  "code-server": "codercom/code-server:latest",
  "uptime kuma": "louislam/uptime-kuma:1",
  dockge: "louislam/dockge:1",
  portainer: "portainer/portainer-ce:latest",
  "stirling pdf": "frooodle/s-pdf:latest",
  homepage: "ghcr.io/gethomepage/homepage:latest",
  homarr: "ghcr.io/ajnart/homarr:latest",
  dashy: "lissy93/dashy:latest",
  flame: "pawelmalak/flame:latest",
  glance: "glanceapp/glance:latest",
  excalidraw: "excalidraw/excalidraw:latest",
  cyberchef: "mpepping/cyberchef:latest",
  "it-tools": "corentinth/it-tools:latest",
  vaultwarden: "vaultwarden/server:latest",
  bitwarden: "vaultwarden/server:latest",
  passbolt: "passbolt/passbolt:latest",
  immich: "ghcr.io/immich-app/immich-server:release",
  photoprism: "photoprism/photoprism:latest",
  jellyfin: "jellyfin/jellyfin:latest",
  navidrome: "deluan/navidrome:latest",
  audiobookshelf: "ghcr.io/advplyr/audiobookshelf:latest",
  kavita: "jvmilazz0/kavita:latest",
  komga: "gotson/komga:latest",
  "calibre-web": "linuxserver/calibre-web:latest",
  "paperless-ngx": "ghcr.io/paperless-ngx/paperless-ngx:latest",
  memos: "neosmemo/memos:latest",
  "trilium notes": "zadam/trilium:latest",
  vikunja: "vikunja/vikunja:latest",
  planka: "ghcr.io/plankanban/planka:latest",
  focalboard: "mattermost/focalboard:latest",
  penpot: "penpotapp/frontend:latest",
  searxng: "searxng/searxng:latest",
  whoogle: "benbusby/whoogle-search:latest",
  libretranslate: "libretranslate/libretranslate:latest",
  rustdesk: "rustdesk/rustdesk-server:latest",
  "wg-easy": "ghcr.io/wg-easy/wg-easy:latest",
  wireguard: "ghcr.io/wg-easy/wg-easy:latest",
  "pi-hole": "pihole/pihole:latest",
  "adguard home": "adguard/adguardhome:latest",
  shlink: "shlinkio/shlink:latest",
  yourls: "yourls:latest",
  mealie: "ghcr.io/mealie-recipes/mealie:latest",
  grocy: "linuxserver/grocy:latest",
  docmost: "docmost/docmost:latest",
  bookstack: "linuxserver/bookstack:latest",
  "wiki.js": "requarks/wiki:latest",
  outline: "outlinewiki/outline:latest",
  hedgedoc: "quay.io/hedgedoc/hedgedoc:latest",
  etherpad: "etherpad/etherpad:latest",
  "redis commander": "rediscommander/redis-commander:latest",
  pgadmin: "dpage/pgadmin4:latest",
  meilisearch: "getmeili/meilisearch:latest",
  typesense: "typesense/typesense:27.1",
  qdrant: "qdrant/qdrant:latest",
  chroma: "chromadb/chroma:latest",
  minio: "minio/minio:latest",
  metabase: "metabase/metabase:latest",
  grafana: "grafana/grafana:latest",
  prometheus: "prom/prometheus:latest",
  "open-webui": "ghcr.io/open-webui/open-webui:main",
  ollama: "ollama/ollama:latest",
  flowise: "flowiseai/flowise:latest",
  anythingllm: "mintplexlabs/anything-llm:latest",
  dify: "langgenius/dify-api:latest",
  langfuse: "langfuse/langfuse:2",
  "firefly iii": "fireflyiii/core:latest",
  "actual budget": "actualbudget/actual-server:latest",
  maybe: "ghcr.io/maybe-finance/maybe:latest",
  "invoice ninja": "invoiceninja/invoiceninja:latest",
  beszel: "henrygd/beszel:latest",
  netdata: "netdata/netdata:latest",
  zabbix: "zabbix/zabbix-web-nginx-mysql:latest",
  glances: "nicolargo/glances:latest",
  traefik: "traefik:latest",
  caddy: "caddy:latest",
  "nginx proxy manager": "jc21/nginx-proxy-manager:latest",
  tailscale: "tailscale/tailscale:latest",
};

const lines = content.split("\n");
let currentTagObj = null;
const apps = [];
const tagCounts = new Map();

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (line.startsWith("## ") || line.startsWith("### ")) {
    const rawHeading = line.replace(/^#+\s+/, "").trim();
    if (
      !rawHeading.includes("Table of contents") &&
      !rawHeading.includes("Software") &&
      !rawHeading.includes("Contributing") &&
      !rawHeading.includes("License") &&
      !rawHeading.includes("List of Licenses")
    ) {
      const match = TAG_LOOKUP.get(rawHeading.toLowerCase()) ||
        TAG_LOOKUP.get(rawHeading.toLowerCase().replace(/[^a-z0-9]/g, "")) || {
          label: rawHeading,
          slug: rawHeading.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          icon: "📦",
        };
      currentTagObj = match;
      if (!tagCounts.has(match.slug)) {
        tagCounts.set(match.slug, { ...match, count: 0 });
      }
    }
  } else if (line.startsWith("- [") || line.startsWith("* [")) {
    const match = line.match(/^[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*[-–—:]?\s*(.*)$/);
    if (match && currentTagObj) {
      const name = match[1].trim();
      const url = match[2].trim();
      let rest = match[3].trim();

      // Clean tags inside `...`
      rest = rest.replace(/`[^`]+`/g, "").trim();
      let desc = rest
        .replace(/^[-–—:]\s*/, "")
        .replace(/\s*\([^)]*\)$/, "")
        .trim();

      if (name && url) {
        const lowerName = name.toLowerCase();
        let image = KNOWN_DOCKER_IMAGES[lowerName] || null;
        if (!image) {
          const ghMatch = url.match(/github\.com\/([^/]+)\/([^/#?]+)/);
          if (ghMatch) {
            const org = ghMatch[1];
            const repo = ghMatch[2].replace(/\.git$/, "");
            image = `${org.toLowerCase()}/${repo.toLowerCase()}:latest`;
          } else {
            const cleanSlug = name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
            image = `${cleanSlug}:${cleanSlug}`;
          }
        }

        const appItem = {
          id: name.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
          category: currentTagObj.slug,
          categoryLabel: currentTagObj.label,
          desc: desc || `${name} - Open source self-hosted software.`,
          url,
          website: url,
          image,
          source: "awesome_selfhosted",
          tags: [currentTagObj.slug, "awesome-selfhosted", "self-hosted", "foss"],
          tagUrl: `https://awesome-selfhosted.net/tags/${currentTagObj.slug}.html`,
        };
        apps.push(appItem);

        const tc = tagCounts.get(currentTagObj.slug);
        if (tc) tc.count += 1;
      }
    }
  }
}

// Build final tags array preserving canonical order
const finalTags = CANONICAL_TAGS.map((t) => {
  const existing = tagCounts.get(t.slug);
  return {
    ...t,
    count: existing ? existing.count : 0,
    tagUrl: `https://awesome-selfhosted.net/tags/${t.slug}.html`,
  };
}).filter((t) => t.count > 0);

console.log("Complete Catalog Parsed:");
console.log("- Total apps indexed:", apps.length);
console.log("- Total active tags:", finalTags.length);

const outData = {
  version: "2026.1",
  source: "https://awesome-selfhosted.net",
  totalApps: apps.length,
  totalTags: finalTags.length,
  tags: finalTags,
  apps: apps,
};

fs.writeFileSync("src/lib/awesome-selfhosted-db.json", JSON.stringify(outData, null, 2), "utf8");
fs.writeFileSync(
  "hosterax/engine/src/awesome-selfhosted-db.json",
  JSON.stringify(outData, null, 2),
  "utf8",
);
fs.writeFileSync("public/catalog.json", JSON.stringify(outData, null, 2), "utf8");
console.log("Synchronized to both frontend and backend db files!");
