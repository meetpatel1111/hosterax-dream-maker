# HosteraX Roadmap

What to build next, in priority order. Everything here is grounded in the current code: items
marked **(gap)** are things the product already implies but does not do yet.

## P0 — Trust and safety

1. **Real user accounts with enforced roles.** Today permissions come only from API token scopes;
   the Team/Organization pages are a directory **(gap)**. Add users with scrypt passwords, sessions,
   TOTP 2FA and OIDC/SSO sign-in, then make `Owner/Admin/Developer/Viewer` actually gate routes and
   MCP tools per organization.
2. **Encrypt project environment variables at rest.** The `secrets.mjs` machinery already protects
   SSH/S3/DKIM/TLS keys; env values still sit in SQLite in clear text. Encrypt them, add a "secret"
   flag, and write an audit entry whenever a value is revealed.
3. **Close the edge and transport gaps.** Bind the Caddy admin API to a unix socket, offer built-in
   ACME for the dashboard hostname so the engine can serve HTTPS itself, and add HSTS/secure-cookie
   defaults.
4. **Token hygiene.** Expiry dates, last-used IP/user-agent, per-token rate limits, and a
   "revoke all" panic button. Surface the audit log in the dashboard with filters and export.
5. **Reduce what the Docker socket can do.** Document and support a socket proxy (read-only for
   most routes), rootless Docker, and a sandboxed BuildKit builder with CPU/RAM/time limits so
   building untrusted repos cannot starve or escape the host.

## P1 — Finish what is half-built

6. **Deploy to remote servers (gap).** Servers can be registered and pinged, but projects run only
   on the engine host. Implement SSH-based deploys (or a small agent), real CPU/RAM/Docker probes
   for remote nodes, and a placement choice per project.
7. **Email that actually receives mail (gap).** Either integrate a proper MTA (Stalwart or Mailu as
   a managed app) or narrow the feature to "DNS records + relay sending" and say so in the UI.
8. **Backup notifications and verification depth.** Scheduled backups, retention, archive
   verification, restore drills and opt-in encrypted archives now exist. Still missing: pushing
   failures to email/Slack/webhooks, running a restore drill against a real Docker daemon in CI,
   deeper verification of mongodump archives, per-backup key rotation, and MCP tools for schedules.
9. **Verified catalog images.** A CI job that pulls every catalog image, records its digest and
   architectures, and flips `imageVerified` (currently 608 of ~2,500). Pin digests, and verify
   signatures with cosign where publishers provide them.
10. **OAuth 2.1 + PKCE for remote MCP clients (gap)**, so hosted agents can authenticate without
    sharing a long-lived admin token.

## P2 — Product features

11. **Observability.** A Prometheus `/metrics` endpoint, OpenTelemetry export, alert rules (crash
    loop, disk, cert expiry, failed backup) with Slack/email/webhook notifications.
12. **GitHub App integration.** Replace per-repo webhook secrets with an app: deploy status checks,
    PR comments with preview URLs, and GitLab/Gitea equivalents.
13. **Environments and promotion.** Staging → production promotion, deploy approvals, per-PR
    preview databases (seeded from a backup), and scheduled/ephemeral previews.
14. **More deploy targets.** Import `docker-compose.yml` as a multi-service project, and a Kubernetes
    or Nomad driver behind the same deploy interface.
15. **Log retention and search.** Persist logs with rotation and add in-dashboard search/filter;
    stream to Loki or an external syslog.
16. **Localization without a third party.** Replace opt-in machine translation with community
    dictionaries and a missing-key report in CI; add an accessibility pass (focus order, contrast).

## P3 — Engineering health

17. **Break up `engine/src/index.mjs` (~5k lines)** into route modules with JSDoc/TypeScript types.
18. **Generate the API contract.** Many past bugs were the CLI and dashboard calling routes or
    fields that did not exist. Emit an OpenAPI document from the route table, generate the client
    types from it, and add a contract test that fails CI on drift.
19. **Broader tests.** Playwright end-to-end tests for sign-in, deploy and rollback; Docker-backed
    integration tests (database provisioning, backup/restore, blue/green cutover) on CI.
20. **Release and dependency hygiene.** One package manager for the repo (the root `bun.lock` is
    stale), Renovate, SBOM generation, and signed images with build provenance. Remove the unused
    Supabase scaffold (`src/integrations/supabase`, `supabase/`, the tracked `.env`) once confirmed
    it is not needed by the Lovable project.

## Quick wins

- A `htx doctor` command that checks Docker access, ports, DNS, disk and the secret-key backup.
- Per-project "deploy from branch" selector and a "redeploy last successful" button.
- Export/import of a project definition (without secrets) for moving between engines.
