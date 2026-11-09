import YAML from "yaml";

export type ServiceCategory = "frontend" | "backend" | "database" | "cache" | "worker" | "other";

export interface ComposePortMapping {
  host: number;
  container: number;
  protocol?: "tcp" | "udp";
}

export interface ComposeEnvVar {
  key: string;
  value: string;
}

export interface ComposeVolumeMapping {
  hostPath: string; // e.g. "pgdata" or "./data"
  containerPath: string; // e.g. "/var/lib/postgresql/data"
  mode?: "rw" | "ro";
}

export interface ComposeService {
  id: string;
  name: string;
  image?: string;
  buildContext?: string;
  dockerfilePath?: string;
  category: ServiceCategory;
  ports: ComposePortMapping[];
  env: ComposeEnvVar[];
  volumes: ComposeVolumeMapping[];
  dependsOn: string[];
  restartPolicy: "always" | "unless-stopped" | "on-failure" | "no";
  cpuLimit?: string;
  memoryLimit?: string;
  command?: string;
  isPublic?: boolean;
  publicDomain?: string;
}

export interface ComposeStack {
  version?: string;
  name: string;
  description?: string;
  services: ComposeService[];
  networks?: string[];
  namedVolumes?: string[];
}

export function detectServiceCategory(name: string, image?: string): ServiceCategory {
  const s = `${name.toLowerCase()} ${(image || "").toLowerCase()}`;
  if (
    s.includes("postgres") ||
    s.includes("mysql") ||
    s.includes("mariadb") ||
    s.includes("mongo") ||
    s.includes("cockroach") ||
    s.includes("sqlite") ||
    s.includes("supabase") ||
    s.includes("db")
  ) {
    return "database";
  }
  if (
    s.includes("redis") ||
    s.includes("memcached") ||
    s.includes("valkey") ||
    s.includes("dragonfly")
  ) {
    return "cache";
  }
  if (
    s.includes("worker") ||
    s.includes("celery") ||
    s.includes("queue") ||
    s.includes("consumer") ||
    s.includes("cron")
  ) {
    return "worker";
  }
  if (
    s.includes("front") ||
    s.includes("web") ||
    s.includes("ui") ||
    s.includes("client") ||
    s.includes("react") ||
    s.includes("next") ||
    s.includes("vue") ||
    s.includes("nuxt") ||
    s.includes("astro")
  ) {
    return "frontend";
  }
  if (
    s.includes("api") ||
    s.includes("server") ||
    s.includes("backend") ||
    s.includes("app") ||
    s.includes("fastapi") ||
    s.includes("express") ||
    s.includes("nest") ||
    s.includes("django") ||
    s.includes("fiber") ||
    s.includes("gin")
  ) {
    return "backend";
  }
  return "other";
}

/**
 * Serializes a ComposeStack model into clean Docker Compose YAML string.
 */
export function generateDockerComposeYaml(stack: ComposeStack): string {
  const composeObj: Record<string, any> = {
    services: {},
  };

  const declaredVolumes = new Set<string>(stack.namedVolumes || []);

  for (const svc of stack.services) {
    const serviceDef: Record<string, any> = {};

    if (svc.image) {
      serviceDef.image = svc.image;
    } else if (svc.buildContext) {
      serviceDef.build = {
        context: svc.buildContext,
        ...(svc.dockerfilePath ? { dockerfile: svc.dockerfilePath } : {}),
      };
    }

    if (svc.restartPolicy && svc.restartPolicy !== "no") {
      serviceDef.restart = svc.restartPolicy;
    }

    if (svc.ports && svc.ports.length > 0) {
      serviceDef.ports = svc.ports.map((p) =>
        p.protocol && p.protocol !== "tcp"
          ? `${p.host}:${p.container}/${p.protocol}`
          : `${p.host}:${p.container}`,
      );
    }

    if (svc.env && svc.env.length > 0) {
      const envMap: Record<string, string> = {};
      for (const e of svc.env) {
        if (e.key.trim()) {
          envMap[e.key.trim()] = e.value;
        }
      }
      if (Object.keys(envMap).length > 0) {
        serviceDef.environment = envMap;
      }
    }

    if (svc.volumes && svc.volumes.length > 0) {
      serviceDef.volumes = svc.volumes.map((v) => {
        // If hostPath doesn't start with . or /, it's a named volume
        if (
          !v.hostPath.startsWith(".") &&
          !v.hostPath.startsWith("/") &&
          !v.hostPath.includes("\\")
        ) {
          declaredVolumes.add(v.hostPath);
        }
        return `${v.hostPath}:${v.containerPath}${v.mode === "ro" ? ":ro" : ""}`;
      });
    }

    if (svc.dependsOn && svc.dependsOn.length > 0) {
      serviceDef.depends_on = svc.dependsOn;
    }

    if (svc.command) {
      serviceDef.command = svc.command;
    }

    if (svc.cpuLimit || svc.memoryLimit) {
      serviceDef.deploy = {
        resources: {
          limits: {
            ...(svc.cpuLimit ? { cpus: svc.cpuLimit } : {}),
            ...(svc.memoryLimit ? { memory: svc.memoryLimit } : {}),
          },
        },
      };
    }

    composeObj.services[svc.name] = serviceDef;
  }

  if (declaredVolumes.size > 0) {
    composeObj.volumes = {};
    for (const v of declaredVolumes) {
      composeObj.volumes[v] = null;
    }
  }

  return YAML.stringify(composeObj, { indent: 2 });
}

