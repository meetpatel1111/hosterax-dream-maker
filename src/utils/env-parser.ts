export interface ParsedDotEnvEntry {
  key: string;
  value: string;
  inferredSecret: boolean;
}

const VALID_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const SECRET_KEY_RE =
  /(SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|PRIVATE_KEY|AUTH_KEY|SIGNING|MASTER_KEY|JWT|CREDENTIAL|DSN|WEBHOOK_KEY|ENCRYPTION|DATABASE_URL|REDIS_URL|MONGO_URI|POSTGRES_URL|MYSQL_URL|CONNECTION_STRING)/i;

export function isLikelySecretEnvKey(key: string, value = ""): boolean {
  if (SECRET_KEY_RE.test(key)) return true;
  if (/^[a-z]+:\/\/[^:\s/@]+:[^@\s]+@/i.test(value)) return true;
  return false;
}

/**
 * Parses standard `.env` file contents into key/value entries.
 * Supports `export KEY=val`, single/double quotes, inline comments on unquoted values, and URL values containing `=`.
 */
export function parseDotEnvText(raw: string): {
  entries: ParsedDotEnvEntry[];
  errors: string[];
} {
  const deduped = new Map<string, ParsedDotEnvEntry>();
  const errors: string[] = [];
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("export ")) {
      line = line.slice(7).trim();
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) {
      errors.push(`Line ${lineNo}: expected KEY=VALUE format.`);
      continue;
    }

    const key = line.slice(0, eqIdx).trim();
    if (!VALID_ENV_KEY_RE.test(key)) {
      errors.push(`Line ${lineNo}: invalid variable name "${key}".`);
      continue;
    }

    const rawVal = line.slice(eqIdx + 1).trim();
    let value = rawVal;

    if (rawVal.startsWith('"')) {
      const closing = findClosingQuote(rawVal, '"');
      const inner = closing !== -1 ? rawVal.slice(1, closing) : rawVal.slice(1);
      value = inner
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    } else if (rawVal.startsWith("'")) {
      const closing = findClosingQuote(rawVal, "'");
      value = closing !== -1 ? rawVal.slice(1, closing) : rawVal.slice(1);
    } else {
      // Strip inline comment preceded by whitespace for unquoted values
      const commentIdx = rawVal.search(/\s+#/);
      if (commentIdx !== -1) {
        value = rawVal.slice(0, commentIdx).trim();
      }
    }

    deduped.set(key, {
      key,
      value,
      inferredSecret: isLikelySecretEnvKey(key, value),
    });
  }

  return { entries: Array.from(deduped.values()), errors };
}

function findClosingQuote(str: string, quoteChar: '"' | "'"): number {
  let escaped = false;
  for (let i = 1; i < str.length; i++) {
    const ch = str[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoteChar === '"' && ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === quoteChar) return i;
  }
  return -1;
}

export function formatDotEnvText(
  rows: { key: string; value: string; isSecret?: boolean }[],
  options?: { includeSecretPlaceholders?: boolean },
): string {
  const includePlaceholders = options?.includeSecretPlaceholders ?? true;
  const lines: string[] = [];

  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    if (row.isSecret) {
      if (includePlaceholders) {
        lines.push(`# ${key}=<stored-secret-overwrite-to-update>`);
      }
      continue;
    }
    const v = row.value ?? "";
    const needsQuotes = /[\s#"'\n\r]/.test(v) || v.includes("\\");
    if (needsQuotes) {
      const escaped = v
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r");
      lines.push(`${key}="${escaped}"`);
    } else {
      lines.push(`${key}=${v}`);
    }
  }

  return lines.join("\n");
}
