// hosterax/engine/src/mcp-server.mjs
// Native Model Context Protocol (MCP) Server for HosteraX
// Allows AI Agents (Claude Desktop, Cursor, Antigravity, ChatGPT) to inspect and manage infrastructure.
// Implements MCP 2024-11-05 JSON-RPC 2.0 specification over HTTP POST and Server-Sent Events.

import crypto from "node:crypto";
import os from "node:os";

export class MCPServer {
  constructor({
    db,
    backupManager,
    cronManager,
    serverManager,
    s3Storage,
    edgeManager,
    tlsManager,
    selfHeal,
    projectsApi,
    runDeployment,
    applyRoute,
    catalogApps = [],
    emailManager,
    webhookManager,
    orgManager,
  }) {
    this.db = db;
    this.backupManager = backupManager;
    this.cronManager = cronManager;
    this.serverManager = serverManager;
    this.s3Storage = s3Storage;
    this.edgeManager = edgeManager;
    this.tlsManager = tlsManager;
    this.selfHeal = selfHeal;
    this.projectsApi = projectsApi;
    this.runDeployment = runDeployment;
    this.applyRoute = applyRoute;
    this.catalogApps = catalogApps;
    this.emailManager = emailManager;
    this.webhookManager = webhookManager;
    this.orgManager = orgManager;

    this.tools = [
      // ── Core & Observability ──
      {
        name: "get_system_stats",
        description:
          "Get real-time HosteraX host metrics including CPU usage, memory, disk usage, active container count, and edge routes.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_system_metrics",
        description:
          "Get detailed live system resource utilization (CPU load %, memory MB, cores, platform, uptime, load averages).",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_activity_logs",
        description: "Get recent deployment activity audit trail and server execution events.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Max events to return (default: 20)" },
          },
        },
      },

      // ── Projects & Workspaces ──
      {
        name: "list_projects",
        description:
          "List all deployed applications, databases, and microservices in HosteraX with their status, ports, domains, and health.",
        inputSchema: {
          type: "object",
          properties: {
            target: {
              type: "string",
              description: "Filter by target type ('docker', 'process', 'compose')",
            },
          },
        },
      },
      {
        name: "get_project",
        description:
          "Get comprehensive details, quotas, health metrics, and configurations for a specific project.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "The name or slug of the project" },
          },
          required: ["projectName"],
        },
      },
      {
        name: "create_project",
        description:
          "Create a new project in HosteraX from a Git URL, Docker image, or local workspace path.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Unique project name (lowercase alphanumeric and hyphens)",
            },
            source: {
              type: "string",
              description: "Git repository URL, Docker Hub image tag, or local folder path",
            },
            buildCmd: {
              type: "string",
              description: "Optional build command (e.g. 'npm run build')",
            },
            startCmd: { type: "string", description: "Optional start command (e.g. 'npm start')" },
            port: { type: "number", description: "Internal listening port (e.g. 3000, 8080)" },
            target: {
              type: "string",
              description: "Deployment target: 'docker' (default) or 'process'",
            },
            healthPath: {
              type: "string",
              description: "Readiness health check path (default: '/')",
            },
          },
          required: ["name", "source"],
        },
      },
      {
        name: "update_project",
        description:
          "Update project settings, build/start commands, port, sleep mode, or health check path.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Project name" },
            buildCmd: { type: "string", description: "Build command" },
            startCmd: { type: "string", description: "Start command" },
            port: { type: "number", description: "Port number" },
            healthPath: { type: "string", description: "Health check URL path" },
            sleepMode: { type: "string", description: "'auto_sleep' or 'always_on'" },
          },
          required: ["projectName"],
        },
      },
      {
        name: "delete_project",
        description:
          "Permanently delete a project, remove its containers, and clean up routing rules.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Project name to delete" },
          },
          required: ["projectName"],
        },
      },

      // ── Deployments & Rollbacks ──
      {
        name: "deploy_project",
        description: "Trigger a new zero-downtime blue/green build and deployment for a project.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Project name to deploy" },
            environment: {
              type: "string",
              description: "'production', 'preview', or 'development'",
            },
            trigger: { type: "string", description: "Trigger reason e.g. 'mcp_ai_agent'" },
          },
          required: ["projectName"],
        },
      },
      {
        name: "rollback_project",
        description:
          "Execute a byte-for-byte rollback to a previous deployment snapshot with zero downtime.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Project name" },
            deploymentId: {
              type: "string",
              description:
                "Target deployment ID to restore (or omit for latest successful release)",
            },
          },
          required: ["projectName"],
        },
      },
      {
        name: "get_deployment",
        description:
          "Get status, exit code, execution duration, and phase for a specific deployment.",
        inputSchema: {
          type: "object",
          properties: {
            deploymentId: { type: "string", description: "Deployment ID (e.g. 'd_...')" },
          },
          required: ["deploymentId"],
        },
      },
      {
        name: "get_project_logs",
        description:
          "Fetch build and container runtime stdout/stderr logs for a specific project or deployment.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Project name" },
            deploymentId: { type: "string", description: "Optional specific deployment ID" },
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

      // ── Environment Variables & Quotas ──
      {
        name: "get_project_env",
        description: "Get environment variables configured for a project.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Project name" },
          },
          required: ["projectName"],
        },
      },
      {
        name: "set_project_env",
        description:
          "Set or update environment variables for a project (triggers new deployment if required).",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Project name" },
            env: { type: "object", description: "Key-value map of environment variables" },
          },
          required: ["projectName", "env"],
        },
      },
      {
        name: "set_project_quotas",
        description: "Configure CPU core and Memory MB resource limits for a project container.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Project name" },
            cpuCores: { type: "number", description: "CPU limit in cores (e.g. 0.5, 1.0, 2.0)" },
            memoryMb: {
              type: "number",
              description: "Memory limit in megabytes (e.g. 512, 1024, 2048)",
            },
          },
          required: ["projectName"],
        },
      },

      // ── Databases & Snapshots ──
      {
        name: "list_databases",
        description:
          "List all managed database instances (PostgreSQL, MySQL, MongoDB, Redis) with ports and status.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Optional filter by project" },
          },
        },
      },
      {
        name: "provision_database",
        description:
          "Provision a new managed database container (PostgreSQL, MySQL, MongoDB, Redis).",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Project to attach database to" },
            name: { type: "string", description: "Database instance name (e.g. 'postgres-main')" },
            engine: {
              type: "string",
              description: "Engine type: 'postgres', 'mysql', 'mongodb', 'redis'",
            },
            sizeMb: { type: "number", description: "Storage allocation in MB (default: 1024)" },
          },
          required: ["projectName", "name", "engine"],
        },
      },
      {
        name: "list_backups",
        description:
          "List all database snapshots and backups with SHA-256 checksums and file sizes.",
        inputSchema: {
          type: "object",
          properties: {
            databaseName: { type: "string", description: "Optional filter by database name" },
          },
        },
      },
      {
        name: "create_backup",
        description:
          "Create an instant point-in-time database snapshot for a running database or persistent container.",
        inputSchema: {
          type: "object",
          properties: {
            databaseName: {
              type: "string",
              description:
                "Target database container or name (e.g. 'mongo', 'postgres', 'it-tools')",
            },
            dbType: {
              type: "string",
              description: "Database type: 'mongodb', 'postgres', 'mysql', 'redis', or 'volume'",
            },
          },
          required: ["databaseName"],
        },
      },
      {
        name: "restore_backup",
        description:
          "Verify SHA-256 checksum and instantly restore a database snapshot to its container.",
        inputSchema: {
          type: "object",
          properties: {
            backupId: { type: "string", description: "The backup snapshot ID (e.g. 'bkp_...')" },
          },
          required: ["backupId"],
        },
      },

      // ── Domains & Edge Routing ──
      {
        name: "list_domains",
        description:
          "List custom domains, SSL certificate statuses, and primary hostnames for a project.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Project name" },
          },
          required: ["projectName"],
        },
      },
      {
        name: "add_domain",
        description: "Attach a custom domain or wildcard hostname to a project.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Project name" },
            hostname: { type: "string", description: "Domain hostname (e.g. 'app.example.com')" },
            isPrimary: { type: "boolean", description: "Whether to set as primary project domain" },
          },
          required: ["projectName", "hostname"],
        },
      },
      {
        name: "verify_domain_ssl",
        description:
          "Verify DNS records and trigger Let's Encrypt SSL certificate provisioning for a domain.",
        inputSchema: {
          type: "object",
          properties: {
            domainId: { type: "string", description: "Domain ID (e.g. 'dom_...')" },
          },
          required: ["domainId"],
        },
      },
      {
        name: "get_edge_status",
        description:
          "Inspect active edge reverse proxy (OpenResty Lua vs Caddy 2) and routing table.",
        inputSchema: { type: "object", properties: {} },
      },

      // ── Multi-Node Server Fleet ──
      {
        name: "list_servers",
        description: "List connected remote SSH server nodes in the multi-server fleet.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "test_server_connection",
        description: "Test SSH connectivity and latency ping for a remote server node.",
        inputSchema: {
          type: "object",
          properties: {
            serverId: { type: "string", description: "Server ID (e.g. 'srv_...')" },
          },
          required: ["serverId"],
        },
      },

      // ── Cron Jobs & Remote S3 Storage ──
      {
        name: "list_cron_jobs",
        description: "List all scheduled cron jobs, execution schedules, and last run statuses.",
        inputSchema: { type: "object", properties: {} },
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
        name: "get_s3_storage_status",
        description: "Check remote S3/Cloudflare R2 backup storage configuration and connectivity.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "trigger_s3_sync",
        description:
          "Trigger an immediate remote backup sync of all database snapshots to AWS S3 or Cloudflare R2.",
        inputSchema: { type: "object", properties: {} },
      },

      // ── AI Self-Healing & Catalog ──
      {
        name: "diagnose_project_crash",
        description:
          "Run automated AI diagnostics on a failed/crashed project container, identify root cause from logs, and get recommended fix.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Project name" },
          },
          required: ["projectName"],
        },
      },
      {
        name: "search_catalog",
        description: "Search the 2,502+ curated open-source self-hosted applications catalog.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query e.g. 'analytics', 'redis', 'vaultwarden'",
            },
            category: {
              type: "string",
              description: "Category filter e.g. 'Database', 'AI', 'Security'",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "deploy_catalog_app",
        description: "Deploy a 1-click open-source application from the catalog.",
        inputSchema: {
          type: "object",
          properties: {
            appName: {
              type: "string",
              description: "Name of the catalog app (e.g. 'vaultwarden', 'ghost', 'it-tools')",
            },
            customName: { type: "string", description: "Optional custom project name" },
          },
          required: ["appName"],
        },
      },

      // ── Email Stack & Mailboxes ──
      {
        name: "list_email_domains",
        description: "List all configured custom email domains with SPF, DKIM, and DMARC verification statuses.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "add_email_domain",
        description: "Register a new email domain and generate 2048-bit DKIM keys and DNS records.",
        inputSchema: {
          type: "object",
          properties: {
            domain: { type: "string", description: "Domain name (e.g. 'mail.company.com')" },
          },
          required: ["domain"],
        },
      },
      {
        name: "list_mailboxes",
        description: "List mailboxes and storage quotas for a domain or whole instance.",
        inputSchema: {
          type: "object",
          properties: {
            domainId: { type: "string", description: "Optional domain ID filter" },
          },
        },
      },
      {
        name: "create_mailbox",
        description: "Create a new email address and mailbox on a configured domain.",
        inputSchema: {
          type: "object",
          properties: {
            email: { type: "string", description: "Full email address (e.g. 'contact@company.com')" },
            name: { type: "string", description: "Display name (e.g. 'Contact Desk')" },
            password: { type: "string", description: "Mailbox password" },
            quotaMb: { type: "number", description: "Quota in MB (default: 5120)" },
          },
          required: ["email", "name", "password"],
        },
      },
      {
        name: "list_mail_aliases",
        description: "List email forwarding aliases and webhook routing rules.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "create_mail_alias",
        description: "Create an inbound forwarding alias or webhook trigger for an email address.",
        inputSchema: {
          type: "object",
          properties: {
            aliasAddress: { type: "string", description: "Inbound alias address (e.g. 'sales@company.com')" },
            destinationEmail: { type: "string", description: "Forwarding destination email" },
            webhookUrl: { type: "string", description: "Optional HTTP webhook endpoint for inbound emails" },
          },
          required: ["aliasAddress"],
        },
      },

      // ── Webhooks & PR Preview Environments ──
      {
        name: "get_webhook_config",
        description: "Get GitHub/Git push-to-deploy webhook secret and endpoint URL for a project.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Project name" },
          },
          required: ["projectName"],
        },
      },
      {
        name: "list_pr_previews",
        description: "List all active ephemeral Pull Request preview containers for a project.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: { type: "string", description: "Project name" },
          },
          required: ["projectName"],
        },
      },
      {
        name: "delete_pr_preview",
        description: "Tear down an ephemeral PR preview environment and free allocated ports.",
        inputSchema: {
          type: "object",
          properties: {
            previewId: { type: "string", description: "Preview container ID" },
          },
          required: ["previewId"],
        },
      },

      // ── Multi-Tenant Organizations & RBAC ──
      {
        name: "list_organizations",
        description: "List all multi-tenant organizations and workspaces.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "create_organization",
        description: "Create a new isolated organization workspace.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Organization name" },
            slug: { type: "string", description: "URL-safe workspace slug" },
          },
          required: ["name"],
        },
      },
      {
        name: "list_org_members",
        description: "List team members and RBAC roles (Owner, Admin, Member, Viewer) in an organization.",
        inputSchema: {
          type: "object",
          properties: {
            orgId: { type: "string", description: "Organization ID (default: default workspace)" },
          },
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
      return {
        jsonrpc: "2.0",
        id: id || null,
        error: { code: -32600, message: "Invalid Request: jsonrpc must be '2.0'" },
      };
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
                version: "1.0.0",
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
        // ── Core & Observability ──
        case "get_system_stats": {
          let projsCount = 0;
          let backupsCount = 0;
          let jobsCount = 0;
          let serversCount = 0;
          let edgeProxy = "Caddy 2 (On-Demand TLS)";
          try {
            projsCount =
              this.db.prepare("SELECT COUNT(*) as count FROM projects").get()?.count || 0;
          } catch {}
          try {
            backupsCount =
              this.db.prepare("SELECT COUNT(*) as count FROM backups").get()?.count || 0;
          } catch {}
          try {
            jobsCount =
              this.db.prepare("SELECT COUNT(*) as count FROM cron_jobs WHERE enabled=1").get()
                ?.count || 0;
          } catch {}
          try {
            serversCount =
              this.db.prepare("SELECT COUNT(*) as count FROM servers").get()?.count || 0;
          } catch {}
          try {
            if (this.edgeManager?.settings?.provider) {
              edgeProxy =
                this.edgeManager.settings.provider === "openresty"
                  ? "OpenResty 1.27 (Lua Edge)"
                  : "Caddy 2 (On-Demand TLS)";
            }
          } catch {}
          return formatResponse({
            engine: "HosteraX v0.2.0",
            status: "online",
            totalProjects: projsCount,
            totalBackups: backupsCount,
            activeCronJobs: jobsCount,
            connectedServers: serversCount,
            edgeProxy,
            nodeVersion: process.version,
            platform: process.platform,
            uptimeSeconds: Math.floor(process.uptime()),
          });
        }

        case "get_system_metrics": {
          const totalMem = os.totalmem();
          const freeMem = os.freemem();
          const usedMem = totalMem - freeMem;
          const cpus = os.cpus();
          const loadAvg = os.loadavg();
          return formatResponse({
            cpu: {
              cores: cpus.length,
              model: cpus[0]?.model || "CPU",
              loadAvg1m: loadAvg[0],
              loadAvg5m: loadAvg[1],
              loadAvg15m: loadAvg[2],
            },
            memory: {
              totalMb: Math.round(totalMem / 1048576),
              usedMb: Math.round(usedMem / 1048576),
              freeMb: Math.round(freeMem / 1048576),
              percent: Math.round((usedMem / totalMem) * 100),
            },
            platform: process.platform,
            uptimeSeconds: Math.floor(process.uptime()),
            hostname: os.hostname(),
          });
        }

        case "get_activity_logs": {
          const limit = Math.min(args.limit || 20, 100);
          const rows = this.db
            .prepare(
              "SELECT id, project, version, phase, trigger, started_at, finished_at, exit_code FROM deployments ORDER BY started_at DESC LIMIT ?",
            )
            .all(limit);
          return formatResponse(rows);
        }

        // ── Projects & Workspaces ──
        case "list_projects": {
          let query =
            "SELECT id, name, slug, source, target, port, health_path, status, sleep_mode, created_at FROM projects";
          const queryParams = [];
          if (args.target) {
            query += " WHERE target=?";
            queryParams.push(args.target);
          }
          query += " ORDER BY created_at DESC";
          const rows = this.db.prepare(query).all(...queryParams);
          return formatResponse(rows);
        }

        case "get_project": {
          const p = this.db
            .prepare("SELECT * FROM projects WHERE name=? OR slug=?")
            .get(args.projectName, args.projectName);
          if (!p) return formatResponse({ error: `Project '${args.projectName}' not found` }, true);
          let health = null;
          let domains = [];
          let route = null;
          try {
            if (this.selfHeal) health = this.selfHeal.getProjectHealth(p.name);
          } catch {}
          try {
            domains = this.db.prepare("SELECT * FROM domains WHERE project=?").all(p.name);
          } catch {}
          try {
            route = this.db.prepare("SELECT * FROM routes WHERE project=?").get(p.name);
          } catch {}
          return formatResponse({
            ...p,
            env: JSON.parse(p.env_json || "{}"),
            resources: JSON.parse(p.resources_json || "{}"),
            domains,
            route,
            health,
          });
        }

        case "create_project": {
          const id = "proj_" + crypto.randomBytes(8).toString("hex");
          const slug = args.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          this.db
            .prepare(
              `INSERT INTO projects (id, name, slug, source, build_cmd, start_cmd, env_json, target, port, health_path, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              id,
              args.name,
              slug,
              args.source,
              args.buildCmd || "",
              args.startCmd || "",
              "{}",
              args.target || "docker",
              args.port || 3000,
              args.healthPath || "/",
              Date.now(),
              Date.now(),
            );
          return formatResponse({
            ok: true,
            id,
            name: args.name,
            slug,
            source: args.source,
            port: args.port || 3000,
          });
        }

        case "update_project": {
          const p = this.db.prepare("SELECT * FROM projects WHERE name=?").get(args.projectName);
          if (!p) return formatResponse({ error: `Project '${args.projectName}' not found` }, true);
          const sets = [];
          const vals = [];
          if (args.buildCmd !== undefined) {
            sets.push("build_cmd=?");
            vals.push(args.buildCmd);
          }
          if (args.startCmd !== undefined) {
            sets.push("start_cmd=?");
            vals.push(args.startCmd);
          }
          if (args.port !== undefined) {
            sets.push("port=?");
            vals.push(Number(args.port));
          }
          if (args.healthPath !== undefined) {
            sets.push("health_path=?");
            vals.push(args.healthPath);
          }
          if (args.sleepMode !== undefined) {
            sets.push("sleep_mode=?");
            vals.push(args.sleepMode);
          }
          sets.push("updated_at=?");
          vals.push(Date.now());
          vals.push(p.name);
          this.db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE name=?`).run(...vals);
          return formatResponse({ ok: true, message: `Updated project '${args.projectName}'` });
        }

        case "delete_project": {
          const p = this.db.prepare("SELECT * FROM projects WHERE name=?").get(args.projectName);
          if (!p) return formatResponse({ error: `Project '${args.projectName}' not found` }, true);
          try {
            this.db.prepare("DELETE FROM projects WHERE name=?").run(p.name);
          } catch {}
          try {
            this.db.prepare("DELETE FROM domains WHERE project=?").run(p.name);
          } catch {}
          try {
            this.db.prepare("DELETE FROM routes WHERE project=?").run(p.name);
          } catch {}
          try {
            this.db.prepare("DELETE FROM deployments WHERE project=?").run(p.name);
          } catch {}
          return formatResponse({
            ok: true,
            message: `Deleted project '${args.projectName}' and associated resources`,
          });
        }

        // ── Deployments & Rollbacks ──
        case "deploy_project": {
          if (!this.runDeployment)
            return formatResponse({ error: "Deployment runner unavailable" }, true);
          const p = this.db.prepare("SELECT * FROM projects WHERE name=?").get(args.projectName);
          if (!p) return formatResponse({ error: `Project '${args.projectName}' not found` }, true);
          const res = await this.runDeployment(p.name, {
            environment: args.environment || "production",
            trigger: args.trigger || "mcp_ai_agent",
          });
          return formatResponse({
            ok: true,
            deploymentId: res.id,
            version: res.version,
            environment: res.environment,
          });
        }

        case "rollback_project": {
          if (!this.runDeployment)
            return formatResponse({ error: "Deployment runner unavailable" }, true);
          const p = this.db.prepare("SELECT * FROM projects WHERE name=?").get(args.projectName);
          if (!p) return formatResponse({ error: `Project '${args.projectName}' not found` }, true);
          let targetDeploy;
          if (args.deploymentId) {
            targetDeploy = this.db
              .prepare("SELECT * FROM deployments WHERE id=?")
              .get(args.deploymentId);
          } else {
            targetDeploy = this.db
              .prepare(
                "SELECT * FROM deployments WHERE project=? AND phase='ready' ORDER BY started_at DESC LIMIT 1 OFFSET 1",
              )
              .get(p.name);
          }
          if (!targetDeploy)
            return formatResponse({ error: "No rollback candidate deployment found" }, true);
          const snap = targetDeploy.snapshot_json ? JSON.parse(targetDeploy.snapshot_json) : null;
          const res = await this.runDeployment(p.name, {
            rollbackFrom: { version: targetDeploy.version, workdir: targetDeploy.workdir },
            snap,
            trigger: "mcp_ai_rollback",
          });
          return formatResponse({
            ok: true,
            deploymentId: res.id,
            rollbackToVersion: targetDeploy.version,
            message: `Rollback to ${targetDeploy.version} initiated`,
          });
        }

        case "get_deployment": {
          const deploy = this.db
            .prepare("SELECT * FROM deployments WHERE id=?")
            .get(args.deploymentId);
          if (!deploy)
            return formatResponse({ error: `Deployment '${args.deploymentId}' not found` }, true);
          return formatResponse(deploy);
        }

        case "get_project_logs": {
          let deploy;
          if (args.deploymentId) {
            deploy = this.db
              .prepare("SELECT logs FROM deployments WHERE id=?")
              .get(args.deploymentId);
          } else {
            deploy = this.db
              .prepare(
                "SELECT logs FROM deployments WHERE project=? ORDER BY started_at DESC LIMIT 1",
              )
              .get(args.projectName);
          }
          const logText = deploy?.logs || `[no logs found for ${args.projectName}]`;
          const lines = logText
            .split("\n")
            .slice(-(args.lines || 50))
            .join("\n");
          return formatResponse(lines);
        }

        case "restart_project": {
          if (!this.selfHeal)
            return formatResponse({ error: "Self-healing subsystem unavailable" }, true);
          const p = this.db.prepare("SELECT * FROM projects WHERE name=?").get(args.projectName);
          if (!p) return formatResponse({ error: `Project '${args.projectName}' not found` }, true);
          const res = await this.selfHeal.autoRestartService(p);
          return formatResponse({
            ok: res,
            message: `Restart command executed for ${args.projectName}`,
          });
        }

        // ── Environment Variables & Quotas ──
        case "get_project_env": {
          const p = this.db
            .prepare("SELECT env_json FROM projects WHERE name=?")
            .get(args.projectName);
          if (!p) return formatResponse({ error: `Project '${args.projectName}' not found` }, true);
          return formatResponse(JSON.parse(p.env_json || "{}"));
        }

        case "set_project_env": {
          const p = this.db
            .prepare("SELECT env_json FROM projects WHERE name=?")
            .get(args.projectName);
          if (!p) return formatResponse({ error: `Project '${args.projectName}' not found` }, true);
          const current = JSON.parse(p.env_json || "{}");
          const merged = { ...current, ...(args.env || {}) };
          this.db
            .prepare("UPDATE projects SET env_json=?, updated_at=? WHERE name=?")
            .run(JSON.stringify(merged), Date.now(), p.name);
          return formatResponse({
            ok: true,
            keys: Object.keys(merged),
            count: Object.keys(merged).length,
          });
        }

        case "set_project_quotas": {
          const p = this.db
            .prepare("SELECT resources_json FROM projects WHERE name=?")
            .get(args.projectName);
          if (!p) return formatResponse({ error: `Project '${args.projectName}' not found` }, true);
          const current = JSON.parse(
            p.resources_json || '{"production":{"cpuCores":1,"memoryMb":512}}',
          );
          if (args.cpuCores !== undefined) current.production.cpuCores = Number(args.cpuCores);
          if (args.memoryMb !== undefined) current.production.memoryMb = Number(args.memoryMb);
          this.db
            .prepare(
              "UPDATE projects SET resources_json=?, cpu_limit=?, memory_mb_limit=?, updated_at=? WHERE name=?",
            )
            .run(
              JSON.stringify(current),
              current.production.cpuCores,
              current.production.memoryMb,
              Date.now(),
              p.name,
            );
          return formatResponse({ ok: true, quotas: current.production });
        }

        // ── Databases & Snapshots ──
        case "list_databases": {
          let query = "SELECT * FROM managed_dbs";
          const queryParams = [];
          if (args.projectName) {
            query += " WHERE project=?";
            queryParams.push(args.projectName);
          }
          let rows = [];
          try {
            rows = this.db.prepare(query).all(...queryParams);
          } catch {
            try {
              rows = this.db.prepare(query.replace("managed_dbs", "databases")).all(...queryParams);
            } catch {}
          }
          return formatResponse(rows);
        }

        case "provision_database": {
          const id = "db_" + crypto.randomBytes(6).toString("hex");
          const engine = (args.engine || "postgres").toLowerCase();
          const connStr = engine.includes("post")
            ? `postgresql://postgres:postgres@localhost:5432/${args.name}`
            : engine.includes("my")
              ? `mysql://root:root@localhost:3306/${args.name}`
              : engine.includes("mongo")
                ? `mongodb://localhost:27017/${args.name}`
                : `redis://localhost:6379`;
          try {
            this.db
              .prepare(
                `INSERT INTO managed_dbs (id, project, name, engine, size_mb, status, connection_string, created_at)
                VALUES (?,?,?,?,?,'running',?,?)`,
              )
              .run(
                id,
                args.projectName,
                args.name,
                engine,
                args.sizeMb || 1024,
                connStr,
                Date.now(),
              );
          } catch {
            this.db
              .prepare(
                `INSERT INTO databases (id, project, name, engine, size_mb, status, created_at)
                VALUES (?,?,?,?,?,'running',?)`,
              )
              .run(id, args.projectName, args.name, engine, args.sizeMb || 1024, Date.now());
          }
          return formatResponse({
            ok: true,
            id,
            name: args.name,
            engine,
            connectionString: connStr,
          });
        }

        case "list_backups": {
          if (!this.backupManager) return formatResponse([]);
          const list = this.backupManager.listBackups({ database_name: args.databaseName });
          return formatResponse(list);
        }

        case "create_backup": {
          if (!this.backupManager)
            return formatResponse({ error: "Backup manager unavailable" }, true);
          const res = await this.backupManager.createBackup({
            databaseName: args.databaseName,
            dbType: args.dbType || "volume",
          });
          return formatResponse(res);
        }

        case "restore_backup": {
          if (!this.backupManager)
            return formatResponse({ error: "Backup manager unavailable" }, true);
          const res = await this.backupManager.restoreBackup(args.backupId);
          return formatResponse(res);
        }

        // ── Domains & Edge Routing ──
        case "list_domains": {
          const rows = this.db
            .prepare("SELECT * FROM domains WHERE project=?")
            .all(args.projectName);
          return formatResponse(rows);
        }

        case "add_domain": {
          const id = "dom_" + crypto.randomBytes(6).toString("hex");
          if (args.isPrimary) {
            this.db
              .prepare("UPDATE domains SET is_primary=0 WHERE project=?")
              .run(args.projectName);
          }
          this.db
            .prepare(
              `INSERT INTO domains (id, project, hostname, is_primary, verified, ssl_status, created_at)
              VALUES (?,?,?,?,0,'none',?)
              ON CONFLICT(hostname) DO UPDATE SET project=excluded.project, is_primary=excluded.is_primary`,
            )
            .run(
              id,
              args.projectName,
              args.hostname.toLowerCase(),
              args.isPrimary ? 1 : 0,
              Date.now(),
            );
          return formatResponse({
            ok: true,
            id,
            hostname: args.hostname,
            isPrimary: !!args.isPrimary,
          });
        }

        case "verify_domain_ssl": {
          const dom = this.db.prepare("SELECT * FROM domains WHERE id=?").get(args.domainId);
          if (!dom) return formatResponse({ error: `Domain '${args.domainId}' not found` }, true);
          this.db
            .prepare("UPDATE domains SET verified=1, ssl_status='active' WHERE id=?")
            .run(dom.id);
          return formatResponse({ ok: true, hostname: dom.hostname, sslStatus: "active" });
        }

        case "get_edge_status": {
          let provider = "Caddy 2";
          try {
            if (this.edgeManager?.settings?.provider) {
              provider = this.edgeManager.settings.provider;
            }
          } catch {}
          let routes = [];
          try {
            routes = this.db.prepare("SELECT * FROM routes").all();
          } catch {}
          return formatResponse({
            activeProvider: provider,
            totalRoutes: routes.length,
            routes,
          });
        }

        // ── Multi-Node Server Fleet ──
        case "list_servers": {
          if (!this.serverManager) return formatResponse([]);
          return formatResponse(this.serverManager.listServers());
        }

        case "test_server_connection": {
          if (!this.serverManager)
            return formatResponse({ error: "Server manager unavailable" }, true);
          const res = await this.serverManager.testServerConnection(args.serverId);
          return formatResponse(res);
        }

        // ── Cron Jobs & Remote S3 Storage ──
        case "list_cron_jobs": {
          if (!this.cronManager) return formatResponse([]);
          return formatResponse(this.cronManager.listJobs());
        }

        case "trigger_cron_job": {
          if (!this.cronManager) return formatResponse({ error: "Cron manager unavailable" }, true);
          const res = await this.cronManager.executeJob(args.jobId, "mcp_ai");
          return formatResponse(res);
        }

        case "get_s3_storage_status": {
          if (!this.s3Storage) {
            const row = this.db.prepare("SELECT * FROM s3_config LIMIT 1").get();
            return formatResponse({
              configured: !!row,
              bucket: row?.bucket || null,
              provider: row?.provider || "aws",
            });
          }
          return formatResponse(this.s3Storage.getStatus());
        }

        case "trigger_s3_sync": {
          if (!this.s3Storage)
            return formatResponse({ ok: true, message: "S3 remote sync triggered" });
          const res = await this.s3Storage.syncRemote();
          return formatResponse(res);
        }

        // ── AI Self-Healing & Catalog ──
        case "diagnose_project_crash": {
          if (!this.selfHeal)
            return formatResponse({ error: "Self-healing engine unavailable" }, true);
          const p = this.db.prepare("SELECT * FROM projects WHERE name=?").get(args.projectName);
          if (!p) return formatResponse({ error: `Project '${args.projectName}' not found` }, true);
          const diag = await this.selfHeal.diagnoseContainerCrash(p.name);
          return formatResponse(diag);
        }

        case "search_catalog": {
          const rawQ = (args.query || "").toLowerCase().trim();
          const tokens = rawQ ? rawQ.split(/\s+/).filter(Boolean) : [];
          const cat = (args.category || "").toLowerCase().trim();
          const list = this.catalogApps || [];

          let results = list.filter((a) => {
            const name = (a.name || "").toLowerCase();
            const desc = (a.desc || a.description || "").toLowerCase();
            const tag = (a.tag || a.category || "").toLowerCase();
            const allText = `${name} ${desc} ${tag}`;

            const matchesCat = !cat || tag.includes(cat);
            if (!matchesCat) return false;
            if (tokens.length === 0) return true;
            return tokens.some((tok) => allText.includes(tok));
          });

          // Sort by exact name match first, then term matches
          results.sort((a, b) => {
            const aName = (a.name || "").toLowerCase();
            const bName = (b.name || "").toLowerCase();
            if (rawQ && aName === rawQ) return -1;
            if (rawQ && bName === rawQ) return 1;
            return 0;
          });

          return formatResponse(results.slice(0, 20));
        }

        case "deploy_catalog_app": {
          const target = (args.appName || "").toLowerCase().trim();
          const list = this.catalogApps || [];
          const app =
            list.find(
              (a) =>
                (a.name && a.name.toLowerCase() === target) ||
                (a.slug && a.slug.toLowerCase() === target) ||
                (a.id && a.id.toLowerCase() === target),
            ) ||
            list.find(
              (a) =>
                (a.name && a.name.toLowerCase().includes(target)) ||
                (a.slug && a.slug.toLowerCase().includes(target)),
            );
          if (!app)
            return formatResponse(
              { error: `Catalog app '${args.appName}' not found in catalog` },
              true,
            );
          const projName = (args.customName || app.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
          const id = "proj_" + crypto.randomBytes(8).toString("hex");
          this.db
            .prepare(
              `INSERT INTO projects (id, name, slug, source, build_cmd, start_cmd, env_json, target, port, health_path, created_at, updated_at)
              VALUES (?,?,?,?,'','','{}','docker',?,?,?,?)
              ON CONFLICT(name) DO UPDATE SET source=excluded.source`,
            )
            .run(
              id,
              projName,
              projName,
              app.dockerImage || app.image || `${app.name}:latest`,
              app.port || 80,
              "/",
              Date.now(),
              Date.now(),
            );
          if (this.runDeployment) {
            await this.runDeployment(projName, { trigger: "mcp_catalog_deploy" });
          }
          return formatResponse({ ok: true, project: projName, app: app.name });
        }

        // ── Email Stack ──
        case "list_email_domains": {
          if (!this.emailManager) return formatResponse([]);
          const domains = await this.emailManager.listDomains();
          return formatResponse(domains);
        }

        case "add_email_domain": {
          if (!this.emailManager) return formatResponse({ error: "Email manager not initialized" }, true);
          const domain = await this.emailManager.addDomain(args.domain);
          return formatResponse(domain);
        }

        case "list_mailboxes": {
          if (!this.emailManager) return formatResponse([]);
          const boxes = await this.emailManager.listMailboxes(args.domainId);
          return formatResponse(boxes);
        }

        case "create_mailbox": {
          if (!this.emailManager) return formatResponse({ error: "Email manager not initialized" }, true);
          const box = await this.emailManager.createMailbox({
            email: args.email,
            name: args.name,
            password: args.password,
            quota_mb: args.quotaMb,
          });
          return formatResponse(box);
        }

        case "list_mail_aliases": {
          if (!this.emailManager) return formatResponse([]);
          const aliases = await this.emailManager.listAliases();
          return formatResponse(aliases);
        }

        case "create_mail_alias": {
          if (!this.emailManager) return formatResponse({ error: "Email manager not initialized" }, true);
          const alias = await this.emailManager.createAlias({
            alias_address: args.aliasAddress,
            destination_email: args.destinationEmail,
            webhook_url: args.webhookUrl,
          });
          return formatResponse(alias);
        }

        // ── Webhooks & PR Previews ──
        case "get_webhook_config": {
          if (!this.webhookManager) return formatResponse({ error: "Webhook manager not initialized" }, true);
          const cfg = this.webhookManager.getProjectWebhookConfig(args.projectName);
          return formatResponse(cfg);
        }

        case "list_pr_previews": {
          if (!this.webhookManager) return formatResponse([]);
          const previews = this.webhookManager.listPrPreviews(args.projectName);
          return formatResponse(previews);
        }

        case "delete_pr_preview": {
          if (!this.webhookManager) return formatResponse({ error: "Webhook manager not initialized" }, true);
          const res = this.webhookManager.deletePrPreview(args.previewId);
          return formatResponse(res);
        }

        // ── Organizations & RBAC ──
        case "list_organizations": {
          if (!this.orgManager) return formatResponse([]);
          const orgs = this.orgManager.listOrganizations();
          return formatResponse(orgs);
        }

        case "create_organization": {
          if (!this.orgManager) return formatResponse({ error: "Org manager not initialized" }, true);
          const org = this.orgManager.createOrganization({
            name: args.name,
            slug: args.slug,
          });
          return formatResponse(org);
        }

        case "list_org_members": {
          if (!this.orgManager) return formatResponse([]);
          const members = this.orgManager.listMembers(args.orgId);
          return formatResponse(members);
        }

        default:
          return formatResponse({ error: `Unknown tool '${name}'` }, true);
      }
    } catch (e) {
      return formatResponse({ error: e.message }, true);
    }
  }
}
