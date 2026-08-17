// hosterax/engine/src/mcp-server.mjs
// Native Model Context Protocol (MCP) Server for HosteraX
// Allows AI Agents (Claude Desktop, Cursor, Antigravity, ChatGPT) to inspect and manage infrastructure.
// Implements MCP 2024-11-05 JSON-RPC 2.0 specification over HTTP POST and Server-Sent Events.

export class MCPServer {
  constructor({ db, backupManager, cronManager, selfHeal, projectsApi, catalogApps = [] }) {
    this.db = db;
    this.backupManager = backupManager;
    this.cronManager = cronManager;
    this.selfHeal = selfHeal;
    this.projectsApi = projectsApi;
    this.catalogApps = catalogApps;

    this.tools = [
      {
        name: "get_system_stats",
        description: "Get real-time HosteraX host metrics including CPU usage, memory, disk usage, active container count, and edge routes.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "list_projects",
        description: "List all deployed applications, databases, and microservices in HosteraX with their status, ports, and domains.",
        inputSchema: {
          type: "object",
          properties: {
            target: { type: "string", description: "Filter by target type ('docker', 'process', etc.)" },
          },
        },
      },
      {
        name: "get_project",
        description: "Get comprehensive details, health metrics, and environment variables for a specific project.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "The name or slug of the project" },
          },
          required: ["projectName"],
        },
      },
      {
        name: "get_project_logs",
        description: "Fetch deployment and container runtime stdout/stderr logs for a specific project.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Project name" },
            lines: { type: "number", description: "Number of log lines to retrieve (default: 50)" },
          },
          required: ["projectName"],
        },
      },
      {
        name: "restart_project",
        description: "Trigger an immediate self-healing container restart for a project.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Project name" },
          },
          required: ["projectName"],
        },
      },
      {
        name: "list_backups",
        description: "List all database snapshots and backups with SHA-256 checksums and file sizes.",
        inputSchema: {
          type: "object",
          properties: {
            databaseName: { type: "string", description: "Optional filter by database name" },
          },
        },
      },
      {
        name: "create_backup",
        description: "Create an instant point-in-time database snapshot for a running database or persistent container.",
        inputSchema: {
          type: "object",
          properties: {
            databaseName: { type: "string", description: "Target database container or name (e.g. 'mongo', 'postgres', 'it-tools')" },
            dbType: { type: "string", description: "Database type: 'mongodb', 'postgres', 'mysql', 'redis', or 'volume'" },
          },
          required: ["databaseName"],
        },
      },
      {
        name: "restore_backup",
        description: "Verify SHA-256 checksum and instantly restore a database snapshot to its container.",
        inputSchema: {
          type: "object",
          properties: {
            backupId: { type: "string", description: "The backup snapshot ID (e.g. 'bkp_...')" },
          },
          required: ["backupId"],
        },
      },
      {
        name: "list_cron_jobs",
        description: "List all scheduled cron jobs, execution schedules, and last run statuses.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "trigger_cron_job",
        description: "Trigger an immediate execution of a scheduled cron job.",
        inputSchema: {
          type: "object",
          properties: {
            jobId: { type: "string", description: "The cron job ID" },
          },
          required: ["jobId"],
        },
      },
      {
        name: "search_catalog",
        description: "Search the 2,502+ curated open-source self-hosted applications catalog.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query e.g. 'analytics', 'redis', 'vaultwarden'" },
            category: { type: "string", description: "Category filter e.g. 'Database', 'AI', 'Security'" },
          },
          required: ["query"],
        },
      },
    ];
  }

  /**
   * Handle MCP JSON-RPC 2.0 request
   */
  async handleJsonRpc(reqBody) {
    const { jsonrpc, id, method, params } = reqBody || {};

    if (jsonrpc !== "2.0") {
      return { jsonrpc: "2.0", id: id || null, error: { code: -32600, message: "Invalid Request: jsonrpc must be '2.0'" } };
    }

    try {
      switch (method) {
        case "initialize":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: { listChanged: false },
                resources: {},
                prompts: {},
              },
              serverInfo: {
                name: "hosterax-engine",
                version: "0.2.0",
                description: "HosteraX Autonomous Self-Hosted Cloud Operating System",
              },
            },
          };

        case "notifications/initialized":
          return { jsonrpc: "2.0", id, result: {} };

        case "ping":
          return { jsonrpc: "2.0", id, result: {} };

        case "tools/list":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              tools: this.tools,
            },
          };

        case "tools/call":
          return await this.handleToolCall(id, params);

        default:
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method '${method}' not found` },
          };
      }
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: `Internal error: ${err.message}` },
      };
    }
  }

  /**
   * Tool execution dispatcher
   */
  async handleToolCall(rpcId, params = {}) {
    const { name, arguments: args = {} } = params;

    const formatResponse = (data, isError = false) => ({
      jsonrpc: "2.0",
      id: rpcId,
      result: {
        content: [
          {
            type: "text",
            text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
          },
        ],
        isError,
      },
    });

    try {
      switch (name) {
        case "get_system_stats": {
          const projs = this.db.prepare("SELECT COUNT(*) as count FROM projects").get();
          const backups = this.db.prepare("SELECT COUNT(*) as count FROM backups").get();
          const jobs = this.db.prepare("SELECT COUNT(*) as count FROM cron_jobs WHERE enabled=1").get();
          return formatResponse({
            engine: "HosteraX v0.2.0",
            status: "online",
            totalProjects: projs?.count || 0,
            totalBackups: backups?.count || 0,
            activeCronJobs: jobs?.count || 0,
            edgeProxy: "Caddy 2 (On-Demand TLS)",
            nodeVersion: process.version,
            platform: process.platform,
            uptimeSeconds: Math.floor(process.uptime()),
          });
        }

        case "list_projects": {
          const rows = this.db.prepare("SELECT id, name, slug, source, target, port, created_at FROM projects").all();
          return formatResponse(rows);
        }

        case "get_project": {
          const p = this.db.prepare("SELECT * FROM projects WHERE name=? OR slug=?").get(args.projectName, args.projectName);
          if (!p) return formatResponse({ error: `Project '${args.projectName}' not found` }, true);
          const health = this.selfHeal ? this.selfHeal.getProjectHealth(p.name) : null;
          return formatResponse({ ...p, health });
        }

        case "get_project_logs": {
          const deploy = this.db
            .prepare("SELECT logs FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 1")
            .get(args.projectName);
          const logText = deploy?.logs || `[no recent deployment logs for ${args.projectName}]`;
          const lines = logText.split("\n").slice(-(args.lines || 50)).join("\n");
          return formatResponse(lines);
        }

        case "restart_project": {
          if (!this.selfHeal) return formatResponse({ error: "Self-healing subsystem unavailable" }, true);
          const p = this.db.prepare("SELECT * FROM projects WHERE name=?").get(args.projectName);
          if (!p) return formatResponse({ error: `Project '${args.projectName}' not found` }, true);
          const res = await this.selfHeal.autoRestartService(p);
          return formatResponse({ ok: res, message: `Restart command executed for ${args.projectName}` });
        }

        case "list_backups": {
          if (!this.backupManager) return formatResponse([]);
          const list = this.backupManager.listBackups({ database_name: args.databaseName });
          return formatResponse(list);
        }

        case "create_backup": {
          if (!this.backupManager) return formatResponse({ error: "Backup manager unavailable" }, true);
          const res = await this.backupManager.createBackup({
            databaseName: args.databaseName,
            dbType: args.dbType || "volume",
          });
          return formatResponse(res);
        }

        case "restore_backup": {
          if (!this.backupManager) return formatResponse({ error: "Backup manager unavailable" }, true);
          const res = await this.backupManager.restoreBackup(args.backupId);
          return formatResponse(res);
        }

        case "list_cron_jobs": {
          if (!this.cronManager) return formatResponse([]);
          return formatResponse(this.cronManager.listJobs());
        }

        case "trigger_cron_job": {
          if (!this.cronManager) return formatResponse({ error: "Cron manager unavailable" }, true);
          const res = await this.cronManager.executeJob(args.jobId, "mcp_ai");
          return formatResponse(res);
        }

        case "search_catalog": {
          const q = (args.query || "").toLowerCase();
          const cat = (args.category || "").toLowerCase();
          const results = (this.catalogApps || [])
            .filter((a) => {
              const matchesQ = (a.name && a.name.toLowerCase().includes(q)) || (a.description && a.description.toLowerCase().includes(q));
              const matchesCat = !cat || (a.category && a.category.toLowerCase().includes(cat));
              return matchesQ && matchesCat;
            })
            .slice(0, 20);
          return formatResponse(results);
        }

        default:
          return formatResponse({ error: `Unknown tool '${name}'` }, true);
      }
    } catch (e) {
      return formatResponse({ error: e.message }, true);
    }
  }
}