/**
 * Parses a Docker Compose YAML string into ComposeStack.
 */
export function parseDockerComposeYaml(
  yamlString: string,
  defaultName = "custom-stack",
): ComposeStack {
  let parsed: any;
  try {
    parsed = YAML.parse(yamlString);
  } catch (err: any) {
    throw new Error(`YAML Syntax Error: ${err.message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid Docker Compose format: expected a root mapping object.");
  }

  const rawServices = parsed.services || {};
  if (typeof rawServices !== "object") {
    throw new Error("Invalid Docker Compose format: 'services' must be a mapping.");
  }

  const services: ComposeService[] = [];
  let idCounter = 1;

  for (const [svcName, def] of Object.entries(rawServices)) {
    if (!def || typeof def !== "object") continue;
    const rawDef = def as Record<string, any>;

    // Parse ports
    const ports: ComposePortMapping[] = [];
    if (Array.isArray(rawDef.ports)) {
      for (const p of rawDef.ports) {
        const portStr = String(p).trim();
        const parts = portStr.split(":");
        if (parts.length === 2) {
          const host = parseInt(parts[0], 10);
          const contParts = parts[1].split("/");
          const cont = parseInt(contParts[0], 10);
          const proto = (contParts[1] === "udp" ? "udp" : "tcp") as "tcp" | "udp";
          if (!isNaN(host) && !isNaN(cont)) {
            ports.push({ host, container: cont, protocol: proto });
          }
        } else if (parts.length === 1) {
          const cont = parseInt(parts[0], 10);
          if (!isNaN(cont)) {
            ports.push({ host: cont, container: cont });
          }
        }
      }
    }

    // Parse environment
    const env: ComposeEnvVar[] = [];
    if (Array.isArray(rawDef.environment)) {
      for (const item of rawDef.environment) {
        const str = String(item);
        const eqIdx = str.indexOf("=");
        if (eqIdx !== -1) {
          env.push({ key: str.slice(0, eqIdx).trim(), value: str.slice(eqIdx + 1).trim() });
        } else {
          env.push({ key: str.trim(), value: "" });
        }
      }
    } else if (rawDef.environment && typeof rawDef.environment === "object") {
      for (const [k, v] of Object.entries(rawDef.environment)) {
        env.push({ key: k, value: String(v ?? "") });
      }
    }

    // Parse volumes
    const volumes: ComposeVolumeMapping[] = [];
    if (Array.isArray(rawDef.volumes)) {
      for (const item of rawDef.volumes) {
        const str = String(item).trim();
        const parts = str.split(":");
        if (parts.length >= 2) {
          volumes.push({
            hostPath: parts[0],
            containerPath: parts[1],
            mode: parts[2] === "ro" ? "ro" : "rw",
          });
        }
      }
    }

    // Parse depends_on
    let dependsOn: string[] = [];
    if (Array.isArray(rawDef.depends_on)) {
      dependsOn = rawDef.depends_on.map(String);
    } else if (rawDef.depends_on && typeof rawDef.depends_on === "object") {
      dependsOn = Object.keys(rawDef.depends_on);
    }

    // Build context
    let buildContext: string | undefined;
    let dockerfilePath: string | undefined;
    if (typeof rawDef.build === "string") {
      buildContext = rawDef.build;
    } else if (rawDef.build && typeof rawDef.build === "object") {
      buildContext = rawDef.build.context;
      dockerfilePath = rawDef.build.dockerfile;
    }

    const image = typeof rawDef.image === "string" ? rawDef.image : undefined;
    const category = detectServiceCategory(svcName, image);
    const restartPolicy = ["always", "unless-stopped", "on-failure", "no"].includes(rawDef.restart)
      ? rawDef.restart
      : "unless-stopped";

    // Limits
    const cpuLimit = rawDef.deploy?.resources?.limits?.cpus;
    const memoryLimit = rawDef.deploy?.resources?.limits?.memory;

    services.push({
      id: `svc-${idCounter++}-${Date.now().toString(36)}`,
      name: svcName,
      image,
      buildContext,
      dockerfilePath,
      category,
      ports,
      env,
      volumes,
      dependsOn,
      restartPolicy,
      cpuLimit: cpuLimit ? String(cpuLimit) : undefined,
      memoryLimit: memoryLimit ? String(memoryLimit) : undefined,
      command: typeof rawDef.command === "string" ? rawDef.command : undefined,
      isPublic: ports.length > 0 && (category === "frontend" || category === "backend"),
    });
  }

  const namedVolumes: string[] = [];
  if (parsed.volumes && typeof parsed.volumes === "object") {
    namedVolumes.push(...Object.keys(parsed.volumes));
  }

  return {
    version: parsed.version ? String(parsed.version) : undefined,
    name: defaultName,
    services,
    namedVolumes,
  };
}

/**
 * Validates ComposeStack and detects dependency cycles, name collisions, or invalid ports.
 */
export function validateComposeStack(stack: ComposeStack): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!stack.services || stack.services.length === 0) {
    errors.push("Stack must have at least one service defined.");
    return { valid: false, errors, warnings };
  }

  const seenNames = new Set<string>();
  const usedHostPorts = new Map<number, string>();

  for (const svc of stack.services) {
    const trimmed = svc.name.trim();
    if (!trimmed) {
      errors.push("Every service must have a non-empty name.");
      continue;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      errors.push(
        `Service name "${trimmed}" contains invalid characters (use alphanumeric, - or _).`,
      );
    }

    if (seenNames.has(trimmed)) {
      errors.push(`Duplicate service name "${trimmed}". Service names must be unique.`);
    }
    seenNames.add(trimmed);

    if (!svc.image && !svc.buildContext) {
      errors.push(`Service "${trimmed}" must specify either a container image or a build context.`);
    }

    // Validate ports
    for (const p of svc.ports) {
      if (p.host < 1 || p.host > 65535 || p.container < 1 || p.container > 65535) {
        errors.push(
          `Service "${trimmed}" has invalid port ${p.host}:${p.container} (must be 1-65535).`,
        );
      }
      if (usedHostPorts.has(p.host)) {
        errors.push(
          `Port conflict: Host port ${p.host} is bound by both "${usedHostPorts.get(p.host)}" and "${trimmed}".`,
        );
      } else {
        usedHostPorts.set(p.host, trimmed);
      }
    }
  }

  // Validate dependencies & cycle detection
  for (const svc of stack.services) {
    for (const dep of svc.dependsOn) {
      if (!seenNames.has(dep)) {
        errors.push(`Service "${svc.name}" depends on unknown service "${dep}".`);
      }
      if (dep === svc.name) {
        errors.push(`Service "${svc.name}" cannot depend on itself.`);
      }
    }
  }

  const graph = detectDependencyGraph(stack);
  if (graph.hasCycle) {
    errors.push(
      "Circular dependency detected between services. Container startup order cannot be resolved.",
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Builds dependency graph and detects circular dependencies via Tarjan/DFS.
 */
export function detectDependencyGraph(stack: ComposeStack): {
  nodes: string[];
  edges: { from: string; to: string }[];
  topologicalOrder: string[];
  hasCycle: boolean;
} {
  const nodes = stack.services.map((s) => s.name);
  const edges: { from: string; to: string }[] = [];
  const adj = new Map<string, string[]>();

  for (const name of nodes) {
    adj.set(name, []);
  }

  for (const svc of stack.services) {
    for (const dep of svc.dependsOn) {
      edges.push({ from: dep, to: svc.name });
      if (adj.has(dep)) {
        adj.get(dep)!.push(svc.name);
      }
    }
  }

  // Topological sort via Kahn's algorithm
  const inDegree = new Map<string, number>();
  for (const name of nodes) {
    inDegree.set(name, 0);
  }
  for (const edge of edges) {
    if (inDegree.has(edge.to)) {
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [name, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(name);
  }

  const topologicalOrder: string[] = [];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    topologicalOrder.push(curr);

    const neighbors = adj.get(curr) || [];
    for (const nxt of neighbors) {
      const newDeg = (inDegree.get(nxt) || 1) - 1;
      inDegree.set(nxt, newDeg);
      if (newDeg === 0) queue.push(nxt);
    }
  }

  const hasCycle = topologicalOrder.length !== nodes.length;

  return {
    nodes,
    edges,
    topologicalOrder: hasCycle ? [] : topologicalOrder,
    hasCycle,
  };
}

/**
 * Curated flagship production presets for instant 1-click loading.
 */
export const PRESET_STACKS: {
  id: string;
  name: string;
  tagline: string;
  category: string;
  icon: string;
  stack: ComposeStack;
}[] = [
  {
    id: "pern-stack",
    name: "PERN Stack",
    tagline: "PostgreSQL 16, Express API, React Web, and Redis 7 Cache",
    category: "Full Stack",
    icon: "🐘",
    stack: {
      name: "pern-production",
      description:
        "Full-stack Node.js + React web application with dedicated PostgreSQL database and Redis caching layer.",
      services: [
        {
          id: "svc-web",
          name: "web",
          image: "node:22-alpine",
          buildContext: "./client",
          category: "frontend",
          ports: [{ host: 3000, container: 3000 }],
          env: [
            { key: "NODE_ENV", value: "production" },
            { key: "VITE_API_URL", value: "http://api:4000" },
          ],
          volumes: [],
          dependsOn: ["api"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "web.localhost",
        },
        {
          id: "svc-api",
          name: "api",
          image: "node:22-alpine",
          buildContext: "./server",
          category: "backend",
          ports: [{ host: 4000, container: 4000 }],
          env: [
            { key: "NODE_ENV", value: "production" },
            { key: "PORT", value: "4000" },
            { key: "DATABASE_URL", value: "postgres://postgres:postgres@db:5432/app" },
            { key: "REDIS_URL", value: "redis://cache:6379" },
          ],
          volumes: [],
          dependsOn: ["db", "cache"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "api.localhost",
        },
        {
          id: "svc-db",
          name: "db",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5432, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "postgres" },
            { key: "POSTGRES_PASSWORD", value: "postgres" },
            { key: "POSTGRES_DB", value: "app" },
          ],
          volumes: [{ hostPath: "pgdata", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-cache",
          name: "cache",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6379, container: 6379 }],
          env: [],
          volumes: [{ hostPath: "redisdata", containerPath: "/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["pgdata", "redisdata"],
    },
  },
  {
    id: "fastapi-celery",
    name: "FastAPI + Celery + AI",
    tagline: "Python FastAPI, Celery background worker, Redis broker, and Postgres",
    category: "AI & Data",
    icon: "⚡",
    stack: {
      name: "fastapi-celery-stack",
      description:
        "Scalable asynchronous Python processing stack for machine learning, scraping, and heavy tasks.",
      services: [
        {
          id: "svc-fastapi",
          name: "fastapi",
          image: "tiangolo/uvicorn-gunicorn-fastapi:python3.11",
          buildContext: "./api",
          category: "backend",
          ports: [{ host: 8000, container: 8000 }],
          env: [
            { key: "DATABASE_URL", value: "postgresql://user:pass@postgres:5432/app" },
            { key: "CELERY_BROKER_URL", value: "redis://redis:6379/0" },
          ],
          volumes: [],
          dependsOn: ["postgres", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "fastapi.localhost",
        },
        {
          id: "svc-worker",
          name: "worker",
          image: "python:3.11-slim",
          buildContext: "./api",
          category: "worker",
          ports: [],
          env: [
            { key: "DATABASE_URL", value: "postgresql://user:pass@postgres:5432/app" },
            { key: "CELERY_BROKER_URL", value: "redis://redis:6379/0" },
          ],
          volumes: [],
          dependsOn: ["redis", "postgres"],
          restartPolicy: "unless-stopped",
          command: "celery -A tasks worker --loglevel=info",
          isPublic: false,
        },
        {
          id: "svc-postgres",
          name: "postgres",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5433, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "user" },
            { key: "POSTGRES_PASSWORD", value: "pass" },
            { key: "POSTGRES_DB", value: "app" },
          ],
          volumes: [
            { hostPath: "pgdata_py", containerPath: "/var/lib/postgresql/data", mode: "rw" },
          ],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6380, container: 6379 }],
          env: [],
          volumes: [{ hostPath: "redis_py", containerPath: "/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["pgdata_py", "redis_py"],
    },
  },
  {
    id: "saas-boilerplate",
    name: "Modern SaaS Stack",
    tagline: "Next.js 15, MeiliSearch AI vector search, PostgreSQL, and Mailhog testing",
    category: "Full Stack",
    icon: "🚀",
    stack: {
      name: "saas-production",
      description:
        "Complete modern SaaS architecture with blazing fast search indexing and transactional mail sandbox.",
      services: [
        {
          id: "svc-nextjs",
          name: "web",
          image: "node:22-alpine",
          buildContext: "./",
          category: "frontend",
          ports: [{ host: 3000, container: 3000 }],
          env: [
            { key: "DATABASE_URL", value: "postgresql://postgres:secret@db:5432/saas" },
            { key: "MEILISEARCH_HOST", value: "http://search:7700" },
            { key: "SMTP_HOST", value: "mailhog" },
            { key: "SMTP_PORT", value: "1025" },
          ],
          volumes: [],
          dependsOn: ["db", "search", "mailhog"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "saas.localhost",
        },
        {
          id: "svc-search",
          name: "search",
          image: "getmeili/meilisearch:v1.11",
          category: "backend",
          ports: [{ host: 7700, container: 7700 }],
          env: [
            { key: "MEILI_MASTER_KEY", value: "masterKeySuperSecret123" },
            { key: "MEILI_ENV", value: "production" },
          ],
          volumes: [{ hostPath: "meilidata", containerPath: "/meili_data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-db-saas",
          name: "db",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5434, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "postgres" },
            { key: "POSTGRES_PASSWORD", value: "secret" },
            { key: "POSTGRES_DB", value: "saas" },
          ],
          volumes: [{ hostPath: "saas_db", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-mailhog",
          name: "mailhog",
          image: "mailhog/mailhog:latest",
          category: "other",
          ports: [
            { host: 8025, container: 8025 },
            { host: 1025, container: 1025 },
          ],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "mail.localhost",
        },
      ],
      namedVolumes: ["meilidata", "saas_db"],
    },
  },
  {
    id: "wordpress-prod",
    name: "WordPress Production",
    tagline: "WordPress, MariaDB 11, and Redis Object Cache",
    category: "CMS",
    icon: "🌐",
    stack: {
      name: "wordpress-stack",
      description:
        "High-performance WordPress stack with persistent media storage, relational MariaDB, and Redis object cache.",
      services: [
        {
          id: "svc-wp",
          name: "wordpress",
          image: "wordpress:6-php8.2-apache",
          category: "frontend",
          ports: [{ host: 8080, container: 80 }],
          env: [
            { key: "WORDPRESS_DB_HOST", value: "mariadb:3306" },
            { key: "WORDPRESS_DB_USER", value: "wp_user" },
            { key: "WORDPRESS_DB_PASSWORD", value: "wp_pass_secure" },
            { key: "WORDPRESS_DB_NAME", value: "wordpress" },
          ],
          volumes: [{ hostPath: "wp_data", containerPath: "/var/www/html", mode: "rw" }],
          dependsOn: ["mariadb", "redis"],
          restartPolicy: "always",
          isPublic: true,
          publicDomain: "blog.localhost",
        },
        {
          id: "svc-mariadb",
          name: "mariadb",
          image: "mariadb:11",
          category: "database",
          ports: [{ host: 3306, container: 3306 }],
          env: [
            { key: "MYSQL_ROOT_PASSWORD", value: "root_pass_secure" },
            { key: "MYSQL_DATABASE", value: "wordpress" },
            { key: "MYSQL_USER", value: "wp_user" },
            { key: "MYSQL_PASSWORD", value: "wp_pass_secure" },
          ],
          volumes: [{ hostPath: "db_data", containerPath: "/var/lib/mysql", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "always",
          isPublic: false,
        },
        {
          id: "svc-wp-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6381, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "always",
          isPublic: false,
        },
      ],
      namedVolumes: ["wp_data", "db_data"],
    },
  },
];
