#!/usr/bin/env node
// scripts/licenses.mjs
//
// What HosteraX is made of, and under which licences:
//
//   docs/THIRD_PARTY.md  generated from the engine's lockfile and the dashboard's installed production
//                        dependencies, plus a hand-maintained list of the programs HosteraX starts or pulls
//   policy               no strong copyleft (GPL, AGPL, SSPL, …) and no unspecified licence in what we ship
//
//   node scripts/licenses.mjs --write   regenerate docs/THIRD_PARTY.md
//   node scripts/licenses.mjs --check   fail on a policy violation, or if the file is out of date
//
// Optional dependencies (prebuilt binaries for one operating system) are left out so the file reads the
// same on every platform CI runs on.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUTPUT = path.join(ROOT, "docs", "THIRD_PARTY.md");

/** Licences that must not appear in what we ship: they would impose conditions on the whole product. */
export const FORBIDDEN =
  /(^|[^A-Za-z])(A?GPL|SSPL|BUSL|CC-BY-NC|Commons-Clause|UNLICENSED|UNKNOWN)/i;

/** Read the licence of every production dependency below `dir`, as `name@version -> licence`. */
export function collect(dir) {
  const found = new Map();
  const root = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const queue = Object.keys(root.dependencies || {}).map((name) => ({ name, from: dir }));
  while (queue.length) {
    const { name, from } = queue.pop();
    let search = from;
    let manifest = null;
    for (;;) {
      const candidate = path.join(search, "node_modules", name, "package.json");
      if (fs.existsSync(candidate)) {
        manifest = candidate;
        break;
      }
      // Never look above the package being inventoried: the engine and the dashboard are separate installs,
      // and a dependency missing from one must not be found in (and drag in the whole tree of) the other.
      if (search === dir) break;
      const up = path.dirname(search);
      if (up === search) break;
      search = up;
    }
    if (!manifest) continue; // not installed: a peer or platform-specific package
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    // A package that is really another project linked into this install (a junction or symlink to the repo
    // root, or the project itself) is not one of its dependencies and drags that project's whole tree along.
    if (pkg.name === root.name) continue;
    try {
      const real = fs.realpathSync(path.dirname(manifest));
      const inside = path.relative(fs.realpathSync(dir), real);
      if (inside.startsWith("..") || path.isAbsolute(inside)) continue;
    } catch {}
    const key = `${pkg.name}@${pkg.version}`;
    if (found.has(key)) continue;
    let license = pkg.license;
    if (license && typeof license === "object") license = license.type;
    if (!license && Array.isArray(pkg.licenses))
      license = pkg.licenses.map((l) => l.type).join(" OR ");
    found.set(key, {
      name: pkg.name,
      version: pkg.version,
      license: license || "UNSPECIFIED",
      location: path.dirname(manifest), // for diagnosing a mismatch; not part of the inventory
    });
    for (const dep of Object.keys(pkg.dependencies || {}))
      queue.push({ name: dep, from: path.dirname(manifest) });
  }
  return [...found.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

/**
 * The packages `dir` ships, as its committed package-lock.json records them (null when it has none). This is
 * exactly the set `npm ci` installs, so it reads the same on every platform and however the install was done,
 * which walking whatever is on disk does not.
 */
export function collectFromLockfile(dir) {
  const file = path.join(dir, "package-lock.json");
  if (!fs.existsSync(file)) return null;
  const lock = JSON.parse(fs.readFileSync(file, "utf8"));
  const out = [];
  for (const [key, entry] of Object.entries(lock.packages || {})) {
    // only what sits under a node_modules directory is installed from the registry: the root ("") and the
    // projects a link points at ("../..", "packages/x") are not dependencies
    const at = key.lastIndexOf("node_modules/");
    if (at < 0 || entry.dev || entry.optional || entry.peer || entry.link) continue;
    const name = key.slice(at + "node_modules/".length);
    let license = entry.license;
    if (license && typeof license === "object") license = license.type;
    out.push({ name, version: entry.version, license: license || "UNSPECIFIED" });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** Programs HosteraX starts or pulls. Hand-maintained: check a licence at its source before relying on it. */
export const PROGRAMS = [
  [
    "Docker Engine and CLI",
    "Runs every container (this machine and remote servers)",
    "Apache-2.0 (Docker Desktop has its own subscription terms)",
    "Not shipped: the host's own Docker is used",
  ],
  [
    "OpenSSH (`ssh`, `ssh-keyscan`, `ssh-keygen`)",
    "Remote servers, and the SSH-based public tunnels",
    "OpenSSH licence (BSD-style)",
    "Not shipped: the host's own client is used",
  ],
  [
    "SQLite (inside better-sqlite3)",
    "The engine's database",
    "Public domain",
    "Compiled into the better-sqlite3 package",
  ],
  [
    "OpenResty (`openresty/openresty:alpine`)",
    "The default edge proxy",
    "BSD-2-Clause",
    "Pulled as an image at run time (floating tag)",
  ],
  [
    "Caddy (`caddy`)",
    "The alternative edge proxy",
    "Apache-2.0",
    "Pulled as an image at run time (floating tag)",
  ],
  [
    "certbot (`certbot/certbot`)",
    "Let's Encrypt certificates",
    "Apache-2.0",
    "Pulled as an image at run time (floating tag)",
  ],
  [
    "cloudflared",
    "Public address through Cloudflare (free, no account)",
    "Apache-2.0 (the Cloudflare services have their own terms)",
    "Pulled as an image, pinned by version and digest",
  ],
  [
    "ngrok agent",
    "Public address through ngrok (needs your own account)",
    "Proprietary: you accept ngrok's terms with your own token",
    "Pulled as an image, pinned by version and digest; only used if you choose it",
  ],
  [
    "bore",
    "Public address through a bore relay",
    "MIT",
    "Pulled as an image, pinned by version and digest; only used if you choose it",
  ],
  [
    "localtunnel",
    "Public address through localtunnel",
    "MIT",
    "Fetched with `npx` only if you choose it",
  ],
  [
    "Tailscale",
    "Public address through Funnel",
    "BSD-3-Clause (client); account terms apply",
    "Not shipped: the host's own client is used",
  ],
  [
    "localhost.run, Pinggy, Serveo",
    "Public addresses over plain SSH",
    "Services with their own terms; no software is installed",
    "Reached with the host's `ssh`",
  ],
  [
    "PostgreSQL, MariaDB, MySQL (images)",
    "Managed databases, on request",
    "PostgreSQL licence; GPL-2.0 (MariaDB, MySQL; with the MySQL FOSS exception)",
    "Pulled as images and run as separate programs, never linked or redistributed",
  ],
  [
    "MongoDB (image)",
    "Managed databases, on request",
    "SSPL-1.0",
    "Pulled as an image and run as a separate program; read the SSPL before offering it as a service",
  ],
  [
    "Redis (image)",
    "Managed databases, on request",
    "7.4 and later: RSALv2 or SSPLv1 (8.x also AGPLv3); 7.2 and earlier: BSD-3-Clause",
    "Pulled as an image and run as a separate program",
  ],
];

const groupBy = (list) => {
  const by = new Map();
  for (const p of list) {
    if (!by.has(p.license)) by.set(p.license, []);
    by.get(p.license).push(p);
  }
  return [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
};

/**
 * A licence is a problem only if every way of using the package is forbidden: `MIT OR GPL-3.0` can be
 * taken under the MIT terms, `MIT AND GPL-3.0` cannot.
 */
export function isForbidden(license) {
  if (license === "UNSPECIFIED") return true;
  const alternatives = String(license)
    .replace(/[()]/g, " ")
    .split(/\s+OR\s+/i);
  return alternatives.every((alt) => FORBIDDEN.test(alt));
}

export function violations(packages) {
  return packages.filter((p) => isForbidden(p.license));
}

export function render({ engine, dashboard }) {
  const out = [
    "# Third-party software",
    "",
    "<!-- Generated by scripts/licenses.mjs. Do not edit by hand: run `npm run licenses:write`. -->",
    "",
    "HosteraX is MIT licensed. This page lists what it is built from and the programs it can start. The npm lists are read from the installed",
    "production dependencies (optional, platform-specific binaries are left out). `npm run licenses:check` fails the build if anything shipped",
    "uses a strong-copyleft licence (GPL, AGPL, SSPL, …) or has no licence at all.",
    "",
    "## Programs HosteraX starts or pulls",
    "",
    "Maintained by hand. These run as separate programs; HosteraX does not link or redistribute them. Check the licence at its source before",
    "relying on this table for compliance.",
    "",
    "| Program | Used for | Licence | How it reaches you |",
    "| --- | --- | --- | --- |",
    ...PROGRAMS.map((r) => `| ${r.join(" | ")} |`),
    "",
    `## The engine's npm packages (${engine.length})`,
    "",
    "| Package | Version | Licence |",
    "| --- | --- | --- |",
    ...engine.map((p) => `| ${p.name} | ${p.version} | ${p.license} |`),
    "",
    `## Packages bundled into the dashboard (${dashboard.length})`,
    "",
  ];
  for (const [license, list] of groupBy(dashboard)) {
    out.push(
      `**${license}** (${list.length}): ${[...new Set(list.map((p) => p.name))].join(", ")}`,
      "",
    );
  }
  return out.join("\n");
}

/** Which entries differ between the committed inventory and what this machine would generate. */
export function describeDifference(have, want) {
  const items = (text) =>
    new Set(
      text
        .split("\n")
        .flatMap((line) => line.replace(/^\*\*[^*]+\*\*\s*\(\d+\):\s*/, "").split(/,\s+|\s*\|\s*/))
        .map((x) => x.trim())
        .filter(Boolean),
    );
  const a = items(have);
  const b = items(want);
  const onlyHere = [...b].filter((x) => !a.has(x));
  const onlyCommitted = [...a].filter((x) => !b.has(x));
  const show = (list) => (list.length ? list.slice(0, 25).join(", ") : "(nothing)");
  return [
    `  only on this machine: ${show(onlyHere)}`,
    `  only in the committed file: ${show(onlyCommitted)}`,
  ].join("\n");
}

export function gather() {
  return {
    engine:
      collectFromLockfile(path.join(ROOT, "hosterax", "engine")) ??
      collect(path.join(ROOT, "hosterax", "engine")),
    dashboard: collect(ROOT),
  };
}

async function main() {
  const write = process.argv.includes("--write");
  const data = gather();
  const bad = violations([...data.engine, ...data.dashboard]);
  const text = render(data).replace(/\n*$/, "\n");
  if (write) {
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, text);
    console.log(`wrote ${path.relative(ROOT, OUTPUT)}`);
  }
  if (bad.length) {
    console.error("These packages use a licence we do not allow in what we ship:");
    for (const p of bad) console.error(`  ${p.name}@${p.version}: ${p.license}`);
    process.exit(1);
  }
  if (!write) {
    const have = fs.existsSync(OUTPUT)
      ? fs.readFileSync(OUTPUT, "utf8").replace(/\r\n/g, "\n")
      : "";
    if (have !== text) {
      console.error(`${path.relative(ROOT, OUTPUT)} is out of date. Run: npm run licenses:write`);
      console.error(describeDifference(have, text));
      // counts, and where the first dashboard packages were found, tell a stray tree from a real difference
      console.error(
        `  engine packages: ${data.engine.length}, dashboard packages: ${data.dashboard.length}`,
      );
      for (const p of data.dashboard.slice(0, 3))
        console.error(`    ${p.name}@${p.version}  ${p.location}`);
      process.exit(1);
    }
    console.log("licences are in policy and the inventory is up to date");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
