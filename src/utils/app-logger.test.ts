import test from "node:test";
import assert from "node:assert/strict";
import {
  createLogEntry,
  sanitizeLogMetadata,
  filterLogs,
  calculateLogMetrics,
  formatAsCurlCommand,
  exportLogsAsJson,
  exportLogsAsCsv,
  appLogger,
  type LogEntry,
} from "./app-logger";

test("createLogEntry creates normalized log entries accurately", () => {
  const entry = createLogEntry(
    "api",
    "info",
    "GET /api/projects",
    "Fetched projects successfully",
    {
      method: "get",
      path: "/api/projects",
      status: 200,
      durationMs: 14.8,
    },
  );

  assert.ok(entry.id.startsWith("log-"));
  assert.equal(entry.category, "api");
  assert.equal(entry.level, "info");
  assert.equal(entry.method, "GET");
  assert.equal(entry.path, "/api/projects");
  assert.equal(entry.status, 200);
  assert.equal(entry.durationMs, 15);
});

test("sanitizeLogMetadata redacts sensitive keys recursively", () => {
  const dirty = {
    username: "admin",
    password: "supersecretpassword123",
    nested: {
      api_key: "ai-studio-key-999",
      other: "normal-value",
    },
    authorization: "Bearer my-jwt-token",
  };

  const clean = sanitizeLogMetadata(dirty);
  assert.equal(clean.username, "admin");
  assert.equal(clean.password, "[REDACTED]");
  assert.equal((clean.nested as any).api_key, "[REDACTED]");
  assert.equal((clean.nested as any).other, "normal-value");
  assert.equal(clean.authorization, "[REDACTED]");
});

test("filterLogs correctly filters by category, level, query and status", () => {
  const sampleLogs: LogEntry[] = [
    createLogEntry("api", "info", "GET /api/projects", "Projects retrieved", {
      path: "/api/projects",
      method: "GET",
      status: 200,
      durationMs: 10,
    }),
    createLogEntry("api", "error", "POST /api/projects", "Creation failed", {
      path: "/api/projects",
      method: "POST",
      status: 500,
      durationMs: 80,
    }),
    createLogEntry("ui", "info", "button_click", "User clicked Deploy button", {
      meta: { button: "Deploy" },
    }),
    createLogEntry("ui", "warn", "canary_divert", "Canary weight shifted", {
      meta: { weight: 25 },
    }),
  ];

  // Category filter
  const apiOnly = filterLogs(sampleLogs, { category: "api" });
  assert.equal(apiOnly.length, 2);

  const uiOnly = filterLogs(sampleLogs, { category: "ui" });
  assert.equal(uiOnly.length, 2);

  // Level filter
  const errorsOnly = filterLogs(sampleLogs, { level: "error" });
  assert.equal(errorsOnly.length, 1);
  assert.equal(errorsOnly[0].status, 500);

  // Status filter
  const successOnly = filterLogs(sampleLogs, { statusFilter: "success" });
  assert.equal(successOnly.length, 1);

  const serverErrorOnly = filterLogs(sampleLogs, { statusFilter: "server_error" });
  assert.equal(serverErrorOnly.length, 1);

  // Search query
  const searched = filterLogs(sampleLogs, { searchQuery: "Deploy" });
  assert.equal(searched.length, 1);
  assert.equal(searched[0].action, "button_click");
});

test("calculateLogMetrics computes accurate telemetry stats", () => {
  const sampleLogs: LogEntry[] = [
    createLogEntry("api", "info", "GET /api/projects", "Success", {
      path: "/api/projects",
      method: "GET",
      status: 200,
      durationMs: 20,
    }),
    createLogEntry("api", "info", "GET /api/system", "Success", {
      path: "/api/system",
      method: "GET",
      status: 200,
      durationMs: 40,
    }),
    createLogEntry("api", "error", "POST /api/deployments", "Failed", {
      path: "/api/deployments",
      method: "POST",
      status: 502,
      durationMs: 120,
    }),
    createLogEntry("ui", "info", "toggle_theme", "Theme changed"),
    createLogEntry("ui", "warn", "modal_close", "Modal dismissed without save"),
  ];

  const metrics = calculateLogMetrics(sampleLogs);
  assert.equal(metrics.totalCount, 5);
  assert.equal(metrics.apiCount, 3);
  assert.equal(metrics.uiCount, 2);
  assert.equal(metrics.errorCount, 1);
  assert.equal(metrics.warnCount, 1);
  // (20 + 40 + 120) / 3 = 60ms
  assert.equal(metrics.avgApiLatencyMs, 60);
  // 2 out of 3 = 66.7%
  assert.equal(metrics.apiSuccessRate, 66.7);
  // Slowest endpoint should be /api/deployments
  assert.equal(metrics.slowestEndpoints[0].path, "/api/deployments");
  assert.equal(metrics.slowestEndpoints[0].durationMs, 120);
});

test("formatAsCurlCommand creates valid cURL representation", () => {
  const apiLog = createLogEntry("api", "info", "POST /api/projects", "Project created", {
    method: "POST",
    path: "/api/projects",
    status: 201,
    meta: {
      requestBody: { name: "my-web-app", port: 3000 },
      headers: { "x-hosterax-client": "dashboard" },
    },
  });

  const curl = formatAsCurlCommand(apiLog);
  assert.ok(curl.includes('curl -X POST "http://127.0.0.1:7777/api/projects"'));
  assert.ok(curl.includes('-H "Content-Type: application/json"'));
  assert.ok(curl.includes('-H "x-hosterax-client: dashboard"'));
  assert.ok(curl.includes('-d \'{"name":"my-web-app","port":3000}\''));
});

test("exportLogsAsJson and exportLogsAsCsv generate valid exports", () => {
  const sampleLogs: LogEntry[] = [
    createLogEntry("api", "info", "GET /health", "Healthy", {
      path: "/health",
      method: "GET",
      status: 200,
      durationMs: 4,
    }),
  ];

  const json = exportLogsAsJson(sampleLogs);
  assert.ok(json.includes('"category": "api"'));
  assert.ok(json.includes('"path": "/health"'));

  const csv = exportLogsAsCsv(sampleLogs);
  assert.ok(csv.startsWith("Timestamp,ISO Time,Category,Level,Action"));
  assert.ok(csv.includes("GET"));
  assert.ok(csv.includes("/health"));
});

test("appLogger singleton handles pub/sub events and buffer storage", () => {
  appLogger.clear();
  assert.equal(appLogger.getLogs().length, 0);

  let notified = false;
  const unsubscribe = appLogger.subscribe((entry) => {
    if (entry.action === "UI_TEST") notified = true;
  });

  appLogger.logUi("UI_TEST", "Test UI action executed");
  assert.equal(notified, true);
  assert.equal(appLogger.getLogs().length, 1);

  appLogger.logApi("GET", "/api/metrics", 200, 12);
  assert.equal(appLogger.getLogs().length, 2);

  unsubscribe();
});
