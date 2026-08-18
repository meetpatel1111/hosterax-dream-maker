#!/usr/bin/env node
// =============================================================
// HosteraX Local Release & Distribution Verification Pipeline
// =============================================================

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function log(emoji, msg) {
  console.log(`\n${emoji} [HosteraX Release] ${msg}`);
}

function run(cmd, args, cwd = ROOT) {
  console.log(`   ➔ ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true });
  if (res.status !== 0) {
    console.error(`\n❌ Error: "${cmd} ${args.join(" ")}" exited with code ${res.status}`);
    process.exit(1);
  }
}

log("📋", "Reading Release Manifests...");
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const cliPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "hosterax/cli/package.json"), "utf8"));
const desktopPkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "hosterax/desktop/package.json"), "utf8"),
);

console.log(`   Root Version:    ${rootPkg.version}`);
console.log(`   CLI Version:     ${cliPkg.version}`);
console.log(`   Desktop Version: ${desktopPkg.version}`);

if (rootPkg.version !== cliPkg.version || rootPkg.version !== desktopPkg.version) {
  console.error("\n❌ Error: Version mismatch across packages! Please synchronize versions.");
  process.exit(1);
}

log("🧪", "1/5: Running TypeScript Type Verification...");
run("npx", ["tsc", "--noEmit"]);

log("🧹", "2/5: Checking ESLint & Prettier Code Style...");
run("npm", ["run", "lint"]);

log("⚡", "3/5: Running Engine Test Suite (18 Suites)...");
run("npm", ["run", "test:engine"]);

log("🏗️", "4/5: Compiling Frontend Production Bundle...");
run("npm", ["run", "build"]);

log("📦", "5/5: Verifying CLI NPM Tarball Package...");
run("npm", ["pack", "--dry-run"], path.join(ROOT, "hosterax/cli"));

log("🚀", `Release Verification Succeeded for v${rootPkg.version}!`);
console.log(`
=============================================================
✅ Ready to Release HosteraX v${rootPkg.version} Across All Platforms:
=============================================================

1. Commit all prepared files:
   git add -A
   git commit -m "chore(release): release v${rootPkg.version}"
   git push origin main

2. Push release tag to trigger GitHub Actions Multi-Platform CI/CD:
   git tag v${rootPkg.version}
   git push origin v${rootPkg.version}

3. Publish CLI to npm registry manually (if preferred):
   cd hosterax/cli && npm publish --access public
=============================================================
`);
