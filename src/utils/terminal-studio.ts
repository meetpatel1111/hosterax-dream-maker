/**
 * Multi-Container Terminal & Live Web-Shell Studio Utilities
 */

export interface TerminalHistoryItem {
  id: string;
  containerName: string;
  command: string;
  output: string;
  exitCode: number;
  timestamp: number;
  durationMs?: number;
}

export interface TerminalSnippet {
  id: string;
  name: string;
  command: string;
  category: "diagnostics" | "database" | "network" | "edge" | "docker";
  description: string;
}

export interface TerminalTab {
  id: string;
  title: string;
  containerName: string;
  shell: "sh" | "bash" | "psql" | "redis-cli";
  active: boolean;
}

export const CURATED_TERMINAL_SNIPPETS: TerminalSnippet[] = [
  {
    id: "disk-usage",
    name: "Disk & Volume Usage",
    command: "df -h",
    category: "diagnostics",
    description: "Inspect mount points, available storage, and Docker persistent volumes.",
  },
  {
    id: "memory-free",
    name: "Host & Container Memory",
    command: "free -m || cat /proc/meminfo | head -n 10",
    category: "diagnostics",
    description: "Display total, used, and free RAM and swap allocations.",
  },
  {
    id: "top-processes",
    name: "Top Memory Consumers",
    command: "ps aux --sort=-%mem | head -n 12",
    category: "diagnostics",
    description: "Rank processes by active memory consumption.",
  },
  {
    id: "listening-ports",
    name: "Listening Ports & Sockets",
    command: "netstat -tlpn 2>/dev/null || ss -tlpn",
    category: "network",
    description: "List all active TCP listening sockets and bound port bindings.",
  },
  {
    id: "dns-resolve",
    name: "DNS Lookup Test",
    command: "nslookup localhost && cat /etc/resolv.conf",
    category: "network",
    description: "Verify container DNS resolvers and upstream nameserver entries.",
  },
  {
    id: "postgres-ping",
    name: "PostgreSQL Readiness",
    command: "pg_isready -h 127.0.0.1 2>/dev/null || echo 'pg_isready not present'",
    category: "database",
    description: "Check if the PostgreSQL daemon is accepting TCP socket connections.",
  },
  {
    id: "redis-info",
    name: "Redis Server Memory",
    command: "redis-cli INFO memory 2>/dev/null || echo 'redis-cli not present'",
    category: "database",
    description: "Display Redis peak memory, fragmented ratio, and cache stats.",
  },
  {
    id: "edge-caddy-check",
    name: "Validate Caddy Config",
    command:
      "caddy validate --config /etc/caddy/Caddyfile 2>/dev/null || cat /etc/caddy/Caddyfile 2>/dev/null || echo 'Caddyfile check'",
    category: "edge",
    description: "Check syntax and SSL directives in the edge Caddy reverse-proxy config.",
  },
  {
    id: "docker-env",
    name: "Container Environment",
    command: "env | sort | head -n 25",
    category: "docker",
    description: "List injected environment variables and container configuration flags.",
  },
];

/**
 * Categorizes a container by image name or container name
 */
export function categorizeContainer(image = "", name = ""): "database" | "edge" | "app" | "system" {
  const lowerImg = image.toLowerCase();
  const lowerName = name.toLowerCase();

  if (
    lowerImg.includes("postgres") ||
    lowerImg.includes("mysql") ||
    lowerImg.includes("mariadb") ||
    lowerImg.includes("mongo") ||
    lowerImg.includes("redis") ||
    lowerName.includes("db") ||
    lowerName.includes("postgres") ||
    lowerName.includes("redis")
  ) {
    return "database";
  }

  if (
    lowerImg.includes("caddy") ||
    lowerImg.includes("nginx") ||
    lowerImg.includes("openresty") ||
    lowerImg.includes("traefik") ||
    lowerName.includes("edge") ||
    lowerName.includes("proxy")
  ) {
    return "edge";
  }

  if (
    lowerName.includes("hosterax") ||
    lowerName.includes("engine") ||
    lowerName.includes("system")
  ) {
    return "system";
  }

  return "app";
}

/**
 * Strips ANSI terminal escape codes for plain-text formatting
 */
export function stripAnsiCodes(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Filters command execution history by search term
 */
export function filterTerminalHistory(
  history: TerminalHistoryItem[],
  query: string,
): TerminalHistoryItem[] {
  if (!query || !query.trim()) return history;
  const q = query.toLowerCase().trim();
  return history.filter(
    (h) =>
      h.command.toLowerCase().includes(q) ||
      h.containerName.toLowerCase().includes(q) ||
      h.output.toLowerCase().includes(q),
  );
}

/**
 * Formats audit history into standard CSV format for compliance export
 */
export function formatAuditCsv(history: TerminalHistoryItem[]): string {
  const headers = ["Timestamp", "Container", "Command", "ExitCode", "OutputSnippet"];
  const rows = history.map((item) => {
    const timestampStr = new Date(item.timestamp).toISOString();
    const cleanOutput = stripAnsiCodes(item.output)
      .replace(/[\r\n]+/g, " ")
      .substring(0, 100);
    const escapedCmd = item.command.replace(/"/g, '""');
    const escapedOutput = cleanOutput.replace(/"/g, '""');
    return `"${timestampStr}","${item.containerName}","${escapedCmd}",${item.exitCode},"${escapedOutput}"`;
  });
  return [headers.join(","), ...rows].join("\n");
}

/**
 * Formats audit history into structured JSON
 */
export function formatAuditJson(history: TerminalHistoryItem[]): string {
  return JSON.stringify(
    history.map((h) => ({
      ...h,
      outputClean: stripAnsiCodes(h.output),
    })),
    null,
    2,
  );
}
