// Bounded synchronous process execution.
//
// Every synchronous child process the engine starts is a Docker CLI call. If the Docker daemon is
// hung (Docker Desktop starting up, a stuck socket), an unbounded spawnSync freezes the whole event
// loop: the API stops answering and nothing is logged. This wrapper gives each call a default
// timeout; callers that already pass their own `timeout` keep it.
//
// It also honours the remote-server scope (docker-scope.mjs), so a docker call made while working on a
// project that lives on another server goes to that server.

import { spawnSync as scopedSpawnSync } from "./docker-scope.mjs";

export const DEFAULT_SYNC_TIMEOUT_MS = 10000;

export function spawnSync(command, args, options = {}) {
  return scopedSpawnSync(command, args, {
    timeout: DEFAULT_SYNC_TIMEOUT_MS,
    windowsHide: true,
    ...options,
  });
}
