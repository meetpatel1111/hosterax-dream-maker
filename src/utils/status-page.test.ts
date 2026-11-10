import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateOverallSystemStatus,
  calculateUptimePercentage,
  calculateAverageLatency,
  checkSslRenewalWarning,
  generate90DayTimeline,
  generatePostMortemMarkdown,
  generateStatusBadgeMarkdown,
  DEFAULT_MONITORED_COMPONENTS,
  type MonitoredComponent,
  type ProbeResult,
  type Incident,
} from "./status-page";

const testFixtureComp1: MonitoredComponent = {
  id: "comp-edge",
  name: "Edge Gateway & Reverse Proxy",
  description: "Caddy TLS proxy",
  group: "Edge & Ingress",
  status: "operational",
  probe: {
    id: "prb-edge",
    name: "Edge HTTP",
    target: "http://127.0.0.1:80/health",
    type: "http",
    intervalSeconds: 15,
    timeoutMs: 2000,
    expectedStatus: 200,
    enabled: true,
  },
  uptime90d: 99.99,
  recentResults: [{ timestamp: Date.now(), latencyMs: 4, success: true, statusCode: 200 }],
};

const testFixtureComp2: MonitoredComponent = {
  id: "comp-postgres",
  name: "Primary PostgreSQL Cluster",
  description: "Database cluster",
  group: "Storage & Databases",
  status: "operational",
  probe: {
    id: "prb-pg",
    name: "PG TCP",
    target: "127.0.0.1:5432",
    type: "tcp",
    intervalSeconds: 30,
    timeoutMs: 3000,
    enabled: true,
  },
  uptime90d: 99.98,
  recentResults: [{ timestamp: Date.now(), latencyMs: 2, success: true }],
};

test("calculateOverallSystemStatus determines worst-case status accurately", () => {
  const allHealthy: MonitoredComponent[] = [
    { ...testFixtureComp1, status: "operational" },
    { ...testFixtureComp2, status: "operational" },
  ];
  assert.equal(calculateOverallSystemStatus(allHealthy), "operational");

  const withDegraded: MonitoredComponent[] = [
    { ...testFixtureComp1, status: "operational" },
    { ...testFixtureComp2, status: "degraded_performance" },
  ];
  assert.equal(calculateOverallSystemStatus(withDegraded), "degraded_performance");

  const withPartial: MonitoredComponent[] = [
    { ...testFixtureComp1, status: "degraded_performance" },
    { ...testFixtureComp2, status: "partial_outage" },
  ];
  assert.equal(calculateOverallSystemStatus(withPartial), "partial_outage");

  const withMajor: MonitoredComponent[] = [
    { ...testFixtureComp1, status: "partial_outage" },
    { ...testFixtureComp2, status: "major_outage" },
  ];
  assert.equal(calculateOverallSystemStatus(withMajor), "major_outage");

  const withMaintenance: MonitoredComponent[] = [
    { ...testFixtureComp1, status: "operational" },
    { ...testFixtureComp2, status: "under_maintenance" },
  ];
  assert.equal(calculateOverallSystemStatus(withMaintenance), "under_maintenance");
});

test("calculateUptimePercentage computes 100% on empty and exact decimals", () => {
  assert.equal(calculateUptimePercentage([]), 100.0);

  const results: ProbeResult[] = [
    { timestamp: 1, latencyMs: 5, success: true },
    { timestamp: 2, latencyMs: 5, success: true },
    { timestamp: 3, latencyMs: 5, success: true },
    { timestamp: 4, latencyMs: 0, success: false },
  ];
  // 3 out of 4 = 75.0%
  assert.equal(calculateUptimePercentage(results), 75.0);

  // 19 out of 20 = 95.0%
  const twentyResults: ProbeResult[] = Array(19)
    .fill({ timestamp: 1, latencyMs: 10, success: true })
    .concat([{ timestamp: 20, latencyMs: 0, success: false }]);
  assert.equal(calculateUptimePercentage(twentyResults), 95.0);
});

test("calculateAverageLatency calculates accurate mean of successful probes", () => {
  const results: ProbeResult[] = [
    { timestamp: 1, latencyMs: 10, success: true },
    { timestamp: 2, latencyMs: 20, success: true },
    { timestamp: 3, latencyMs: 30, success: true },
    { timestamp: 4, latencyMs: 0, success: false }, // Ignored in average
  ];
  assert.equal(calculateAverageLatency(results), 20);
});

test("checkSslRenewalWarning warns on <= 14 days and flags critical on <= 3 days", () => {
  const safe = checkSslRenewalWarning(45);
  assert.equal(safe.warning, false);
  assert.equal(safe.severity, "ok");

  const warning = checkSslRenewalWarning(10);
  assert.equal(warning.warning, true);
  assert.equal(warning.severity, "warning");

  const critical = checkSslRenewalWarning(2);
  assert.equal(critical.warning, true);
  assert.equal(critical.severity, "critical");

  const none = checkSslRenewalWarning(undefined);
  assert.equal(none.warning, false);
});

test("generate90DayTimeline returns 90 consecutive day records", () => {
  const timeline = generate90DayTimeline(99.95, 90);
  assert.equal(timeline.length, 90);
  assert.equal(timeline[timeline.length - 1].dayOffset, 0); // Today is offset 0
  assert.ok(timeline[0].dateString.includes("-"));
});

test("generatePostMortemMarkdown generates structured Markdown report", () => {
  const incident: Incident = {
    id: "inc-1",
    title: "Database Connection Pool Exhaustion",
    severity: "major",
    affectedComponentIds: ["comp-postgres"],
    stage: "resolved",
    createdAt: Date.now() - 3600000,
    resolvedAt: Date.now(),
    updates: [
      {
        id: "u1",
        timestamp: Date.now() - 3000000,
        stage: "investigating",
        message: "High latency detected on port 5432.",
      },
      {
        id: "u2",
        timestamp: Date.now() - 1000000,
        stage: "resolved",
        message: "Pool limits increased and connection leaks cleared.",
      },
    ],
  };

  const md = generatePostMortemMarkdown(incident, [testFixtureComp1, testFixtureComp2]);
  assert.ok(md.includes("Incident Post-Mortem: Database Connection Pool Exhaustion"));
  assert.ok(md.includes("MAJOR"));
  assert.ok(md.includes("Primary PostgreSQL Cluster"));
  assert.ok(md.includes("Timeline of Events"));
  assert.ok(md.includes("Root Cause Analysis"));
});

test("generateStatusBadgeMarkdown produces valid Shields.io link", () => {
  const badge = generateStatusBadgeMarkdown("operational", "status.hosterax.io");
  assert.ok(badge.includes("img.shields.io/badge/Status-Operational-brightgreen"));
  assert.ok(badge.includes("https://status.hosterax.io/status"));
});

test("DEFAULT_MONITORED_COMPONENTS is initialized as clean array for dynamic engine telemetry", () => {
  assert.ok(Array.isArray(DEFAULT_MONITORED_COMPONENTS));
});
