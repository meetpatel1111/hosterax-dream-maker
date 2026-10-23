// hosterax/engine/src/secrets.mjs
// At-rest encryption (AES-256-GCM) for credentials stored in SQLite: SSH keys, S3 secrets,
// SMTP relay passwords, custom TLS private keys. The key lives next to the database with 0600 perms.
// Values written before this existed are passed through unchanged and re-encrypted on next write.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PREFIX = "enc:v1:";
let key = null;

export function initSecrets(home) {
  if (process.env.HOSTERAX_SECRET_KEY) {
    key = crypto.createHash("sha256").update(process.env.HOSTERAX_SECRET_KEY).digest();
    return;
  }
  const file = path.join(home, "secret.key");
  try {
    key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
    if (key.length === 32) return;
  } catch {}
  key = crypto.randomBytes(32);
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(file, key.toString("hex"), { mode: 0o600 });
}

export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptSecret(plain) {
  if (plain === null || plain === undefined || plain === "") return plain;
  if (isEncrypted(plain)) return plain;
  if (!key) throw new Error("secrets not initialised");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(stored) {
  if (!isEncrypted(stored)) return stored; // legacy plaintext
  if (!key) throw new Error("secrets not initialised");
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
