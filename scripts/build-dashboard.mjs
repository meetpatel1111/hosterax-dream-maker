#!/usr/bin/env node
// scripts/build-dashboard.mjs
// Builds the dashboard as a Node-runnable bundle (.output/public + .output/server) that the engine
// serves. `npm run build` keeps targeting the Lovable/Cloudflare preview; use this one for the
// Docker image, the npm package and the desktop app.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");

if (!fs.existsSync(vite)) {
  console.error("[HosteraX Build] vite is not installed. Run `npm install` first.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [vite, "build"], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, NITRO_PRESET: "node-server" },
});
process.exit(result.status ?? 1);
