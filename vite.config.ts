// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { spawn } from "node:child_process";
import http from "node:http";

function hosteraxEnginePlugin() {
  return {
    name: "hosterax-engine-daemon",
    configureServer() {
      const req = http.get("http://127.0.0.1:7777/health", () => {});
      req.on("error", () => {
        try {
          const proc = spawn(process.execPath, ["./hosterax/engine/src/index.mjs"], {
            stdio: "ignore",
            detached: true,
          });
          proc.unref();
        } catch {}
      });
    },
  };
}

export default defineConfig({
  plugins: [hosteraxEnginePlugin()],
  vite: {
    server: {
      proxy: {
        "/api": {
          target: "http://127.0.0.1:7777",
          changeOrigin: true,
        },
        "/ws": {
          target: "ws://127.0.0.1:7777",
          ws: true,
        },
      },
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
