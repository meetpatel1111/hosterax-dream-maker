// hosterax/engine/src/dependency-analyzer.mjs
// Discovers environment variables, persistent volumes, ports, and companion database
// dependencies from OCI image metadata, Docker Hub READMEs, GitHub compose/.env.example files,
// and curated catalog presets.

import { isSafeImageRef } from "./security.mjs";

const SYSTEM_ENV_NOISE = new Set([
  "PATH",
  "HOME",
  "HOSTNAME",
  "TERM",
  "LANG",
  "LC_ALL",
  "PWD",
  "SHLVL",
  "DEBIAN_FRONTEND",
  "GOSU_VERSION",
  "GPG_KEY",
  "NODE_VERSION",
  "YARN_VERSION",
  "NPM_CONFIG_LOGLEVEL",
  "PYTHON_VERSION",
  "PYTHON_PIP_VERSION",
  "PYTHON_GET_PIP_URL",
  "PYTHON_GET_PIP_SHA256",
  "PYTHON_SHA256",
  "PIP_NO_CACHE_DIR",
  "PHP_VERSION",
  "PHP_SHA256",
  "PHP_URL",
  "PHP_ASC_URL",
  "PHPIZE_DEPS",
  "RUBY_VERSION",
  "RUBY_MAJOR",
  "RUBY_DOWNLOAD_SHA256",
  "GOLANG_VERSION",
  "RUST_VERSION",
  "JAVA_HOME",
  "JAVA_VERSION",
  "DOTNET_VERSION",
  "ASPNETCORE_URLS",
  "S6_BEHAVIOUR_IF_STAGE2_FAILS",
  "S6_CMD_WAIT_FOR_SERVICES_MAXTIME",
  "LSIO_FIRST_PARTY",
  "BUILD_DATE",
  "VERSION",
  "NVIDIA_VISIBLE_DEVICES",
  "NVIDIA_DRIVER_CAPABILITIES",
]);

const SECRET_KEY_RE =
  /(SECRET|PASSWORD|PASSWD|PASS\b|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|ENCRYPTION_KEY|AUTH_KEY|SIGNING_KEY|JWT|SALT|CREDENTIAL|MASTER_KEY|SESSION_KEY|APP_KEY)/i;

const PLACEHOLDER_VAL_RE =
  /^(|changeme|change_me|change-me|your[_-].*|replace[_-]?me|example.*|<.*>|\$\{.*\}|xxx+|todo|secret|password|insert[_-].*|enter[_-].*|put[_-].*)$/i;

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

