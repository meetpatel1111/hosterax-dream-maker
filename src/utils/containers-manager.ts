// src/utils/containers-manager.ts
// Pure utility functions and data transformations for HosteraX Container Fleet Manager

export interface ContainerPort {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type?: string;
}

export interface ContainerItem {
  Id: string;
  Names: string[];
  Image: string;
  State: "running" | "exited" | "paused" | "restarting" | string;
  Status: string;
  Ports?: ContainerPort[];
  Labels?: Record<string, string>;
  Created?: number | string;
}

export interface ContainerFleetMetrics {
  total: number;
  running: number;
  stopped: number;
  exposedPortsCount: number;
  systemCount: number;
  userCount: number;
}

/**
 * Strips leading slashes from container names for display
 */
export function formatContainerName(rawNames?: string[]): string {
  if (!rawNames || rawNames.length === 0) return "unnamed-container";
  const name = rawNames[0] || "";
  return name.replace(/^\//, "");
}

/**
 * Shortens 64-char container ID to standard 12-char hash
 */
export function formatShortId(id?: string): string {
  if (!id) return "";
  return id.replace(/^sha256:/, "").slice(0, 12);
}

/**
 * Extracts and formats all published port mappings for display and links
 */
export function formatPortMappings(ports?: ContainerPort[]): Array<{
  hostPort: number;
  containerPort: number;
  protocol: string;
  url: string;
}> {
  if (!ports || !Array.isArray(ports)) return [];
  const result: Array<{
    hostPort: number;
    containerPort: number;
    protocol: string;
    url: string;
  }> = [];

  for (const p of ports) {
    if (p.PublicPort) {
      result.push({
        hostPort: p.PublicPort,
        containerPort: p.PrivatePort,
        protocol: p.Type || "tcp",
        url: `http://localhost:${p.PublicPort}`,
      });
    }
  }
  return result;
}

/**
 * Determines whether a container is a HosteraX core system container
 */
export function isSystemContainer(name: string): boolean {
  const clean = name.toLowerCase().replace(/^\//, "");
  return (
    clean.startsWith("hx_") ||
    clean === "hosterax_edge" ||
    clean === "hx_edge" ||
    clean === "hx_engine" ||
    clean.includes("caddy")
  );
}

/**
 * Detects if a container belongs to a HosteraX managed Project.
 * For example: "hx_demo_app" -> "demo-app", or from Docker labels.
 */
export function detectProjectAssociation(
  container: ContainerItem,
  knownProjectSlugs: string[] = [],
): string | null {
  if (container.Labels?.["hosterax.project"]) {
    return container.Labels["hosterax.project"];
  }
  if (container.Labels?.["com.docker.compose.project"]) {
    return container.Labels["com.docker.compose.project"];
  }

  const rawName = formatContainerName(container.Names).toLowerCase();
  if (isSystemContainer(rawName) && rawName !== "hx_demo_app") return null;

  for (const slug of knownProjectSlugs) {
    const cleanSlug = slug.toLowerCase();
    const normalized = cleanSlug.replace(/[^a-z0-9]/g, "_");
    if (
      rawName === cleanSlug ||
      rawName === `hx_${normalized}` ||
      rawName === normalized ||
      rawName.startsWith(`hx_${normalized}_`)
    ) {
      return slug;
    }
  }

  if (rawName.startsWith("hx_") && rawName !== "hx_edge" && rawName !== "hx_engine") {
    return rawName.slice(3).replace(/_/g, "-");
  }

  return null;
}

/**
 * Calculates aggregate health and counts for the container fleet
 */
export function calculateContainerFleetMetrics(containers: ContainerItem[]): ContainerFleetMetrics {
  let running = 0;
  let stopped = 0;
  let exposedPortsCount = 0;
  let systemCount = 0;
  let userCount = 0;

  for (const c of containers) {
    const isRunning = String(c.State).toLowerCase() === "running";
    if (isRunning) running++;
    else stopped++;

    const name = formatContainerName(c.Names);
    if (isSystemContainer(name)) systemCount++;
    else userCount++;

    if (c.Ports && Array.isArray(c.Ports)) {
      exposedPortsCount += c.Ports.filter((p) => Boolean(p.PublicPort)).length;
    }
  }

  return {
    total: containers.length,
    running,
    stopped,
    exposedPortsCount,
    systemCount,
    userCount,
  };
}

/**
 * Filters containers by text search and status category
 */
export function filterContainers(
  containers: ContainerItem[],
  query: string,
  statusFilter: "all" | "running" | "stopped" | "system",
): ContainerItem[] {
  const q = query.trim().toLowerCase();

  return containers.filter((c) => {
    const name = formatContainerName(c.Names).toLowerCase();
    const image = (c.Image || "").toLowerCase();
    const id = (c.Id || "").toLowerCase();
    const status = (c.Status || "").toLowerCase();
    const isRunning = String(c.State).toLowerCase() === "running";
    const isSys = isSystemContainer(name);

    // Status filter
    if (statusFilter === "running" && !isRunning) return false;
    if (statusFilter === "stopped" && isRunning) return false;
    if (statusFilter === "system" && !isSys) return false;

    // Search query
    if (!q) return true;
    return (
      name.includes(q) ||
      image.includes(q) ||
      id.includes(q) ||
      status.includes(q) ||
      (c.Ports || []).some((p) => String(p.PublicPort || "").includes(q))
    );
  });
}

/**
 * Parses raw ENV array (KEY=VALUE strings) into key-value map
 */
export function parseContainerEnv(envList?: string[]): Record<string, string> {
  if (!envList || !Array.isArray(envList)) return {};
  const map: Record<string, string> = {};
  for (const item of envList) {
    const idx = item.indexOf("=");
    if (idx !== -1) {
      map[item.slice(0, idx)] = item.slice(idx + 1);
    } else {
      map[item] = "";
    }
  }
  return map;
}

/**
 * Returns Tailwind badge colors for container states
 */
export function getContainerBadgeColor(state?: string): {
  badgeClass: string;
  dotClass: string;
  label: string;
} {
  const s = (state || "").toLowerCase();
  if (s === "running") {
    return {
      badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      dotClass: "bg-emerald-500",
      label: "Running",
    };
  }
  if (s === "exited") {
    return {
      badgeClass: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
      dotClass: "bg-zinc-500",
      label: "Exited",
    };
  }
  if (s === "restarting") {
    return {
      badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      dotClass: "bg-amber-500 animate-ping",
      label: "Restarting",
    };
  }
  if (s === "paused") {
    return {
      badgeClass: "bg-sky-500/10 text-sky-400 border-sky-500/20",
      dotClass: "bg-sky-500",
      label: "Paused",
    };
  }
  return {
    badgeClass: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    dotClass: "bg-rose-500",
    label: state || "Unknown",
  };
}
