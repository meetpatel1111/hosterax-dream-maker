export type OAuthClientType = "confidential" | "public";

export type OAuthScope =
  | "read:projects"
  | "write:projects"
  | "deploy:containers"
  | "admin:all"
  | "mcp:tools"
  | "mcp:prompts"
  | "mcp:resources";

export interface OAuthClient {
  id: string;
  name: string;
  description: string;
  clientType: OAuthClientType;
  clientId: string;
  clientSecret?: string;
  clientSecretHint?: string;
  redirectUris: string[];
  scopes: OAuthScope[];
  allowedGrantTypes: ("authorization_code" | "client_credentials" | "refresh_token")[];
  createdAt: string;
  status: "active" | "revoked";
  lastUsedAt: string | null;
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export interface IntrospectionResult {
  active: boolean;
  scope?: string;
  client_id?: string;
  token_type?: string;
  exp?: number;
  iat?: number;
  sub?: string;
  aud?: string;
}

export const AVAILABLE_OAUTH_SCOPES: { scope: OAuthScope; label: string; description: string }[] = [
  {
    scope: "read:projects",
    label: "Read Projects",
    description: "Read container status, environment configs, and deployment topology.",
  },
  {
    scope: "write:projects",
    label: "Write Projects",
    description: "Create, configure, and modify containers, services, and stacks.",
  },
  {
    scope: "deploy:containers",
    label: "Deploy Containers",
    description: "Trigger live zero-downtime builds, rollouts, and rollback operations.",
  },
  {
    scope: "admin:all",
    label: "Full Admin",
    description: "Complete unrestricted administrative control over node, edge, and secrets.",
  },
  {
    scope: "mcp:tools",
    label: "MCP Tools Execution",
    description: "Allow Model Context Protocol agents to invoke runtime tools and actions.",
  },
  {
    scope: "mcp:prompts",
    label: "MCP Prompts",
    description: "Access registered infrastructure prompt templates and runbooks.",
  },
  {
    scope: "mcp:resources",
    label: "MCP Resources",
    description: "Read real-time log streams, container telemetry, and audit events.",
  },
];

/**
 * Pure, universal SHA-256 implementation (works in browser & Node without node:crypto)
 */
export function sha256Bytes(ascii: string): Uint8Array {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i: number;
  let j: number;
  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;
  let hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;
  const isComposite: Record<number, number> = {};

  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += "\x80";
  while ((ascii.length % 64) - 56) ascii += "\x00";

  for (i = 0; i < ascii.length; i++) {
    j = ascii.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;

  for (j = 0; j < words.length;) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const a = hash[0];
      const e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  const bytes = new Uint8Array(32);
  for (i = 0; i < 8; i++) {
    bytes[i * 4] = (hash[i] >>> 24) & 255;
    bytes[i * 4 + 1] = (hash[i] >>> 16) & 255;
    bytes[i * 4 + 2] = (hash[i] >>> 8) & 255;
    bytes[i * 4 + 3] = hash[i] & 255;
  }
  return bytes;
}

/**
 * Base64URL encoding according to RFC 7636 (no padding, url-safe)
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 =
    typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Secure random hex generator compatible with universal global crypto
 */
export function getRandomHex(bytesCount: number): string {
  const arr = new Uint8Array(bytesCount);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytesCount; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a cryptographically secure PKCE code_verifier and S256 code_challenge
 */
export function generatePkcePair(length = 64): PkcePair {
  const safeLength = Math.max(43, Math.min(length, 128));
  const rawBytes = new Uint8Array(Math.ceil((safeLength * 3) / 4));
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(rawBytes);
  } else {
    for (let i = 0; i < rawBytes.length; i++) {
      rawBytes[i] = Math.floor(Math.random() * 256);
    }
  }

  const codeVerifier = base64UrlEncode(rawBytes).slice(0, safeLength);
  const hash = sha256Bytes(codeVerifier);
  const codeChallenge = base64UrlEncode(hash);

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: "S256",
  };
}

/**
 * Verify a PKCE code_verifier against an S256 code_challenge
 */
export function verifyPkce(
  codeVerifier: string,
  codeChallenge: string,
  method: "S256" = "S256",
): boolean {
  if (!codeVerifier || !codeChallenge) return false;
  if (method !== "S256") return false;
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false;

  const calculated = base64UrlEncode(sha256Bytes(codeVerifier));
  return calculated === codeChallenge;
}

/**
 * Validates redirect URIs according to OAuth 2.1 specs
 */
export function validateRedirectUri(uri: string): { valid: boolean; error?: string } {
  if (!uri || typeof uri !== "string") {
    return { valid: false, error: "Redirect URI is required" };
  }

  const trimmed = uri.trim();
  if (trimmed.includes("#")) {
    return { valid: false, error: "Redirect URI must not contain a fragment identifier (#)" };
  }

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();

    if (protocol === "http:") {
      const isLoopback =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "::1" ||
        parsed.hostname === "[::1]";

      if (!isLoopback) {
        return {
          valid: false,
          error: "HTTP redirect URIs are only permitted on loopback (localhost/127.0.0.1)",
        };
      }
    } else if (protocol !== "https:" && !protocol.endsWith(":")) {
      return { valid: false, error: "Invalid protocol" };
    }

    return { valid: true };
  } catch {
    if (/^[a-z][a-z0-9+.-]*:\/\/.+/i.test(trimmed)) {
      return { valid: true };
    }
    return { valid: false, error: "Invalid URI syntax" };
  }
}

