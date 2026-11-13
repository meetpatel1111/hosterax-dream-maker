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
    configureServer(server: any) {
      server?.middlewares?.use((req: any, res: any, next: any) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "*");
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        next();
      });

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
      cors: false,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:7777",
          changeOrigin: true,
          xfwd: false,
          configure: (proxy: any) => {
            proxy.on("proxyReq", (proxyReq: any, req: any) => {
              const peer = req?.socket?.remoteAddress || "";
              const isLocalPeer =
                peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
              if (!isLocalPeer && peer) {
                const prev = req.headers["x-forwarded-for"];
                proxyReq.setHeader("x-forwarded-for", prev ? `${prev}, ${peer}` : peer);
                if (req.headers.host) {
                  proxyReq.setHeader("x-forwarded-host", String(req.headers.host));
                }
              }
              proxyReq.setHeader("host", "127.0.0.1:7777");
            });
          },
        },
        "/health": {
          target: "http://127.0.0.1:7777",
          changeOrigin: true,
          xfwd: false,
          configure: (proxy: any) => {
            proxy.on("proxyReq", (proxyReq: any, req: any) => {
              const peer = req?.socket?.remoteAddress || "";
              const isLocalPeer =
                peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
              if (!isLocalPeer && peer) {
                const prev = req.headers["x-forwarded-for"];
                proxyReq.setHeader("x-forwarded-for", prev ? `${prev}, ${peer}` : peer);
              }
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
          configure: (proxy: any) => {
            proxy.on("proxyReqWs", (proxyReq: any, req: any) => {
              const peer = req?.socket?.remoteAddress || "";
              const isLocalPeer =
                peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
              if (!isLocalPeer && peer) {
                const prev = req.headers["x-forwarded-for"];
                proxyReq.setHeader("x-forwarded-for", prev ? `${prev}, ${peer}` : peer);
              }
              proxyReq.setHeader("host", "127.0.0.1:7777");
            });
          },
        },
      },
    },
    build: {
      rollupOptions: {
        onwarn(warning: any, defaultHandler: any) {
          if (
            warning.code === "MODULE_LEVEL_DIRECTIVE" ||
            warning.message?.includes('"use client"') ||
            String(warning).includes('"use client"')
          ) {
            return;
          }
          defaultHandler(warning);
        },
        onLog(level: any, log: any, defaultHandler: any) {
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
    client: { entry: "client" },
    server: { entry: "server" },
  },
});
