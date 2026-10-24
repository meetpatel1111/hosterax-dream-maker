# HosteraX Roadmap

What to build next, in priority order. Everything here is grounded in the current code: items
marked **(gap)** are things the product already implies but does not do yet.

## Where we stand (October 2026)

HosteraX was compared with Coolify, Dokploy, CapRover, Dokku, Portainer and Openship. Openship is the
closest in shape: a desktop app and CLI, self-hosted, an OpenResty edge, a mail server, scheduled
backups and an MCP endpoint. Five were compared from their READMEs and licence files (star counts
read from their GitHub pages on 2026-10-24). Openship's source was also read (commit `eb09a99`, a
TypeScript monorepo of about 7,300 files). None of them was run.

- **Ahead or different:** the AI copilot (no AI features found in Openship's API, platform or CLI
  code), backups that are verified and restore-drilled (Openship checks checksums, upload
  completeness and destinations, but no restore drill was found), SSO sign-in (Openship has two-factor
  authentication, passkeys and what looks like OAuth for MCP clients, but no user SSO was found), free public tunnels that need no
  account or domain, a broad app catalog, and a much smaller footprint: one Node process and SQLite
  where Openship's server mode runs Postgres and Redis.
- **Closed since that comparison:** deploying to other machines over SSH (single-container Docker
  projects, host key pinned, no agent), notifications (webhook, Slack, Discord, ntfy, email), a
  password gate for any app, pinned tunnel images, Docker context detection, generated CLI and API
  references, and a licence inventory with a policy check.
- **Still behind:** a per-server edge and orchestration across servers, clustering, mail that
  receives mail, metrics and dashboards (Prometheus, charts), a GitHub App, a CDN, and awareness
  (Coolify has about 63.6k GitHub stars, Openship about 14.9k). Openship also manages Cloudflare
  Tunnels through the Cloudflare API with Cloudflare Access login policies; HosteraX asks you to
  paste a tunnel token.
- **Engineering discipline:** Openship has about 1,850 test files, end-to-end and release-gate
  workflows, release advisories, structured error reporting and a `TODO.md` checked against the
  tree. HosteraX has 24 test files (224 tests, including end-to-end tests against a real OpenSSH server).
- **Unproven:** the newest features were tested against simulated systems only (an identity
  provider, Docker for restore drills, the tunnel services, the Docker image build). Remote servers
  were tested with the real engine, the real `docker` CLI and a real OpenSSH server, but the Docker
  daemon behind the SSH connection was a stand-in, and no real second machine was used.

## Priority order

| Order | Item                                   | Why                                                                                                              | Size |
| :---- | :------------------------------------- | :--------------------------------------------------------------------------------------------------------------- | :--- |
| 1     | Remote servers: the rest of the plan   | Built for Docker projects; still missing a per-server edge, compose, remote databases and a real-machine run     | M–L  |
| 2     | Prove the new features on real systems | Trust is the differentiator, and SSO, restore drills, tunnels, remote servers and the image build are unverified | S–M  |
| 3     | Observability                          | Notifications exist now; Prometheus metrics, charts and alert rules (disk, certificate expiry) do not            | M    |
| 4     | Decide what "mail" is                  | Openship bundles a mail server; HosteraX only sends through a relay                                              | M–L  |
| 5     | GitHub App and pull-request previews   | Replaces per-repo webhook secrets and puts the preview link on the pull request                                  | M    |
| 6     | Make it easy to adopt                  | One-line installer, a docs site, a demo, release notes: the gap to Coolify is mostly awareness                   | S–M  |
| 7     | Multi-node orchestration               | Scheduling and failover across servers; only after item 1                                                        | L    |
| 8     | Edge extras (CDN and cache rules)      | Openship has a CDN, but most people put Cloudflare in front, so this goes last                                   | S–M  |

Details of the older, finer-grained backlog follow below; the items there that overlap with this
table (remote deploys, mail, notifications, GitHub App) are the same work.

### Remote servers over SSH: what was built and what is left

**Built.** Servers are logged into for real (`ssh`, key only), their host key is confirmed by an admin
and pinned, a changed key is refused, and the connection test reports the machine and Docker with a
plain-words reason for each failure. Docker on a server is reached through a bridge process that runs
`ssh … docker system dial-stdio`, behind a unix socket, so the CLI and the HTTP client share one path
(`DOCKER_HOST=unix://…`). Projects have a `server_id`; the work for a project runs inside
`runOnServer(serverId, …)`, an async scope that points every `docker` process at that server, so
deploy, rollback, stop, restart, logs, delete, self-heal and prune act on it, and a server that is
down fails the call instead of falling back to this machine. The container publishes on the server's
loopback and is forwarded over the same SSH connection to a port here, which routes, health checks,
domains and tunnels already use. An unreachable server shows its projects as unreachable and nothing
is restarted. Tested end to end against a real `sshd` (as root and as an ordinary user), the real
`docker` CLI and a stand-in Docker daemon, with mutation checks on host-key pinning, strict checking,
key permissions, input validation, the scope and the unreachable guard.

