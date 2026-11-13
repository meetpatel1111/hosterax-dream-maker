/**
 * HosteraX Observability & Monitoring Engine
 *
 * Provides pure, decoupled logic for:
 * 1. Prometheus exposition format generation (for Prometheus scrapers)
 * 2. Alert rule evaluation and threshold gating (CPU, RAM, Disk, SSL, Containers)
 * 3. Latency percentiles and error rate metrics aggregation
 */

export interface HostMetricsSnapshot {
  cpuPercent: number;
  memoryTotalBytes: number;
  memoryUsedBytes: number;
  memoryFreeBytes: number;
  diskTotalBytes: number;
  diskUsedBytes: number;
  diskFreeBytes: number;
  uptimeSeconds: number;
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
}

export interface ContainerMetric {
  id: string;
  name: string;
  status: "running" | "restarting" | "stopped" | "unhealthy";
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  restartCount: number;
  networkRxBytes?: number;
  networkTxBytes?: number;
}

export interface EdgeMetric {
  domain: string;
  requestsTotal: number;
  status2xx: number;
  status4xx: number;
  status5xx: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  sslDaysRemaining: number;
}

export type AlertCategory = "cpu" | "memory" | "disk" | "ssl" | "container" | "edge";
export type AlertSeverity = "warning" | "critical";

export interface AlertRule {
  id: string;
  name: string;
  category: AlertCategory;
  condition: ">" | "<";
  threshold: number;
  unit: string;
  durationSeconds: number;
  severity: AlertSeverity;
  enabled: boolean;
  description: string;
}

export interface AlertEvaluation {
  ruleId: string;
  ruleName: string;
  triggered: boolean;
  currentValue: number;
  threshold: number;
  severity: AlertSeverity;
  message: string;
  triggeredAt?: number;
}

/**
 * Standard pre-configured alert rules for production HosteraX nodes
 */
export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    id: "rule-cpu-critical",
    name: "Node CPU Exhaustion",
    category: "cpu",
    condition: ">",
    threshold: 85,
    unit: "%",
    durationSeconds: 300,
    severity: "critical",
    enabled: true,
    description: "Triggers when host CPU utilization remains above 85% for over 5 minutes.",
  },
  {
    id: "rule-mem-critical",
    name: "Node Memory OOM Risk",
    category: "memory",
    condition: ">",
    threshold: 90,
    unit: "%",
    durationSeconds: 180,
    severity: "critical",
    enabled: true,
    description: "Triggers when host memory allocation exceeds 90%, risking system OOM killer.",
  },
  {
    id: "rule-disk-low",
    name: "Disk Free Space Warning",
    category: "disk",
    condition: "<",
    threshold: 15,
    unit: "% free",
    durationSeconds: 60,
    severity: "warning",
    enabled: true,
    description: "Triggers when storage volume free space drops below 15%.",
  },
  {
    id: "rule-ssl-expiry",
    name: "Edge SSL Certificate Expiry",
    category: "ssl",
    condition: "<",
    threshold: 14,
    unit: "days",
    durationSeconds: 60,
    severity: "warning",
    enabled: true,
    description:
      "Triggers when any domain TLS certificate expires in under 14 days without renewal.",
  },
  {
    id: "rule-container-crashloop",
    name: "Container CrashLoop / Restarts",
    category: "container",
    condition: ">",
    threshold: 3,
    unit: "restarts",
    durationSeconds: 60,
    severity: "critical",
    enabled: true,
    description: "Triggers when an application container restarts more than 3 times.",
  },
  {
    id: "rule-edge-error-rate",
    name: "Edge HTTP 5xx Error Rate Spike",
    category: "edge",
    condition: ">",
    threshold: 5,
    unit: "% errors",
    durationSeconds: 120,
    severity: "warning",
    enabled: true,
    description: "Triggers when 5xx HTTP response rate across edge gateways exceeds 5%.",
  },
];

/**
 * Evaluates an alert rule against current snapshot metrics
 */
