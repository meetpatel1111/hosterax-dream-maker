// hosterax/engine/src/totp.mjs
// Time-based one-time passwords (RFC 6238 over RFC 4226 HOTP) with node:crypto only.

import crypto from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text || "")
    .replace(/[\s-]/g, "")
    .replace(/=+$/, "")
    .toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("invalid base32 secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret, base32 encoded (what authenticator apps expect). */
export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function hotp(secret, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secret).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

const STEP_SECONDS = 30;

export function timeStep(now = Date.now()) {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

export function totp(secretBase32, now = Date.now(), digits = 6) {
  return hotp(base32Decode(secretBase32), timeStep(now), digits);
}

/**
 * Checks a code against the current step and one step either side (clock drift).
 * `lastStep` is the newest step already accepted for this account: a code from that step or earlier is
 * refused, so a code that was just used (or shoulder-surfed) cannot be replayed.
 * Returns the matched step, or null.
 */
export function verifyTotp(
  secretBase32,
  code,
  { now = Date.now(), window = 1, lastStep = 0 } = {},
) {
  const given = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  const secret = base32Decode(secretBase32);
  const current = timeStep(now);
  let matched = null;
  for (let step = current - window; step <= current + window; step++) {
    const expected = hotp(secret, step);
    // compare every candidate so timing does not reveal which step matched
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given)) && step > lastStep) {
      matched = step;
    }
  }
  return matched;
}

export function otpauthUri({ secret, account, issuer = "HosteraX" }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}
