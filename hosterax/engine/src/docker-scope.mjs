// hosterax/engine/src/docker-scope.mjs
// Runs Docker commands against the server a project lives on.
//
// The engine has dozens of places that run `docker …` for a project (deploy, stop, logs, health,
// rollback, …). Rather than thread a "which server" argument through all of them, the work for a project
// runs inside runOnServer(serverId, …). While a remote scope is active, any `docker` process started
// through the spawn / execFile / spawnSync exported here gets DOCKER_HOST pointed at that server's bridge
// socket (see ssh-transport.mjs). Nothing else is touched: other programs, and Docker itself outside a
// remote scope, run exactly as before.
//
// The scope follows the async call chain (AsyncLocalStorage), so it covers everything awaited inside it
// and nothing outside it.

import { AsyncLocalStorage } from "node:async_hooks";
import * as cp from "node:child_process";
import path from "node:path";

const storage = new AsyncLocalStorage();
let resolveDockerEnv = null;

/** Called once at startup with a function (serverId) => env additions. It throws if the server is down. */
export function configureDockerScope({ dockerEnv }) {
  resolveDockerEnv = dockerEnv;
}

/** Run `fn` on a server. "local", null and undefined all mean this machine (no change). */
export function runOnServer(serverId, fn) {
  return storage.run(serverId && serverId !== "local" ? String(serverId) : null, fn);
}

/** Wrap a function so every call runs on the server `serverFor(...args)` names. */
export function onServer(serverFor, fn) {
  return function scoped(...args) {
    return runOnServer(serverFor(...args), () => fn.apply(this, args));
  };
}

export function currentServerId() {
  return storage.getStore() ?? null;
}

const DOCKER_ENV_KEYS = ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"];
const isDocker = (command) => /^docker(\.exe)?$/i.test(path.basename(String(command)));

/** The env a child should get: `env` untouched, unless it is a docker process inside a remote scope. */
export function scopedEnv(command, env) {
  const serverId = storage.getStore();
  if (!serverId || !isDocker(command)) return env;
  if (!resolveDockerEnv) throw new Error("Remote servers are not configured in this process.");
  const base = { ...(env ?? process.env) };
  for (const k of DOCKER_ENV_KEYS) delete base[k];
  return { ...base, ...resolveDockerEnv(serverId) };
}

/** Put the scoped env into whichever argument of a child_process call holds the options. */
function withScope(command, rest) {
  if (!storage.getStore() || !isDocker(command)) return rest;
  const out = [...rest];
  const i = out.findIndex((a) => a && typeof a === "object" && !Array.isArray(a));
  if (i >= 0) {
    out[i] = { ...out[i], env: scopedEnv(command, out[i].env) };
    return out;
  }
  const env = scopedEnv(command, undefined);
  const cb = out.findIndex((a) => typeof a === "function");
  if (cb >= 0) out.splice(cb, 0, { env });
  else out.push({ env });
  return out;
}

export function spawn(command, ...rest) {
  return cp.spawn(command, ...withScope(command, rest));
}

export function execFile(command, ...rest) {
  return cp.execFile(command, ...withScope(command, rest));
}

export function spawnSync(command, ...rest) {
  return cp.spawnSync(command, ...withScope(command, rest));
}
