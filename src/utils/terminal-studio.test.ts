import test from "node:test";
import assert from "node:assert/strict";
import {
  categorizeContainer,
  stripAnsiCodes,
  filterTerminalHistory,
  formatAuditCsv,
  formatAuditJson,
  CURATED_TERMINAL_SNIPPETS,
  type TerminalHistoryItem,
} from "./terminal-studio";

test("categorizeContainer accurately identifies container roles", () => {
  assert.equal(categorizeContainer("postgres:16-alpine", "prod_db"), "database");
  assert.equal(categorizeContainer("redis:7", "cache"), "database");
  assert.equal(categorizeContainer("caddy:2-alpine", "hx_edge"), "edge");
  assert.equal(categorizeContainer("openresty/openresty:latest", "proxy"), "edge");
  assert.equal(categorizeContainer("node:20", "hosterax-engine"), "system");
  assert.equal(categorizeContainer("my-custom-api:latest", "web-api"), "app");
});

test("stripAnsiCodes cleans terminal color escapes", () => {
  const colored = "\x1b[32mSUCCESS:\x1b[0m \x1b[1mContainer running\x1b[0m";
  assert.equal(stripAnsiCodes(colored), "SUCCESS: Container running");
  assert.equal(stripAnsiCodes("plain text"), "plain text");
});

test("filterTerminalHistory matches across commands, containers and outputs", () => {
  const items: TerminalHistoryItem[] = [
    {
      id: "1",
      containerName: "postgres_db",
      command: "psql -U postgres -c 'SELECT 1;'",
      output: "1 row in set",
      exitCode: 0,
      timestamp: 1000,
    },
    {
      id: "2",
      containerName: "web_api",
      command: "curl localhost:8080/health",
      output: '{"status":"ok"}',
      exitCode: 0,
      timestamp: 2000,
    },
    {
      id: "3",
      containerName: "redis_cache",
      command: "redis-cli ping",
      output: "PONG",
      exitCode: 0,
      timestamp: 3000,
    },
  ];

  const searchPsql = filterTerminalHistory(items, "psql");
  assert.equal(searchPsql.length, 1);
  assert.equal(searchPsql[0].id, "1");

  const searchRedis = filterTerminalHistory(items, "redis_cache");
  assert.equal(searchRedis.length, 1);
  assert.equal(searchRedis[0].id, "3");

  const searchOutput = filterTerminalHistory(items, "status");
  assert.equal(searchOutput.length, 1);
  assert.equal(searchOutput[0].id, "2");

  const emptyFilter = filterTerminalHistory(items, "");
  assert.equal(emptyFilter.length, 3);
});

test("formatAuditCsv and formatAuditJson generate compliant outputs", () => {
  const items: TerminalHistoryItem[] = [
    {
      id: "1",
      containerName: "hx_edge",
      command: "caddy validate",
      output: "\x1b[32mConfiguration is valid\x1b[0m",
      exitCode: 0,
      timestamp: 1700000000000,
    },
  ];

  const csv = formatAuditCsv(items);
  assert.ok(csv.includes("Timestamp,Container,Command,ExitCode,OutputSnippet"));
  assert.ok(csv.includes('"hx_edge"'));
  assert.ok(csv.includes('"caddy validate"'));
  assert.ok(csv.includes("Configuration is valid"));

  const json = formatAuditJson(items);
  const parsed = JSON.parse(json);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].outputClean, "Configuration is valid");
});

test("CURATED_TERMINAL_SNIPPETS contains valid diagnostics and database commands", () => {
  assert.ok(CURATED_TERMINAL_SNIPPETS.length >= 8);
  assert.ok(CURATED_TERMINAL_SNIPPETS.some((s) => s.id === "disk-usage"));
  assert.ok(CURATED_TERMINAL_SNIPPETS.some((s) => s.id === "postgres-ping"));
  assert.ok(CURATED_TERMINAL_SNIPPETS.some((s) => s.id === "edge-caddy-check"));
});