**Where it differs from the plan above.** Docker is reached through a bridge rather than
`DOCKER_HOST=ssh://`: the engine calls `spawnSync("docker", …)` in many places, which blocks its own
event loop, and a bridge living in the engine could not answer the very command waiting for it, so
it is a separate process. There is no per-server `HOME` with an ssh config: HosteraX runs `ssh -F` with a
config it generates, which also works without touching `HOME`. Apps are reached through a forward
from this machine instead of an edge on each server.

**Left to do.**

- **A per-server edge (M).** DNS pointing at the server, TLS ending there, traffic flowing if the
  engine is down. Today traffic enters through this machine's edge or tunnel and crosses to the server
  inside SSH.
- **Compose and process projects on a server, and remote managed databases, backups and restore drills (M).** Today a
  server runs single-container Docker projects, and databases, backups, scale-to-zero and the metrics
  charts are local only.
- **Per-server serialisation and cancellation (S–M).** Changes to one server are not yet queued behind
  a lock, long builds cannot be cancelled, and a dropped connection during a long build is not journalled.
- **Move a project between servers (S–M).** Deployed projects cannot be moved.
- **Find the remote Docker socket (S).** `docker system dial-stdio` uses the remote CLI's own endpoint,
  which covers most setups; rootless Docker whose CLI is not configured for it is not handled.
- **An agent** for servers that cannot accept inbound SSH, and scheduling across servers (item 7).
- **Run it against a real machine (S).** The first real server is the first real check of the Docker
  parts.

### Smaller follow-ups from reading Openship's code

- **Pin the tunnel programs: done.** The Docker fallback runs `cloudflared`, `ngrok` and `bore` pinned
  by version and digest (`IMAGES` in `tunnel-manager.mjs`; `HOSTERAX_<TOOL>_IMAGE` overrides one).
  To update, pull the new tag, read its digest with `docker buildx imagetools inspect`, and change
  both. The edge images (`openresty/openresty:alpine`, `caddy`, `certbot/certbot`) still use floating
  tags.
- **API-driven Cloudflare tunnels with login policies (M).** Given a Cloudflare API token, create
  the tunnel, DNS records and ingress rules, and optionally a Cloudflare Access policy, instead of
  asking the user to copy a token from the dashboard.
- **A password gate for any app: done, but not at the edge.** A per-project listener (PBKDF2 hash,
  signed session cookie, rate limit, WebSockets) in front of the app; routes and tunnels point at it.
  It is one shared password, so Cloudflare Access style per-person policies remain open.
- **Edge-side metrics (M).** Count requests in the proxy's log phase and flush aggregates on a
  schedule: no per-request I/O and no database write per request.
- **Find the Docker daemon through the CLI's active context: done** (`detectDockerHost`).
- **Consent and an audit trail for MCP clients (M).** Openship appears to issue OAuth tokens to MCP
  clients with a consent step and an audit log, judging by its MCP consent, token and audit modules
  (not read in full); this is the same work as the OAuth item in the backlog below.
- **Generate and check reference docs: done for the CLI and the API** (`docs/CLI.md`, `docs/API.md`,
  `npm run docs:check`). The MCP tool reference is still written by hand.
- **Write the deploy sequence down as code (M).** One pipeline (preflight, start the new release,
  health gate, route, retire the old one) with retain-and-revert and cancellation, shared by every
  deploy target.
- **Keep a component licence inventory: done** (`docs/THIRD_PARTY.md`, `npm run licenses:check` fails
  on strong copyleft or a missing licence). Run mail as a separate managed app if it is added; Openship
  ships a vendored GPL v3 mail engine inside its API image.

### Decisions for the owner

- A hosted offering (Coolify, Openship and Dokploy all have one) is not planned; say so if that
  changes.
- Avoid bundling GPL components (Openship ships iRedMail, which is GPL). If mail is integrated, run
  it as a separate managed app.
- Where to be known: verified backups, access control and an AI-operable platform are the real
  differences, not matching Coolify feature for feature.

## P0 — Trust and safety

1. **Per-organization and per-project permissions.** User accounts, four enforced roles, TOTP 2FA and
   OIDC SSO exist now, but roles are instance-wide and the Team/Organization pages are still a
   directory **(gap)**. Still missing: scoping roles to organizations/projects, SCIM or group-to-role
   mapping from the identity provider, "sign out everywhere" and session lists, WebAuthn/passkeys,
   and requiring 2FA by policy.