const CURATED_APP_BLUEPRINTS = [
  {
    id: "gitea",
    match: /(?:^|\/)(?:gitea|forgejo)(?::|$)|^gitea$/i,
    port: 3000,
    volumes: ["/data"],
    databases: [
      {
        engine: "postgres",
        reason: "Recommended production database for Gitea/Forgejo (uncheck to use embedded SQLite)",
        envKey: "GITEA__database__HOST",
        confidence: "high",
        recommended: true,
      },
    ],
    envVars: [
      {
        key: "GITEA__server__DOMAIN",
        defaultValue: "",
        required: false,
        secret: false,
        description: "Public domain hostname for web & Git clone URLs",
        source: "blueprint",
      },
      {
        key: "GITEA__server__ROOT_URL",
        defaultValue: "",
        required: false,
        secret: false,
        description: "Canonical base URL (e.g. https://git.example.com)",
        source: "blueprint",
      },
      {
        key: "GITEA__security__SECRET_KEY",
        defaultValue: "",
        required: true,
        secret: true,
        description: "Session & CSRF signing secret for Gitea",
        source: "blueprint",
      },
      {
        key: "GITEA__security__INTERNAL_TOKEN",
        defaultValue: "",
        required: true,
        secret: true,
        description: "Internal API / SSH JWT signing secret",
        source: "blueprint",
      },
    ],
  },
  {
    id: "n8n",
    match: /(?:^|\/)n8n(?::|$)/i,
    port: 5678,
    volumes: ["/home/node/.n8n"],
    databases: [
      {
        engine: "postgres",
        reason: "Recommended relational store for production n8n workflows",
        envKey: "DB_POSTGRESDB_HOST",
        confidence: "high",
        recommended: true,
      },
    ],
    envVars: [
      {
        key: "N8N_ENCRYPTION_KEY",
        defaultValue: "",
        required: true,
        secret: true,
        description: "Key used to encrypt stored workflow credentials",
        source: "blueprint",
      },
      {
        key: "N8N_HOST",
        defaultValue: "",
        required: false,
        secret: false,
        description: "Public hostname for webhooks and OAuth callbacks",
        source: "blueprint",
      },
      {
        key: "WEBHOOK_URL",
        defaultValue: "",
        required: false,
        secret: false,
        description: "Full public HTTPS URL for webhook triggers",
        source: "blueprint",
      },
      {
        key: "GENERIC_TIMEZONE",
        defaultValue: "UTC",
        required: false,
        secret: false,
        description: "Default timezone for cron triggers",
        source: "blueprint",
      },
    ],
  },
  {
    id: "nextcloud",
    match: /(?:^|\/)nextcloud(?::|$)/i,
    port: 80,
    volumes: ["/var/www/html"],
    databases: [
      {
        engine: "postgres",
        reason: "Recommended primary database for Nextcloud (avoids slow SQLite locks)",
        envKey: "POSTGRES_HOST",
        confidence: "high",
        recommended: true,
      },
      {
        engine: "redis",
        reason: "Recommended transactional file locking & memory cache for Nextcloud",
        envKey: "REDIS_HOST",
        confidence: "medium",
        recommended: false,
      },
    ],
    envVars: [
      {
        key: "NEXTCLOUD_ADMIN_USER",
        defaultValue: "admin",
        required: true,
        secret: false,
        description: "Initial administrator username",
        source: "blueprint",
      },
      {
        key: "NEXTCLOUD_ADMIN_PASSWORD",
        defaultValue: "",
        required: true,
        secret: true,
        description: "Initial administrator password",
        source: "blueprint",
      },
      {
        key: "NEXTCLOUD_TRUSTED_DOMAINS",
        defaultValue: "",
        required: false,
        secret: false,
        description: "Space-separated allowed hostnames",
        source: "blueprint",
      },
    ],
  },
  {
    id: "ghost",
    match: /(?:^|\/)ghost(?::|$)/i,
    port: 2368,
    volumes: ["/var/lib/ghost/content"],
    databases: [
      {
        engine: "mysql",
        reason: "Ghost production requires MySQL 8 for content & member storage",
        envKey: "database__connection__host",
        confidence: "high",
        recommended: true,
      },
    ],
    envVars: [
      {
        key: "url",
        defaultValue: "",
        required: true,
        secret: false,
        description: "Canonical HTTPS URL where Ghost is served",
        source: "blueprint",
      },
      {
        key: "NODE_ENV",
        defaultValue: "production",
        required: false,
        secret: false,
        description: "Runtime environment mode",
        source: "blueprint",
      },
    ],
  },
  {
    id: "paperless-ngx",
    match: /paperless-ngx|paperless/i,
    port: 8000,
    volumes: ["/usr/src/paperless/data", "/usr/src/paperless/media", "/usr/src/paperless/consume"],
    databases: [
      {
        engine: "postgres",
        reason: "Primary metadata database for Paperless-ngx",
        envKey: "PAPERLESS_DBHOST",
        confidence: "high",
        recommended: true,
      },
      {
        engine: "redis",
        reason: "Required Celery broker for Paperless-ngx OCR & task queue",
        envKey: "PAPERLESS_REDIS",
        confidence: "high",
        recommended: true,
      },
    ],
    envVars: [
      {
        key: "PAPERLESS_SECRET_KEY",
        defaultValue: "",
        required: true,
        secret: true,
        description: "Django cryptographic signing key",
        source: "blueprint",
      },
      {
        key: "PAPERLESS_URL",
        defaultValue: "",
        required: false,
        secret: false,
        description: "Canonical HTTPS origin for CSRF trusted origins",
        source: "blueprint",
      },
      {
        key: "PAPERLESS_ADMIN_USER",
        defaultValue: "admin",
        required: false,
        secret: false,
        description: "Bootstrap admin username",
        source: "blueprint",
      },
      {
        key: "PAPERLESS_ADMIN_PASSWORD",
        defaultValue: "",
        required: false,
        secret: true,
        description: "Bootstrap admin password",
        source: "blueprint",
      },
    ],
  },
  {
    id: "vaultwarden",
    match: /vaultwarden/i,
    port: 80,
    volumes: ["/data"],
    databases: [],
    envVars: [
      {
        key: "DOMAIN",
        defaultValue: "",
        required: false,
        secret: false,
        description: "Public HTTPS URL for WebAuthn / Bitwarden clients",
        source: "blueprint",
      },
      {
        key: "ADMIN_TOKEN",
        defaultValue: "",
        required: false,
        secret: true,
        description: "Protects the /admin diagnostics & user management panel",
        source: "blueprint",
      },
      {
        key: "SIGNUPS_ALLOWED",
        defaultValue: "false",
        required: false,
        secret: false,
        description: "Set to true temporarily to register initial accounts",
        source: "blueprint",
      },
    ],
  },
  {
    id: "uptime-kuma",
    match: /uptime-kuma/i,
    port: 3001,
    volumes: ["/app/data"],
    databases: [],
    envVars: [
      {
        key: "TZ",
        defaultValue: "UTC",
        required: false,
        secret: false,
        description: "Timezone for status page timestamps",
        source: "blueprint",
      },
    ],
  },
  {
    id: "grafana",
    match: /(?:^|\/)grafana(?::|$)/i,
    port: 3000,
    volumes: ["/var/lib/grafana"],
    databases: [],
    envVars: [
      {
        key: "GF_SECURITY_ADMIN_USER",
        defaultValue: "admin",
        required: false,
        secret: false,
        description: "Initial Grafana admin username",
        source: "blueprint",
      },
      {
        key: "GF_SECURITY_ADMIN_PASSWORD",
        defaultValue: "",
        required: true,
        secret: true,
        description: "Initial Grafana admin password",
        source: "blueprint",
      },
      {
        key: "GF_SERVER_ROOT_URL",
        defaultValue: "",
        required: false,
        secret: false,
        description: "Canonical Grafana root URL for OAuth & alerts",
        source: "blueprint",
      },
    ],
  },
  {
    id: "metabase",
    match: /(?:^|\/)metabase(?::|$)/i,
    port: 3000,
    volumes: ["/metabase-data"],
    databases: [
      {
        engine: "postgres",
        reason: "Recommended application database for Metabase questions & dashboards",
        envKey: "MB_DB_HOST",
        confidence: "high",
        recommended: true,
      },
    ],
    envVars: [
      {
        key: "MB_SITE_URL",
        defaultValue: "",
        required: false,
        secret: false,
        description: "Public base URL for shared dashboards & emails",
        source: "blueprint",
      },
    ],
  },
  {
    id: "directus",
    match: /(?:^|\/)directus(?::|$)/i,
    port: 8055,
    volumes: ["/directus/uploads", "/directus/extensions"],
    databases: [
      {
        engine: "postgres",
        reason: "Directus requires PostgreSQL, MySQL, or SQLite for data storage",
        envKey: "DB_HOST",
        confidence: "high",
        recommended: true,
      },
      {
        engine: "redis",
        reason: "Recommended cache & rate-limit store for Directus",
        envKey: "REDIS",
        confidence: "medium",
        recommended: false,
      },
    ],
    envVars: [
      {
        key: "SECRET",
        defaultValue: "",
        required: true,
        secret: true,
        description: "Random string used to sign JWT tokens",
        source: "blueprint",
      },
      {
        key: "ADMIN_EMAIL",
        defaultValue: "admin@example.com",
        required: true,
        secret: false,
        description: "Initial bootstrap administrator email",
        source: "blueprint",
      },
      {
        key: "ADMIN_PASSWORD",
        defaultValue: "",
        required: true,
        secret: true,
        description: "Initial bootstrap administrator password",
        source: "blueprint",
      },
      {
        key: "PUBLIC_URL",
        defaultValue: "",
        required: false,
        secret: false,
        description: "Public HTTPS URL of your Directus instance",
        source: "blueprint",
      },
    ],
  },
  {
    id: "umami",
    match: /(?:^|\/)umami(?::|$)/i,
    port: 3000,
    volumes: [],
    databases: [
      {
        engine: "postgres",
        reason: "Umami analytics requires PostgreSQL or MySQL",
        envKey: "DATABASE_URL",
        confidence: "high",
        recommended: true,
      },
    ],
    envVars: [
      {
        key: "APP_SECRET",
        defaultValue: "",
        required: true,
        secret: true,
        description: "Random secret used to sign Umami auth tokens",
        source: "blueprint",
      },
    ],
  },
  {
    id: "outline",
    match: /(?:^|\/)outline(?::|$)/i,
    port: 3000,
    volumes: ["/var/lib/outline/data"],
    databases: [
      {
        engine: "postgres",
        reason: "Outline requires PostgreSQL for workspace storage",
        envKey: "DATABASE_URL",
        confidence: "high",
        recommended: true,
      },
      {
        engine: "redis",
        reason: "Outline requires Redis for real-time collaboration & queues",
        envKey: "REDIS_URL",
        confidence: "high",
        recommended: true,
      },
    ],
    envVars: [
      {
        key: "SECRET_KEY",
        defaultValue: "",
        required: true,
        secret: true,
        description: "32-byte hex encryption key for sessions",
        source: "blueprint",
      },
      {
        key: "UTILS_SECRET",
        defaultValue: "",
        required: true,
        secret: true,
        description: "32-byte hex secret for internal utilities",
        source: "blueprint",
      },
      {
        key: "URL",
        defaultValue: "",
        required: true,
        secret: false,
        description: "Canonical HTTPS URL for Outline",
        source: "blueprint",
      },
    ],
  },
  {
    id: "minio",
    match: /(?:^|\/)minio(?::|$)/i,
    port: 9000,
    volumes: ["/data"],
    databases: [],
    envVars: [
      {
        key: "MINIO_ROOT_USER",
        defaultValue: "minioadmin",
        required: true,
        secret: false,
        description: "Root S3 access key",
        source: "blueprint",
      },
      {
        key: "MINIO_ROOT_PASSWORD",
        defaultValue: "",
        required: true,
        secret: true,
        description: "Root S3 secret key (min 8 chars)",
        source: "blueprint",
      },
    ],
  },
];

