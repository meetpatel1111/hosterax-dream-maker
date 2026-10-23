// hosterax/engine/src/domain-utils.mjs
// Shared validation for custom domains: they are written into proxy configs and ACME flows.

import { isSafeHostname } from "./security.mjs";

/** Lower-cases, trims and validates a hostname. Throws an Error with `.status = 400` when invalid. */
export function normalizeDomain(input) {
  const host = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (
    !isSafeHostname(host) ||
    host.startsWith("*.") ||
    (!host.includes(".") && host !== "localhost")
  ) {
    const err = new Error(`Invalid domain name: ${JSON.stringify(String(input ?? ""))}`);
    err.status = 400;
    throw err;
  }
  return host;
}

/** A hostname may only be (re)assigned inside the project that already owns it. */
export function assertDomainAvailable(db, hostname, project) {
  const owner = db.prepare("SELECT project FROM domains WHERE LOWER(hostname)=?").get(hostname);
  if (owner && owner.project !== project) {
    const err = new Error(`Domain ${hostname} is already attached to project "${owner.project}"`);
    err.status = 409;
    throw err;
  }
}
