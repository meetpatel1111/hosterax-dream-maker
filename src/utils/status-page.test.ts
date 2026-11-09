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

test("calculateOverallSystemStatus determines worst-case status accurately", () => {
  const allHealthy: MonitoredComponent[] = [
    { ...DEFAULT_MONITORED_COMPONENTS[0], status: "operational" },
    { ...DEFAULT_MONITORED_COMPONENTS[1], status: "operational" },
  ];
  assert.equal(calculateOverallSystemStatus(allHealthy), "operational");

  const withDegraded: MonitoredComponent[] = [
    { ...DEFAULT_MONITORED_COMPONENTS[0], status: "operational" },
    { ...DEFAULT_MONITORED_COMPONENTS[1], status: "degraded_performance" },
  ];
  assert.equal(calculateOverallSystemStatus(withDegraded), "degraded_performance");

  const withPartial: MonitoredComponent[] = [
    { ...DEFAULT_MONITORED_COMPONENTS[0], status: "degraded_performance" },
    { ...DEFAULT_MONITORED_COMPONENTS[1], status: "partial_outage" },
  ];
  assert.equal(calculateOverallSystemStatus(withPartial), "partial_outage");

  const withMajor: MonitoredComponent[] = [
    { ...DEFAULT_MONITORED_COMPONENTS[0], status: "partial_outage" },
    { ...DEFAULT_MONITORED_COMPONENTS[1], status: "major_outage" },
  ];
  assert.equal(calculateOverallSystemStatus(withMajor), "major_outage");

  const withMaintenance: MonitoredComponent[] = [
    { ...DEFAULT_MONITORED_COMPONENTS[0], status: "operational" },
    { ...DEFAULT_MONITORED_COMPONENTS[1], status: "under_maintenance" },
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

  const md = generatePostMortemMarkdown(incident, DEFAULT_MONITORED_COMPONENTS);
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

test("DEFAULT_MONITORED_COMPONENTS all have valid probe configurations", () => {
  assert.ok(DEFAULT_MONITORED_COMPONENTS.length >= 5);
  for (const comp of DEFAULT_MONITORED_COMPONENTS) {
    assert.ok(comp.id.length > 0);
    assert.ok(comp.name.length > 0);
    assert.ok(comp.probe.target.length > 0);
    assert.ok(comp.probe.intervalSeconds > 0);
    assert.ok(comp.recentResults.length > 0);
  }
});
