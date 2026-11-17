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
 * Coolify-compatible Magic Compose Variables Engine:
 * Supports ${SERVICE_PASSWORD_*}, ${SERVICE_PASSWORD_64_*}, ${SERVICE_BASE64_*},
 * ${SERVICE_BASE64_64_*}, ${SERVICE_USER_*}, ${SERVICE_FQDN_*}, and ${SERVICE_URL_*}.
 */
export type MagicVariableKind =
  "password" | "password64" | "base64" | "base64_64" | "user" | "fqdn" | "url";

export interface MagicVariableDescriptor {
  name: string;
  kind: MagicVariableKind;
  services: string[];
  targetService?: string;
  targetPort?: number;
}

export interface StackDeploymentServicePlan {
  projectName: string;
  serviceName: string;
  image: string;
  port: number;
  healthPath: string;
  env: Record<string, string>;
  publicDomain?: string;
  customDomainToBind?: string;
  cpuLimit: number | null;
  memoryMbLimit: number | null;
  dependsOn: string[];
  orderIndex: number;
}

const MAGIC_VAR_RE =
  /\$\{(SERVICE_(?:PASSWORD(?:_64)?|BASE64(?:_64)?|USER|FQDN|URL)_[A-Za-z0-9_]+)(?::-[^}]*)?\}|\$(SERVICE_(?:PASSWORD(?:_64)?|BASE64(?:_64)?|USER|FQDN|URL)_[A-Za-z0-9_]+)/g;

function classifyMagicVar(varName: string): {
  kind: MagicVariableKind;
  token: string;
  targetPort?: number;
} {
  if (varName.startsWith("SERVICE_PASSWORD_64_")) {
    return { kind: "password64", token: varName.slice("SERVICE_PASSWORD_64_".length) };
  }
  if (varName.startsWith("SERVICE_PASSWORD_")) {
    return { kind: "password", token: varName.slice("SERVICE_PASSWORD_".length) };
  }
  if (varName.startsWith("SERVICE_BASE64_64_")) {
    return { kind: "base64_64", token: varName.slice("SERVICE_BASE64_64_".length) };
  }
  if (varName.startsWith("SERVICE_BASE64_")) {
    return { kind: "base64", token: varName.slice("SERVICE_BASE64_".length) };
  }
  if (varName.startsWith("SERVICE_USER_")) {
    return { kind: "user", token: varName.slice("SERVICE_USER_".length) };
  }
  const isUrl = varName.startsWith("SERVICE_URL_");
  const rawSuffix = isUrl
    ? varName.slice("SERVICE_URL_".length)
    : varName.slice("SERVICE_FQDN_".length);
  const portMatch = rawSuffix.match(/^(.*)_(\d{2,5})$/);
  return {
    kind: isUrl ? "url" : "fqdn",
    token: portMatch ? portMatch[1] : rawSuffix,
    targetPort: portMatch ? Number(portMatch[2]) : undefined,
  };
}

function defaultRandomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBase64Url(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function formatServiceHost(
  stackName: string,
  serviceName: string,
  magicHostFormat?: string,
): string {
  const slug = `${stackName}-${serviceName}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (magicHostFormat && magicHostFormat.includes("{name}")) {
    return magicHostFormat.replace(/\{name\}/g, slug || "service");
  }
  return `${slug || "service"}.127-0-0-1.sslip.io`;
}

export function extractMagicVariables(stack: ComposeStack): MagicVariableDescriptor[] {
  const map = new Map<string, MagicVariableDescriptor>();

  const scanString = (text: string | undefined, serviceName: string) => {
    if (!text) return;
    MAGIC_VAR_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MAGIC_VAR_RE.exec(text)) !== null) {
      const name = match[1] || match[2];
      if (!name) continue;
      let existing = map.get(name);
      if (!existing) {
        const meta = classifyMagicVar(name);
        const matchedSvc =
          meta.kind === "fqdn" || meta.kind === "url"
            ? stack.services.find(
                (s) =>
                  s.name.toLowerCase().replace(/[^a-z0-9]/g, "") ===
                  meta.token.toLowerCase().replace(/[^a-z0-9]/g, ""),
              )?.name || meta.token.toLowerCase()
            : undefined;
        existing = {
          name,
          kind: meta.kind,
          services: [],
          targetService: matchedSvc,
          targetPort: meta.targetPort,
        };
        map.set(name, existing);
      }
      if (!existing.services.includes(serviceName)) {
        existing.services.push(serviceName);
      }
    }
  };

  for (const svc of stack.services) {
    for (const row of svc.env) {
      scanString(row.value, svc.name);
    }
    scanString(svc.command, svc.name);
    scanString(svc.publicDomain, svc.name);
  }

  return Array.from(map.values());
}

export function generateMagicVariableValue(
  varName: string,
  stack: ComposeStack,
  options?: {
    magicHostFormat?: string;
    randomHex?: (bytes: number) => string;
  },
): string {
  const meta = classifyMagicVar(varName);
  const randHex = options?.randomHex || defaultRandomHex;

  switch (meta.kind) {
    case "password":
      return randHex(16); // 32 hex chars
    case "password64":
      return randHex(32); // 64 hex chars
    case "base64":
      return hexToBase64Url(randHex(32));
    case "base64_64":
      return hexToBase64Url(randHex(64));
    case "user": {
      const cleanToken = meta.token
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/^_+|_+$/g, "");
      return cleanToken ? `${cleanToken}_user`.slice(0, 24) : "app_user";
    }
    case "fqdn":
    case "url": {
      const svc = stack.services.find(
        (s) =>
          s.name.toLowerCase().replace(/[^a-z0-9]/g, "") ===
          meta.token.toLowerCase().replace(/[^a-z0-9]/g, ""),
      );
      const explicitDomain =
        svc?.publicDomain && !svc.publicDomain.endsWith(".localhost")
          ? svc.publicDomain.trim()
          : "";
      const host =
        explicitDomain ||
        formatServiceHost(stack.name, svc?.name || meta.token, options?.magicHostFormat);
      const scheme =
        host.endsWith(".127-0-0-1.sslip.io") || host.includes("localhost") ? "http" : "https";
      const portSuffix = meta.targetPort ? `:${meta.targetPort}` : "";
      return meta.kind === "url" ? `${scheme}://${host}${portSuffix}` : host;
    }
  }
}

export function resolveStackMagicVariables(
  stack: ComposeStack,
  options?: {
    magicHostFormat?: string;
    overrides?: Record<string, string>;
    randomHex?: (bytes: number) => string;
  },
): {
  resolvedStack: ComposeStack;
  resolvedVars: Record<string, string>;
  descriptors: MagicVariableDescriptor[];
} {
  const descriptors = extractMagicVariables(stack);
  const resolvedVars: Record<string, string> = {};

  for (const desc of descriptors) {
    const override = options?.overrides?.[desc.name];
    if (override !== undefined && override !== "") {
      resolvedVars[desc.name] = override;
    } else {
      resolvedVars[desc.name] = generateMagicVariableValue(desc.name, stack, options);
    }
  }

  const replaceInStr = (input?: string): string | undefined => {
    if (!input) return input;
    return input.replace(MAGIC_VAR_RE, (full, bracedName, bareName) => {
      const key = bracedName || bareName;
      return key && resolvedVars[key] !== undefined ? resolvedVars[key] : full;
    });
  };

  const resolvedServices: ComposeService[] = stack.services.map((svc) => ({
    ...svc,
    publicDomain: replaceInStr(svc.publicDomain),
    command: replaceInStr(svc.command),
    env: svc.env.map((e) => ({
      key: e.key,
      value: replaceInStr(e.value) ?? "",
    })),
  }));

  return {
    resolvedStack: {
      ...stack,
      services: resolvedServices,
    },
    resolvedVars,
    descriptors,
  };
}

export function parseCpuLimit(raw?: string): number | null {
  if (!raw) return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Number(n.toFixed(2));
}

