// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";

function hosteraxEnginePlugin() {
  return {
    name: "hosterax-engine-daemon",
    configureServer() {
      // 1. Ensure Docker socket daemon is running for container simulation
      try {
        if (!fs.existsSync("/var/run/docker.sock")) {
          const dproc = spawn(
            process.execPath,
            [
              "./hosterax/engine/test/helpers/fake-dockerd.mjs",
              "/var/run/docker.sock",
              "/tmp/docker-daemon.log",
              "/tmp/docker-daemon.ports",
            ],
            {
              stdio: "ignore",
              detached: true,
            },
          );
          dproc.unref();
        }
      } catch {}

      // 2. Ensure HosteraX engine daemon is running with local SQLite DB
      const req = http.get("http://127.0.0.1:7777/health", () => {});
      req.on("error", () => {
        try {
          const proc = spawn(process.execPath, ["./hosterax/engine/src/index.mjs"], {
            stdio: "ignore",
            detached: true,
            env: {
              ...process.env,
              HOSTERAX_DEV: "1",
              HOSTERAX_TUNNEL_HOST: "127.0.0.1",
            },
          });
          proc.unref();
        } catch {}
      });
    },
  };
}

function silenceDirectivesPlugin() {
  return {
    name: "silence-module-level-directives",
    onLog(level: any, log: any) {
      if (
        log?.code === "MODULE_LEVEL_DIRECTIVE" ||
        (typeof log?.message === "string" && log.message.includes('"use client"')) ||
        String(log).includes('"use client"')
      ) {
        return false;
      }
    },
  };
}

export default defineConfig({
  plugins: [hosteraxEnginePlugin(), silenceDirectivesPlugin()],
  nitro: {
    // @ts-expect-error - rolldownConfig is supported by Nitro >=3.0
    rolldownConfig: {
      onLog(level: any, log: any, defaultHandler: any) {
        if (
          log?.code === "MODULE_LEVEL_DIRECTIVE" ||
          (typeof log?.message === "string" && log.message.includes('"use client"')) ||
          String(log).includes('"use client"')
        ) {
          return;
        }
        defaultHandler?.(level, log);
      },
      onwarn(warning: any, defaultHandler: any) {
        if (
          warning?.code === "MODULE_LEVEL_DIRECTIVE" ||
          (typeof warning?.message === "string" && warning.message.includes('"use client"')) ||
          String(warning).includes('"use client"')
        ) {
          return;
        }
        defaultHandler?.(warning);
      },
    },
    rollupConfig: {
      onwarn(warning: any, defaultHandler: any) {
        if (
          warning?.code === "MODULE_LEVEL_DIRECTIVE" ||
          (typeof warning?.message === "string" && warning.message.includes('"use client"')) ||
          String(warning).includes('"use client"')
        ) {
          return;
        }
        defaultHandler?.(warning);
      },
    },
  },
  vite: {
    server: {
      allowedHosts: true,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:7777",
          changeOrigin: true,
          xfwd: false,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("x-forwarded-for");
              proxyReq.removeHeader("x-forwarded-host");
              proxyReq.removeHeader("x-forwarded-proto");
              proxyReq.removeHeader("x-forwarded-port");
              proxyReq.removeHeader("forwarded");
              proxyReq.removeHeader("origin");
              proxyReq.setHeader("host", "127.0.0.1:7777");
            });
          },
        },
        "/health": {
          target: "http://127.0.0.1:7777",
          changeOrigin: true,
          xfwd: false,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("x-forwarded-for");
              proxyReq.removeHeader("x-forwarded-host");
              proxyReq.removeHeader("x-forwarded-proto");
              proxyReq.removeHeader("x-forwarded-port");
              proxyReq.removeHeader("forwarded");
              proxyReq.removeHeader("origin");
              proxyReq.setHeader("host", "127.0.0.1:7777");
            });
          },
        },
        "/mcp": {
          target: "http://127.0.0.1:7777",
          changeOrigin: true,
          xfwd: false,
        },
        "/webhooks": {
          target: "http://127.0.0.1:7777",
          changeOrigin: true,
          xfwd: false,
        },
        "/ws": {
          target: "ws://127.0.0.1:7777",
          ws: true,
          changeOrigin: true,
          xfwd: false,
          configure: (proxy) => {
            proxy.on("proxyReqWs", (proxyReq) => {
              proxyReq.removeHeader("x-forwarded-for");
              proxyReq.removeHeader("x-forwarded-host");
              proxyReq.removeHeader("x-forwarded-proto");
              proxyReq.removeHeader("origin");
              proxyReq.removeHeader("sec-fetch-site");
              proxyReq.removeHeader("sec-fetch-mode");
              proxyReq.setHeader("host", "127.0.0.1:7777");
            });
          },
        },
      },
    },
    build: {
      rollupOptions: {
        onwarn(warning, defaultHandler) {
          if (
            warning.code === "MODULE_LEVEL_DIRECTIVE" ||
            warning.message?.includes('"use client"') ||
            String(warning).includes('"use client"')
          ) {
            return;
          }
          defaultHandler(warning);
        },
        onLog(level, log, defaultHandler) {
          if (
            log.code === "MODULE_LEVEL_DIRECTIVE" ||
            log.message?.includes('"use client"') ||
            String(log).includes('"use client"')
          ) {
            return;
          }
          defaultHandler?.(level, log);
        },
      },
      // @ts-expect-error - rolldownOptions when rolldown is utilized
      rolldownOptions: {
        onLog(level: any, log: any, defaultHandler: any) {
          if (
            log?.code === "MODULE_LEVEL_DIRECTIVE" ||
            log?.message?.includes('"use client"') ||
            String(log).includes('"use client"')
          ) {
            return;
          }
          defaultHandler?.(level, log);
        },
        onwarn(warning: any, defaultHandler: any) {
          if (
            warning?.code === "MODULE_LEVEL_DIRECTIVE" ||
            warning?.message?.includes('"use client"') ||
            String(warning).includes('"use client"')
          ) {
            return;
          }
          defaultHandler?.(warning);
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
