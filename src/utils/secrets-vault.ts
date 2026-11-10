export interface VaultSecret {
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
  category?: "database" | "api_key" | "auth" | "payment" | "email" | "general";
  updatedAt: number;
  description?: string;
}

export interface SecretGroup {
  id: string;
  name: string;
  description: string;
  environment: "production" | "staging" | "development" | "global";
  secrets: VaultSecret[];
  attachedProjects: string[]; // project slugs/names
  createdAt: number;
  updatedAt: number;
}

const SECRET_PATTERNS = [
  "SECRET",
  "KEY",
  "PASS",
  "PWD",
  "TOKEN",
  "PRIVATE",
  "AUTH",
  "CERT",
  "SIGNING",
  "CREDENTIAL",
  "SALT",
  "PEPPER",
];

export function isLikelySecretKey(keyName: string): boolean {
  const upper = keyName.toUpperCase();
  return SECRET_PATTERNS.some((pattern) => upper.includes(pattern));
}

export function detectSecretCategory(keyName: string): VaultSecret["category"] {
  const upper = keyName.toUpperCase();
  if (
    upper.includes("DB") ||
    upper.includes("DATABASE") ||
    upper.includes("POSTGRES") ||
    upper.includes("MONGO") ||
    upper.includes("REDIS") ||
    upper.includes("MYSQL")
  ) {
    return "database";
  }
  if (upper.includes("STRIPE") || upper.includes("PAYPAL") || upper.includes("PAYMENT")) {
    return "payment";
  }
  if (
    upper.includes("SMTP") ||
    upper.includes("MAIL") ||
    upper.includes("RESEND") ||
    upper.includes("SENDGRID")
  ) {
    return "email";
  }
  if (
    upper.includes("JWT") ||
    upper.includes("AUTH") ||
    upper.includes("SESSION") ||
    upper.includes("OAUTH")
  ) {
    return "auth";
  }
  if (
    upper.includes("API") ||
    upper.includes("OPENAI") ||
    upper.includes("GEMINI") ||
    upper.includes("ANTHROPIC")
  ) {
    return "api_key";
  }
  return "general";
}

/**
 * Parses raw .env string into structured VaultSecret entries.
 */
export function parseDotEnv(content: string): VaultSecret[] {
  const lines = content.split(/\r?\n/);
  const result: VaultSecret[] = [];
  let counter = 1;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Remove optional "export " prefix
    const cleanLine = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eqIdx = cleanLine.indexOf("=");
    if (eqIdx === -1) continue;

    const rawKey = cleanLine.slice(0, eqIdx).trim();
    let val = cleanLine.slice(eqIdx + 1).trim();

    // Strip surrounding quotes if present
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    if (rawKey) {
      result.push({
        id: `s-${counter++}-${Date.now().toString(36)}`,
        key: rawKey,
        value: val,
        isSecret: isLikelySecretKey(rawKey),
        category: detectSecretCategory(rawKey),
        updatedAt: Date.now(),
      });
    }
  }

  return result;
}

/**
 * Serializes secrets to standard .env format with optional masking.
 */
export function exportToDotEnv(secrets: VaultSecret[], maskSecrets = false): string {
  const lines: string[] = [
    `# HosteraX Secrets Vault Export`,
    `# Generated at: ${new Date().toISOString()}`,
    ``,
  ];

  for (const s of secrets) {
    if (!s.key.trim()) continue;
    let outputVal = s.value;
    if (maskSecrets && s.isSecret && s.value.length > 0) {
      outputVal = "••••••••••••";
    }
    // Quote value if it contains spaces or quotes
    if (outputVal.includes(" ") || outputVal.includes("\n") || outputVal.includes('"')) {
      outputVal = `"${outputVal.replace(/"/g, '\\"')}"`;
    }
    lines.push(`${s.key}=${outputVal}`);
  }

  return lines.join("\n");
}

/**
 * Resolves ${VAR} and $VAR placeholders using available variable context.
 */
export function interpolateVariables(
  template: string,
  context: Record<string, string>,
): { resolved: string; missingVars: string[] } {
  const missingVars = new Set<string>();

  const resolved = template.replace(
    /\$\{([A-Za-z0-9_]+)\}|\$([A-Za-z0-9_]+)/g,
    (_, braced, bare) => {
      const key = braced || bare;
      if (Object.prototype.hasOwnProperty.call(context, key)) {
        return context[key];
      }
      missingVars.add(key);
      return braced ? `\${${key}}` : `$${key}`;
    },
  );

  return {
    resolved,
    missingVars: Array.from(missingVars),
  };
}

/**
 * Generates cryptographic secure random secrets across popular formats.
 */
export function generateSecureSecret(type: "hex64" | "base64" | "alphanumeric32" | "uuid"): string {
  if (type === "uuid") {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    // Fallback UUID RFC4122
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  if (type === "hex64") {
    const bytes = new Uint8Array(32);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  if (type === "base64") {
    const bytes = new Uint8Array(24);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 24; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    if (typeof btoa === "function") {
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    return Array.from(bytes, (b) => b.toString(16)).join("");
  }

  // alphanumeric32
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/**
 * Default secret groups start empty so only real user-defined or project-synced secrets exist.
 */
export const PRESET_SECRET_GROUPS: SecretGroup[] = [];
