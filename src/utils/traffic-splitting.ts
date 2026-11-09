/**
 * Zero-Downtime Deployment Strategies, Canary Releases & Traffic Splitting Utilities
 */

export interface HealthProbeResult {
  statusCode: number;
  latencyMs: number;
  timestamp: number;
  endpoint: string;
}

export interface CanaryEvaluation {
  healthy: boolean;
  successRate: number;
  avgLatencyMs: number;
  recommendation: "promote" | "soak" | "rollback";
  details: string;
}

export interface TrafficSplitParams {
  domain: string;
  stablePort: number;
  canaryPort: number;
  canaryWeightPercent: number; // 0 to 100
  stickyCookie?: boolean;
  headerOverride?: string;
  healthCheckPath?: string;
}

export interface RolloutStrategyPreset {
  id: string;
  name: string;
  description: string;
  type: "canary" | "blue_green" | "header_routing" | "rolling";
  initialCanaryWeight: number;
  soakMinutes: number;
  autoRollbackErrorThreshold: number; // e.g. 1%
}

export const PRESET_ROLLOUT_STRATEGIES: RolloutStrategyPreset[] = [
  {
    id: "conservative-canary",
    name: "Conservative Canary (10% Soak)",
    description:
      "Route 10% of traffic to the new candidate. Monitor error rates and latency for 15 minutes before 100% rollout.",
    type: "canary",
    initialCanaryWeight: 10,
    soakMinutes: 15,
    autoRollbackErrorThreshold: 1.0,
  },
  {
    id: "fast-blue-green",
    name: "Atomic Blue/Green Swap",
    description:
      "Provision green candidate in parallel. Execute zero-downtime 100% cutover once health check passes.",
    type: "blue_green",
    initialCanaryWeight: 0,
    soakMinutes: 2,
    autoRollbackErrorThreshold: 0.1,
  },
  {
    id: "internal-beta",
    name: "Internal Beta Header Routing",
    description:
      "Route only requests with HTTP header 'X-Canary: beta' or cookie 'hx_canary=1' to the new release.",
    type: "header_routing",
    initialCanaryWeight: 0,
    soakMinutes: 60,
    autoRollbackErrorThreshold: 2.0,
  },
  {
    id: "balanced-50",
    name: "50/50 A/B Performance Split",
    description:
      "Split traffic evenly between versions to measure real-world latency, conversion, and resource consumption.",
    type: "canary",
    initialCanaryWeight: 50,
    soakMinutes: 30,
    autoRollbackErrorThreshold: 1.5,
  },
];

/**
 * Generates Caddyfile reverse-proxy directive for weighted traffic splitting
 */
export function generateCaddyTrafficSplitSnippet(params: TrafficSplitParams): string {
  const {
    domain,
    stablePort,
    canaryPort,
    canaryWeightPercent,
    stickyCookie = true,
    headerOverride = "X-Canary",
    healthCheckPath = "/healthz",
  } = params;

  const lines: string[] = [
    `# =========================================================`,
    `# HosteraX Edge: Caddy Weighted Traffic Splitting Configuration`,
    `# Domain: ${domain}`,
    `# Stable Port: ${stablePort} | Canary Port: ${canaryPort}`,
    `# Canary Weight: ${canaryWeightPercent}%`,
    `# =========================================================`,
    `${domain} {`,
  ];

  if (headerOverride) {
    lines.push(
      `  # Header-based override for QA / beta testers`,
      `  @canaryHeader header ${headerOverride} "true"`,
      `  handle @canaryHeader {`,
      `    reverse_proxy 127.0.0.1:${canaryPort}`,
      `  }`,
      ``,
    );
  }

  if (canaryWeightPercent <= 0) {
    lines.push(
      `  # 100% Stable Traffic (Canary Inactive)`,
      `  reverse_proxy 127.0.0.1:${stablePort} {`,
      `    health_uri ${healthCheckPath}`,
      `    health_interval 5s`,
      `  }`,
    );
  } else if (canaryWeightPercent >= 100) {
    lines.push(
      `  # 100% Canary Rollout Promoted`,
      `  reverse_proxy 127.0.0.1:${canaryPort} {`,
      `    health_uri ${healthCheckPath}`,
      `    health_interval 5s`,
      `  }`,
    );
  } else {
    // Weighted upstream load balancing with sticky sessions
    lines.push(
      `  # Weighted Reverse Proxy (${100 - canaryWeightPercent}% Stable / ${canaryWeightPercent}% Canary)`,
      `  reverse_proxy {`,
      `    to 127.0.0.1:${stablePort} 127.0.0.1:${canaryPort}`,
      `    lb_policy round_robin`,
    );

    if (stickyCookie) {
      lines.push(`    lb_retries 3`, `    lb_try_duration 1s`);
    }

    lines.push(
      `    health_uri ${healthCheckPath}`,
      `    health_interval 3s`,
      `    health_timeout 2s`,
      `    health_status 200`,
      `  }`,
    );
  }

  lines.push(`}`);
  return lines.join("\n");
}

