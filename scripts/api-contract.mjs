#!/usr/bin/env node
// scripts/api-contract.mjs
//
// The engine's HTTP routes, the CLI and the dashboard are written separately, and in the past the
// clients called routes the engine never had. This module keeps them honest:
//
//   1. extractEngineRoutes() reads the engine source and lists every route it serves,
//   2. extractClientCalls()  reads the CLI and dashboard and lists every engine call they make,
//   3. findMismatches()      reports client calls that no engine route can answer,
//   4. buildOpenApi()        renders the route list as hosterax/engine/openapi.json.
//
//   node scripts/api-contract.mjs --write   regenerate hosterax/engine/openapi.json
//   node scripts/api-contract.mjs --check   fail if openapi.json is stale or a client call has no route
//
// Extraction is static and deliberately conservative. The engine has no central route table, so the
// route list is inferred from the comparisons the handlers make (`pathname === "/x"`,
// `pathname.match(/^\/x\/([^/]+)$/)`, `R("sub", "VERB")`). A route whose methods cannot be
// determined is recorded with method "*" and matches any client method; calls whose path is built
// at runtime (a variable) cannot be checked and are skipped.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export const OPENAPI_FILE = path.join(ROOT, "hosterax", "engine", "src", "openapi.json");

const ENGINE_FILES = ["index.mjs", "projects-api.mjs", "catalog-api.mjs", "docker-api.mjs"];
const PROJECT_BASE = "/api/projects/{name}/";
// Paths the engine only compares against to gate other behaviour (auth, magic DNS); not routes.
const NOT_ROUTES = new Set(["/api", "/api/auth", "/webhooks"]);

// ───────────────────────── helpers ─────────────────────────

function* walk(dir, exts) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, exts);
    else if (exts.includes(path.extname(entry.name))) yield full;
  }
}

const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");

/** Reads a regex literal starting at `start` (which points at the opening "/"). */
function readRegexLiteral(text, start) {
  let i = start + 1;
  let inClass = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) break;
    else if (c === "\n") return null;
  }
  return i < text.length ? text.slice(start + 1, i) : null;
}

