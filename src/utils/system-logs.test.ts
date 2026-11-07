import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSeverity,
  parseWebSocketLogMessage,
  formatLogTimestamp,
  filterSystemLogs,
  countLogsBySeverity,
  appendLogWithCap,
  exportLogsAsText,
  SystemLogEntry,
} from "./system-logs";

const mockLogs: SystemLogEntry[] = [
  {
    id: "log_1",
    ts: 1710000000000,
    level: "INFO",
    source: "engine",
    message: "HosteraX engine started successfully on port 7777",
  },
  {
    id: "log_2",
    ts: 1710000005000,
    level: "WARN",
    source: "backup",
    message: "S3 backup bucket unreachable, retrying in 30s",
  },
  {
    id: "log_3",
    ts: 1710000010000,
    level: "ERROR",
    source: "docker",
    message: "Container hx_db failed health check",
    meta: { exitCode: 137, containerId: "c1234" },
  },
  {
    id: "log_4",
    ts: 1710000015000,
    level: "INFO",
    source: "caddy",
    message: "TLS certificate renewed for domain.local",
  },
];

test("normalizeSeverity handles standard and alias severities", () => {
  assert.equal(normalizeSeverity("info"), "INFO");
  assert.equal(normalizeSeverity("INFO"), "INFO");
  assert.equal(normalizeSeverity("warn"), "WARN");
  assert.equal(normalizeSeverity("warning"), "WARN");
  assert.equal(normalizeSeverity("error"), "ERROR");
  assert.equal(normalizeSeverity("CRITICAL"), "ERROR");
  assert.equal(normalizeSeverity("FATAL"), "ERROR");
  assert.equal(normalizeSeverity(null), "INFO");
  assert.equal(normalizeSeverity(""), "INFO");
});

test("parseWebSocketLogMessage parses valid JSON string", () => {
  const jsonStr = JSON.stringify({
    id: "evt_123",
    ts: 1710000020000,
    level: "warn",
    source: "self-heal",
    message: "High memory pressure detected",
    meta: { rssMb: 1450 },
  });

  const parsed = parseWebSocketLogMessage(jsonStr);
  assert.ok(parsed);
  assert.equal(parsed.id, "evt_123");
  assert.equal(parsed.level, "WARN");
  assert.equal(parsed.source, "self-heal");
  assert.equal(parsed.message, "High memory pressure detected");
  assert.deepEqual(parsed.meta, { rssMb: 1450 });
});

test("parseWebSocketLogMessage falls back on stream and text fields", () => {
  const streamMsg = {
    stream: "stderr",
    text: "Database connection timed out",
    project: "my-app",
  };

  const parsed = parseWebSocketLogMessage(streamMsg);
  assert.ok(parsed);
  assert.equal(parsed.level, "WARN");
  assert.equal(parsed.source, "my-app");
  assert.equal(parsed.message, "Database connection timed out");
});

test("parseWebSocketLogMessage rejects invalid inputs", () => {
  assert.equal(parseWebSocketLogMessage(null), null);
  assert.equal(parseWebSocketLogMessage(""), null);
  assert.equal(parseWebSocketLogMessage("invalid-json"), null);
  assert.equal(parseWebSocketLogMessage({}), null);
});

test("filterSystemLogs filters by severity level", () => {
  const infoOnly = filterSystemLogs(mockLogs, { level: "INFO" });
  assert.equal(infoOnly.length, 2);
  assert.ok(infoOnly.every((l) => l.level === "INFO"));

  const warnOnly = filterSystemLogs(mockLogs, { level: "WARN" });
  assert.equal(warnOnly.length, 1);
  assert.equal(warnOnly[0].id, "log_2");

  const errorOnly = filterSystemLogs(mockLogs, { level: "ERROR" });
  assert.equal(errorOnly.length, 1);
  assert.equal(errorOnly[0].id, "log_3");

  const allLogs = filterSystemLogs(mockLogs, { level: "ALL" });
  assert.equal(allLogs.length, 4);
});

test("filterSystemLogs filters by search query across message and source", () => {
  const filteredMessage = filterSystemLogs(mockLogs, { searchQuery: "health check" });
  assert.equal(filteredMessage.length, 1);
  assert.equal(filteredMessage[0].id, "log_3");

  const filteredSource = filterSystemLogs(mockLogs, { searchQuery: "caddy" });
  assert.equal(filteredSource.length, 1);
  assert.equal(filteredSource[0].id, "log_4");

  const filteredMeta = filterSystemLogs(mockLogs, { searchQuery: "c1234" });
  assert.equal(filteredMeta.length, 1);
  assert.equal(filteredMeta[0].id, "log_3");
});

test("filterSystemLogs filters by source option", () => {
  const filtered = filterSystemLogs(mockLogs, { source: "engine" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "log_1");
});

test("countLogsBySeverity calculates correct breakdown", () => {
  const counts = countLogsBySeverity(mockLogs);
  assert.deepEqual(counts, {
    ALL: 4,
    INFO: 2,
    WARN: 1,
    ERROR: 1,
  });
});

test("appendLogWithCap dedupes and enforces capacity", () => {
  const existing: SystemLogEntry[] = [mockLogs[0], mockLogs[1]];

  // Duplicate ID
  const withDuplicate = appendLogWithCap(existing, mockLogs[0], 5);
  assert.equal(withDuplicate.length, 2);

  // New entry within cap
  const withNew = appendLogWithCap(existing, mockLogs[2], 5);
  assert.equal(withNew.length, 3);

  // Exceed cap of 2
  const capped = appendLogWithCap(existing, mockLogs[2], 2);
  assert.equal(capped.length, 2);
  assert.equal(capped[0].id, "log_2");
  assert.equal(capped[1].id, "log_3");
});

test("exportLogsAsText formats into standard log lines", () => {
  const text = exportLogsAsText([mockLogs[0]]);
  assert.ok(text.includes("[INFO ]"));
  assert.ok(text.includes("[engine]"));
  assert.ok(text.includes("HosteraX engine started successfully on port 7777"));
});
