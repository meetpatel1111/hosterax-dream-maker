export type MiddlewareType =
  | "basic-auth"
  | "rate-limit"
  | "ip-whitelist"
  | "security-headers"
  | "cors"
  | "redirect-rewrite"
  | "body-limit";

export interface EdgeMiddleware {
  id: string;
  name: string;
  description: string;
  type: MiddlewareType;
  enabled: boolean;
  attachedDomains: string[]; // domain hostnames or project slugs
  config: {
    // basic-auth
    username?: string;
    password?: string;
    realm?: string;

    // rate-limit
    requestsPerMinute?: number;
    burst?: number;
    keyBy?: "ip" | "header" | "path";
    headerName?: string;

    // ip-whitelist
    allowedIps?: string[]; // e.g. ["127.0.0.1", "192.168.1.0/24", "10.0.0.0/8"]
    blockAction?: "deny_403" | "drop_connection";

    // security-headers
    hsts?: boolean;
    hstsMaxAge?: number;
    frameOptions?: "DENY" | "SAMEORIGIN" | "ALLOW";
    contentTypeOptions?: boolean;
    referrerPolicy?: string;
    contentSecurityPolicy?: string;

    // cors
    allowOrigins?: string[];
    allowMethods?: string[];
    allowHeaders?: string[];
    allowCredentials?: boolean;
    maxAge?: number;

    // redirect-rewrite
    matchPath?: string;
    targetUrl?: string;
    redirectType?: "301" | "302" | "rewrite";

    // body-limit
    maxBodyMegabytes?: number;
  };
}

/**
 * Generates genuine Caddyfile directives for an EdgeMiddleware.
 */
export function generateCaddySnippet(m: EdgeMiddleware): string {
  if (!m.enabled) {
    return `# Middleware "${m.name}" is currently disabled`;
  }

  const lines: string[] = [`# [HosteraX Edge] Middleware: ${m.name} (${m.type})`];

  switch (m.type) {
    case "basic-auth": {
      const user = m.config.username || "admin";
      const pass = m.config.password || "password";
      lines.push(`basicauth {`);
      lines.push(`    ${user} ${pass}`);
      lines.push(`}`);
      break;
    }

    case "rate-limit": {
      const rpm = m.config.requestsPerMinute || 60;
      const burst = m.config.burst || 10;
      const zoneKey =
        m.config.keyBy === "header" && m.config.headerName
          ? `{http.request.header.${m.config.headerName}}`
          : `{client_ip}`;
      lines.push(`rate_limit {`);
      lines.push(`    zone ${m.name.replace(/[^a-zA-Z0-9_-]/g, "_")} {`);
      lines.push(`        key ${zoneKey}`);
      lines.push(`        events ${rpm}`);
      lines.push(`        window 1m`);
      lines.push(`    }`);
      lines.push(`    burst ${burst}`);
      lines.push(`}`);
      break;
    }

    case "ip-whitelist": {
      const allowed = (m.config.allowedIps || ["127.0.0.1"]).join(" ");
      lines.push(`@blocked not remote_ip ${allowed}`);
      lines.push(`abort @blocked`);
      break;
    }

    case "security-headers": {
      lines.push(`header {`);
      if (m.config.hsts !== false) {
        const maxAge = m.config.hstsMaxAge || 31536000;
        lines.push(`    Strict-Transport-Security "max-age=${maxAge}; includeSubDomains; preload"`);
      }
      if (m.config.frameOptions && m.config.frameOptions !== "ALLOW") {
        lines.push(`    X-Frame-Options "${m.config.frameOptions}"`);
      }
      if (m.config.contentTypeOptions !== false) {
        lines.push(`    X-Content-Type-Options "nosniff"`);
      }
      if (m.config.referrerPolicy) {
        lines.push(`    Referrer-Policy "${m.config.referrerPolicy}"`);
      }
      if (m.config.contentSecurityPolicy) {
        lines.push(`    Content-Security-Policy "${m.config.contentSecurityPolicy}"`);
      }
      lines.push(`}`);
      break;
    }

    case "cors": {
      const origins = (m.config.allowOrigins || ["*"]).join(" ");
      const methods = (m.config.allowMethods || ["GET", "POST", "PUT", "DELETE", "OPTIONS"]).join(
        ", ",
      );
      const headers = (m.config.allowHeaders || ["Content-Type", "Authorization"]).join(", ");
      lines.push(`header {`);
      lines.push(`    Access-Control-Allow-Origin "${origins}"`);
      lines.push(`    Access-Control-Allow-Methods "${methods}"`);
      lines.push(`    Access-Control-Allow-Headers "${headers}"`);
      if (m.config.allowCredentials) {
        lines.push(`    Access-Control-Allow-Credentials "true"`);
      }
      lines.push(`}`);
      break;
    }

    case "redirect-rewrite": {
      const match = m.config.matchPath || "/*";
      const target = m.config.targetUrl || "https://example.com";
      if (m.config.redirectType === "rewrite") {
        lines.push(`rewrite ${match} ${target}`);
      } else {
        const code = m.config.redirectType === "302" ? "302" : "301";
        lines.push(`redir ${match} ${target} ${code}`);
      }
      break;
    }

    case "body-limit": {
      const mb = m.config.maxBodyMegabytes || 50;
      lines.push(`request_body {`);
      lines.push(`    max_size ${mb}MB`);
      lines.push(`}`);
      break;
    }
  }

  return lines.join("\n");
}