export function evaluateAlertRule(
  rule: AlertRule,
  metrics: {
    host: HostMetricsSnapshot;
    containers?: ContainerMetric[];
    edge?: EdgeMetric[];
  },
): AlertEvaluation {
  if (!rule.enabled) {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      triggered: false,
      currentValue: 0,
      threshold: rule.threshold,
      severity: rule.severity,
      message: "Rule is disabled",
    };
  }

  let currentValue = 0;
  let targetDesc = "Host node";

  switch (rule.category) {
    case "cpu":
      currentValue = rule.threshold > 1 ? rule.threshold : 0;
      currentValue = metrics.host.cpuPercent;
      break;

    case "memory": {
      const total = metrics.host.memoryTotalBytes || 1;
      currentValue = Math.round((metrics.host.memoryUsedBytes / total) * 100);
      break;
    }

    case "disk": {
      const total = metrics.host.diskTotalBytes || 1;
      const freePercent = Math.round((metrics.host.diskFreeBytes / total) * 100);
      currentValue = freePercent;
      break;
    }

    case "ssl": {
      if (metrics.edge && metrics.edge.length > 0) {
        // Find minimum days remaining across all domains
        const minDays = Math.min(...metrics.edge.map((e) => e.sslDaysRemaining));
        currentValue = Number.isFinite(minDays) ? minDays : 365;
        const targetDomain = metrics.edge.find((e) => e.sslDaysRemaining === minDays)?.domain;
        if (targetDomain) targetDesc = targetDomain;
      } else {
        currentValue = 90;
      }
      break;
    }

    case "container": {
      if (metrics.containers && metrics.containers.length > 0) {
        // Find max restarts across containers
        const maxRestarts = Math.max(...metrics.containers.map((c) => c.restartCount));
        currentValue = Number.isFinite(maxRestarts) ? maxRestarts : 0;
        const targetContainer = metrics.containers.find(
          (c) => c.restartCount === maxRestarts,
        )?.name;
        if (targetContainer) targetDesc = targetContainer;
      } else {
        currentValue = 0;
      }
      break;
    }

    case "edge": {
      if (metrics.edge && metrics.edge.length > 0) {
        const totalReq = metrics.edge.reduce((acc, e) => acc + e.requestsTotal, 0);
        const total5xx = metrics.edge.reduce((acc, e) => acc + e.status5xx, 0);
        currentValue = totalReq > 0 ? Math.round((total5xx / totalReq) * 100) : 0;
      } else {
        currentValue = 0;
      }
      break;
    }
  }

  const triggered =
    rule.condition === ">" ? currentValue > rule.threshold : currentValue < rule.threshold;

  const message = triggered
    ? `${rule.name}: ${targetDesc} is at ${currentValue}${rule.unit} (${rule.condition} threshold of ${rule.threshold}${rule.unit})`
    : `${rule.name}: ${targetDesc} within bounds at ${currentValue}${rule.unit}`;

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    triggered,
    currentValue,
    threshold: rule.threshold,
    severity: rule.severity,
    message,
    triggeredAt: triggered ? Date.now() : undefined,
  };
}

/**
 * Calculates a specific percentile from an array of numeric values
 */
