// hosterax/engine/src/secrets.mjs
// At-rest encryption (AES-256-GCM) for credentials stored in SQLite: SSH keys, S3 secrets,
// SMTP relay passwords, custom TLS private keys. The key lives next to the database with 0600 perms.
// Values written before this existed are passed through unchanged and re-encrypted on next write.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

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

// ───────────── Streaming file encryption (backup archives) ─────────────
//
// Layout: "HXB1" | 12-byte IV | AES-256-GCM ciphertext | 16-byte auth tag.
// GCM only authenticates at the very end, so a consumer must call authenticateEncryptedFile() before
// it trusts any plaintext (the backup restore path does).

const FILE_MAGIC = Buffer.from("HXB1");
const IV_LEN = 12;
const TAG_LEN = 16;

export function createEncryptStream() {
  if (!key) throw new Error("secrets not initialised");
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let started = false;
  return new Transform({
    transform(chunk, _enc, cb) {
      if (!started) {
        started = true;
        this.push(Buffer.concat([FILE_MAGIC, iv]));
      }
      cb(null, cipher.update(chunk));
    },
    flush(cb) {
      if (!started) this.push(Buffer.concat([FILE_MAGIC, iv]));
      this.push(cipher.final());
      this.push(cipher.getAuthTag());
      cb();
    },
  });
}

export function createDecryptStream() {
  if (!key) throw new Error("secrets not initialised");
  let header = Buffer.alloc(0);
  let tail = Buffer.alloc(0);
  let decipher = null;
  return new Transform({
    transform(chunk, _enc, cb) {
      try {
        if (!decipher) {
          header = Buffer.concat([header, chunk]);
          if (header.length < FILE_MAGIC.length + IV_LEN) return cb();
          if (!header.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC))
            return cb(new Error("not a HosteraX encrypted archive"));
          decipher = crypto.createDecipheriv(
            "aes-256-gcm",
            key,
            header.subarray(FILE_MAGIC.length, FILE_MAGIC.length + IV_LEN),
          );
          chunk = header.subarray(FILE_MAGIC.length + IV_LEN);
          header = null;
        }
        const data = Buffer.concat([tail, chunk]);
        if (data.length <= TAG_LEN) {
          tail = data;
          return cb();
        }
        tail = data.subarray(data.length - TAG_LEN);
        cb(null, decipher.update(data.subarray(0, data.length - TAG_LEN)));
      } catch (e) {
        cb(e);
      }
    },
    flush(cb) {
      try {
        if (!decipher || tail.length !== TAG_LEN) throw new Error("encrypted archive is truncated");
        decipher.setAuthTag(tail);
        this.push(decipher.final());
        cb();
      } catch {
        cb(
          new Error(
            "encrypted archive failed authentication — it was modified, or the encryption key changed",
          ),
        );
      }
    },
  });
}

export function isEncryptedArchive(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const head = Buffer.alloc(FILE_MAGIC.length);
      fs.readSync(fd, head, 0, head.length, 0);
      return head.equals(FILE_MAGIC);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** Reads the whole archive through the decryptor; resolves only if the auth tag checks out. */
export async function authenticateEncryptedFile(filePath) {
  await pipeline(
    fs.createReadStream(filePath),
    createDecryptStream(),
    new Transform({ transform: (_c, _e, cb) => cb() }),
  );
}