export function parseMemoryLimitMb(raw?: string): number | null {
  if (!raw) return null;
  const match = String(raw)
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(gib|gb|gi|g|mib|mb|mi|m|kib|kb|ki|k|b)?$/i);
  if (!match) return null;
  const val = Number(match[1]);
  if (!Number.isFinite(val) || val <= 0) return null;
  const unit = (match[2] || "m").toLowerCase();
  if (unit.startsWith("g")) return Math.round(val * 1024);
  if (unit.startsWith("k")) return Math.max(1, Math.round(val / 1024));
  if (unit === "b") return Math.max(1, Math.round(val / (1024 * 1024)));
  return Math.round(val);
}

/**
 * Builds an ordered deployment plan following DAG topological order with Coolify magic variables resolved.
 */
export function buildStackDeploymentPlan(
  stack: ComposeStack,
  options?: {
    magicHostFormat?: string;
    overrides?: Record<string, string>;
    randomHex?: (bytes: number) => string;
  },
): {
  plan: StackDeploymentServicePlan[];
  resolvedVars: Record<string, string>;
  descriptors: MagicVariableDescriptor[];
} {
  const { resolvedStack, resolvedVars, descriptors } = resolveStackMagicVariables(stack, options);
  const dag = detectDependencyGraph(resolvedStack);
  const orderNames =
    dag.topologicalOrder.length === resolvedStack.services.length
      ? dag.topologicalOrder
      : resolvedStack.services.map((s) => s.name);

  const byName = new Map(resolvedStack.services.map((s) => [s.name, s]));
  const stackSlug = (resolvedStack.name || "stack")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const plan: StackDeploymentServicePlan[] = [];
  orderNames.forEach((svcName, index) => {
    const svc = byName.get(svcName);
    if (!svc) return;
    const svcSlug = svc.name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const projectName = `${stackSlug}-${svcSlug}`.slice(0, 48).replace(/-+$/g, "");

    const envMap: Record<string, string> = {};
    for (const row of svc.env) {
      if (row.key.trim()) {
        envMap[row.key.trim()] = row.value;
      }
    }

    const rawDomain = (svc.publicDomain || "").trim().toLowerCase();
    const customDomainToBind =
      svc.isPublic && rawDomain && !rawDomain.endsWith(".localhost") && rawDomain.includes(".")
        ? rawDomain
        : undefined;

    plan.push({
      projectName,
      serviceName: svc.name,
      image: svc.image || "",
      port: svc.ports[0]?.container || 3000,
      healthPath: "/",
      env: envMap,
      publicDomain: svc.isPublic ? rawDomain || undefined : undefined,
      customDomainToBind,
      cpuLimit: parseCpuLimit(svc.cpuLimit),
      memoryMbLimit: parseMemoryLimitMb(svc.memoryLimit),
      dependsOn: [...svc.dependsOn],
      orderIndex: index + 1,
    });
  });

  return { plan, resolvedVars, descriptors };
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
            { key: "VITE_API_URL", value: "${SERVICE_URL_API}" },
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
            {
              key: "DATABASE_URL",
              value: "postgres://postgres:${SERVICE_PASSWORD_POSTGRES}@db:5432/app",
            },
            { key: "REDIS_URL", value: "redis://cache:6379" },
            { key: "JWT_SECRET", value: "${SERVICE_BASE64_64_JWT}" },
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
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_POSTGRES}" },
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
            {
              key: "DATABASE_URL",
              value: "postgresql://${SERVICE_USER_PG}:${SERVICE_PASSWORD_PG}@postgres:5432/app",
            },
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
            {
              key: "DATABASE_URL",
              value: "postgresql://${SERVICE_USER_PG}:${SERVICE_PASSWORD_PG}@postgres:5432/app",
            },
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
            { key: "POSTGRES_USER", value: "${SERVICE_USER_PG}" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_PG}" },
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
            {
              key: "DATABASE_URL",
              value: "postgresql://postgres:${SERVICE_PASSWORD_SAASDB}@db:5432/saas",
            },
            { key: "MEILISEARCH_HOST", value: "http://search:7700" },
            { key: "MEILI_MASTER_KEY", value: "${SERVICE_PASSWORD_MEILI}" },
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
            { key: "MEILI_MASTER_KEY", value: "${SERVICE_PASSWORD_MEILI}" },
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
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_SAASDB}" },
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
            { key: "WORDPRESS_DB_USER", value: "${SERVICE_USER_WP}" },
            { key: "WORDPRESS_DB_PASSWORD", value: "${SERVICE_PASSWORD_WP}" },
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
            { key: "MYSQL_ROOT_PASSWORD", value: "${SERVICE_PASSWORD_MYSQLROOT}" },
            { key: "MYSQL_DATABASE", value: "wordpress" },
            { key: "MYSQL_USER", value: "${SERVICE_USER_WP}" },
            { key: "MYSQL_PASSWORD", value: "${SERVICE_PASSWORD_WP}" },
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
  {
    id: "authentik-sso",
    name: "Authentik SSO & IAM",
    tagline: "Authentik server, background worker, PostgreSQL, and Redis",
    category: "Auth & Identity",
    icon: "🔐",
    stack: {
      name: "authentik-sso",
      description:
        "Self-hosted Identity Provider supporting OIDC, SAML, LDAP, and forward-auth SSO.",
      services: [
        {
          id: "svc-ak-server",
          name: "server",
          image: "ghcr.io/goauthentik/server:2024.10",
          command: "server",
          category: "backend",
          ports: [{ host: 9000, container: 9000 }],
          env: [
            { key: "AUTHENTIK_SECRET_KEY", value: "${SERVICE_BASE64_64_AUTHENTIK}" },
            { key: "AUTHENTIK_REDIS__HOST", value: "redis" },
            { key: "AUTHENTIK_POSTGRESQL__HOST", value: "postgresql" },
            { key: "AUTHENTIK_POSTGRESQL__USER", value: "authentik" },
            { key: "AUTHENTIK_POSTGRESQL__NAME", value: "authentik" },
            { key: "AUTHENTIK_POSTGRESQL__PASSWORD", value: "${SERVICE_PASSWORD_POSTGRES}" },
          ],
          volumes: [{ hostPath: "ak_media", containerPath: "/media", mode: "rw" }],
          dependsOn: ["postgresql", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "sso.localhost",
        },
        {
          id: "svc-ak-worker",
          name: "worker",
          image: "ghcr.io/goauthentik/server:2024.10",
          command: "worker",
          category: "worker",
          ports: [],
          env: [
            { key: "AUTHENTIK_SECRET_KEY", value: "${SERVICE_BASE64_64_AUTHENTIK}" },
            { key: "AUTHENTIK_REDIS__HOST", value: "redis" },
            { key: "AUTHENTIK_POSTGRESQL__HOST", value: "postgresql" },
            { key: "AUTHENTIK_POSTGRESQL__USER", value: "authentik" },
            { key: "AUTHENTIK_POSTGRESQL__NAME", value: "authentik" },
            { key: "AUTHENTIK_POSTGRESQL__PASSWORD", value: "${SERVICE_PASSWORD_POSTGRES}" },
          ],
          volumes: [{ hostPath: "ak_media", containerPath: "/media", mode: "rw" }],
          dependsOn: ["postgresql", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-ak-pg",
          name: "postgresql",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5435, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "authentik" },
            { key: "POSTGRES_DB", value: "authentik" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_POSTGRES}" },
          ],
          volumes: [
            { hostPath: "ak_pgdata", containerPath: "/var/lib/postgresql/data", mode: "rw" },
          ],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-ak-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6382, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["ak_media", "ak_pgdata"],
    },
  },
  {
    id: "plausible-analytics",
    name: "Plausible Analytics CE",
    tagline: "Privacy-first web analytics backed by ClickHouse + PostgreSQL",
    category: "Analytics",
    icon: "📉",
    stack: {
      name: "plausible-ce",
      description:
        "Cookie-free GDPR analytics combining PostgreSQL metadata storage with high-speed ClickHouse event OLAP.",
      services: [
        {
          id: "svc-pl-app",
          name: "plausible",
          image: "ghcr.io/plausible/community-edition:v2.1",
          category: "frontend",
          ports: [{ host: 8001, container: 8000 }],
          env: [
            { key: "BASE_URL", value: "${SERVICE_URL_PLAUSIBLE}" },
            { key: "SECRET_KEY_BASE", value: "${SERVICE_BASE64_64_PLAUSIBLE}" },
            {
              key: "DATABASE_URL",
              value: "postgres://postgres:${SERVICE_PASSWORD_PG}@plausible-db:5432/plausible_db",
            },
            {
              key: "CLICKHOUSE_DATABASE_URL",
              value: "http://plausible-events-db:8123/plausible_events_db",
            },
          ],
          volumes: [],
          dependsOn: ["plausible-db", "plausible-events-db"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "analytics.localhost",
        },
        {
          id: "svc-pl-pg",
          name: "plausible-db",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5436, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "postgres" },
            { key: "POSTGRES_DB", value: "plausible_db" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_PG}" },
          ],
          volumes: [{ hostPath: "pl_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-pl-ch",
          name: "plausible-events-db",
          image: "clickhouse/clickhouse-server:24-alpine",
          category: "database",
          ports: [{ host: 8123, container: 8123 }],
          env: [{ key: "CLICKHOUSE_DB", value: "plausible_events_db" }],
          volumes: [{ hostPath: "pl_ch", containerPath: "/var/lib/clickhouse", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["pl_pg", "pl_ch"],
    },
  },
  {
    id: "langfuse-llmops",
    name: "Langfuse LLM Observability",
    tagline: "Langfuse v3 web + PostgreSQL + ClickHouse + Redis + MinIO",
    category: "AI & Data",
    icon: "🔬",
    stack: {
      name: "langfuse-stack",
      description:
        "Complete LLMOps tracing, prompt management, and evals stack powered by ClickHouse and PostgreSQL.",
      services: [
        {
          id: "svc-lf-web",
          name: "langfuse-web",
          image: "langfuse/langfuse:2",
          category: "frontend",
          ports: [{ host: 3001, container: 3000 }],
          env: [
            { key: "NEXTAUTH_URL", value: "${SERVICE_URL_LANGFUSE_WEB}" },
            { key: "NEXTAUTH_SECRET", value: "${SERVICE_BASE64_64_NEXTAUTH}" },
            { key: "SALT", value: "${SERVICE_BASE64_32_SALT}" },
            { key: "ENCRYPTION_KEY", value: "${SERVICE_BASE64_32_ENC}" },
            {
              key: "DATABASE_URL",
              value: "postgresql://postgres:${SERVICE_PASSWORD_LFPG}@postgres:5432/langfuse",
            },
            { key: "CLICKHOUSE_URL", value: "http://clickhouse:8123" },
            { key: "REDIS_CONNECTION_STRING", value: "redis://redis:6379" },
          ],
          volumes: [],
          dependsOn: ["postgres", "clickhouse", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "langfuse.localhost",
        },
        {
          id: "svc-lf-pg",
          name: "postgres",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5437, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "postgres" },
            { key: "POSTGRES_DB", value: "langfuse" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_LFPG}" },
          ],
          volumes: [{ hostPath: "lf_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-lf-ch",
          name: "clickhouse",
          image: "clickhouse/clickhouse-server:24-alpine",
          category: "database",
          ports: [{ host: 8124, container: 8123 }],
          env: [{ key: "CLICKHOUSE_DB", value: "default" }],
          volumes: [{ hostPath: "lf_ch", containerPath: "/var/lib/clickhouse", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-lf-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6383, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["lf_pg", "lf_ch"],
    },
  },
  {
    id: "immich-photos",
    name: "Immich Photo Cloud",
    tagline: "Immich server + ML container + pgvector PostgreSQL + Redis",
    category: "Media & Cloud",
    icon: "📸",
    stack: {
      name: "immich-photos",
      description:
        "Self-hosted Google Photos replacement with mobile auto-upload, CLIP search, and facial clustering.",
      services: [
        {
          id: "svc-im-srv",
          name: "immich-server",
          image: "ghcr.io/immich-app/immich-server:release",
          category: "frontend",
          ports: [{ host: 2283, container: 2283 }],
          env: [
            { key: "DB_HOSTNAME", value: "database" },
            { key: "DB_USERNAME", value: "postgres" },
            { key: "DB_DATABASE_NAME", value: "immich" },
            { key: "DB_PASSWORD", value: "${SERVICE_PASSWORD_IMMICHDB}" },
            { key: "REDIS_HOSTNAME", value: "redis" },
            { key: "IMMICH_MACHINE_LEARNING_URL", value: "http://immich-machine-learning:3003" },
          ],
          volumes: [
            { hostPath: "immich_upload", containerPath: "/usr/src/app/upload", mode: "rw" },
          ],
          dependsOn: ["database", "redis", "immich-machine-learning"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "photos.localhost",
        },
        {
          id: "svc-im-ml",
          name: "immich-machine-learning",
          image: "ghcr.io/immich-app/immich-machine-learning:release",
          category: "worker",
          ports: [{ host: 3003, container: 3003 }],
          env: [],
          volumes: [{ hostPath: "immich_ml_cache", containerPath: "/cache", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-im-db",
          name: "database",
          image: "tensorchord/pgvecto-rs:pg14-v0.2.0",
          category: "database",
          ports: [{ host: 5438, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "postgres" },
            { key: "POSTGRES_DB", value: "immich" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_IMMICHDB}" },
          ],
          volumes: [
            { hostPath: "immich_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" },
          ],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-im-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6384, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["immich_upload", "immich_ml_cache", "immich_pg"],
    },
  },
  {
    id: "openwebui-ollama",
    name: "OpenWebUI + Ollama + Qdrant",
    tagline: "Private ChatGPT interface, local LLM runner, and vector knowledge store",
    category: "AI & Data",
    icon: "💬",
    stack: {
      name: "local-ai-suite",
      description:
        "Complete private AI chat + RAG workbench with OpenWebUI, Ollama inference, and Qdrant vectors.",
      services: [
        {
          id: "svc-owui",
          name: "open-webui",
          image: "ghcr.io/open-webui/open-webui:main",
          category: "frontend",
          ports: [{ host: 8081, container: 8080 }],
          env: [
            { key: "OLLAMA_BASE_URL", value: "http://ollama:11434" },
            { key: "WEBUI_SECRET_KEY", value: "${SERVICE_BASE64_64_WEBUI}" },
            { key: "QDRANT_URI", value: "http://qdrant:6333" },
          ],
          volumes: [{ hostPath: "owui_data", containerPath: "/app/backend/data", mode: "rw" }],
          dependsOn: ["ollama", "qdrant"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "chat.localhost",
        },
        {
          id: "svc-ollama",
          name: "ollama",
          image: "ollama/ollama:latest",
          category: "backend",
          ports: [{ host: 11434, container: 11434 }],
          env: [{ key: "OLLAMA_HOST", value: "0.0.0.0" }],
          volumes: [{ hostPath: "ollama_models", containerPath: "/root/.ollama", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-qdrant",
          name: "qdrant",
          image: "qdrant/qdrant:latest",
          category: "database",
          ports: [{ host: 6333, container: 6333 }],
          env: [],
          volumes: [{ hostPath: "qdrant_storage", containerPath: "/qdrant/storage", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["owui_data", "ollama_models", "qdrant_storage"],
    },
  },
  {
    id: "dify-llmops",
    name: "Dify.AI Agent Platform",
    tagline: "Dify Web + API + Worker + PostgreSQL + Redis + Qdrant",
    category: "AI & Data",
    icon: "🤖",
    stack: {
      name: "dify-platform",
      description:
        "Production-grade LLM agent workflow builder and RAG backend with vector retrieval.",
      services: [
        {
          id: "svc-dify-web",
          name: "web",
          image: "langgenius/dify-web:latest",
          category: "frontend",
          ports: [{ host: 3002, container: 3000 }],
          env: [
            { key: "CONSOLE_API_URL", value: "${SERVICE_URL_API}" },
            { key: "APP_API_URL", value: "${SERVICE_URL_API}" },
          ],
          volumes: [],
          dependsOn: ["api"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "dify.localhost",
        },
        {
          id: "svc-dify-api",
          name: "api",
          image: "langgenius/dify-api:latest",
          category: "backend",
          ports: [{ host: 5001, container: 5001 }],
          env: [
            { key: "SECRET_KEY", value: "${SERVICE_BASE64_64_DIFY}" },
            { key: "DB_HOST", value: "postgres" },
            { key: "DB_PORT", value: "5432" },
            { key: "DB_USERNAME", value: "postgres" },
            { key: "DB_PASSWORD", value: "${SERVICE_PASSWORD_DIFYPG}" },
            { key: "DB_DATABASE", value: "dify" },
            { key: "REDIS_HOST", value: "redis" },
            { key: "QDRANT_URL", value: "http://qdrant:6333" },
          ],
          volumes: [{ hostPath: "dify_storage", containerPath: "/app/api/storage", mode: "rw" }],
          dependsOn: ["postgres", "redis", "qdrant"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "dify-api.localhost",
        },
        {
          id: "svc-dify-pg",
          name: "postgres",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5439, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "postgres" },
            { key: "POSTGRES_DB", value: "dify" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_DIFYPG}" },
          ],
          volumes: [{ hostPath: "dify_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-dify-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6385, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-dify-qdrant",
          name: "qdrant",
          image: "qdrant/qdrant:latest",
          category: "database",
          ports: [{ host: 6334, container: 6333 }],
          env: [],
          volumes: [{ hostPath: "dify_qdrant", containerPath: "/qdrant/storage", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["dify_storage", "dify_pg", "dify_qdrant"],
    },
  },
  {
    id: "n8n-queue-cluster",
    name: "n8n Queue Mode Cluster",
    tagline: "n8n Main + Queue Worker + PostgreSQL 16 + Redis",
    category: "Automation",
    icon: "🔗",
    stack: {
      name: "n8n-cluster",
      description:
        "Horizontally scalable n8n automation architecture with Redis BullMQ worker execution.",
      services: [
        {
          id: "svc-n8n-main",
          name: "n8n",
          image: "docker.n8n.io/n8nio/n8n:latest",
          category: "frontend",
          ports: [{ host: 5678, container: 5678 }],
          env: [
            { key: "N8N_ENCRYPTION_KEY", value: "${SERVICE_BASE64_32_N8N}" },
            { key: "DB_TYPE", value: "postgresdb" },
            { key: "DB_POSTGRESDB_HOST", value: "postgres" },
            { key: "DB_POSTGRESDB_DATABASE", value: "n8n" },
            { key: "DB_POSTGRESDB_USER", value: "n8n" },
            { key: "DB_POSTGRESDB_PASSWORD", value: "${SERVICE_PASSWORD_N8N}" },
            { key: "EXECUTIONS_MODE", value: "queue" },
            { key: "QUEUE_BULL_REDIS_HOST", value: "redis" },
            { key: "WEBHOOK_URL", value: "${SERVICE_URL_N8N}" },
          ],
          volumes: [{ hostPath: "n8n_data", containerPath: "/home/node/.n8n", mode: "rw" }],
          dependsOn: ["postgres", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "n8n.localhost",
        },
        {
          id: "svc-n8n-worker",
          name: "n8n-worker",
          image: "docker.n8n.io/n8nio/n8n:latest",
          command: "worker",
          category: "worker",
          ports: [],
          env: [
            { key: "N8N_ENCRYPTION_KEY", value: "${SERVICE_BASE64_32_N8N}" },
            { key: "DB_TYPE", value: "postgresdb" },
            { key: "DB_POSTGRESDB_HOST", value: "postgres" },
            { key: "DB_POSTGRESDB_DATABASE", value: "n8n" },
            { key: "DB_POSTGRESDB_USER", value: "n8n" },
            { key: "DB_POSTGRESDB_PASSWORD", value: "${SERVICE_PASSWORD_N8N}" },
            { key: "EXECUTIONS_MODE", value: "queue" },
            { key: "QUEUE_BULL_REDIS_HOST", value: "redis" },
          ],
          volumes: [],
          dependsOn: ["postgres", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-n8n-pg",
          name: "postgres",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5440, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "n8n" },
            { key: "POSTGRES_DB", value: "n8n" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_N8N}" },
          ],
          volumes: [{ hostPath: "n8n_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-n8n-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6386, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["n8n_data", "n8n_pg"],
    },
  },
  {
    id: "docmost-wiki",
    name: "Docmost Knowledge Wiki",
    tagline: "Real-time collaborative wiki + PostgreSQL 16 + Redis",
    category: "Collaboration",
    icon: "📚",
    stack: {
      name: "docmost-wiki",
      description:
        "Notion-style team workspace with collaborative diagrams, spaces, and real-time sync.",
      services: [
        {
          id: "svc-dm-app",
          name: "docmost",
          image: "docmost/docmost:latest",
          category: "frontend",
          ports: [{ host: 3004, container: 3000 }],
          env: [
            { key: "APP_URL", value: "${SERVICE_URL_DOCMOST}" },
            { key: "APP_SECRET", value: "${SERVICE_BASE64_64_DOCMOST}" },
            {
              key: "DATABASE_URL",
              value: "postgresql://docmost:${SERVICE_PASSWORD_DOCMOST}@db:5432/docmost",
            },
            { key: "REDIS_URL", value: "redis://redis:6379" },
          ],
          volumes: [{ hostPath: "dm_storage", containerPath: "/app/data/storage", mode: "rw" }],
          dependsOn: ["db", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "docs.localhost",
        },
        {
          id: "svc-dm-pg",
          name: "db",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5441, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "docmost" },
            { key: "POSTGRES_DB", value: "docmost" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_DOCMOST}" },
          ],
          volumes: [{ hostPath: "dm_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-dm-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6387, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["dm_storage", "dm_pg"],
    },
  },
  {
    id: "twenty-crm",
    name: "Twenty Open-Source CRM",
    tagline: "Twenty Server + Worker + PostgreSQL 16 + Redis",
    category: "Business & CRM",
    icon: "💼",
    stack: {
      name: "twenty-crm",
      description:
        "Modern open-source Salesforce alternative with customizable objects and workflows.",
      services: [
        {
          id: "svc-tw-srv",
          name: "server",
          image: "twentycrm/twenty:latest",
          category: "frontend",
          ports: [{ host: 3005, container: 3000 }],
          env: [
            { key: "SERVER_URL", value: "${SERVICE_URL_SERVER}" },
            { key: "APP_SECRET", value: "${SERVICE_BASE64_64_TWENTY}" },
            {
              key: "PG_DATABASE_URL",
              value: "postgres://postgres:${SERVICE_PASSWORD_TWENTY}@db:5432/default",
            },
            { key: "REDIS_URL", value: "redis://redis:6379" },
          ],
          volumes: [{ hostPath: "twenty_data", containerPath: "/app/.local-storage", mode: "rw" }],
          dependsOn: ["db", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "crm.localhost",
        },
        {
          id: "svc-tw-worker",
          name: "worker",
          image: "twentycrm/twenty:latest",
          command: "yarn worker:prod",
          category: "worker",
          ports: [],
          env: [
            { key: "APP_SECRET", value: "${SERVICE_BASE64_64_TWENTY}" },
            {
              key: "PG_DATABASE_URL",
              value: "postgres://postgres:${SERVICE_PASSWORD_TWENTY}@db:5432/default",
            },
            { key: "REDIS_URL", value: "redis://redis:6379" },
          ],
          volumes: [],
          dependsOn: ["db", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-tw-pg",
          name: "db",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5442, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "postgres" },
            { key: "POSTGRES_DB", value: "default" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_TWENTY}" },
          ],
          volumes: [
            { hostPath: "twenty_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" },
          ],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-tw-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6388, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["twenty_data", "twenty_pg"],
    },
  },
  {
    id: "plane-pm",
    name: "Plane Project Management",
    tagline: "Plane Web + API + Worker + PostgreSQL + Redis + MinIO",
    category: "Collaboration",
    icon: "✈️",
    stack: {
      name: "plane-pm",
      description:
        "Self-hosted Linear & Jira alternative for engineering sprints, cycles, and roadmaps.",
      services: [
        {
          id: "svc-plane-web",
          name: "web",
          image: "makeplane/plane-frontend:stable",
          category: "frontend",
          ports: [{ host: 3006, container: 3000 }],
          env: [{ key: "NEXT_PUBLIC_API_BASE_URL", value: "${SERVICE_URL_API}" }],
          volumes: [],
          dependsOn: ["api"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "plane.localhost",
        },
        {
          id: "svc-plane-api",
          name: "api",
          image: "makeplane/plane-backend:stable",
          category: "backend",
          ports: [{ host: 8002, container: 8000 }],
          env: [
            { key: "SECRET_KEY", value: "${SERVICE_BASE64_64_PLANE}" },
            {
              key: "DATABASE_URL",
              value: "postgres://plane:${SERVICE_PASSWORD_PLANE}@plane-db:5432/plane",
            },
            { key: "REDIS_URL", value: "redis://plane-redis:6379" },
          ],
          volumes: [],
          dependsOn: ["plane-db", "plane-redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "plane-api.localhost",
        },
        {
          id: "svc-plane-pg",
          name: "plane-db",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5443, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "plane" },
            { key: "POSTGRES_DB", value: "plane" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_PLANE}" },
          ],
          volumes: [
            { hostPath: "plane_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" },
          ],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-plane-redis",
          name: "plane-redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6389, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["plane_pg"],
    },
  },
  {
    id: "directus-headless",
    name: "Directus Headless Data Studio",
    tagline: "Directus CMS + PostgreSQL 16 + Redis cache",
    category: "CMS",
    icon: "📦",
    stack: {
      name: "directus-cms",
      description:
        "Instant REST & GraphQL APIs over PostgreSQL with an extensible admin studio and flows.",
      services: [
        {
          id: "svc-dir-app",
          name: "directus",
          image: "directus/directus:11",
          category: "backend",
          ports: [{ host: 8055, container: 8055 }],
          env: [
            { key: "SECRET", value: "${SERVICE_BASE64_64_DIRECTUS}" },
            { key: "ADMIN_EMAIL", value: "admin@example.com" },
            { key: "ADMIN_PASSWORD", value: "${SERVICE_PASSWORD_ADMIN}" },
            { key: "DB_CLIENT", value: "pg" },
            { key: "DB_HOST", value: "postgres" },
            { key: "DB_PORT", value: "5432" },
            { key: "DB_DATABASE", value: "directus" },
            { key: "DB_USER", value: "directus" },
            { key: "DB_PASSWORD", value: "${SERVICE_PASSWORD_DIRECTUS}" },
            { key: "CACHE_ENABLED", value: "true" },
            { key: "CACHE_STORE", value: "redis" },
            { key: "REDIS", value: "redis://redis:6379" },
          ],
          volumes: [{ hostPath: "dir_uploads", containerPath: "/directus/uploads", mode: "rw" }],
          dependsOn: ["postgres", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "directus.localhost",
        },
        {
          id: "svc-dir-pg",
          name: "postgres",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5444, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "directus" },
            { key: "POSTGRES_DB", value: "directus" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_DIRECTUS}" },
          ],
          volumes: [{ hostPath: "dir_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-dir-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6390, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["dir_uploads", "dir_pg"],
    },
  },
  {
    id: "nocodb-stack",
    name: "NocoDB Airtable Suite",
    tagline: "NocoDB Low-Code Spreadsheet + PostgreSQL 16 + Redis",
    category: "Full Stack",
    icon: "📊",
    stack: {
      name: "nocodb-suite",
      description:
        "Production NocoDB deployment backed by dedicated PostgreSQL metadata and Redis queueing.",
      services: [
        {
          id: "svc-nc-app",
          name: "nocodb",
          image: "nocodb/nocodb:latest",
          category: "frontend",
          ports: [{ host: 8082, container: 8080 }],
          env: [
            {
              key: "NC_DB",
              value: "pg://postgres:5432?u=nocodb&p=${SERVICE_PASSWORD_NOCODB}&d=nocodb",
            },
            { key: "NC_AUTH_JWT_SECRET", value: "${SERVICE_BASE64_64_NOCO}" },
            { key: "NC_REDIS_URL", value: "redis://redis:6379" },
          ],
          volumes: [{ hostPath: "nc_data", containerPath: "/usr/app/data", mode: "rw" }],
          dependsOn: ["postgres", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "nocodb.localhost",
        },
        {
          id: "svc-nc-pg",
          name: "postgres",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5445, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "nocodb" },
            { key: "POSTGRES_DB", value: "nocodb" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_NOCODB}" },
          ],
          volumes: [{ hostPath: "nc_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-nc-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6391, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["nc_data", "nc_pg"],
    },
  },
  {
    id: "paperless-ocr",
    name: "Paperless-ngx OCR Archive",
    tagline: "Paperless-ngx + PostgreSQL 16 + Redis + Apache Tika + Gotenberg",
    category: "Productivity",
    icon: "📑",
    stack: {
      name: "paperless-ngx",
      description:
        "Document archival and full-text OCR pipeline with Office document rendering via Gotenberg.",
      services: [
        {
          id: "svc-plx-web",
          name: "webserver",
          image: "ghcr.io/paperless-ngx/paperless-ngx:latest",
          category: "frontend",
          ports: [{ host: 8003, container: 8000 }],
          env: [
            { key: "PAPERLESS_URL", value: "${SERVICE_URL_WEBSERVER}" },
            { key: "PAPERLESS_SECRET_KEY", value: "${SERVICE_BASE64_64_PAPERLESS}" },
            { key: "PAPERLESS_DBHOST", value: "db" },
            { key: "PAPERLESS_DBNAME", value: "paperless" },
            { key: "PAPERLESS_DBUSER", value: "paperless" },
            { key: "PAPERLESS_DBPASS", value: "${SERVICE_PASSWORD_PAPERLESS}" },
            { key: "PAPERLESS_REDIS", value: "redis://broker:6379" },
            { key: "PAPERLESS_TIKA_ENABLED", value: "1" },
            { key: "PAPERLESS_TIKA_ENDPOINT", value: "http://tika:9998" },
            { key: "PAPERLESS_TIKA_GOTENBERG_ENDPOINT", value: "http://gotenberg:3000" },
          ],
          volumes: [
            { hostPath: "plx_data", containerPath: "/usr/src/paperless/data", mode: "rw" },
            { hostPath: "plx_media", containerPath: "/usr/src/paperless/media", mode: "rw" },
          ],
          dependsOn: ["db", "broker", "gotenberg", "tika"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "paperless.localhost",
        },
        {
          id: "svc-plx-pg",
          name: "db",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5446, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "paperless" },
            { key: "POSTGRES_DB", value: "paperless" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_PAPERLESS}" },
          ],
          volumes: [{ hostPath: "plx_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-plx-redis",
          name: "broker",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6392, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-plx-gotenberg",
          name: "gotenberg",
          image: "docker.io/gotenberg/gotenberg:8.7",
          category: "worker",
          ports: [{ host: 3007, container: 3000 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-plx-tika",
          name: "tika",
          image: "docker.io/apache/tika:latest",
          category: "worker",
          ports: [{ host: 9998, container: 9998 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["plx_data", "plx_media", "plx_pg"],
    },
  },
  {
    id: "grafana-loki-prom",
    name: "Observability (Grafana + Prometheus + Loki)",
    tagline: "Metrics, log aggregation, and dashboards in one telemetry stack",
    category: "Monitoring",
    icon: "📈",
    stack: {
      name: "observability-stack",
      description:
        "Complete LGTM-lite observability suite pairing Prometheus scraping, Loki logs, and Grafana dashboards.",
      services: [
        {
          id: "svc-obs-graf",
          name: "grafana",
          image: "grafana/grafana:latest",
          category: "frontend",
          ports: [{ host: 3008, container: 3000 }],
          env: [
            { key: "GF_SECURITY_ADMIN_USER", value: "admin" },
            { key: "GF_SECURITY_ADMIN_PASSWORD", value: "${SERVICE_PASSWORD_GRAFANA}" },
            { key: "GF_SECURITY_ALLOW_EMBEDDING", value: "true" },
          ],
          volumes: [{ hostPath: "graf_data", containerPath: "/var/lib/grafana", mode: "rw" }],
          dependsOn: ["prometheus", "loki"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "grafana.localhost",
        },
        {
          id: "svc-obs-prom",
          name: "prometheus",
          image: "prom/prometheus:latest",
          category: "backend",
          ports: [{ host: 9090, container: 9090 }],
          env: [],
          volumes: [{ hostPath: "prom_data", containerPath: "/prometheus", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-obs-loki",
          name: "loki",
          image: "grafana/loki:3.1.0",
          category: "backend",
          ports: [{ host: 3100, container: 3100 }],
          env: [],
          volumes: [{ hostPath: "loki_data", containerPath: "/loki", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["graf_data", "prom_data", "loki_data"],
    },
  },
  {
    id: "gitea-actions",
    name: "Gitea + Postgres + Redis",
    tagline: "Self-hosted Git server with database & session cache",
    category: "DevTools",
    icon: "🍵",
    stack: {
      name: "gitea-git",
      description:
        "Fast, self-hosted GitHub alternative with pull requests, packages, and actions.",
      services: [
        {
          id: "svc-gt-app",
          name: "gitea",
          image: "gitea/gitea:latest",
          category: "frontend",
          ports: [{ host: 3009, container: 3000 }],
          env: [
            { key: "GITEA__database__DB_TYPE", value: "postgres" },
            { key: "GITEA__database__HOST", value: "db:5432" },
            { key: "GITEA__database__NAME", value: "gitea" },
            { key: "GITEA__database__USER", value: "gitea" },
            { key: "GITEA__database__PASSWD", value: "${SERVICE_PASSWORD_GITEA}" },
            { key: "GITEA__cache__ADAPTER", value: "redis" },
            { key: "GITEA__cache__HOST", value: "redis://redis:6379/0" },
          ],
          volumes: [{ hostPath: "gitea_data", containerPath: "/data", mode: "rw" }],
          dependsOn: ["db", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "git.localhost",
        },
        {
          id: "svc-gt-pg",
          name: "db",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5447, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "gitea" },
            { key: "POSTGRES_DB", value: "gitea" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_GITEA}" },
          ],
          volumes: [
            { hostPath: "gitea_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" },
          ],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-gt-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6393, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["gitea_data", "gitea_pg"],
    },
  },
  {
    id: "ghost-mysql",
    name: "Ghost Publishing + MySQL 8",
    tagline: "Ghost 5 editorial CMS with dedicated MySQL 8 database",
    category: "CMS",
    icon: "👻",
    stack: {
      name: "ghost-publishing",
      description:
        "Modern publishing, newsletter, and membership platform backed by persistent MySQL 8.",
      services: [
        {
          id: "svc-gh-app",
          name: "ghost",
          image: "ghost:5-alpine",
          category: "frontend",
          ports: [{ host: 2368, container: 2368 }],
          env: [
            { key: "url", value: "${SERVICE_URL_GHOST}" },
            { key: "database__client", value: "mysql" },
            { key: "database__connection__host", value: "mysql" },
            { key: "database__connection__user", value: "ghost" },
            { key: "database__connection__password", value: "${SERVICE_PASSWORD_GHOSTDB}" },
            { key: "database__connection__database", value: "ghost" },
          ],
          volumes: [
            { hostPath: "ghost_content", containerPath: "/var/lib/ghost/content", mode: "rw" },
          ],
          dependsOn: ["mysql"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "ghost.localhost",
        },
        {
          id: "svc-gh-mysql",
          name: "mysql",
          image: "mysql:8.0",
          category: "database",
          ports: [{ host: 3307, container: 3306 }],
          env: [
            { key: "MYSQL_ROOT_PASSWORD", value: "${SERVICE_PASSWORD_MYSQLROOT}" },
            { key: "MYSQL_DATABASE", value: "ghost" },
            { key: "MYSQL_USER", value: "ghost" },
            { key: "MYSQL_PASSWORD", value: "${SERVICE_PASSWORD_GHOSTDB}" },
          ],
          volumes: [{ hostPath: "ghost_mysql", containerPath: "/var/lib/mysql", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["ghost_content", "ghost_mysql"],
    },
  },
  {
    id: "umami-postgres",
    name: "Umami Web Analytics",
    tagline: "Fast cookieless analytics + PostgreSQL 16",
    category: "Analytics",
    icon: "📊",
    stack: {
      name: "umami-analytics",
      description: "Lightweight, privacy-preserving Google Analytics alternative.",
      services: [
        {
          id: "svc-um-app",
          name: "umami",
          image: "ghcr.io/umami-software/umami:postgresql-latest",
          category: "frontend",
          ports: [{ host: 3010, container: 3000 }],
          env: [
            {
              key: "DATABASE_URL",
              value: "postgresql://umami:${SERVICE_PASSWORD_UMAMI}@db:5432/umami",
            },
            { key: "APP_SECRET", value: "${SERVICE_BASE64_64_UMAMI}" },
          ],
          volumes: [],
          dependsOn: ["db"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "umami.localhost",
        },
        {
          id: "svc-um-pg",
          name: "db",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5448, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "umami" },
            { key: "POSTGRES_DB", value: "umami" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_UMAMI}" },
          ],
          volumes: [
            { hostPath: "umami_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" },
          ],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["umami_pg"],
    },
  },
  {
    id: "keycloak-iam",
    name: "Keycloak Identity Server",
    tagline: "Enterprise OIDC/SAML Keycloak + PostgreSQL 16",
    category: "Auth & Identity",
    icon: "🛡️",
    stack: {
      name: "keycloak-iam",
      description: "RedHat-backed IAM & Single Sign-On server backed by PostgreSQL.",
      services: [
        {
          id: "svc-kc-app",
          name: "keycloak",
          image: "quay.io/keycloak/keycloak:25.0",
          command: "start-dev",
          category: "backend",
          ports: [{ host: 8083, container: 8080 }],
          env: [
            { key: "KEYCLOAK_ADMIN", value: "admin" },
            { key: "KEYCLOAK_ADMIN_PASSWORD", value: "${SERVICE_PASSWORD_KCADMIN}" },
            { key: "KC_DB", value: "postgres" },
            { key: "KC_DB_URL", value: "jdbc:postgresql://postgres:5432/keycloak" },
            { key: "KC_DB_USERNAME", value: "keycloak" },
            { key: "KC_DB_PASSWORD", value: "${SERVICE_PASSWORD_KCDB}" },
          ],
          volumes: [],
          dependsOn: ["postgres"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "auth.localhost",
        },
        {
          id: "svc-kc-pg",
          name: "postgres",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5449, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "keycloak" },
            { key: "POSTGRES_DB", value: "keycloak" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_KCDB}" },
          ],
          volumes: [{ hostPath: "kc_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["kc_pg"],
    },
  },
  {
    id: "nextcloud-hub",
    name: "Nextcloud Cloud Hub",
    tagline: "Nextcloud + MariaDB 11 + Redis locking",
    category: "Productivity",
    icon: "☁️",
    stack: {
      name: "nextcloud-hub",
      description: "Self-hosted file sync, calendar, contacts, and team collaboration platform.",
      services: [
        {
          id: "svc-nx-app",
          name: "nextcloud",
          image: "nextcloud:29-apache",
          category: "frontend",
          ports: [{ host: 8084, container: 80 }],
          env: [
            { key: "MYSQL_HOST", value: "mariadb" },
            { key: "MYSQL_DATABASE", value: "nextcloud" },
            { key: "MYSQL_USER", value: "nextcloud" },
            { key: "MYSQL_PASSWORD", value: "${SERVICE_PASSWORD_NEXTCLOUD}" },
            { key: "REDIS_HOST", value: "redis" },
            { key: "NEXTCLOUD_ADMIN_USER", value: "admin" },
            { key: "NEXTCLOUD_ADMIN_PASSWORD", value: "${SERVICE_PASSWORD_NXADMIN}" },
          ],
          volumes: [{ hostPath: "nextcloud_html", containerPath: "/var/www/html", mode: "rw" }],
          dependsOn: ["mariadb", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "cloud.localhost",
        },
        {
          id: "svc-nx-db",
          name: "mariadb",
          image: "mariadb:11",
          category: "database",
          ports: [{ host: 3308, container: 3306 }],
          env: [
            { key: "MYSQL_ROOT_PASSWORD", value: "${SERVICE_PASSWORD_MYSQLROOT}" },
            { key: "MYSQL_DATABASE", value: "nextcloud" },
            { key: "MYSQL_USER", value: "nextcloud" },
            { key: "MYSQL_PASSWORD", value: "${SERVICE_PASSWORD_NEXTCLOUD}" },
          ],
          volumes: [{ hostPath: "nextcloud_db", containerPath: "/var/lib/mysql", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-nx-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6394, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["nextcloud_html", "nextcloud_db"],
    },
  },
  {
    id: "infisical-secrets",
    name: "Infisical Secrets Manager",
    tagline: "Infisical KMS + PostgreSQL 16 + Redis",
    category: "Auth & Identity",
    icon: "🗝️",
    stack: {
      name: "infisical-vault",
      description: "End-to-end encrypted team secrets sync & rotation platform.",
      services: [
        {
          id: "svc-inf-app",
          name: "infisical",
          image: "infisical/infisical:latest",
          category: "backend",
          ports: [{ host: 8085, container: 8080 }],
          env: [
            { key: "SITE_URL", value: "${SERVICE_URL_INFISICAL}" },
            { key: "ENCRYPTION_KEY", value: "${SERVICE_BASE64_32_INFISICAL}" },
            { key: "AUTH_SECRET", value: "${SERVICE_BASE64_64_INFISICAL}" },
            {
              key: "DB_CONNECTION_URI",
              value: "postgres://infisical:${SERVICE_PASSWORD_INFPG}@postgres:5432/infisical",
            },
            { key: "REDIS_URL", value: "redis://redis:6379" },
          ],
          volumes: [],
          dependsOn: ["postgres", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "vault.localhost",
        },
        {
          id: "svc-inf-pg",
          name: "postgres",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5450, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "infisical" },
            { key: "POSTGRES_DB", value: "infisical" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_INFPG}" },
          ],
          volumes: [{ hostPath: "inf_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-inf-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6395, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["inf_pg"],
    },
  },
  {
    id: "outline-wiki",
    name: "Outline Team Wiki",
    tagline: "Outline Knowledge Base + PostgreSQL 16 + Redis",
    category: "Collaboration",
    icon: "📝",
    stack: {
      name: "outline-wiki",
      description: "Fast collaborative knowledge base for modern engineering teams.",
      services: [
        {
          id: "svc-out-app",
          name: "outline",
          image: "docker.getoutline.com/outlinewiki/outline:latest",
          category: "frontend",
          ports: [{ host: 3011, container: 3000 }],
          env: [
            { key: "URL", value: "${SERVICE_URL_OUTLINE}" },
            { key: "SECRET_KEY", value: "${SERVICE_BASE64_64_OUTLINE}" },
            { key: "UTILS_SECRET", value: "${SERVICE_BASE64_64_UTILS}" },
            {
              key: "DATABASE_URL",
              value: "postgres://outline:${SERVICE_PASSWORD_OUTLINE}@postgres:5432/outline",
            },
            { key: "REDIS_URL", value: "redis://redis:6379" },
            { key: "FILE_STORAGE", value: "local" },
          ],
          volumes: [
            { hostPath: "outline_data", containerPath: "/var/lib/outline/data", mode: "rw" },
          ],
          dependsOn: ["postgres", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "wiki.localhost",
        },
        {
          id: "svc-out-pg",
          name: "postgres",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5451, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "outline" },
            { key: "POSTGRES_DB", value: "outline" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_OUTLINE}" },
          ],
          volumes: [
            { hostPath: "outline_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" },
          ],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-out-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6396, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["outline_data", "outline_pg"],
    },
  },
  {
    id: "chatwoot-support",
    name: "Chatwoot Customer Support",
    tagline: "Chatwoot Rails + Sidekiq Worker + PostgreSQL + Redis",
    category: "Business & CRM",
    icon: "🎧",
    stack: {
      name: "chatwoot-desk",
      description: "Open-source omnichannel customer support inbox with live chat & bots.",
      services: [
        {
          id: "svc-cw-web",
          name: "chatwoot",
          image: "chatwoot/chatwoot:latest",
          category: "frontend",
          ports: [{ host: 3012, container: 3000 }],
          env: [
            { key: "FRONTEND_URL", value: "${SERVICE_URL_CHATWOOT}" },
            { key: "SECRET_KEY_BASE", value: "${SERVICE_BASE64_64_CHATWOOT}" },
            { key: "POSTGRES_HOST", value: "postgres" },
            { key: "POSTGRES_USERNAME", value: "chatwoot" },
            { key: "POSTGRES_DATABASE", value: "chatwoot" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_CHATWOOT}" },
            { key: "REDIS_URL", value: "redis://redis:6379" },
          ],
          volumes: [{ hostPath: "cw_storage", containerPath: "/app/storage", mode: "rw" }],
          dependsOn: ["postgres", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "support.localhost",
        },
        {
          id: "svc-cw-worker",
          name: "sidekiq",
          image: "chatwoot/chatwoot:latest",
          command: "bundle exec sidekiq -C config/sidekiq.yml",
          category: "worker",
          ports: [],
          env: [
            { key: "SECRET_KEY_BASE", value: "${SERVICE_BASE64_64_CHATWOOT}" },
            { key: "POSTGRES_HOST", value: "postgres" },
            { key: "POSTGRES_USERNAME", value: "chatwoot" },
            { key: "POSTGRES_DATABASE", value: "chatwoot" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_CHATWOOT}" },
            { key: "REDIS_URL", value: "redis://redis:6379" },
          ],
          volumes: [],
          dependsOn: ["postgres", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-cw-pg",
          name: "postgres",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5452, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "chatwoot" },
            { key: "POSTGRES_DB", value: "chatwoot" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_CHATWOOT}" },
          ],
          volumes: [{ hostPath: "cw_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-cw-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6397, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["cw_storage", "cw_pg"],
    },
  },
  {
    id: "activepieces-auto",
    name: "Activepieces Automation",
    tagline: "No-code automation engine + PostgreSQL 16 + Redis",
    category: "Automation",
    icon: "🧩",
    stack: {
      name: "activepieces",
      description: "Open-source Zapier alternative with TypeScript pieces and AI triggers.",
      services: [
        {
          id: "svc-ap-app",
          name: "activepieces",
          image: "ghcr.io/activepieces/activepieces:latest",
          category: "frontend",
          ports: [{ host: 8086, container: 80 }],
          env: [
            { key: "AP_FRONTEND_URL", value: "${SERVICE_URL_ACTIVEPIECES}" },
            { key: "AP_ENCRYPTION_KEY", value: "${SERVICE_BASE64_32_AP}" },
            { key: "AP_JWT_SECRET", value: "${SERVICE_BASE64_64_APJWT}" },
            { key: "AP_POSTGRES_HOST", value: "postgres" },
            { key: "AP_POSTGRES_DATABASE", value: "activepieces" },
            { key: "AP_POSTGRES_USERNAME", value: "postgres" },
            { key: "AP_POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_APPG}" },
            { key: "AP_REDIS_HOST", value: "redis" },
          ],
          volumes: [],
          dependsOn: ["postgres", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "flows.localhost",
        },
        {
          id: "svc-ap-pg",
          name: "postgres",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5453, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "postgres" },
            { key: "POSTGRES_DB", value: "activepieces" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_APPG}" },
          ],
          volumes: [{ hostPath: "ap_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-ap-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6398, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["ap_pg"],
    },
  },
  {
    id: "windmill-dev",
    name: "Windmill Script & Workflow Engine",
    tagline: "Windmill Server + Workers + PostgreSQL 16",
    category: "Automation",
    icon: "🎡",
    stack: {
      name: "windmill-engine",
      description: "Turn Python, TypeScript, Go, and SQL scripts into internal apps and workflows.",
      services: [
        {
          id: "svc-wm-srv",
          name: "windmill-server",
          image: "ghcr.io/windmill-labs/windmill:main",
          category: "frontend",
          ports: [{ host: 8004, container: 8000 }],
          env: [
            { key: "BASE_INTERNAL_URL", value: "http://windmill-server:8000" },
            {
              key: "DATABASE_URL",
              value: "postgres://postgres:${SERVICE_PASSWORD_WM}@db:5432/windmill",
            },
            { key: "MODE", value: "server" },
          ],
          volumes: [],
          dependsOn: ["db"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "windmill.localhost",
        },
        {
          id: "svc-wm-worker",
          name: "windmill-worker",
          image: "ghcr.io/windmill-labs/windmill:main",
          category: "worker",
          ports: [],
          env: [
            {
              key: "DATABASE_URL",
              value: "postgres://postgres:${SERVICE_PASSWORD_WM}@db:5432/windmill",
            },
            { key: "MODE", value: "worker" },
          ],
          volumes: [],
          dependsOn: ["db"],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-wm-pg",
          name: "db",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5454, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "postgres" },
            { key: "POSTGRES_DB", value: "windmill" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_WM}" },
          ],
          volumes: [{ hostPath: "wm_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["wm_pg"],
    },
  },
  {
    id: "listmonk-newsletter",
    name: "Listmonk Newsletter + Postgres",
    tagline: "High-throughput mailing list manager backed by PostgreSQL",
    category: "CMS",
    icon: "✉️",
    stack: {
      name: "listmonk-mail",
      description: "Self-hosted newsletter and transactional campaign manager written in Go.",
      services: [
        {
          id: "svc-lm-app",
          name: "listmonk",
          image: "listmonk/listmonk:latest",
          category: "frontend",
          ports: [{ host: 9001, container: 9000 }],
          env: [
            { key: "LISTMONK_app__address", value: "0.0.0.0:9000" },
            { key: "LISTMONK_db__host", value: "db" },
            { key: "LISTMONK_db__port", value: "5432" },
            { key: "LISTMONK_db__user", value: "listmonk" },
            { key: "LISTMONK_db__password", value: "${SERVICE_PASSWORD_LISTMONK}" },
            { key: "LISTMONK_db__database", value: "listmonk" },
          ],
          volumes: [{ hostPath: "lm_uploads", containerPath: "/listmonk/uploads", mode: "rw" }],
          dependsOn: ["db"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "mailings.localhost",
        },
        {
          id: "svc-lm-pg",
          name: "db",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5455, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "listmonk" },
            { key: "POSTGRES_DB", value: "listmonk" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_LISTMONK}" },
          ],
          volumes: [{ hostPath: "lm_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["lm_uploads", "lm_pg"],
    },
  },
  {
    id: "turso-libsql-api",
    name: "Edge API + LibSQL (sqld) + Redis",
    tagline: "Bun/Node API connected to self-hosted Turso LibSQL edge database",
    category: "Full Stack",
    icon: "⚡",
    stack: {
      name: "edge-libsql-stack",
      description:
        "Modern edge-ready API backend paired with SQLite-compatible LibSQL server and Redis cache.",
      services: [
        {
          id: "svc-edge-api",
          name: "api",
          image: "node:22-alpine",
          category: "backend",
          ports: [{ host: 3013, container: 3000 }],
          env: [
            { key: "PORT", value: "3000" },
            { key: "LIBSQL_URL", value: "http://libsql:8080" },
            { key: "REDIS_URL", value: "redis://redis:6379" },
            { key: "JWT_SECRET", value: "${SERVICE_BASE64_64_EDGE}" },
          ],
          volumes: [],
          dependsOn: ["libsql", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "edge-api.localhost",
        },
        {
          id: "svc-edge-libsql",
          name: "libsql",
          image: "ghcr.io/tursodatabase/libsql-server:latest",
          category: "database",
          ports: [{ host: 8087, container: 8080 }],
          env: [{ key: "SQLD_NODE", value: "primary" }],
          volumes: [{ hostPath: "libsql_data", containerPath: "/var/lib/sqld", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-edge-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6399, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["libsql_data"],
    },
  },
  {
    id: "linkwarden-bookmarks",
    name: "Linkwarden Archive + Postgres",
    tagline: "Collaborative bookmark archiver with headless snapshot engine",
    category: "Productivity",
    icon: "🔖",
    stack: {
      name: "linkwarden-archive",
      description: "Save webpages, screenshots, and PDFs permanently with PostgreSQL indexing.",
      services: [
        {
          id: "svc-lw-app",
          name: "linkwarden",
          image: "ghcr.io/linkwarden/linkwarden:latest",
          category: "frontend",
          ports: [{ host: 3014, container: 3000 }],
          env: [
            { key: "NEXTAUTH_URL", value: "${SERVICE_URL_LINKWARDEN}" },
            { key: "NEXTAUTH_SECRET", value: "${SERVICE_BASE64_64_LINKWARDEN}" },
            {
              key: "DATABASE_URL",
              value: "postgresql://postgres:${SERVICE_PASSWORD_LINKWARDEN}@postgres:5432/postgres",
            },
          ],
          volumes: [{ hostPath: "lw_data", containerPath: "/data/data", mode: "rw" }],
          dependsOn: ["postgres"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "links.localhost",
        },
        {
          id: "svc-lw-pg",
          name: "postgres",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5456, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "postgres" },
            { key: "POSTGRES_DB", value: "postgres" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_LINKWARDEN}" },
          ],
          volumes: [{ hostPath: "lw_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["lw_data", "lw_pg"],
    },
  },
  {
    id: "minio-s3-suite",
    name: "MinIO S3 Storage + Console",
    tagline: "Self-hosted S3-compatible object storage with Web Console",
    category: "DevTools",
    icon: "🪣",
    stack: {
      name: "minio-object-store",
      description:
        "High-performance S3 object storage for app media, backups, and AI artifact lakes.",
      services: [
        {
          id: "svc-minio",
          name: "minio",
          image: "minio/minio:latest",
          command: 'server /data --console-address ":9001"',
          category: "database",
          ports: [
            { host: 9002, container: 9000 },
            { host: 9003, container: 9001 },
          ],
          env: [
            { key: "MINIO_ROOT_USER", value: "${SERVICE_USER_MINIO}" },
            { key: "MINIO_ROOT_PASSWORD", value: "${SERVICE_PASSWORD_MINIO}" },
          ],
          volumes: [{ hostPath: "minio_data", containerPath: "/data", mode: "rw" }],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "s3.localhost",
        },
      ],
      namedVolumes: ["minio_data"],
    },
  },
  {
    id: "medusa-commerce",
    name: "Medusa Headless Commerce",
    tagline: "Medusa v2 API + PostgreSQL 16 + Redis",
    category: "Full Stack",
    icon: "🛍️",
    stack: {
      name: "medusa-commerce",
      description: "Composable e-commerce backend with cart, checkout, and payment orchestration.",
      services: [
        {
          id: "svc-med-app",
          name: "medusa",
          image: "node:22-alpine",
          category: "backend",
          ports: [{ host: 9004, container: 9000 }],
          env: [
            {
              key: "DATABASE_URL",
              value: "postgres://medusa:${SERVICE_PASSWORD_MEDUSA}@postgres:5432/medusa",
            },
            { key: "REDIS_URL", value: "redis://redis:6379" },
            { key: "JWT_SECRET", value: "${SERVICE_BASE64_64_MEDUSAJWT}" },
            { key: "COOKIE_SECRET", value: "${SERVICE_BASE64_64_MEDUSACOOKIE}" },
          ],
          volumes: [],
          dependsOn: ["postgres", "redis"],
          restartPolicy: "unless-stopped",
          isPublic: true,
          publicDomain: "shop-api.localhost",
        },
        {
          id: "svc-med-pg",
          name: "postgres",
          image: "postgres:16-alpine",
          category: "database",
          ports: [{ host: 5457, container: 5432 }],
          env: [
            { key: "POSTGRES_USER", value: "medusa" },
            { key: "POSTGRES_DB", value: "medusa" },
            { key: "POSTGRES_PASSWORD", value: "${SERVICE_PASSWORD_MEDUSA}" },
          ],
          volumes: [
            { hostPath: "medusa_pg", containerPath: "/var/lib/postgresql/data", mode: "rw" },
          ],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
        {
          id: "svc-med-redis",
          name: "redis",
          image: "redis:7-alpine",
          category: "cache",
          ports: [{ host: 6400, container: 6379 }],
          env: [],
          volumes: [],
          dependsOn: [],
          restartPolicy: "unless-stopped",
          isPublic: false,
        },
      ],
      namedVolumes: ["medusa_pg"],
    },
  },
];
