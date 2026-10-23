// Bounded synchronous process execution.
//
// Every synchronous child process the engine starts is a Docker CLI call. If the Docker daemon is
// hung (Docker Desktop starting up, a stuck socket), an unbounded spawnSync freezes the whole event
// loop: the API stops answering and nothing is logged. This wrapper gives each call a default
// timeout; callers that already pass their own `timeout` keep it.

import { spawnSync as rawSpawnSync } from "node:child_process";

export const DEFAULT_SYNC_TIMEOUT_MS = 10000;

export function spawnSync(command, args, options = {}) {
  return rawSpawnSync(command, args, {
    timeout: DEFAULT_SYNC_TIMEOUT_MS,
    windowsHide: true,
    ...options,
  });
}