/** Turns the source of an anchored route regex into one or more path templates. */
function regexToTemplates(source) {
  let s = source.replace(/^\^/, "").replace(/\$$/, "").replace(/\\\//g, "/");
  // expand alternations of plain words: (start|stop|restart)
  const alt = /\(([A-Za-z0-9_-]+(?:\|[A-Za-z0-9_-]+)+)\)/.exec(s);
  if (alt) {
    return alt[1].split("|").flatMap((word) => regexToTemplates(s.replace(alt[0], word)));
  }
  s = s.replace(/\(\.\+\)/g, "{path}").replace(/\(\.\*\)/g, "{path}");
  s = s.replace(/\([^()]*\)/g, "{param}");
  s = s.replace(/\\\./g, ".").replace(/\\-/g, "-");
  if (/[\\^$*+?|()[\]]/.test(s.replace(/\{param\}|\{path\}/g, ""))) return []; // not a plain route
  return [s];
}

function methodsIn(text) {
  const found = new Set();
  for (const m of text.matchAll(/\b(?:req\.method|method)\s*===\s*"([A-Z]+)"/g)) found.add(m[1]);
  for (const m of text.matchAll(/\bR\(\s*"[^"]+"\s*,\s*"([A-Z]+)"\s*\)/g)) found.add(m[1]);
  return [...found].filter((m) => METHODS.includes(m));
}

// ───────────────────────── engine routes ─────────────────────────

export function extractEngineRoutes(root = ROOT) {
  const routes = new Map(); // "METHOD path" -> {method, path, source}
  const add = (method, p, source) => {
    const key = `${method} ${p}`;
    if (!routes.has(key)) routes.set(key, { method, path: p, source });
  };

  for (const name of ENGINE_FILES) {
    const file = path.join(root, "hosterax", "engine", "src", name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const lines = text.split("\n");

    // 1. declarations: [{line, paths: [..], base}]
    const decls = [];
    lines.forEach((line, idx) => {
      const found = [];
      for (const m of line.matchAll(/(?:\bpathname|\bp)\s*===\s*"(\/[^"]*)"/g)) found.push(m[1]);
      for (const m of line.matchAll(/(?:\bpathname|\bp)\.startsWith\(\s*"(\/[^"]*)"\s*\)/g)) {
        found.push(m[1].endsWith("/") ? `${m[1]}{path}` : m[1]);
      }
      for (const m of line.matchAll(/\b(sub\.match|pathname\.match|\.match|\bM2?|\bM)\(\s*\//g)) {
        const regexStart = m.index + m[0].length - 1;
        const source = readRegexLiteral(line, regexStart);
        if (!source || !source.startsWith("^")) continue;
        const relative = m[1] === "sub.match";
        for (const t of regexToTemplates(source)) {
          // `^/api/projects/([^/]+)/(.+)$` is the dispatcher that fans out to the real sub-routes, not a
          // route itself: counting it would let any typo under a project "match".
          if (!relative && /^\/[^/{]+\/[^/{]+\/\{param\}\/\{path\}$/.test(t)) continue;
          found.push(relative ? PROJECT_BASE + t : t);
        }
      }
      const apiPaths = found.filter((p) => p.startsWith("/"));
      if (apiPaths.length) decls.push({ line: idx, paths: apiPaths });
    });

    decls.forEach((decl, i) => {
      const end = Math.min(decls[i + 1]?.line ?? lines.length, decl.line + 80);
      const window = lines.slice(decl.line, end).join("\n");
      const methods = methodsIn(window);
      for (const p of decl.paths) {
        const where = `${rel(file)}:${decl.line + 1}`;
        if (methods.length === 0) add("*", p, where);
        else for (const method of methods) add(method, p, where);
      }
    });

    // 2. R("sub", "VERB") routes under /api/projects/{name}/
    lines.forEach((line, idx) => {
      for (const m of line.matchAll(/\bR\(\s*"([^"]+)"\s*,\s*"([A-Z]+)"\s*\)/g)) {
        if (METHODS.includes(m[2])) add(m[2], PROJECT_BASE + m[1], `${rel(file)}:${idx + 1}`);
      }
    });
  }

  // A method-less declaration is subsumed by explicit methods on the same path.
  const out = [...routes.values()].filter(
    (r) =>
      !NOT_ROUTES.has(r.path) &&
      (r.method !== "*" ||
        ![...routes.values()].some((o) => o.path === r.path && o.method !== "*")),
  );
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

// ───────────────────────── client calls ─────────────────────────

/** Replaces `${...}` (with nested braces) by {param} and drops the query string. */
function templateToPath(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "$" && raw[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < raw.length && depth > 0) {
        if (raw[i] === "{") depth++;
        else if (raw[i] === "}") depth--;
        i++;
      }
      i--;
      out += "{param}";
    } else out += raw[i];
  }
  // `/events${query}` appends a query string, `/x-${id}` is a single dynamic segment
  const cleaned = out
    .split("?")[0]
    .split("/")
    .map((seg) => {
      if (seg === "{param}" || !seg.includes("{param}")) return seg;
      return seg.endsWith("{param}") && !seg.startsWith("{param}")
        ? seg.slice(0, -"{param}".length)
        : "{param}";
    })
    .join("/");
  return cleaned.replace(/\/+$/, "") || "/";
}

const STRING_ARG =
  "(`(?:[^`\\\\]|\\\\.)*`|\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')(\\s*\\+)?";

function pathFromLiteral(literal, concatenated) {
  const inner = literal.slice(1, -1);
  const p = templateToPath(inner);
  return concatenated && !p.endsWith("}") ? `${p}/{param}` : p;
}

export function extractClientCalls(root = ROOT) {
  const calls = [];
  const cliFile = path.join(root, "hosterax", "cli", "src", "cli.mjs");
  const dashboardFiles = [...walk(path.join(root, "src"), [".ts", ".tsx"])];

  const scan = (file, regexes) => {
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    for (const { re, method } of regexes) {
      for (const m of text.matchAll(re)) {
        const literal = m[method.group + 1];
        const concat = m[method.group + 2];
        const p = pathFromLiteral(literal, Boolean(concat));
        if (!p.startsWith("/api/") && !p.startsWith("/webhooks/")) continue;
        const line = text.slice(0, m.index).split("\n").length;
        calls.push({
          method: method.fixed ?? m[method.group],
          path: p,
          source: `${rel(file)}:${line}`,
        });
      }
    }
  };

  const verb = '"(GET|POST|PUT|PATCH|DELETE)"';
  if (fs.existsSync(cliFile)) {
    scan(cliFile, [
      {
        re: new RegExp(`\\b(?:api|request)\\(\\s*${verb}\\s*,\\s*${STRING_ARG}`, "g"),
        method: { group: 1 },
      },
    ]);
  }
  for (const file of dashboardFiles) {
    scan(file, [
      {
        re: new RegExp(`\\.call(?:<[\\s\\S]{0,400}?>)?\\(\\s*${verb}\\s*,\\s*${STRING_ARG}`, "g"),
        method: { group: 1 },
      },
      {
        // fetch(`${engine.url}/api/...`) — the method defaults to any
        re: /fetch\(\s*(`\$\{(?:engine|eng)\.url\}(?:[^`\\]|\\.)*`)()/g,
        method: { group: 0, fixed: "*" },
      },
    ]);
  }
  // fetch literals start with ${engine.url}; strip it so the path starts at /api
  for (const c of calls) c.path = c.path.replace(/^\{param\}(?=\/)/, "");
  return calls.filter((c) => c.path.startsWith("/api/") || c.path.startsWith("/webhooks/"));
}

// ───────────────────────── matching ─────────────────────────

function segmentsMatch(routePath, callPath) {
  const r = routePath.split("/");
  const c = callPath.split("/");
  const restIdx = r.indexOf("{path}");
  if (restIdx === -1 && r.length !== c.length) return false;
  if (restIdx !== -1 && c.length < r.length) return false;
  for (let i = 0; i < r.length; i++) {
    if (r[i] === "{path}") return true;
    if (r[i].startsWith("{") || c[i].startsWith("{")) continue;
    if (r[i] !== c[i]) return false;
  }
  return true;
}

export function findMismatches(routes, calls) {
  const bad = [];
  for (const call of calls) {
    const pathMatches = routes.filter((r) => segmentsMatch(r.path, call.path));
    if (pathMatches.length === 0) {
      bad.push({ ...call, reason: "no engine route serves this path" });
    } else if (
      call.method !== "*" &&
      !pathMatches.some((r) => r.method === "*" || r.method === call.method)
    ) {
      bad.push({
        ...call,
        reason: `the engine serves this path only for ${[...new Set(pathMatches.map((r) => r.method))].join(", ")}`,
      });
    }
  }
  return bad;
}

// ───────────────────────── OpenAPI ─────────────────────────

export function buildOpenApi(routes, version) {
  const paths = {};
  for (const r of routes) {
    const openPath = r.path.replace(/\{(?:param|path)\}/g, (m, offset, whole) => {
      const index = whole.slice(0, offset).split("/").length - 1;
      return `{${m === "{path}" ? "rest" : "param"}${index}}`;
    });
    const params = [...openPath.matchAll(/\{([^}]+)\}/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const entry = (paths[openPath] ??= {});
    const methods =
      r.method === "*" ? METHODS.map((m) => m.toLowerCase()) : [r.method.toLowerCase()];
    for (const method of methods) {
      entry[method] ??= {
        summary: `${r.method === "*" ? "Any method" : r.method} ${r.path}`,
        ...(params.length ? { parameters: params } : {}),
        ...(r.method === "*" ? { "x-method-unspecified": true } : {}),
        responses: { default: { description: "See the engine source for the response shape." } },
        // file only: line numbers would make the committed spec stale after every unrelated edit
        "x-source": r.source.replace(/:\d+$/, ""),
      };
    }
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "HosteraX engine API",
      version,
      description:
        "Generated by scripts/api-contract.mjs from the engine source. Paths and methods only; request and response schemas are not modelled yet. Authenticate with `Authorization: Bearer <API token>`.",
    },
    servers: [{ url: "http://localhost:7777" }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    security: [{ bearer: [] }],
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function engineVersion(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, "hosterax", "engine", "package.json"), "utf8"))
    .version;
}

export function renderOpenApi(root = ROOT) {
  return (
    JSON.stringify(buildOpenApi(extractEngineRoutes(root), engineVersion(root)), null, 2) + "\n"
  );
}

// ───────────────────────── CLI ─────────────────────────

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = OPENAPI_FILE;
  const rendered = renderOpenApi();
  if (process.argv.includes("--write")) {
    fs.writeFileSync(target, rendered);
    console.log(`wrote ${rel(target)}`);
  } else if (process.argv.includes("--check")) {
    let failed = false;
    const committed = fs.existsSync(target)
      ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n")
      : null;
    if (committed !== rendered) {
      console.error("openapi.json is stale: run `node scripts/api-contract.mjs --write`");
      failed = true;
    }
    const bad = findMismatches(extractEngineRoutes(), extractClientCalls());
    for (const b of bad) console.error(`${b.source}: ${b.method} ${b.path} — ${b.reason}`);
    if (bad.length) failed = true;
    process.exit(failed ? 1 : 0);
  } else {
    console.log(rendered);
  }
}
