#!/usr/bin/env node
// scripts/prepare-npm-package.mjs
// Prepares the all-in-one HosteraX NPM package by copying the core engine and built web dashboard.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const CLI_DIR = path.join(ROOT, "hosterax", "cli");
const ENGINE_SRC = path.join(ROOT, "hosterax", "engine", "src");
const CLI_ENGINE_DIR = path.join(CLI_DIR, "engine");
const CLI_DIST_DIR = path.join(CLI_DIR, "dist");

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

console.log("[HosteraX Package] Preparing all-in-one NPM package distribution...");

// 1. Copy Engine Source into CLI package
fs.rmSync(CLI_ENGINE_DIR, { recursive: true, force: true });
fs.mkdirSync(CLI_ENGINE_DIR, { recursive: true });
copyDirRecursive(ENGINE_SRC, CLI_ENGINE_DIR);
console.log(`[HosteraX Package] Bundled core engine source into ${CLI_ENGINE_DIR}`);

// 2. Copy Web Dashboard Assets into CLI package
fs.rmSync(CLI_DIST_DIR, { recursive: true, force: true });
fs.mkdirSync(CLI_DIST_DIR, { recursive: true });

// The engine serves `<dist>/public` and runs `<dist>/server/index.mjs`; both come from
// `npm run build:engine` (a Node-server build). A Cloudflare-preset build cannot be served.
const outputDir = path.join(ROOT, ".output");
let preset = null;
try {
  preset = JSON.parse(fs.readFileSync(path.join(outputDir, "nitro.json"), "utf8")).preset;
} catch {}

if (preset === "node-server" || preset === "node") {
  copyDirRecursive(outputDir, CLI_DIST_DIR);
  console.log(`[HosteraX Package] Bundled web control plane from ${outputDir}`);
} else {
  console.error(
    `[HosteraX Package] No Node-server dashboard build found in ${outputDir} (preset: ${preset ?? "none"}). Run 'npm run build:engine' first.`,
  );
  process.exit(1);
}

console.log("[HosteraX Package] ✅ All-in-one package bundle prepared successfully!");