export function matchCuratedAppBlueprint(imageTag = "", appName = "") {
  const target = `${String(imageTag || "").trim()} ${String(appName || "").trim()}`.toLowerCase();
  if (!target.trim()) return null;
  for (const bp of CURATED_APP_BLUEPRINTS) {
    if (bp.match.test(String(imageTag || "").split("@")[0].toLowerCase()) || bp.match.test(target)) {
      return bp;
    }
  }
  return null;
}

const PORT_PRIORITY = [
  80, 8080, 3000, 5000, 8000, 5678, 8090, 8055, 8096, 2368, 2283, 9000, 8108, 6333, 11434,
];

export function parseGithubOwnerRepo(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const cleaned = rawUrl
    .trim()
    .replace(/^git\+/, "")
    .replace(/\.git$/i, "");
  const m = cleaned.match(
    /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:[/?#].*)?$/i,
  );
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

export function parseDockerHubRepo(imageRef) {
  if (!imageRef || typeof imageRef !== "string") return null;
  let ref = imageRef.trim().split("@")[0];
  const lastColon = ref.lastIndexOf(":");
  const lastSlash = ref.lastIndexOf("/");
  if (lastColon > lastSlash) ref = ref.slice(0, lastColon);

  if (ref.startsWith("docker.io/")) {
    ref = ref.slice("docker.io/".length);
  } else if (ref.startsWith("index.docker.io/")) {
    ref = ref.slice("index.docker.io/".length);
  } else if (ref.includes("/")) {
    const firstSeg = ref.split("/")[0];
    if (firstSeg.includes(".") || firstSeg.includes(":") || firstSeg === "localhost") {
      return null;
    }
  }

  if (!ref.includes("/")) return `library/${ref}`;
  const parts = ref.split("/");
  if (parts.length === 2) return `${parts[0]}/${parts[1]}`;
  return null;
}

export function isSecretEnvKey(key) {
  return SECRET_KEY_RE.test(String(key || ""));
}

export function isPlaceholderValue(val) {
  const s = String(val ?? "").trim();
  if (!s) return true;
  if (PLACEHOLDER_VAL_RE.test(s)) return true;
  const interp = s.match(/^\$\{[A-Za-z0-9_]+(?::[-?](.*))?\}$/);
  if (interp) {
    return !interp[1] || PLACEHOLDER_VAL_RE.test(interp[1]);
  }
  return false;
}

export function normalizeEnvDefault(val) {
  let s = String(val ?? "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  const interp = s.match(/^\$\{[A-Za-z0-9_]+:-([^}]*)\}$/);
  if (interp) return interp[1];
  if (/^\$\{[A-Za-z0-9_]+(?::\?[^}]*)?\}$/.test(s)) return "";
  return s;
}

export function parseEnvFileText(text) {
  if (!text || typeof text !== "string") return [];
  const entries = [];
  let pendingComments = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      pendingComments = [];
      continue;
    }
    if (line.startsWith("#")) {
      const commentBody = line.replace(/^#+\s*/, "").trim();
      if (commentBody && !/^[A-Z0-9_]{2,}=/.test(commentBody)) {
        pendingComments.push(commentBody);
      }
      continue;
    }
    const cleaned = line.replace(/^export\s+/, "");
    const eq = cleaned.indexOf("=");
    if (eq <= 0) {
      pendingComments = [];
      continue;
    }
    const key = cleaned.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) || SYSTEM_ENV_NOISE.has(key)) {
      pendingComments = [];
      continue;
    }
    let valPart = cleaned.slice(eq + 1).trim();
    if (!valPart.startsWith('"') && !valPart.startsWith("'")) {
      const hashIdx = valPart.indexOf(" #");
      if (hashIdx >= 0) valPart = valPart.slice(0, hashIdx).trim();
    }
    const defaultValue = normalizeEnvDefault(valPart);
    const description = pendingComments.slice(-2).join(" ");
    pendingComments = [];
    const required =
      isPlaceholderValue(defaultValue) ||
      /\b(required|mandatory|must set)\b/i.test(description);
    entries.push({
      key,
      defaultValue: isPlaceholderValue(defaultValue) ? "" : defaultValue,
      required,
      secret: isSecretEnvKey(key),
      description: description || undefined,
      source: "env-example",
    });
  }
  return entries;
}

