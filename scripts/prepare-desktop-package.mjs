#!/usr/bin/env node
// scripts/prepare-desktop-package.mjs
// Bundles the core engine and built web control plane into hosterax/desktop for Electron packaging.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DESKTOP_DIR = path.join(ROOT, "hosterax", "desktop");
const ENGINE_SRC = path.join(ROOT, "hosterax", "engine", "src");
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

// 1. Bundle Engine
fs.rmSync(DESKTOP_ENGINE_DIR, { recursive: true, force: true });
fs.mkdirSync(DESKTOP_ENGINE_DIR, { recursive: true });
copyDirRecursive(ENGINE_SRC, DESKTOP_ENGINE_DIR);
console.log(`[HosteraX Desktop] Bundled engine into ${DESKTOP_ENGINE_DIR}`);

// 2. Bundle Web UI
fs.rmSync(DESKTOP_DIST_DIR, { recursive: true, force: true });
fs.mkdirSync(DESKTOP_DIST_DIR, { recursive: true });

const outputPublic = path.join(ROOT, ".output", "public");
const distDir = path.join(ROOT, "dist");

if (fs.existsSync(outputPublic)) {
  copyDirRecursive(outputPublic, DESKTOP_DIST_DIR);
  console.log(`[HosteraX Desktop] Bundled web dashboard from ${outputPublic}`);
} else if (fs.existsSync(distDir)) {
  copyDirRecursive(distDir, DESKTOP_DIST_DIR);
  console.log(`[HosteraX Desktop] Bundled web dashboard from ${distDir}`);
}

console.log("[HosteraX Desktop] ✅ Desktop bundle assets prepared successfully!");
