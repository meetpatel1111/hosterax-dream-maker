#!/usr/bin/env node
// scripts/prepare-desktop-package.mjs
// Bundles the core engine and built web control plane into hosterax/desktop for Electron packaging.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DESKTOP_DIR = path.join(ROOT, "hosterax", "desktop");
const ENGINE_DIR = path.join(ROOT, "hosterax", "engine");
const ENGINE_SRC = path.join(ENGINE_DIR, "src");
const ENGINE_MODULES = path.join(ENGINE_DIR, "node_modules");
const DESKTOP_ENGINE_DIR = path.join(DESKTOP_DIR, "engine");
const DESKTOP_DIST_DIR = path.join(DESKTOP_DIR, "dist");

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log("[HosteraX Desktop] Preparing desktop app bundle...");

// 1. Bundle Engine source and pre-built node_modules
fs.rmSync(DESKTOP_ENGINE_DIR, { recursive: true, force: true });
fs.mkdirSync(DESKTOP_ENGINE_DIR, { recursive: true });
copyDirRecursive(ENGINE_SRC, DESKTOP_ENGINE_DIR);

if (fs.existsSync(ENGINE_MODULES)) {
  copyDirRecursive(ENGINE_MODULES, path.join(DESKTOP_ENGINE_DIR, "node_modules"));
}
if (fs.existsSync(path.join(ENGINE_DIR, "package.json"))) {
  fs.copyFileSync(
    path.join(ENGINE_DIR, "package.json"),
    path.join(DESKTOP_ENGINE_DIR, "package.json"),
  );
}
console.log(`[HosteraX Desktop] Bundled engine into ${DESKTOP_ENGINE_DIR}`);

// 2. Bundle Web UI
fs.rmSync(DESKTOP_DIST_DIR, { recursive: true, force: true });
fs.mkdirSync(DESKTOP_DIST_DIR, { recursive: true });

// The engine serves `<dist>/public` and runs `<dist>/server/index.mjs`; both come from
// `npm run build:engine` (a Node-server build). A Cloudflare-preset build cannot be served.
const outputDir = path.join(ROOT, ".output");
let preset = null;
try {
  preset = JSON.parse(fs.readFileSync(path.join(outputDir, "nitro.json"), "utf8")).preset;
} catch {}

if (preset === "node-server" || preset === "node") {
  copyDirRecursive(outputDir, DESKTOP_DIST_DIR);
  console.log(`[HosteraX Desktop] Bundled web dashboard from ${outputDir}`);
} else {
  console.error(
    `[HosteraX Desktop] No Node-server dashboard build found in ${outputDir} (preset: ${preset ?? "none"}). Run 'npm run build:engine' first.`,
  );
  process.exit(1);
}

console.log("[HosteraX Desktop] ✅ Desktop bundle assets prepared successfully!");
