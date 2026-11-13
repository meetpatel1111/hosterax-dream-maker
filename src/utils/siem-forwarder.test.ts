import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateSyslogPri,
  formatRfc5424Syslog,
  formatDatadogLog,
  formatSplunkHecEvent,
  formatGrafanaLokiPayload,
  shouldForwardLog,
  PRESET_SIEM_SINKS,
} from "./siem-forwarder";
import { type LogEntry } from "./app-logger";

const mockLog: LogEntry = {
  id: "log_test_123",
  timestamp: 1710000000000,
  category: "security",
  level: "warn",
  action: "LOGIN_FAILED",
  message: "Invalid credential attempt from 192.168.1.50",
  method: "POST",
  path: "/api/auth/login",
  status: 401,
  durationMs: 42,
  meta: { ip: "192.168.1.50" },
};

test("calculateSyslogPri calculates correct facility and severity combinations", () => {
  // Facility 16 (local0) * 8 + severity 4 (warning) = 132
  assert.equal(calculateSyslogPri(16, "warn"), 132);
  assert.equal(calculateSyslogPri(16, "warning"), 132);

  // Facility 16 * 8 + severity 3 (error) = 131
  assert.equal(calculateSyslogPri(16, "error"), 131);

  // Facility 1 (user) * 8 + severity 6 (info) = 14
  assert.equal(calculateSyslogPri(1, "info"), 14);

  // Emergency / fatal severity 0
  assert.equal(calculateSyslogPri(0, "emergency"), 0);
  assert.equal(calculateSyslogPri(16, "fatal"), 128);
});

test("formatRfc5424Syslog outputs valid RFC 5424 compliant syslog packet", () => {
  const formatted = formatRfc5424Syslog(mockLog, {
    hostname: "node-1.hosterax.io",
    appName: "hx-security",
    facility: 16,
  });

  // Check RFC 5424 preamble: <132>1
  assert.ok(formatted.startsWith("<132>1 "));
  assert.ok(formatted.includes("node-1.hosterax.io hx-security 1 LOGIN_FAILED"));
  // Check structured data
  assert.ok(formatted.includes('[hosterax@54321 category="security" level="warn"]'));
  // Check message and latency
  assert.ok(formatted.includes("Invalid credential attempt from 192.168.1.50 (latency: 42ms)"));
});

test("formatDatadogLog formats payload according to Datadog Logs V2 schema", () => {
  const dd = formatDatadogLog(mockLog, { region: "us-east" });

  assert.equal(dd.ddsource, "hosterax");
  assert.equal(dd.service, "hosterax-engine");
  assert.equal(dd.status, "WARN");
  assert.equal(dd.timestamp, 1710000000000);
  assert.equal(dd.message, "Invalid credential attempt from 192.168.1.50");
  assert.ok(dd.ddtags.includes("region:us-east"));
  assert.ok(dd.ddtags.includes("category:security"));
  assert.equal(dd.attributes.action, "LOGIN_FAILED");
  assert.equal(dd.attributes.statusCode, 401);
  assert.equal(dd.attributes.durationMs, 42);
});

test("formatSplunkHecEvent formats payload according to Splunk HEC standards", () => {
  const splunk = formatSplunkHecEvent(mockLog, "security_logs");

  assert.equal(splunk.time, 1710000000); // in seconds
  assert.equal(splunk.source, "hosterax-audit");
  assert.equal(splunk.sourcetype, "_json");
  assert.equal(splunk.index, "security_logs");
  assert.equal(splunk.event.action, "LOGIN_FAILED");
  assert.equal(splunk.event.level, "warn");
  assert.equal(splunk.event.status, 401);
});

test("formatGrafanaLokiPayload generates compliant push stream with nanoseconds", () => {
  const loki = formatGrafanaLokiPayload(mockLog, { env: "prod" });

  assert.ok(Array.isArray(loki.streams));
  assert.equal(loki.streams.length, 1);
  const stream = loki.streams[0];
  assert.equal(stream.stream.app, "hosterax");
  assert.equal(stream.stream.level, "warn");
  assert.equal(stream.stream.category, "security");

  const [nanoTimestamp, logBody] = stream.values[0];
  assert.equal(nanoTimestamp, "1710000000000000000"); // 1710000000000 + 6 zeroes
  const parsedBody = JSON.parse(logBody);
  assert.equal(parsedBody.action, "LOGIN_FAILED");
  assert.equal(parsedBody.level, "warn");
});

test("shouldForwardLog correctly respects severity threshold hierarchy", () => {
  // Min level is info
  assert.equal(shouldForwardLog("error", "info"), true);
  assert.equal(shouldForwardLog("warn", "info"), true);
  assert.equal(shouldForwardLog("info", "info"), true);
  assert.equal(shouldForwardLog("debug", "info"), false);

  // Min level is error
  assert.equal(shouldForwardLog("error", "error"), true);
  assert.equal(shouldForwardLog("warn", "error"), false);
  assert.equal(shouldForwardLog("info", "error"), false);

  // Min level is debug
  assert.equal(shouldForwardLog("debug", "debug"), true);
  assert.equal(shouldForwardLog("info", "debug"), true);
});

test("PRESET_SIEM_SINKS contains valid presets", () => {
  assert.ok(PRESET_SIEM_SINKS.length >= 4);
  for (const preset of PRESET_SIEM_SINKS) {
    assert.ok(preset.name.length > 0);
    assert.ok(preset.endpoint.length > 0);
    assert.ok(["datadog", "splunk_hec", "grafana_loki", "syslog_rfc5424"].includes(preset.type));
  }
});