export function extractReadmeHints(markdown) {
  if (!markdown || typeof markdown !== "string") {
    return { composeBlocks: [], dockerRunEnvs: [], ports: [], mentionedDbs: [] };
  }
  const composeBlocks = [];
  const codeBlockRe = /```(?:ya?ml)?\s*\r?\n([\s\S]*?)```/gi;
  let m;
  while ((m = codeBlockRe.exec(markdown)) !== null) {
    const block = m[1];
    if (/\bservices\s*:/i.test(block) && /\bimage\s*:/i.test(block)) {
      composeBlocks.push(block);
    }
  }

  const dockerRunEnvs = [];
  const envFlagRe = /(?:^|\s)(?:-e|--env)\s+["']?([A-Za-z_][A-Za-z0-9_.-]*)=([^\s"'\\]+)?["']?/gm;
  while ((m = envFlagRe.exec(markdown)) !== null) {
    const key = m[1];
    if (SYSTEM_ENV_NOISE.has(key)) continue;
    const rawVal = m[2] || "";
    const defaultValue = normalizeEnvDefault(rawVal);
    dockerRunEnvs.push({
      key,
      defaultValue: isPlaceholderValue(defaultValue) ? "" : defaultValue,
      required: isPlaceholderValue(rawVal),
      secret: isSecretEnvKey(key),
      source: "readme",
    });
  }

  const ports = [];
  const portFlagRe = /(?:^|\s)-p\s+["']?(?:\d+:)?(\d{2,5})(?:\/\w+)?["']?/gm;
  while ((m = portFlagRe.exec(markdown)) !== null) {
    const p = Number.parseInt(m[1], 10);
    if (p > 0 && p <= 65535 && !ports.includes(p)) ports.push(p);
  }

  const mentionedDbs = [];
  const dbPatterns = [
    { engine: "postgres", re: /\b(postgres(?:ql)?|pgvector|timescaledb)\b/i },
    { engine: "redis", re: /\b(redis|valkey|dragonfly)\b/i },
    { engine: "mysql", re: /\bmysql\b/i },
    { engine: "mariadb", re: /\bmariadb\b/i },
    { engine: "mongodb", re: /\b(mongodb|mongo)\b/i },
  ];
  for (const pat of dbPatterns) {
    if (pat.re.test(markdown)) mentionedDbs.push(pat.engine);
  }

  return { composeBlocks, dockerRunEnvs, ports, mentionedDbs };
}

function detectDbEngineFromImageOrName(name, image) {
  const target = `${String(name || "").toLowerCase()} ${String(image || "").toLowerCase()}`;
  if (/postgres|pgvector|timescale|postgis/.test(target)) return "postgres";
  if (/mariadb/.test(target)) return "mariadb";
  if (/mysql/.test(target)) return "mysql";
  if (/mongo/.test(target)) return "mongodb";
  if (/redis|valkey|dragonfly/.test(target)) return "redis";
  return null;
}

export function parseComposeDependencies(yamlText, targetImageHint = "") {
  if (!yamlText || typeof yamlText !== "string") {
    return { services: [], databases: [], envVars: [], volumes: [], ports: [] };
  }

  const lines = yamlText.split(/\r?\n/);
  const servicesIdx = lines.findIndex((l) => /^services\s*:\s*(?:#.*)?$/.test(l));
  if (servicesIdx === -1) {
    return { services: [], databases: [], envVars: [], volumes: [], ports: [] };
  }

  const serviceList = [];
  let currentSvc = null;
  let section = null;
  let svcIndent = -1;

  for (let i = servicesIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.search(/\S/);
    if (indent === 0) break;

    if (svcIndent === -1 || indent <= svcIndent) {
      const svcMatch = raw.match(/^\s+([A-Za-z0-9_.-]+)\s*:\s*(?:#.*)?$/);
      if (svcMatch) {
        svcIndent = indent;
        currentSvc = {
          name: svcMatch[1],
          image: "",
          env: [],
          ports: [],
          volumes: [],
          dependsOn: [],
        };
        serviceList.push(currentSvc);
        section = null;
        continue;
      }
    }
    if (!currentSvc) continue;

    const trimmed = raw.trim();
    if (/^image\s*:\s*/.test(trimmed)) {
      currentSvc.image = trimmed
        .replace(/^image\s*:\s*/, "")
        .replace(/["']/g, "")
        .split(/\s+#/)[0]
        .trim();
      section = null;
      continue;
    }
    if (/^(environment|ports|volumes|depends_on)\s*:\s*(?:#.*)?$/.test(trimmed)) {
      section = trimmed.split(":")[0].trim();
      continue;
    }
    if (
      !trimmed.startsWith("-") &&
      /^[A-Za-z0-9_.-]+\s*:/.test(trimmed) &&
      section !== "environment" &&
      section !== "depends_on"
    ) {
      section = null;
      continue;
    }
    if (!trimmed.startsWith("-") && /^[A-Za-z0-9_.-]+\s*:/.test(trimmed) && indent <= svcIndent + 2) {
      section = null;
      continue;
    }

    if (section === "environment") {
      if (trimmed.startsWith("-")) {
        const kv = trimmed.slice(1).trim().replace(/^["']|["']$/g, "");
        const eq = kv.indexOf("=");
        if (eq > 0) {
          currentSvc.env.push({ key: kv.slice(0, eq).trim(), rawVal: kv.slice(eq + 1).trim() });
        } else if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(kv)) {
          currentSvc.env.push({ key: kv, rawVal: "" });
        }
      } else {
        const kvMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*(.*)$/);
        if (kvMatch) {
          currentSvc.env.push({
            key: kvMatch[1],
            rawVal: kvMatch[2].replace(/\s+#.*$/, "").trim(),
          });
        }
      }
    } else if (section === "ports" && trimmed.startsWith("-")) {
      const pMatch = trimmed
        .slice(1)
        .trim()
        .replace(/["']/g, "")
        .match(/(?:\d+:)?(\d{2,5})(?:\/\w+)?$/);
      if (pMatch) currentSvc.ports.push(Number.parseInt(pMatch[1], 10));
    } else if (section === "volumes" && trimmed.startsWith("-")) {
      const vPart = trimmed.slice(1).trim().replace(/["']/g, "").split(":");
      const containerPath = vPart.length >= 2 ? vPart[1].split(",")[0] : vPart[0];
      if (containerPath && containerPath.startsWith("/")) {
        currentSvc.volumes.push(containerPath);
      }
    } else if (section === "depends_on") {
      if (trimmed.startsWith("-")) {
        currentSvc.dependsOn.push(trimmed.slice(1).trim());
      } else {
        const depMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:/);
        if (depMatch) currentSvc.dependsOn.push(depMatch[1]);
      }
    }
  }

  const hintClean = String(targetImageHint || "").toLowerCase().split(":")[0];
  const databases = [];
  const seenDb = new Set();

  for (const svc of serviceList) {
    const dbEng = detectDbEngineFromImageOrName(svc.name, svc.image);
    if (dbEng && !seenDb.has(dbEng)) {
      seenDb.add(dbEng);
      databases.push({
        engine: dbEng,
        serviceName: svc.name,
        reason: `Defined companion "${svc.name}" (${svc.image || dbEng}) in upstream docker-compose.yml`,
        confidence: "high",
        recommended: true,
      });
    }
  }

  const nonDbServices = serviceList.filter((s) => !detectDbEngineFromImageOrName(s.name, s.image));
  const primarySvc =
    nonDbServices.find((s) => hintClean && s.image.toLowerCase().includes(hintClean)) ||
    nonDbServices[0] ||
    serviceList[0];

  const envVars = [];
  if (primarySvc) {
    for (const item of primarySvc.env) {
      if (SYSTEM_ENV_NOISE.has(item.key)) continue;
      const defaultValue = normalizeEnvDefault(item.rawVal);
      const required = /\$\{[A-Za-z0-9_]+:\?/.test(item.rawVal) || isPlaceholderValue(item.rawVal);
      envVars.push({
        key: item.key,
        defaultValue: isPlaceholderValue(defaultValue) ? "" : defaultValue,
        required,
        secret: isSecretEnvKey(item.key),
        source: "compose",
      });
    }
  }

  return {
    services: serviceList.map((s) => ({ name: s.name, image: s.image })),
    databases,
    envVars,
    volumes: primarySvc ? primarySvc.volumes : [],
    ports: primarySvc ? primarySvc.ports : [],
  };
}

function inferDatabaseFromEnvKeys(envMap, targetImage = "") {
  const keys = Array.from(envMap.keys());
  const combinedValues = Array.from(envMap.values())
    .map((e) => String(e.defaultValue || ""))
    .join(" ");
  const imgLower = String(targetImage || "").toLowerCase();

  if (
    /^(?:library\/)?(postgres|postgresql|mysql|mariadb|mongo|mongodb|redis|valkey)(:|$)/i.test(
      imgLower,
    )
  ) {
    return [];
  }

  const detected = [];
  const addDb = (engine, reason, envKey, confidence = "medium") => {
    if (detected.some((d) => d.engine === engine)) return;
    detected.push({ engine, reason, envKey, confidence, recommended: confidence === "high" });
  };

  const hasPgKey = keys.some((k) =>
    /^(POSTGRES_HOST|POSTGRES_URL|POSTGRESQL_URL|PGHOST|DB_POSTGRESDB_HOST|POSTGRES_USER|POSTGRES_DB)$/i.test(
      k,
    ),
  );
  const hasPgUrl = /postgres(?:ql)?:\/\//i.test(combinedValues);
  const hasGenericDbUrl = keys.some((k) =>
    /^(DATABASE_URL|DB_URL|SQLALCHEMY_DATABASE_URI)$/i.test(k),
  );

  if (hasPgKey || hasPgUrl) {
    addDb(
      "postgres",
      "Detected PostgreSQL connection environment variables",
      keys.find((k) => /^(DATABASE_URL|POSTGRES_URL|POSTGRESQL_URL)$/i.test(k)) || "DATABASE_URL",
      "high",
    );
  } else if (
    keys.some((k) =>
      /^(MYSQL_HOST|MYSQL_URL|MYSQL_DATABASE|MARIADB_HOST|MARIADB_DATABASE)$/i.test(k),
    ) ||
    /mysql:\/\//i.test(combinedValues)
  ) {
    const isMaria = keys.some((k) => /^MARIADB_/i.test(k));
    addDb(
      isMaria ? "mariadb" : "mysql",
      "Detected MySQL/MariaDB connection environment variables",
      keys.find((k) => /^(DATABASE_URL|MYSQL_URL)$/i.test(k)) || "DATABASE_URL",
      "high",
    );
  } else if (
    keys.some((k) => /^(MONGO_URL|MONGODB_URI|MONGODB_URL|MONGO_URI)$/i.test(k)) ||
    /mongodb(?:\+srv)?:\/\//i.test(combinedValues)
  ) {
    addDb(
      "mongodb",
      "Detected MongoDB connection URI variable",
      keys.find((k) => /^(MONGODB_URI|MONGO_URL|MONGODB_URL|MONGO_URI)$/i.test(k)) ||
        "MONGODB_URI",
      "high",
    );
  } else if (hasGenericDbUrl) {
    addDb(
      "postgres",
      "Detected DATABASE_URL variable (PostgreSQL recommended)",
      keys.find((k) => /^(DATABASE_URL|DB_URL|SQLALCHEMY_DATABASE_URI)$/i.test(k)) ||
        "DATABASE_URL",
      "medium",
    );
  }

  if (
    keys.some((k) =>
      /^(REDIS_URL|REDIS_HOST|REDIS_ADDR|VALKEY_URL|QUEUE_BULL_REDIS_HOST)$/i.test(k),
    ) ||
    /redis:\/\//i.test(combinedValues)
  ) {
    addDb(
      "redis",
      "Detected Redis cache/queue environment variables",
      keys.find((k) => /^(REDIS_URL|VALKEY_URL)$/i.test(k)) || "REDIS_URL",
      "high",
    );
  }

  return detected;
}

export function pickDetectedPort(exposedPorts, imageTag = "", presetPort) {
  const cleanKey = String(imageTag || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const baseKey = String(imageTag || "")
    .split(":")[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");

  if (presetPort && Number.isFinite(Number(presetPort)) && Number(presetPort) > 0) {
    if (!exposedPorts || exposedPorts.length === 0 || exposedPorts.includes(Number(presetPort))) {
      return Number(presetPort);
    }
  }
  const wellKnown = WELL_KNOWN_PORTS[cleanKey] || WELL_KNOWN_PORTS[baseKey];
  if (exposedPorts && exposedPorts.length > 0) {
    for (const p of PORT_PRIORITY) {
      if (exposedPorts.includes(p)) return p;
    }
    return exposedPorts[0];
  }
  return wellKnown || presetPort || 3000;
}

export function analyzeDependenciesFromSources({
  image,
  appName = "",
  presetEnv = {},
  presetPort,
  imageVerified = true,
  ociConfig = null,
  dockerHubReadme = "",
  composeYaml = "",
  envExample = "",
  sourcesChecked = [],
}) {
  const envMap = new Map();
  const upsertEnv = (entry, preferIncoming = false) => {
    if (!entry?.key || SYSTEM_ENV_NOISE.has(entry.key)) return;
    const existing = envMap.get(entry.key);
    if (!existing) {
      envMap.set(entry.key, {
        key: entry.key,
        defaultValue: entry.defaultValue ?? "",
        required: Boolean(entry.required),
        secret: Boolean(entry.secret || isSecretEnvKey(entry.key)),
        description: entry.description,
        source: entry.source || "oci",
      });
      return;
    }
    if (preferIncoming) {
      envMap.set(entry.key, {
        ...existing,
        defaultValue:
          entry.defaultValue !== undefined && entry.defaultValue !== ""
            ? entry.defaultValue
            : existing.defaultValue,
        required: existing.required || Boolean(entry.required),
        secret: existing.secret || Boolean(entry.secret),
        description: entry.description || existing.description,
        source: existing.source === "preset" ? existing.source : entry.source || existing.source,
      });
    } else if (!existing.defaultValue && entry.defaultValue) {
      existing.defaultValue = entry.defaultValue;
    }
  };

  const ociExposedPorts = Array.isArray(ociConfig?.exposedPorts)
    ? [...ociConfig.exposedPorts]
    : [];
  const ociVolumes = Array.isArray(ociConfig?.volumes) ? [...ociConfig.volumes] : [];
  const ociEnvList = Array.isArray(ociConfig?.env) ? ociConfig.env : [];
  for (const line of ociEnvList) {
    const str = String(line || "");
    const eq = str.indexOf("=");
    if (eq <= 0) continue;
    const key = str.slice(0, eq).trim();
    const val = str.slice(eq + 1).trim();
    if (!key || SYSTEM_ENV_NOISE.has(key)) continue;
    const placeholder = isPlaceholderValue(val);
    upsertEnv({
      key,
      defaultValue: placeholder ? "" : val,
      required: placeholder,
      secret: isSecretEnvKey(key),
      source: "oci",
    });
  }

  const readmeHints = extractReadmeHints(dockerHubReadme);
  for (const e of readmeHints.dockerRunEnvs) {
    upsertEnv(e, true);
  }
  const effectiveComposeYaml = composeYaml || readmeHints.composeBlocks[0] || "";

  const composeParsed = parseComposeDependencies(effectiveComposeYaml, image);
  for (const e of composeParsed.envVars) {
    upsertEnv(e, true);
  }

  const envExampleEntries = parseEnvFileText(envExample);
  for (const e of envExampleEntries) {
    upsertEnv(e, true);
  }

  if (presetEnv && typeof presetEnv === "object") {
    for (const [k, v] of Object.entries(presetEnv)) {
      upsertEnv(
        {
          key: k,
          defaultValue: String(v ?? ""),
          required: false,
          secret: isSecretEnvKey(k),
          source: "preset",
        },
        true,
      );
    }
  }

  const blueprint = matchCuratedAppBlueprint(image, appName);
  const resolvedSources = [...sourcesChecked];
  if (blueprint) {
    if (!resolvedSources.includes("curated-blueprint")) {
      resolvedSources.push("curated-blueprint");
    }
    for (const bv of blueprint.envVars || []) {
      upsertEnv(bv, false);
    }
  }

  const portSet = new Set([
    ...ociExposedPorts,
    ...composeParsed.ports,
    ...readmeHints.ports,
    ...(blueprint?.port ? [blueprint.port] : []),
  ]);
  const exposedPorts = Array.from(portSet).filter((p) => Number.isFinite(p) && p > 0);
  const detectedPort = pickDetectedPort(exposedPorts, image, presetPort || blueprint?.port);

  const volumeSet = new Set([
    ...ociVolumes,
    ...composeParsed.volumes,
    ...(blueprint?.volumes || []),
  ]);
  const volumes = Array.from(volumeSet);

  const dbMap = new Map();
  for (const d of composeParsed.databases) {
    dbMap.set(d.engine, d);
  }
  if (blueprint?.databases) {
    for (const d of blueprint.databases) {
      if (!dbMap.has(d.engine)) {
        dbMap.set(d.engine, { ...d });
      }
    }
  }
  for (const d of inferDatabaseFromEnvKeys(envMap, image)) {
    if (!dbMap.has(d.engine)) {
      dbMap.set(d.engine, d);
    } else {
      const cur = dbMap.get(d.engine);
      if (!cur.envKey && d.envKey) cur.envKey = d.envKey;
    }
  }
  if (dbMap.size === 0 && readmeHints.mentionedDbs.length > 0) {
    const isSelfDb = /^(?:library\/)?(postgres|mysql|mariadb|mongo|redis)/i.test(
      String(image || ""),
    );
    if (!isSelfDb) {
      for (const eng of readmeHints.mentionedDbs) {
        if (!dbMap.has(eng)) {
          dbMap.set(eng, {
            engine: eng,
            reason: `Mentioned in repository README`,
            envKey:
              eng === "redis" ? "REDIS_URL" : eng === "mongodb" ? "MONGODB_URI" : "DATABASE_URL",
            confidence: "medium",
            recommended: false,
          });
        }
      }
    }
  }

  const databases = Array.from(dbMap.values());

  const envVars = Array.from(envMap.values()).sort((a, b) => {
    const score = (x) =>
      x.required && !x.defaultValue ? 0 : x.required ? 1 : x.source === "preset" ? 2 : 3;
    return score(a) - score(b) || a.key.localeCompare(b.key);
  });

  const warnings = [];
  if (imageVerified === false) {
    warnings.push(
      `Image "${image}" is inferred from the repository name and is not yet verified — verify the tag before deploying.`,
    );
  }
  if (composeParsed.services.length > 2) {
    warnings.push(
      `Upstream Compose defines ${composeParsed.services.length} services (${composeParsed.services.map((s) => s.name).join(", ")}). You can attach companion databases below or deploy the full stack in Compose & Stacks.`,
    );
  }

  return {
    image,
    appName,
    detectedPort,
    exposedPorts: exposedPorts.length > 0 ? exposedPorts : [detectedPort],
    volumes,
    envVars,
    databases,
    composeServices: composeParsed.services,
    sourcesChecked: Array.from(new Set(resolvedSources)),
    warnings,
  };
}

async function fetchTextWithTimeout(url, timeoutMs = 3500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "HosteraX-DependencyAnalyzer/1.0" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithTimeout(url, timeoutMs = 3500) {
  const txt = await fetchTextWithTimeout(url, timeoutMs);
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

export function parseRegistryImageRef(imageTag) {
  if (!imageTag || typeof imageTag !== "string") return null;
  const cleaned = imageTag.trim().split("@")[0];
  if (!cleaned) return null;
  const lastColon = cleaned.lastIndexOf(":");
  const lastSlash = cleaned.lastIndexOf("/");
  let repoPart = cleaned;
  let tag = "latest";
  if (lastColon > lastSlash) {
    repoPart = cleaned.slice(0, lastColon);
    tag = cleaned.slice(lastColon + 1) || "latest";
  }

  let registry = "registry-1.docker.io";
  let repo = repoPart;
  const segs = repoPart.split("/");
  if (segs[0].includes(".") || segs[0].includes(":") || segs[0] === "localhost") {
    registry = segs[0].toLowerCase();
    repo = segs.slice(1).join("/");
    if (registry === "docker.io" || registry === "index.docker.io") {
      registry = "registry-1.docker.io";
    }
  }
  if (registry === "registry-1.docker.io" && !repo.includes("/")) {
    repo = `library/${repo}`;
  }
  if (!repo) return null;
  return { registry, repo, tag };
}

function parseOciConfigObject(cfg, result) {
  if (!cfg || typeof cfg !== "object") return result;
  if (cfg.ExposedPorts) {
    for (const pr of Object.keys(cfg.ExposedPorts)) {
      const m = pr.match(/^(\d+)/);
      if (m) {
        const port = parseInt(m[1], 10);
        if (!result.exposedPorts.includes(port)) result.exposedPorts.push(port);
      }
    }
  }
  if (cfg.Volumes) {
    for (const v of Object.keys(cfg.Volumes)) {
      if (!result.volumes.includes(v)) result.volumes.push(v);
    }
  }
  if (Array.isArray(cfg.Env)) result.env = cfg.Env;
  if (cfg.Labels && typeof cfg.Labels === "object") result.labels = cfg.Labels;
  return result;
}

export async function fetchRemoteOciConfig(imageTag, fetchFn = fetch, timeoutMs = 4000) {
  const result = { exposedPorts: [], volumes: [], env: [], labels: {} };
  const parsed = parseRegistryImageRef(imageTag);
  if (!parsed) return result;
  if (parsed.registry !== "registry-1.docker.io" && parsed.registry !== "ghcr.io") {
    return result;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let token = "";
    const tokenUrl =
      parsed.registry === "ghcr.io"
        ? `https://ghcr.io/token?service=ghcr.io&scope=repository:${encodeURIComponent(parsed.repo)}:pull`
        : `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${encodeURIComponent(parsed.repo)}:pull`;
    const tokRes = await fetchFn(tokenUrl, {
      signal: ctrl.signal,
      headers: { "User-Agent": "HosteraX-DependencyAnalyzer/1.0" },
    });
    if (tokRes.ok) {
      const tokJson = await tokRes.json();
      token = tokJson?.token || tokJson?.access_token || "";
    }

    const base = `https://${parsed.registry}/v2/${parsed.repo}`;
    const acceptManifest = [
      "application/vnd.docker.distribution.manifest.v2+json",
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.docker.distribution.manifest.list.v2+json",
      "application/vnd.oci.image.index.v1+json",
    ].join(", ");
    const headers = {
      Accept: acceptManifest,
      "User-Agent": "HosteraX-DependencyAnalyzer/1.0",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const manRes = await fetchFn(`${base}/manifests/${encodeURIComponent(parsed.tag)}`, {
      signal: ctrl.signal,
      headers,
    });
    if (!manRes.ok) return result;
    let manifest = await manRes.json();

    if (Array.isArray(manifest?.manifests) && manifest.manifests.length > 0) {
      const preferred =
        manifest.manifests.find(
          (m) => m.platform?.os === "linux" && m.platform?.architecture === "amd64",
        ) ||
        manifest.manifests.find(
          (m) => m.platform?.os === "linux" && m.platform?.architecture !== "unknown",
        ) ||
        manifest.manifests[0];
      if (preferred?.digest) {
        const subRes = await fetchFn(`${base}/manifests/${preferred.digest}`, {
          signal: ctrl.signal,
          headers,
        });
        if (subRes.ok) {
          manifest = await subRes.json();
        }
      }
    }

    const configDigest = manifest?.config?.digest;
    if (!configDigest) return result;

    const blobRes = await fetchFn(`${base}/blobs/${configDigest}`, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "HosteraX-DependencyAnalyzer/1.0",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!blobRes.ok) return result;
    const blob = await blobRes.json();
    return parseOciConfigObject(blob?.config || blob?.Config || {}, result);
  } catch {
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export async function inspectOciImageMetadata(imageTag, dockerCli) {
  const result = { exposedPorts: [], volumes: [], env: [], labels: {} };
  if (!imageTag || !isSafeImageRef(imageTag)) return result;

  if (typeof dockerCli === "function") {
    try {
      let insp = await dockerCli(["image", "inspect", imageTag], 4500);
      if (insp.status !== 0) {
        insp = await dockerCli(["manifest", "inspect", imageTag], 5000);
      }
      if (insp.stdout) {
        const raw = JSON.parse(insp.stdout.trim());
        const data = Array.isArray(raw) ? raw[0] : raw;
        parseOciConfigObject(data?.Config || data?.config || data || {}, result);
      }
    } catch {}
  }

  if (
    result.exposedPorts.length === 0 &&
    result.volumes.length === 0 &&
    result.env.length === 0 &&
    Object.keys(result.labels).length === 0
  ) {
    return await fetchRemoteOciConfig(imageTag);
  }

  return result;
}

export async function analyzeImageDependenciesLive(
  {
    image,
    appName = "",
    sourceUrl = "",
    website = "",
    presetEnv = {},
    presetPort,
    imageVerified = true,
  },
  { dockerCli },
) {
  const sourcesChecked = [];
  if (presetEnv && Object.keys(presetEnv).length > 0) {
    sourcesChecked.push("curated-catalog");
  }

  const ociConfig = await inspectOciImageMetadata(image, dockerCli);
  if (
    ociConfig.exposedPorts.length > 0 ||
    ociConfig.volumes.length > 0 ||
    ociConfig.env.length > 0 ||
    Object.keys(ociConfig.labels || {}).length > 0
  ) {
    sourcesChecked.push("oci-image");
  }

  const labelRepoUrl =
    ociConfig.labels?.["org.opencontainers.image.source"] ||
    ociConfig.labels?.["org.label-schema.vcs-url"] ||
    "";
  const ghRef =
    parseGithubOwnerRepo(sourceUrl) ||
    parseGithubOwnerRepo(labelRepoUrl) ||
    parseGithubOwnerRepo(website);
  const dockerHubRepo = parseDockerHubRepo(image);

  const hubPromise = dockerHubRepo
    ? fetchJsonWithTimeout(`https://hub.docker.com/v2/repositories/${dockerHubRepo}/`, 3500)
    : Promise.resolve(null);

  const composeCandidates = ghRef
    ? [
        `https://raw.githubusercontent.com/${ghRef.owner}/${ghRef.repo}/HEAD/docker-compose.yml`,
        `https://raw.githubusercontent.com/${ghRef.owner}/${ghRef.repo}/HEAD/compose.yaml`,
        `https://raw.githubusercontent.com/${ghRef.owner}/${ghRef.repo}/HEAD/compose.yml`,
      ]
    : [];
  const envCandidates = ghRef
    ? [
        `https://raw.githubusercontent.com/${ghRef.owner}/${ghRef.repo}/HEAD/.env.example`,
        `https://raw.githubusercontent.com/${ghRef.owner}/${ghRef.repo}/HEAD/.env.sample`,
      ]
    : [];

  const [hubMeta, ...rawFiles] = await Promise.all([
    hubPromise,
    ...composeCandidates.map((u) => fetchTextWithTimeout(u, 3200)),
    ...envCandidates.map((u) => fetchTextWithTimeout(u, 3200)),
  ]);

  const dockerHubReadme = hubMeta?.full_description || hubMeta?.description || "";
  if (hubMeta?.full_description) sourcesChecked.push("dockerhub-readme");

  const composeResults = rawFiles.slice(0, composeCandidates.length);
  const envResults = rawFiles.slice(composeCandidates.length);

  const composeYaml = composeResults.find((t) => t && /\bservices\s*:/i.test(t)) || "";
  if (composeYaml) sourcesChecked.push("github-compose");

  const envExample = envResults.find((t) => t && /=/.test(t)) || "";
  if (envExample) sourcesChecked.push("github-env-example");

  return analyzeDependenciesFromSources({
    image,
    appName,
    presetEnv,
    presetPort,
    imageVerified,
    ociConfig,
    dockerHubReadme,
    composeYaml,
    envExample,
    sourcesChecked,
  });
}
