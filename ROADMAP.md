# HosteraX Roadmap

What to build next, in priority order. Everything here is grounded in the current code: items
marked **(gap)** are things the product already implies but does not do yet.

## Where we stand (October 2026)

HosteraX was compared with Coolify, Dokploy, CapRover, Dokku, Portainer and Openship. Openship is the
closest in shape: a desktop app and CLI, self-hosted, an OpenResty edge, a mail server, scheduled
backups and an MCP endpoint. The comparison comes from each project's own README and licence files
(star counts read from their GitHub pages on 2026-10-24); none of them was run.

- **Ahead or different:** the AI copilot and MCP server, backups that are verified and drilled,
  accounts with roles, 2FA and SSO, environment values encrypted at rest, a generated API contract,
  free public access without a public IP, and a broad app catalog.
- **Behind:** deploying to other machines (Coolify, Dokploy and Openship all can; HosteraX runs
  everything on the engine host), clustering, mail that receives mail, notifications and monitoring,
  a GitHub App, a CDN, and awareness (Coolify has about 63.6k GitHub stars, Openship about 14.9k).
- **Unproven:** the newest features were tested against simulated systems only (an identity
  provider, Docker for restore drills, the tunnel services, the Docker image build).

## Priority order

| Order | Item                                   | Why                                                                                              | Size |
| :---- | :------------------------------------- | :----------------------------------------------------------------------------------------------- | :--- |
| 1     | Remote servers over SSH                | The largest gap: Coolify, Dokploy and Openship all deploy to other machines                      | L    |
| 2     | Prove the new features on real systems | Trust is the differentiator, and SSO, restore drills, tunnels and the image build are unverified | S–M  |
| 3     | Notifications and observability        | Backup, deploy, tunnel and self-heal failures only show in the UI; competitors notify and chart  | M    |
| 4     | Decide what "mail" is                  | Openship bundles a mail server; HosteraX only sends through a relay                              | M–L  |
| 5     | GitHub App and pull-request previews   | Replaces per-repo webhook secrets and puts the preview link on the pull request                  | M    |
| 6     | Make it easy to adopt                  | One-line installer, a docs site, a demo, release notes: the gap to Coolify is mostly awareness   | S–M  |
| 7     | Multi-node orchestration               | Scheduling and failover across servers; only after item 1                                        | L    |
| 8     | Edge extras (CDN and cache rules)      | Openship has a CDN, but most people put Cloudflare in front, so this goes last                   | S–M  |

Details of the older, finer-grained backlog follow below; the items there that overlap with this
table (remote deploys, mail, notifications, GitHub App) are the same work.

### Plan: remote servers over SSH

**Where it stands.** The server registry stores SSH credentials encrypted, generates a Docker
bootstrap script and polls metrics, but "test connection" only opens a TCP connection to the SSH
port: it never logs in and never checks Docker. Projects have no placement field, so nothing can run
anywhere but the engine host. Roughly 40 places run the `docker` CLI and a separate HTTP client talks
to the daemon; the client understands unix sockets, named pipes and TCP, but not `ssh://`. The edge
proxy forwards to `host.docker.internal`, which only works for the engine's own host.

**Approach: Docker over SSH, with no agent on the server.** Run the same Docker commands against the
remote daemon with `DOCKER_HOST=ssh://user@host`, using a private `HOME` per server that holds an
`.ssh/config`, the server's key and a pinned `known_hosts`, so none of the operator's own ssh setup
is involved. Builds happen on the remote daemon. Alternatives considered: a custom agent (more
control and works behind NAT, but a new program to secure and ship; kept for a later phase), Docker
Swarm (clustering, not placement; item 7), and shell scripts over ssh (fragile).

- **Phase 0, honest connection test (S).** Log in with the stored key, run `docker version`,
  `docker info` and a disk and memory probe, and report what is wrong in plain words. Show the host
  key fingerprint at registration, store it, and refuse to connect if it ever changes. Key
  authentication only; no password login.
- **Phase 1, one way to reach Docker (M).** A `dockerFor(server)` function that returns the
  environment, arguments and API client for a server, and route all roughly 40 CLI call sites and the API
  client through it. The local engine host stays the default and must behave exactly as today.
- **Phase 2, placement (M).** A `server_id` on each project, a choice in the dashboard, CLI and API,
  and make deploy, rollback, health checks, logs, metrics, stop and delete run on that server.
  Managed databases, backups, verification and restore drills run through the same function.
- **Phase 3, routing (M).** The edge forwards to the server's address instead of
  `host.docker.internal`; tunnels point at it too. Document binding app ports to a private interface
  and firewalling them.
- **Phase 4, failure behaviour (M).** A server that cannot be reached shows its projects as
  unreachable, not crashed, and self-heal does not move them elsewhere unasked. Reuse ssh
  connections (`ControlMaster`) and limit concurrent commands per server.
- **Later:** an agent for servers that cannot accept inbound ssh, and scheduling across servers
  (item 7).

**Security.** Credentials are already encrypted at rest. Write the key to a `0600` file only for the
duration of a command, disable agent forwarding, verify host keys strictly, and keep server
management admin-only. Say plainly in the docs that access to a server's Docker group is root on
that server.

**Testing.** The sandbox has no sshd or Docker, so CI uses a fake `ssh` and a fake Docker (as the
existing tests already do for Docker) to check the generated environment, arguments and failure
paths, with mutation checks on host-key pinning. An opt-in test against a real sshd container runs
where Docker exists.

**Done when** a project can be deployed, routed, logged, rolled back, backed up and restore-drilled
on a real remote server, and the limits are written down.

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
   only tested against programs that print each service's documented output. Still missing: a CI
   job or manual checklist that runs each against the real service, pinned relay host keys for the
   ssh providers, an optional login (basic auth or Cloudflare Access) in front of an exposed app,
   automatic UPnP/NAT-PMP port mapping and an external reachability test for direct exposure, and
   stable custom domains on top of quick tunnels.
7. **Deploy to remote servers (gap).** See _Plan: remote servers over SSH_ above.
8. **Email that actually receives mail (gap).** Either integrate a proper MTA (Stalwart or Mailu as
   a managed app) or narrow the feature to "DNS records + relay sending" and say so in the UI.
9. **Backup notifications and verification depth.** Scheduled backups, retention, archive
   verification, restore drills and opt-in encrypted archives now exist. Still missing: pushing
   failures to email/Slack/webhooks, running a restore drill against a real Docker daemon in CI,
   deeper verification of mongodump archives, per-backup key rotation, and MCP tools for schedules.
10. **Verified catalog images.** A CI job that pulls every catalog image, records its digest and
    architectures, and flips `imageVerified` (currently 608 of ~2,500). Pin digests, and verify
    signatures with cosign where publishers provide them.
11. **OAuth 2.1 + PKCE for remote MCP clients (gap)**, so hosted agents can authenticate without
    sharing a long-lived admin token.

## P2 — Product features

12. **Observability.** A Prometheus `/metrics` endpoint, OpenTelemetry export, alert rules (crash
    loop, disk, cert expiry, failed backup) with Slack/email/webhook notifications.
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