2. **Audit secret reads.** Environment values are now encrypted at rest. Still missing: an audit
   entry whenever a value is revealed (MCP `get_project_env`, deploy tokens) and a "reveal" action in
   the dashboard that is separate from editing.
3. **Close the edge and transport gaps.** Bind the Caddy admin API to a unix socket, offer built-in
   ACME for the dashboard hostname so the engine can serve HTTPS itself, and add HSTS/secure-cookie
   defaults.
4. **Token hygiene.** Expiry dates, last-used IP/user-agent, per-token rate limits, and a
   "revoke all" panic button. Surface the audit log in the dashboard with filters and export.
5. **Reduce what the Docker socket can do.** Document and support a socket proxy (read-only for
   most routes), rootless Docker, and a sandboxed BuildKit builder with CPU/RAM/time limits so
   building untrusted repos cannot starve or escape the host.

## P1 — Finish what is half-built

6. **Public access: prove it against the live services and harden it.** Free tunnels (Cloudflare,
   localhost.run, Pinggy, Serveo, localtunnel, ngrok, Tailscale Funnel, bore, custom) exist but were
   only tested against programs that print each service's documented output. A password gate can now
   sit in front of an exposed app. Still missing: a CI job or manual checklist that runs each against
   the real service, pinned relay host keys for the ssh providers, per-person login (Cloudflare Access),
   automatic UPnP/NAT-PMP port mapping and an external reachability test for direct exposure, and
   stable custom domains on top of quick tunnels.
7. **Deploy to remote servers.** Built for Docker projects; see _Remote servers over SSH_ above for what is left.
8. **Email that actually receives mail (gap).** Either integrate a proper MTA (Stalwart or Mailu as
   a managed app) or narrow the feature to "DNS records + relay sending" and say so in the UI.
9. **Verification depth for backups.** Scheduled backups, retention, archive verification, restore
   drills, opt-in encrypted archives and failure notifications (webhook, Slack, Discord, ntfy, email)
   now exist. Still missing: running a restore drill against a real Docker daemon in CI,
   deeper verification of mongodump archives, per-backup key rotation, and MCP tools for schedules.
10. **Verified catalog images.** A CI job that pulls every catalog image, records its digest and
    architectures, and flips `imageVerified` (currently 608 of ~2,500). Pin digests, and verify
    signatures with cosign where publishers provide them.
11. **OAuth 2.1 + PKCE for remote MCP clients (gap)**, so hosted agents can authenticate without
    sharing a long-lived admin token.

## P2 — Product features

12. **Observability.** Failure notifications exist (deploys, crash loops, servers, backups, tunnels,
    Docker). Still missing: a Prometheus `/metrics` endpoint, OpenTelemetry export, and alert rules on
    levels rather than failures (disk, certificate expiry, memory) feeding the same channels.
13. **GitHub App integration.** Replace per-repo webhook secrets with an app: deploy status checks,
    PR comments with preview URLs, and GitLab/Gitea equivalents.
14. **Environments and promotion.** Staging → production promotion, deploy approvals, per-PR
    preview databases (seeded from a backup), and scheduled/ephemeral previews.
15. **More deploy targets.** Import `docker-compose.yml` as a multi-service project, and a Kubernetes
    or Nomad driver behind the same deploy interface.
16. **Log retention and search.** Persist logs with rotation and add in-dashboard search/filter;
    stream to Loki or an external syslog.
17. **Localization without a third party.** Replace opt-in machine translation with community
    dictionaries and a missing-key report in CI; add an accessibility pass (focus order, contrast).

## P3 — Engineering health

18. **Break up `engine/src/index.mjs` (~5k lines)** into route modules with JSDoc/TypeScript types.
19. **Generate the API contract.** Many past bugs were the CLI and dashboard calling routes or
    fields that did not exist. Emit an OpenAPI document from the route table, generate the client
    types from it, and add a contract test that fails CI on drift.
20. **Broader tests.** Playwright end-to-end tests for sign-in, deploy and rollback; Docker-backed
    integration tests (database provisioning, backup/restore, blue/green cutover) on CI.
21. **Release and dependency hygiene.** One package manager for the repo (the root `bun.lock` is
    stale), Renovate, SBOM generation, and signed images with build provenance. Remove the unused
    Supabase scaffold (`src/integrations/supabase`, `supabase/`, the tracked `.env`) once confirmed
    it is not needed by the Lovable project.

## Quick wins

- A `htx doctor` command that checks Docker access, ports, DNS, disk and the secret-key backup.
- Per-project "deploy from branch" selector and a "redeploy last successful" button.
- Export/import of a project definition (without secrets) for moving between engines.
