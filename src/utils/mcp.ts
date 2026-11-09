// src/utils/mcp.ts
// Utility functions for HosteraX Model Context Protocol (MCP) subsystem

export interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

export type McpCategory =
  | "All"
  | "Observability"
  | "Deployments"
  | "Databases"
  | "Networking & Edge"
  | "Automation"
  | "Email & Mailboxes"
  | "Team & RBAC";

/** Categorizes an MCP tool by its name and purpose. */
export function categorizeMcpTool(name: string): McpCategory {
  const n = name.toLowerCase();
  if (
    n.includes("crash") ||
    n.includes("diagnose") ||
    n.includes("metric") ||
    n.includes("stat") ||
    n.includes("_log") ||
    n.endsWith("logs") ||
    n.startsWith("log_")
  ) {
    return "Observability";
  }
  if (
    n.includes("catalog") ||
    n.includes("deploy") ||
    n.includes("rollback") ||
    n.includes("project") ||
    n.includes("preview") ||
    n.includes("webhook")
  ) {
    return "Deployments";
  }
  if (n.includes("database") || n.includes("backup") || n.includes("s3")) {
    return "Databases";
  }
  if (n.includes("domain") || n.includes("ssl") || n.includes("edge") || n.includes("server")) {
    return "Networking & Edge";
  }
  if (n.includes("cron") || n.includes("job") || n.includes("schedule")) {
    return "Automation";
  }
  if (n.includes("mail") || n.includes("email") || n.includes("alias")) {
    return "Email & Mailboxes";
  }
  if (n.includes("org") || n.includes("member") || n.includes("token") || n.includes("user")) {
    return "Team & RBAC";
  }
  return "Deployments";
}

/** Builds a standard MCP JSON-RPC 2.0 request payload. */
export function buildMcpCallPayload(
  toolName: string,
  args: Record<string, any> = {},
  id: number | string = 1,
) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args,
    },
  };
}

export type IdeClientType = "cursor" | "claude_desktop" | "windsurf" | "claude_code";

/** Generates standard client configuration snippet for a given IDE and API token. */
export function generateIdeConfig(client: IdeClientType, engineUrl: string, apiToken: string) {
  const tokenPlaceholder = apiToken || "<YOUR_HOSTERAX_API_TOKEN>";
  const cleanUrl = (engineUrl || "http://127.0.0.1:7777").replace(/\/$/, "");

  switch (client) {
    case "cursor":
      return {
        filename: ".cursor/mcp.json",
        snippet: JSON.stringify(
          {
            mcpServers: {
              hosterax: {
                url: `${cleanUrl}/api/mcp`,
                headers: {
                  Authorization: `Bearer ${tokenPlaceholder}`,
                },
              },
            },
          },
          null,
          2,
        ),
      };

    case "claude_desktop":
      return {
        filename: "claude_desktop_config.json",
        snippet: JSON.stringify(
          {
            mcpServers: {
              hosterax: {
                command: "npx",
                args: ["-y", "hosterax", "mcp:stdio"],
                env: {
                  HOSTERAX_URL: cleanUrl,
                  HOSTERAX_TOKEN: tokenPlaceholder,
                },
              },
            },
          },
          null,
          2,
        ),
      };

    case "windsurf":
      return {
        filename: "~/.codeium/windsurf/mcp_config.json",
        snippet: JSON.stringify(
          {
            mcpServers: {
              hosterax: {
                url: `${cleanUrl}/api/mcp`,
                headers: {
                  Authorization: `Bearer ${tokenPlaceholder}`,
                },
              },
            },
          },
          null,
          2,
        ),
      };

    case "claude_code":
      return {
        filename: "Terminal Command",
        snippet: `claude mcp add hosterax -- ${cleanUrl}/api/mcp -H "Authorization: Bearer ${tokenPlaceholder}"`,
      };

    default:
      return {
        filename: "mcp-config.json",
        snippet: JSON.stringify(
          { mcpServers: { hosterax: { url: `${cleanUrl}/api/mcp` } } },
          null,
          2,
        ),
      };
  }
}

/** Formats JSON-RPC response or errors cleanly for the UI inspector. */
export function formatMcpResponse(response: any): { isError: boolean; data: any; rawText: string } {
  if (!response) {
    return { isError: true, data: null, rawText: "No response received" };
  }
  if (response.error) {
    return {
      isError: true,
      data: response.error,
      rawText: JSON.stringify(response.error, null, 2),
    };
  }
  const result = response.result !== undefined ? response.result : response;
  return {
    isError: false,
    data: result,
    rawText: JSON.stringify(result, null, 2),
  };
}
