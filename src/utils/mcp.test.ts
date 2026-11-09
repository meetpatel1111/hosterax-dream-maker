import test from "node:test";
import assert from "node:assert/strict";
import {
  categorizeMcpTool,
  buildMcpCallPayload,
  generateIdeConfig,
  formatMcpResponse,
} from "./mcp.js";

test("categorizeMcpTool correctly maps tool names to domains", () => {
  assert.equal(categorizeMcpTool("get_system_metrics"), "Observability");
  assert.equal(categorizeMcpTool("diagnose_project_crash"), "Observability");
  assert.equal(categorizeMcpTool("deploy_project"), "Deployments");
  assert.equal(categorizeMcpTool("search_catalog"), "Deployments");
  assert.equal(categorizeMcpTool("provision_database"), "Databases");
  assert.equal(categorizeMcpTool("create_backup"), "Databases");
  assert.equal(categorizeMcpTool("list_domains"), "Networking & Edge");
  assert.equal(categorizeMcpTool("list_servers"), "Networking & Edge");
  assert.equal(categorizeMcpTool("trigger_cron_job"), "Automation");
  assert.equal(categorizeMcpTool("create_mailbox"), "Email & Mailboxes");
  assert.equal(categorizeMcpTool("list_organizations"), "Team & RBAC");
});

test("buildMcpCallPayload constructs valid JSON-RPC 2.0 structure", () => {
  const payload = buildMcpCallPayload("get_project", { projectName: "demo" }, 42);
  assert.equal(payload.jsonrpc, "2.0");
  assert.equal(payload.id, 42);
  assert.equal(payload.method, "tools/call");
  assert.deepEqual(payload.params, {
    name: "get_project",
    arguments: { projectName: "demo" },
  });
});

test("generateIdeConfig outputs correct formats for Cursor, Claude Desktop, and Windsurf", () => {
  const cursor = generateIdeConfig("cursor", "http://127.0.0.1:7777", "hxt_test123");
  assert.equal(cursor.filename, ".cursor/mcp.json");
  assert(cursor.snippet.includes("hxt_test123"));
  assert(cursor.snippet.includes("http://127.0.0.1:7777/api/mcp"));

  const claude = generateIdeConfig("claude_desktop", "http://127.0.0.1:7777", "hxt_test123");
  assert.equal(claude.filename, "claude_desktop_config.json");
  assert(claude.snippet.includes("mcp:stdio"));
  assert(claude.snippet.includes("hxt_test123"));

  const cli = generateIdeConfig("claude_code", "http://127.0.0.1:7777", "hxt_test123");
  assert(cli.snippet.startsWith("claude mcp add hosterax"));
});

test("formatMcpResponse handles success, errors, and empty responses gracefully", () => {
  const success = formatMcpResponse({ result: { cpu: 12 } });
  assert.equal(success.isError, false);
  assert.deepEqual(success.data, { cpu: 12 });

  const error = formatMcpResponse({ error: { code: -32601, message: "Method not found" } });
  assert.equal(error.isError, true);
  assert.equal(error.data.code, -32601);

  const empty = formatMcpResponse(null);
  assert.equal(empty.isError, true);
});