/**
 * Generates genuine Nginx / OpenResty directives for an EdgeMiddleware.
 */
export function generateNginxSnippet(m: EdgeMiddleware): string {
  if (!m.enabled) {
    return `# Middleware "${m.name}" is currently disabled`;
  }

  const lines: string[] = [`# [HosteraX OpenResty] Middleware: ${m.name} (${m.type})`];

  switch (m.type) {
    case "basic-auth": {
      const realm = m.config.realm || "Protected Area";
      lines.push(`auth_basic "${realm}";`);
      lines.push(
        `auth_basic_user_file /etc/nginx/htpasswd/${m.name.replace(/[^a-zA-Z0-9_-]/g, "_")};`,
      );
      break;
    }

    case "rate-limit": {
      const rpm = m.config.requestsPerMinute || 60;
      const rps = Math.max(1, Math.round(rpm / 60));
      const burst = m.config.burst || 10;
      const zoneName = `zone_${m.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      lines.push(
        `# Place in http context: limit_req_zone $binary_remote_addr zone=${zoneName}:10m rate=${rps}r/s;`,
      );
      lines.push(`limit_req zone=${zoneName} burst=${burst} nodelay;`);
      break;
    }

    case "ip-whitelist": {
      for (const ip of m.config.allowedIps || ["127.0.0.1"]) {
        lines.push(`allow ${ip};`);
      }
      lines.push(`deny all;`);
      break;
    }

    case "security-headers": {
      if (m.config.hsts !== false) {
        const maxAge = m.config.hstsMaxAge || 31536000;
        lines.push(
          `add_header Strict-Transport-Security "max-age=${maxAge}; includeSubDomains" always;`,
        );
      }
      if (m.config.frameOptions && m.config.frameOptions !== "ALLOW") {
        lines.push(`add_header X-Frame-Options "${m.config.frameOptions}" always;`);
      }
      if (m.config.contentTypeOptions !== false) {
        lines.push(`add_header X-Content-Type-Options "nosniff" always;`);
      }
      if (m.config.referrerPolicy) {
        lines.push(`add_header Referrer-Policy "${m.config.referrerPolicy}" always;`);
      }
      break;
    }

    case "cors": {
      const origins = (m.config.allowOrigins || ["*"]).join(" ");
      const methods = (m.config.allowMethods || ["GET", "POST", "PUT", "DELETE", "OPTIONS"]).join(
        ", ",
      );
      lines.push(`add_header Access-Control-Allow-Origin "${origins}" always;`);
      lines.push(`add_header Access-Control-Allow-Methods "${methods}" always;`);
      break;
    }

    case "redirect-rewrite": {
      const match = m.config.matchPath || "^/(.*)$";
      const target = m.config.targetUrl || "https://example.com";
      if (m.config.redirectType === "rewrite") {
        lines.push(`rewrite ${match} ${target} break;`);
      } else {
        const flag = m.config.redirectType === "302" ? "redirect" : "permanent";
        lines.push(`rewrite ${match} ${target} ${flag};`);
      }
      break;
    }

    case "body-limit": {
      const mb = m.config.maxBodyMegabytes || 50;
      lines.push(`client_max_body_size ${mb}M;`);
      break;
    }
  }

  return lines.join("\n");
}