/**
 * Generate unique OAuth credentials
 */
export function generateOAuthCredentials(type: OAuthClientType): {
  clientId: string;
  clientSecret?: string;
  clientSecretHint?: string;
} {
  const rawId = getRandomHex(16);
  const clientId = `hx_client_${rawId}`;

  if (type === "confidential") {
    const rawSecret = getRandomHex(32);
    const clientSecret = `hx_sec_${rawSecret}`;
    const clientSecretHint = `${clientSecret.slice(0, 10)}...${clientSecret.slice(-4)}`;
    return { clientId, clientSecret, clientSecretHint };
  }

  return { clientId };
}

/**
 * Creates an OAuth 2.1 client record
 */
export function createOAuthClient(params: {
  name: string;
  description?: string;
  clientType: OAuthClientType;
  redirectUris: string[];
  scopes: OAuthScope[];
}): { client: OAuthClient; plainSecret?: string } {
  const credentials = generateOAuthCredentials(params.clientType);
  const now = new Date().toISOString();

  const client: OAuthClient = {
    id: `app_${getRandomHex(8)}`,
    name: params.name.trim(),
    description: (params.description || "").trim(),
    clientType: params.clientType,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    clientSecretHint: credentials.clientSecretHint,
    redirectUris: params.redirectUris.map((u) => u.trim()).filter(Boolean),
    scopes: params.scopes,
    allowedGrantTypes:
      params.clientType === "confidential"
        ? ["authorization_code", "client_credentials", "refresh_token"]
        : ["authorization_code", "refresh_token"],
    createdAt: now,
    status: "active",
    lastUsedAt: null,
  };

  return {
    client,
    plainSecret: credentials.clientSecret,
  };
}

/**
 * Simulates RFC 7662 Token Introspection
 */
export function introspectToken(token: string, client: OAuthClient): IntrospectionResult {
  if (!token || typeof token !== "string" || !token.startsWith("hx_at_")) {
    return { active: false };
  }

  if (client.status !== "active") {
    return { active: false };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    active: true,
    scope: client.scopes.join(" "),
    client_id: client.clientId,
    token_type: "Bearer",
    exp: nowSeconds + 3600,
    iat: nowSeconds,
    sub: client.id,
    aud: "https://control-plane.hosterax.internal",
  };
}

/**
 * Generate simulated authorization URL
 */
export function buildAuthorizationUrl(params: {
  endpoint: string;
  clientId: string;
  redirectUri: string;
  responseType?: string;
  scope: string;
  state: string;
  codeChallenge?: string;
  codeChallengeMethod?: "S256";
}): string {
  const base = params.endpoint.replace(/\/+$/, "");
  const searchParams = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: params.responseType || "code",
    scope: params.scope,
    state: params.state,
  });

  if (params.codeChallenge) {
    searchParams.set("code_challenge", params.codeChallenge);
    searchParams.set("code_challenge_method", params.codeChallengeMethod || "S256");
  }

  return `${base}/oauth/authorize?${searchParams.toString()}`;
}

/**
 * Preset templates for rapid MCP & Tool integration
 */
export const OAUTH_PRESET_TEMPLATES = [
  {
    id: "claude-desktop",
    name: "Claude Desktop MCP Client",
    description:
      "Native local AI assistant integration with MCP tool execution & telemetry access.",
    clientType: "public" as OAuthClientType,
    redirectUris: ["http://localhost:5173/callback", "claude://oauth/callback"],
    scopes: ["mcp:tools", "mcp:resources", "read:projects"] as OAuthScope[],
  },
  {
    id: "cursor-ai",
    name: "Cursor IDE Agent",
    description:
      "Autonomous code assistant with container deployment and project inspection rights.",
    clientType: "public" as OAuthClientType,
    redirectUris: ["cursor://oauth/callback", "http://127.0.0.1:3300/callback"],
    scopes: ["mcp:tools", "mcp:prompts", "read:projects", "deploy:containers"] as OAuthScope[],
  },
  {
    id: "github-actions-ci",
    name: "GitHub Actions CI/CD Pipeline",
    description: "Automated continuous delivery runner utilizing Client Credentials grant.",
    clientType: "confidential" as OAuthClientType,
    redirectUris: ["https://api.github.com/callback"],
    scopes: ["deploy:containers", "read:projects"] as OAuthScope[],
  },
];