/**
 * Generates OpenResty Nginx configuration with split_clients directive
 */
export function generateNginxTrafficSplitSnippet(params: TrafficSplitParams): string {
  const { domain, stablePort, canaryPort, canaryWeightPercent, stickyCookie = true } = params;

  const lines: string[] = [
    `# =========================================================`,
    `# HosteraX OpenResty Nginx split_clients Traffic Configuration`,
    `# Domain: ${domain}`,
    `# =========================================================`,
    ``,
    `upstream upstream_stable_${stablePort} {`,
    `  server 127.0.0.1:${stablePort} max_fails=2 fail_timeout=10s;`,
    `}`,
    ``,
    `upstream upstream_canary_${canaryPort} {`,
    `  server 127.0.0.1:${canaryPort} max_fails=2 fail_timeout=10s;`,
    `}`,
    ``,
  ];

  if (canaryWeightPercent > 0 && canaryWeightPercent < 100) {
    const key = stickyCookie ? "$remote_addr$http_user_agent" : "$request_id";
    lines.push(
      `split_clients "${key}" $app_upstream_${stablePort} {`,
      `  ${canaryWeightPercent}% upstream_canary_${canaryPort};`,
      `  *   upstream_stable_${stablePort};`,
      `}`,
      ``,
    );
  }

  lines.push(`server {`, `  listen 80;`, `  server_name ${domain};`, ``, `  location / {`);

  if (canaryWeightPercent <= 0) {
    lines.push(`    proxy_pass http://upstream_stable_${stablePort};`);
  } else if (canaryWeightPercent >= 100) {
    lines.push(`    proxy_pass http://upstream_canary_${canaryPort};`);
  } else {
    lines.push(`    proxy_pass http://$app_upstream_${stablePort};`);
  }

  lines.push(
    `    proxy_set_header Host $host;`,
    `    proxy_set_header X-Real-IP $remote_addr;`,
    `    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
    `    proxy_set_header X-Forwarded-Proto $scheme;`,
    `    proxy_next_upstream error timeout http_502 http_503;`,
    `  }`,
    `}`,
  );

  return lines.join("\n");
}

/**
 * Evaluates Canary candidate health based on live probes
 */
export function evaluateCanaryHealth(probes: HealthProbeResult[]): CanaryEvaluation {
  if (probes.length === 0) {
    return {
      healthy: true,
      successRate: 100,
      avgLatencyMs: 0,
      recommendation: "soak",
      details: "Awaiting initial canary health check probes...",
    };
  }

  const successCount = probes.filter((p) => p.statusCode >= 200 && p.statusCode < 400).length;
  const successRate = Math.round((successCount / probes.length) * 1000) / 10;
  const totalLatency = probes.reduce((acc, p) => acc + p.latencyMs, 0);
  const avgLatencyMs = Math.round((totalLatency / probes.length) * 10) / 10;

  const errorRate = 100 - successRate;

  let recommendation: "promote" | "soak" | "rollback" = "soak";
  let details = "";

  if (errorRate >= 2.0 || avgLatencyMs > 800) {
    recommendation = "rollback";
    details = `ALERT: High error rate (${errorRate.toFixed(1)}%) or elevated latency (${avgLatencyMs}ms). Instant rollback recommended.`;
  } else if (successRate >= 99.0 && probes.length >= 10 && avgLatencyMs < 250) {
    recommendation = "promote";
    details = `EXCELLENT: ${probes.length} consecutive probes passed with 0% error rate and ${avgLatencyMs}ms average latency. Candidate is safe to promote to 100%.`;
  } else {
    recommendation = "soak";
    details = `HEALTHY: Candidate is responding normally (${successRate}% success rate, ${avgLatencyMs}ms). Continuing soak period.`;
  }

  return {
    healthy: errorRate < 2.0,
    successRate,
    avgLatencyMs,
    recommendation,
    details,
  };
}

/**
 * Calculates estimated request distribution based on percentage weight
 */
export function calculateTrafficDistribution(
  totalRequests: number,
  canaryPercent: number,
): { stableRequests: number; canaryRequests: number } {
  const boundedCanaryPercent = Math.max(0, Math.min(100, canaryPercent));
  const canaryRequests = Math.round((totalRequests * boundedCanaryPercent) / 100);
  const stableRequests = totalRequests - canaryRequests;
  return { stableRequests, canaryRequests };
}