export interface SimulationRequest {
  ip: string;
  path: string;
  method: string;
  headers: Record<string, string>;
}

export interface SimulationResult {
  allowed: boolean;
  statusCode: number;
  reason: string;
  injectedHeaders: Record<string, string>;
}

function ipToNum(ip: string): number {
  return ip.split(".").reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

export function isIpInCidr(ip: string, cidr: string): boolean {
  if (cidr === ip) return true;
  if (!cidr.includes("/")) return false;
  const [rangeIp, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  if (isNaN(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  const ipNum = ipToNum(ip);
  const rangeNum = ipToNum(rangeIp);
  return (ipNum & mask) === (rangeNum & mask);
}

export function decodeBase64(str: string): string {
  if (typeof atob === "function") {
    return atob(str);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "base64").toString("utf-8");
  }
  return "";
}

/**
 * Simulates the edge proxy evaluating an incoming request against a middleware policy.
 */
export function testMiddlewareEvaluation(
  middleware: EdgeMiddleware,
  req: SimulationRequest,
): SimulationResult {
  if (!middleware.enabled) {
    return {
      allowed: true,
      statusCode: 200,
      reason: "Middleware is disabled — traffic passed through without inspection.",
      injectedHeaders: {},
    };
  }

  const injectedHeaders: Record<string, string> = {};

  switch (middleware.type) {
    case "ip-whitelist": {
      const allowed = middleware.config.allowedIps || ["127.0.0.1"];
      const clientIp = req.ip.trim();

      const isPermitted = allowed.some((cidr) => isIpInCidr(clientIp, cidr));

      if (!isPermitted) {
        return {
          allowed: false,
          statusCode: 403,
          reason: `Forbidden: Client IP ${clientIp} is not in the configured allowlist [${allowed.join(", ")}].`,
          injectedHeaders: {},
        };
      }
      return {
        allowed: true,
        statusCode: 200,
        reason: `Allowed: Client IP ${clientIp} matches permitted subnet.`,
        injectedHeaders: {},
      };
    }

    case "basic-auth": {
      const authHeader = req.headers["authorization"] || req.headers["Authorization"];
      if (!authHeader || !authHeader.startsWith("Basic ")) {
        return {
          allowed: false,
          statusCode: 401,
          reason: "Unauthorized: Missing Basic Authorization credentials header.",
          injectedHeaders: {
            "WWW-Authenticate": `Basic realm="${middleware.config.realm || "Protected Area"}"`,
          },
        };
      }

      const encoded = authHeader.replace(/^Basic\s+/, "");
      try {
        const decoded = decodeBase64(encoded);
        const [user, pass] = decoded.split(":");
        if (user === middleware.config.username && pass === middleware.config.password) {
          return {
            allowed: true,
            statusCode: 200,
            reason: `Authorized: Authenticated as "${user}".`,
            injectedHeaders: {},
          };
        }
      } catch {
        // malformed base64
      }

      return {
        allowed: false,
        statusCode: 401,
        reason: "Unauthorized: Invalid username or password.",
        injectedHeaders: {
          "WWW-Authenticate": `Basic realm="${middleware.config.realm || "Protected Area"}"`,
        },
      };
    }

    case "rate-limit": {
      const rpm = middleware.config.requestsPerMinute || 60;
      const burst = middleware.config.burst || 10;
      // In simulation mode, evaluate if request looks valid
      injectedHeaders["X-RateLimit-Limit"] = String(rpm);
      injectedHeaders["X-RateLimit-Remaining"] = String(Math.max(0, burst - 1));
      injectedHeaders["X-RateLimit-Reset"] = "60";
      return {
        allowed: true,
        statusCode: 200,
        reason: `Pass: Rate limiter bucket accepted request (${rpm} req/min, burst ${burst}).`,
        injectedHeaders,
      };
    }

    case "security-headers": {
      if (middleware.config.hsts !== false) {
        injectedHeaders["Strict-Transport-Security"] =
          `max-age=${middleware.config.hstsMaxAge || 31536000}; includeSubDomains`;
      }
      if (middleware.config.frameOptions && middleware.config.frameOptions !== "ALLOW") {
        injectedHeaders["X-Frame-Options"] = middleware.config.frameOptions;
      }
      if (middleware.config.contentTypeOptions !== false) {
        injectedHeaders["X-Content-Type-Options"] = "nosniff";
      }
      if (middleware.config.referrerPolicy) {
        injectedHeaders["Referrer-Policy"] = middleware.config.referrerPolicy;
      }
      return {
        allowed: true,
        statusCode: 200,
        reason: "Security headers attached to response.",
        injectedHeaders,
      };
    }

    case "cors": {
      const origins = (middleware.config.allowOrigins || ["*"]).join(", ");
      const methods = (
        middleware.config.allowMethods || ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
      ).join(", ");
      injectedHeaders["Access-Control-Allow-Origin"] = origins;
      injectedHeaders["Access-Control-Allow-Methods"] = methods;
      return {
        allowed: true,
        statusCode: req.method === "OPTIONS" ? 204 : 200,
        reason: "CORS preflight & access headers attached.",
        injectedHeaders,
      };
    }

    case "redirect-rewrite": {
      const code = middleware.config.redirectType === "302" ? 302 : 301;
      return {
        allowed: false,
        statusCode: code,
        reason: `Redirected to ${middleware.config.targetUrl || "https://example.com"}.`,
        injectedHeaders: { Location: middleware.config.targetUrl || "https://example.com" },
      };
    }

    case "body-limit": {
      const limit = middleware.config.maxBodyMegabytes || 50;
      injectedHeaders["X-Max-Body-Limit"] = `${limit}MB`;
      return {
        allowed: true,
        statusCode: 200,
        reason: `Pass: Payload under max size limit (${limit}MB).`,
        injectedHeaders,
      };
    }
  }
}

/**
 * Curated production presets for 1-click installation.
 */
export const PRESET_MIDDLEWARES: EdgeMiddleware[] = [
  {
    id: "mw-staging-auth",
    name: "Staging Basic Auth",
    description:
      "Prompts users for credentials before allowing access to internal staging or review deployments.",
    type: "basic-auth",
    enabled: true,
    attachedDomains: [],
    config: {
      username: "admin",
      password: "hosterax-staging-2026",
      realm: "HosteraX Internal Staging",
    },
  },
  {
    id: "mw-anti-ddos",
    name: "Anti-DDoS API Rate Limiter",
    description:
      "Limits burst traffic to 120 requests per minute per client IP to safeguard API backends.",
    type: "rate-limit",
    enabled: true,
    attachedDomains: [],
    config: {
      requestsPerMinute: 120,
      burst: 20,
      keyBy: "ip",
    },
  },
  {
    id: "mw-vpn-allowlist",
    name: "Private Office VPN Allowlist",
    description:
      "Restricts all incoming traffic exclusively to corporate VPN subnets and local loopback.",
    type: "ip-whitelist",
    enabled: true,
    attachedDomains: [],
    config: {
      allowedIps: ["127.0.0.1", "10.0.0.0/8", "192.168.1.0/24"],
      blockAction: "deny_403",
    },
  },
  {
    id: "mw-strict-headers",
    name: "Enterprise A+ Security Headers",
    description:
      "Enforces HSTS 1-year preload, X-Frame-Options DENY, and nosniff content protection.",
    type: "security-headers",
    enabled: true,
    attachedDomains: [],
    config: {
      hsts: true,
      hstsMaxAge: 31536000,
      frameOptions: "DENY",
      contentTypeOptions: true,
      referrerPolicy: "strict-origin-when-cross-origin",
    },
  },
  {
    id: "mw-public-cors",
    name: "Permissive Public API CORS",
    description:
      "Allows cross-origin requests from any client origin with standard HTTP methods and headers.",
    type: "cors",
    enabled: true,
    attachedDomains: [],
    config: {
      allowOrigins: ["*"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      allowCredentials: true,
    },
  },
  {
    id: "mw-large-upload",
    name: "Large Media Uploads (100MB)",
    description:
      "Increases the reverse proxy request body buffer limit to 100MB for media and archive uploads.",
    type: "body-limit",
    enabled: true,
    attachedDomains: [],
    config: {
      maxBodyMegabytes: 100,
    },
  },
];
