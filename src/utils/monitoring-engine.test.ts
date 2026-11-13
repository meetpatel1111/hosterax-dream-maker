import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generatePrometheusMetrics,
  evaluateAlertRule,
  calculatePercentile,
  calculateErrorRate,
  DEFAULT_ALERT_RULES,
  type HostMetricsSnapshot,
  type ContainerMetric,
  type EdgeMetric,
} from "./monitoring-engine.js";

const mockSnapshot: HostMetricsSnapshot = {
  cpuPercent: 42.5,
  memoryTotalBytes: 16 * 1024 * 1024 * 1024,
  memoryUsedBytes: 8 * 1024 * 1024 * 1024,
  memoryFreeBytes: 8 * 1024 * 1024 * 1024,
  diskTotalBytes: 500 * 1024 * 1024 * 1024,
  diskUsedBytes: 250 * 1024 * 1024 * 1024,
  diskFreeBytes: 250 * 1024 * 1024 * 1024,
  uptimeSeconds: 86400,
  loadAvg1m: 1.15,
  loadAvg5m: 1.25,
  loadAvg15m: 0.95,
};

const mockContainers: ContainerMetric[] = [
  {
    id: "cnt-1",
    name: "api-backend",
    status: "running",
    cpuPercent: 12.3,
    memoryBytes: 256 * 1024 * 1024,
    memoryLimitBytes: 1024 * 1024 * 1024,
    restartCount: 0,
  },
  {
    id: "cnt-2",
    name: "worker-queue",
    status: "restarting",
    cpuPercent: 0.5,
    memoryBytes: 128 * 1024 * 1024,
    memoryLimitBytes: 512 * 1024 * 1024,
    restartCount: 5,
  },
];

const mockEdge: EdgeMetric[] = [
  {
    domain: "api.example.com",
    requestsTotal: 1000,
    status2xx: 950,
    status4xx: 30,
    status5xx: 20,
    latencyP50Ms: 15,
    latencyP95Ms: 45,
    latencyP99Ms: 120,
    sslDaysRemaining: 75,
  },
  {
    domain: "admin.example.com",
    requestsTotal: 200,
    status2xx: 195,
    status4xx: 4,
    status5xx: 1,
    latencyP50Ms: 25,
    latencyP95Ms: 65,
    latencyP99Ms: 150,
    sslDaysRemaining: 10, // Under 14 days!
  },
];

test("generatePrometheusMetrics produces valid Prometheus text format", () => {
  const output = generatePrometheusMetrics(mockSnapshot, mockContainers, mockEdge);

  assert.match(output, /# HELP hosterax_node_cpu_utilization_percent/);
  assert.match(output, /# TYPE hosterax_node_cpu_utilization_percent gauge/);
  assert.match(output, /hosterax_node_cpu_utilization_percent 42\.50/);

  assert.match(output, /hosterax_node_memory_bytes\{type="total"\} 17179869184/);
  assert.match(output, /hosterax_node_load_average\{interval="1m"\} 1\.15/);
  assert.match(output, /hosterax_node_uptime_seconds 86400/);

  // Container metrics check
  assert.match(
    output,
    /hosterax_container_cpu_percent\{container_id="cnt-1",container_name="api-backend",status="running"\} 12\.30/,
  );
  assert.match(
    output,
    /hosterax_container_restart_count\{container_id="cnt-2",container_name="worker-queue"\} 5/,
  );

  // Edge metrics check
  assert.match(
    output,
    /hosterax_edge_requests_total\{domain="api\.example\.com",status="2xx"\} 950/,
  );
  assert.match(
    output,
    /hosterax_edge_latency_milliseconds\{domain="api\.example\.com",quantile="0\.95"\} 45/,
  );
  assert.match(output, /hosterax_ssl_cert_days_remaining\{domain="admin\.example\.com"\} 10/);
});

test("evaluateAlertRule triggers correctly on CPU threshold violation", () => {
  const cpuRule = DEFAULT_ALERT_RULES.find((r) => r.id === "rule-cpu-critical")!;

  // Normal state (42.5% <= 85%)
  const normalEval = evaluateAlertRule(cpuRule, { host: mockSnapshot });
  assert.equal(normalEval.triggered, false);

  // High CPU state (92% > 85%)
  const highCpuSnapshot = { ...mockSnapshot, cpuPercent: 92.4 };
  const alertEval = evaluateAlertRule(cpuRule, { host: highCpuSnapshot });
  assert.equal(alertEval.triggered, true);
  assert.equal(alertEval.severity, "critical");
  assert.match(alertEval.message, /Node CPU Exhaustion/);
});

test("evaluateAlertRule triggers correctly on SSL certificate expiry warning", () => {
  const sslRule = DEFAULT_ALERT_RULES.find((r) => r.id === "rule-ssl-expiry")!;

  // mockEdge has admin.example.com with 10 days remaining (< 14 threshold)
  const evalResult = evaluateAlertRule(sslRule, {
    host: mockSnapshot,
    edge: mockEdge,
  });

  assert.equal(evalResult.triggered, true);
  assert.equal(evalResult.severity, "warning");
  assert.equal(evalResult.currentValue, 10);
  assert.match(evalResult.message, /admin\.example\.com/);
});

test("evaluateAlertRule triggers correctly on container crashloop", () => {
  const crashRule = DEFAULT_ALERT_RULES.find((r) => r.id === "rule-container-crashloop")!;

  // mockContainers has worker-queue with 5 restarts (> 3 threshold)
  const evalResult = evaluateAlertRule(crashRule, {
    host: mockSnapshot,
    containers: mockContainers,
  });

  assert.equal(evalResult.triggered, true);
  assert.equal(evalResult.severity, "critical");
  assert.equal(evalResult.currentValue, 5);
  assert.match(evalResult.message, /worker-queue/);
});

test("calculatePercentile computes accurate percentiles", () => {
  const latencies = [10, 15, 20, 25, 30, 40, 50, 75, 100, 200];

  assert.equal(calculatePercentile(latencies, 50), 30);
  assert.equal(calculatePercentile(latencies, 90), 100);
  assert.equal(calculatePercentile(latencies, 99), 200);
  assert.equal(calculatePercentile([], 50), 0);
});

test("calculateErrorRate returns formatted client and server error percentages", () => {
  const { clientErrorRate, serverErrorRate, totalErrorRate } = calculateErrorRate(900, 80, 20);

  assert.equal(clientErrorRate, 8); // 80 / 1000 = 8%
  assert.equal(serverErrorRate, 2); // 20 / 1000 = 2%
  assert.equal(totalErrorRate, 10); // 100 / 1000 = 10%

  // Edge case: zero requests
  assert.deepEqual(calculateErrorRate(0, 0, 0), {
    clientErrorRate: 0,
    serverErrorRate: 0,
    totalErrorRate: 0,
  });
});
