// hosterax/engine/src/version.mjs — single source of truth for the engine version.
import { createRequire } from "node:module";

let pkgVersion = "0.0.0";
try {
  pkgVersion = createRequire(import.meta.url)("../package.json").version || pkgVersion;
} catch {}

export const ENGINE_VERSION = process.env.HOSTERAX_VERSION || pkgVersion;