export function calculatePercentile(values: number[], percentile: number): number {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

/**
 * Calculates error percentage from 2xx, 4xx, 5xx buckets
 */
export function calculateErrorRate(
  requests2xx: number,
  requests4xx: number,
  requests5xx: number,
): { clientErrorRate: number; serverErrorRate: number; totalErrorRate: number } {
  const total = requests2xx + requests4xx + requests5xx;
  if (total <= 0) {
    return { clientErrorRate: 0, serverErrorRate: 0, totalErrorRate: 0 };
  }
  const clientErrorRate = Number(((requests4xx / total) * 100).toFixed(2));
  const serverErrorRate = Number(((requests5xx / total) * 100).toFixed(2));
  const totalErrorRate = Number((((requests4xx + requests5xx) / total) * 100).toFixed(2));
  return { clientErrorRate, serverErrorRate, totalErrorRate };
}

/**
 * Formats metrics into official Prometheus Text Exposition Format (v0.0.4)
 * RFC compliant and ready to be scraped by Prometheus, Grafana Agent, or Datadog.
 */
export function generatePrometheusMetrics(
  snapshot: HostMetricsSnapshot,
  containers: ContainerMetric[] = [],
  edge: EdgeMetric[] = [],
): string {
  const lines: string[] = [
    "# HELP hosterax_node_cpu_utilization_percent Current host CPU utilization percentage",
    "# TYPE hosterax_node_cpu_utilization_percent gauge",
    `hosterax_node_cpu_utilization_percent ${snapshot.cpuPercent.toFixed(2)}`,
    "",
    "# HELP hosterax_node_memory_bytes Host memory metrics in bytes",
    "# TYPE hosterax_node_memory_bytes gauge",
    `hosterax_node_memory_bytes{type="total"} ${snapshot.memoryTotalBytes}`,
    `hosterax_node_memory_bytes{type="used"} ${snapshot.memoryUsedBytes}`,
    `hosterax_node_memory_bytes{type="free"} ${snapshot.memoryFreeBytes}`,
    "",
    "# HELP hosterax_node_disk_bytes Storage volume metrics in bytes",
    "# TYPE hosterax_node_disk_bytes gauge",
    `hosterax_node_disk_bytes{type="total"} ${snapshot.diskTotalBytes}`,
    `hosterax_node_disk_bytes{type="used"} ${snapshot.diskUsedBytes}`,
    `hosterax_node_disk_bytes{type="free"} ${snapshot.diskFreeBytes}`,
    "",
    "# HELP hosterax_node_load_average Node system load averages",
    "# TYPE hosterax_node_load_average gauge",
    `hosterax_node_load_average{interval="1m"} ${snapshot.loadAvg1m.toFixed(2)}`,
    `hosterax_node_load_average{interval="5m"} ${snapshot.loadAvg5m.toFixed(2)}`,
    `hosterax_node_load_average{interval="15m"} ${snapshot.loadAvg15m.toFixed(2)}`,
    "",
    "# HELP hosterax_node_uptime_seconds Total system uptime in seconds",
    "# TYPE hosterax_node_uptime_seconds counter",
    `hosterax_node_uptime_seconds ${Math.round(snapshot.uptimeSeconds)}`,
  ];

  if (containers.length > 0) {
    lines.push(
      "",
      "# HELP hosterax_container_cpu_percent Container CPU utilization percent",
      "# TYPE hosterax_container_cpu_percent gauge",
    );
    for (const c of containers) {
      lines.push(
        `hosterax_container_cpu_percent{container_id="${c.id}",container_name="${c.name}",status="${c.status}"} ${c.cpuPercent.toFixed(2)}`,
      );
    }

    lines.push(
      "",
      "# HELP hosterax_container_memory_bytes Container resident memory usage in bytes",
      "# TYPE hosterax_container_memory_bytes gauge",
    );
    for (const c of containers) {
      lines.push(
        `hosterax_container_memory_bytes{container_id="${c.id}",container_name="${c.name}"} ${c.memoryBytes}`,
      );
    }

    lines.push(
      "",
      "# HELP hosterax_container_restart_count Cumulative restarts per container",
      "# TYPE hosterax_container_restart_count counter",
    );
    for (const c of containers) {
      lines.push(
        `hosterax_container_restart_count{container_id="${c.id}",container_name="${c.name}"} ${c.restartCount}`,
      );
    }
  }

  if (edge.length > 0) {
    lines.push(
      "",
      "# HELP hosterax_edge_requests_total Total HTTP requests routed through edge gateway",
      "# TYPE hosterax_edge_requests_total counter",
    );
    for (const e of edge) {
      lines.push(`hosterax_edge_requests_total{domain="${e.domain}",status="2xx"} ${e.status2xx}`);
      lines.push(`hosterax_edge_requests_total{domain="${e.domain}",status="4xx"} ${e.status4xx}`);
      lines.push(`hosterax_edge_requests_total{domain="${e.domain}",status="5xx"} ${e.status5xx}`);
    }

    lines.push(
      "",
      "# HELP hosterax_edge_latency_milliseconds Edge request duration percentiles",
      "# TYPE hosterax_edge_latency_milliseconds gauge",
    );
    for (const e of edge) {
      lines.push(
        `hosterax_edge_latency_milliseconds{domain="${e.domain}",quantile="0.50"} ${e.latencyP50Ms}`,
      );
      lines.push(
        `hosterax_edge_latency_milliseconds{domain="${e.domain}",quantile="0.95"} ${e.latencyP95Ms}`,
      );
      lines.push(
        `hosterax_edge_latency_milliseconds{domain="${e.domain}",quantile="0.99"} ${e.latencyP99Ms}`,
      );
    }

    lines.push(
      "",
      "# HELP hosterax_ssl_cert_days_remaining Days remaining until TLS certificate expires",
      "# TYPE hosterax_ssl_cert_days_remaining gauge",
    );
    for (const e of edge) {
      lines.push(`hosterax_ssl_cert_days_remaining{domain="${e.domain}"} ${e.sslDaysRemaining}`);
    }
  }

  return lines.join("\n") + "\n";
}
