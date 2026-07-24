# HosteraX Runtime

Self-hosted deployment engine. Runs on your PC / server / VPS. Includes:

- **`engine/`** — Node daemon: HTTP + WebSocket API, spawns real deploys, streams real logs, persists state in SQLite. Zero external services.
- **`cli/`** — `hosterax` command-line client.
- **`electron/`** — Desktop app that boots the engine and loads the dashboard.
- The Lovable web dashboard (this repo's `src/`) has a **Local Engine** page that connects to `http://localhost:7777` and drives real deploys.

## Quick start

Requires Node 20+ (Bun works too). Git and Docker optional but recommended.

```bash
cd hosterax/engine && npm install && npm start
# engine listens on http://localhost:7777
```

Then in another terminal:

```bash
cd hosterax/cli && npm install && npm link
hosterax status
hosterax deploy ./my-app --name my-app
hosterax logs my-app --follow
```

Or launch the desktop app:

```bash
cd hosterax/electron && npm install && npm start
```

## Web dashboard → local engine

Open the dashboard and go to **/local**. Point it at `http://localhost:7777`. It uses the same REST + WS API — everything you see is live from your machine.

## API surface (engine)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | ping |
| GET | `/api/projects` | list |
| POST | `/api/projects` | create `{name, source, buildCmd, startCmd, env}` |
| DELETE | `/api/projects/:name` | remove |
| GET | `/api/projects/:name/deployments` | history |
| POST | `/api/projects/:name/deploy` | trigger deploy `{trigger?}` |
| POST | `/api/deployments/:id/rollback` | redeploy that version |
| POST | `/api/deployments/:id/cancel` | kill build |
| GET | `/api/deployments/:id/logs` | full log text |
| WS   | `/ws?deployment=:id` | live log stream (line-delimited JSON) |
| POST | `/api/projects/:name/env` | replace env vars |
| GET | `/api/tokens` / POST / DELETE | personal access tokens |

Auth: `Authorization: Bearer <token>` — first request without any tokens configured is allowed and creates a bootstrap token printed to the engine console.

## What actually runs

`deploy` performs, in order:

1. **queued** — writes deployment row
2. **fetching** — `git clone` (if source is a URL) or `cp -r` (if local path) into `~/.hosterax/work/<project>/<version>`
3. **building** — runs `buildCmd` in that dir with your env vars (spawned child process, real stdout/stderr piped to the log stream)
4. **deploying** — kills previous `startCmd` process for that project, starts new one detached, tracks PID
5. **ready** or **failed**

Rollback re-runs step 4 against a previous version's working dir. Logs are persisted to SQLite and to `~/.hosterax/logs/<deploymentId>.log`.

## Data

SQLite at `~/.hosterax/hosterax.db`. Work trees at `~/.hosterax/work/`. Nothing phones home.

## Cross-platform

Pure Node — runs on macOS, Linux, Windows. Electron packaging supported via `@electron/packager` (see `electron/README`).
