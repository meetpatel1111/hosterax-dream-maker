# 🛡️ Security Policy

The HosteraX team takes security, container isolation, and data privacy seriously. As a self-hosted cloud control plane managing production workloads and sensitive credentials, we maintain proactive vulnerability monitoring.

---

## 📋 Supported Versions

We release patches and security fixes for the following versions:

| Version     | Supported | Notes                                |
| :---------- | :-------: | :----------------------------------- |
| **1.1.x**   |    Yes    | Current release; receives all fixes  |
| **< 1.1.0** |   ❌ No   | Please upgrade to the latest version |

---

## 🔒 Security Architecture Highlights

HosteraX is architected with defense-in-depth principles:

1. **Local-First & Self-Hosted**: Project metadata, SQLite databases and environment variables stay on your own hardware. The only outbound calls are ones you trigger: image pulls, Let's Encrypt, S3/R2 sync, your SMTP relay and AI providers. The optional machine translation and app-logo loading in the dashboard are controlled in Settings → Privacy.
2. **Hashed API Tokens with Scopes**: Tokens are generated with `node:crypto` (256-bit CSPRNG) and only their SHA-256 digest is stored, so a token can be shown exactly once. Scopes are `read` < `deploy` < `admin` and are enforced on every route, on each MCP tool and on the AI copilot.
3. **Accounts, roles and two-factor**: user sessions are looked up on every request (role changes and disabling apply instantly), passwords are salted scrypt hashes, TOTP secrets are encrypted at rest, lockouts and an audit trail cover sign-ins, and first-run setup requires an admin credential. SSO uses authorization code + PKCE and verifies the ID token fully.
4. **No Implicit Trust for Remote Clients**: Only requests that originate from the engine's own machine, over loopback, from a trusted origin and without proxy headers are accepted without a token. Set `HOSTERAX_REQUIRE_AUTH=1` to disable even that.
5. **Injection Defenses**: Docker is driven with argument vectors rather than shell strings; image references, hostnames, project names and environment keys are validated; git URLs are passed after `--`; log and upload paths are checked against traversal; secrets are masked in logs.
6. **Secrets at Rest** (and opt-in encrypted backups, see README): Project environment variables, SSH keys, S3 credentials, DKIM and TLS private keys, SMTP relay passwords and AI keys are encrypted with AES-256-GCM. Back up `secret.key` (or keep `HOSTERAX_SECRET_KEY`) with your data: without it these values cannot be recovered. Mailbox passwords are stored only as salted scrypt hashes.
7. **Verified Domain Ownership**: A custom domain is only routed after a DNS TXT challenge succeeds, which prevents one project from claiming another's hostname.
8. **Signed Confirmation for AI Actions**: Destructive actions requested by the AI copilot or MCP clients need a short-lived, server-signed ticket.
9. **Webhooks**: GitHub push webhooks are verified with HMAC-SHA256 before anything is deployed.
10. **Remote servers**: a server's host key must be confirmed by an admin (the fingerprint is compared against what the server presents at that moment) and is then pinned; a changed key is refused, never accepted silently. Connections use key login only, strict host-key checking, no agent or agent forwarding, no terminal, and a per-server ssh config HosteraX generates from validated fields (host, port and user are checked so nothing can inject ssh options), never the operator's own ssh config. The private key is stored encrypted, written 0600 to a 0700 per-server directory, and deleted with the server. Apps on a server publish on its loopback only and are reached through the SSH connection.
11. **Password gate**: PBKDF2-SHA256 password hashes, HMAC-signed expiring session cookies bound to the project, rate-limited attempts, same-site-only redirects, and the gate's cookie is never passed on to the app.
12. **Notifications**: channel URLs and secrets are encrypted at rest and masked in every response; outbound messages are http(s) only, avoid link-local and metadata addresses, never follow redirects and have a timeout.

### Known limitations

Please factor these into your threat model:

- **Docker socket = root.** The engine (and its container image) controls the Docker daemon. Anyone with an `admin` or `deploy` token can run containers, so guard tokens accordingly.
- **Environment values are readable by `deploy` and `admin` tokens.** Encryption protects the database file and backups, not callers who are allowed to read the values (for example MCP `get_project_env`). Reads are not yet written to an audit log.
- **Edge proxy admin API.** The Caddy admin endpoint is bound to all interfaces inside the edge container's network. It is not published on the host, but other containers on the same Docker network can reach it.
- **No TLS on the engine itself.** Put a TLS-terminating proxy in front of port 7777 when it is reachable from other machines.
- **Roles are instance-wide.** User accounts have one of four roles that gate every route, MCP tool and AI action, but the Team/Organization pages are still only a directory: there is no per-organization or per-project permission yet.
- **Local access is still full admin.** A request from the engine's own machine (or any API token) is not tied to a user. Set `HOSTERAX_REQUIRE_AUTH=1` to require a credential even locally.
- **SSO is tested against a simulated identity provider only.**
- **Account lockout is per email,** which protects against guessing but means someone can lock a known email for 15 minutes; admins and API tokens are unaffected.
- **Public tunnels expose an app to everyone.** An `admin` can make a deployed project (or the edge proxy) public through a free third-party relay. The app is exposed as it is, with no login added, and the relay operator can see traffic the app does not encrypt itself. Tunnels can only point at a project's port or the edge, never at the engine or dashboard, and tokens for them are stored encrypted and kept out of command lines and logs. The ssh-based providers trust a relay's host key the first time they connect (`StrictHostKeyChecking=accept-new`) and use none of your own keys or ssh config. The `localtunnel` provider downloads and runs an npm package each time it starts (`auto` never picks it), and the `custom` provider runs a command you supply, so it is off unless the machine owner sets `HOSTERAX_ALLOW_CUSTOM_TUNNELS=1`. The provider integrations were tested against stand-in programs, not the live services.
- **A remote server's Docker group is root on that server.** The SSH user HosteraX logs in as must be able to use Docker, which is equivalent to root there; use a dedicated user, restrict it with `authorized_keys` options if you can, and treat the engine host (which holds the key, encrypted with `secret.key`) as having that access. The first host-key confirmation is only as good as the check you make against another source (your provider's console, or `ssh-keygen -lf` on the server).
- **Remote placement is tested against a real OpenSSH server, the real Docker CLI and a real Docker daemon, but that daemon runs on the same machine as the test, not on a second one.** Traffic from the internet reaches a remote app through this machine's edge or tunnel; there is no edge on the server, and an app's forwarded port on this machine is published on `HOSTERAX_BIND_HOST` like any local app.
- **The password gate is one shared password per app** and protects traffic that goes through it. An app that was running before the gate was switched on keeps its own port published until it is redeployed, so the gate does not protect against someone who can reach that port directly.
- **An image name is not always the image you get.** For a bare name such as `nginx`, HosteraX pulls the official image; only if that reference does not exist does it try other candidates, and it says so in the deploy log (`⚠ … was not found; using …`). A temporary registry failure (rate limit, timeout) is retried and never leads to a different publisher's image. A full reference with a tag (`registry/team/app:1.2`) is pulled exactly as written. Pin by digest (`@sha256:…`) when provenance matters.
- **Restoring a database is destructive.** A PostgreSQL restore drops and recreates every database in the cluster, a Redis restore replaces its data, and a restore that fails part-way can leave the database changed. Take a fresh backup first; the restore drill proves a backup can be restored without touching the live database.
- **Not implemented:** an inbound mail server and an OAuth provider; an agent for servers that cannot accept inbound SSH; a per-server edge proxy.

## 🧭 Threat Model

Scope: `meetpatel1111/hosterax-dream-maker` (default branch). Builds on the Security Architecture Highlights and Known limitations above, `ARCHITECTURE.md`, and the engine code. No separate infrastructure repository: HosteraX is self-hosted software, deployed by each operator (`Dockerfile`, `npx hosterax`, desktop app).

### System overview and trust boundaries

HosteraX is a self-hosted control plane (Coolify/Dokku-style). One Node engine process holds the Docker socket (root-equivalent on the host) and SSH keys to remote servers, and serves the API, MCP endpoint and dashboard on port 7777.

Trust boundaries:

1. **Network → engine (port 7777)**: unauthenticated internet/LAN callers vs. token/session holders. Engine has no TLS of its own (SECURITY.md).
2. **Loopback implicit trust**: requests from the engine's own machine, over loopback, with a loopback `Host`, trusted `Origin` and no proxy headers get `["*"]` without a token (`isTrustedLocalRequest`, `hosterax/engine/src/security.mjs`). `HOSTERAX_REQUIRE_AUTH=1` disables it.
3. **Role/scope tiers**: `read` < `deploy` < `admin` (roles viewer/developer/admin/owner, `accounts.mjs`), enforced by `requiredLevel` + `ADMIN_ONLY`/`SECRET_READS` and per MCP tool.
4. **Engine → Docker daemon / remote servers**: anyone who can deploy can run containers (root on host); remote servers via SSH + `docker system dial-stdio`.
5. **Deployed apps (tenants) ↔ engine/edge**: user workloads run as containers or processes on the same host, published on `HOSTERAX_BIND_HOST` (default `0.0.0.0`), routed by the edge proxy and the engine's magic-DNS proxy.
6. **External inputs**: GitHub webhooks (HMAC), OIDC IdP, git repos/images being built, AI providers, app catalog data.

### Components

| Component               | Code                                                                                                                                                                                                           | Notes                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Engine API**          | `hosterax/engine/src/index.mjs`, `projects-api.mjs`, `catalog-api.mjs`, `security.mjs`                                                                                                                         | HTTP router, auth, scopes, deployments, magic-DNS proxy, webhooks                                               |
| **Auth & Accounts**     | `accounts.mjs`, `oidc.mjs`, `totp.mjs`, `secrets.mjs`                                                                                                                                                          | users, sessions (`hxs_`), API tokens (`hxt_`, SHA-256), scrypt, TOTP, OIDC PKCE, AES-256-GCM secrets            |
| **MCP & AI Ops**        | `mcp-server.mjs`, `ai-ops.mjs`, `self-heal.mjs`                                                                                                                                                                | 46 tools gated by scope, signed confirmation tickets for destructive actions, AI copilot/auto-fix, self-healing |
| **Deploy & Docker**     | `docker-api.mjs`, `docker-scope.mjs`, `dockerfile-generator.mjs`, `image-resolver.mjs`, `safe-exec.mjs`, `process-tree.mjs`, `cron-manager.mjs`, `scale-to-zero.mjs`, `stack-registry*.mjs`, `gpu-manager.mjs` | builds, containers, processes, jobs                                                                             |
| **Edge & Networking**   | `edge-manager.mjs`, `tls-manager.mjs`, `domain-utils.mjs`, `gate-manager.mjs`, `tunnel-manager.mjs`, `port-check.mjs`                                                                                          | Caddy/OpenResty `hx_edge` (host network), certbot, password gate, public tunnels                                |
| **Remote Servers**      | `server-manager.mjs`, `ssh-transport.mjs`, `ssh-bridge-worker.mjs`                                                                                                                                             | SSH key login, pinned host keys                                                                                 |
| **Data & Integrations** | `backup-manager.mjs`, `backup-scheduler.mjs`, `s3-storage.mjs`, `email-manager.mjs`, `notification-manager.mjs`, `webhook-manager.mjs`, `org-manager.mjs`, `metrics-manager.mjs`                               | backups/restore, S3, SMTP/mail, outbound notifications (SSRF guards), GitHub webhooks                           |
| **Dashboard & Clients** | `src/` (React/TanStack Start), `hosterax/engine/src/dashboard-server.mjs`, `hosterax/cli/`, `hosterax/desktop/`, `scripts/`                                                                                    | web UI served by engine, CLI `htx`, Electron app (contextIsolation on), release/build scripts                   |

### Entry points and who can reach them

- **Unauthenticated**: `/health`, `/api/health`; `/api/auth/providers`, `/api/auth/login` (password, legacy token exchange), `/api/auth/oidc/login|callback`; first-run setup; `/webhooks/github[/:project]` (HMAC-SHA256 required); magic-DNS reverse proxy (`*.sslip.io`, `*.nip.io`, `*.traefik.me`, `*.ipq.co`, `*.fdns.uk`, `*.localhost` Host headers) which runs _before_ the auth check in `index.mjs`; password-gate listeners per project; public tunnels to apps.
- **Any authenticated role (`read`)**: GET API, MCP read-only tools, logs/metrics streams (WebSocket/SSE).
- **`deploy` (developer)**: deployments, env var reads/writes, containers, databases, backups, AI chat/execute-fix, most MCP tools.
- **`admin`/owner**: tokens, users, servers, settings, tunnels, notifications, SMTP relays, S3 config, container exec, Docker prune, AI config.
- **Local machine**: implicit full admin via loopback trust (unless `HOSTERAX_REQUIRE_AUTH=1`); `htx mcp:stdio`.

### Assets and data sensitivity

- Host root (Docker socket) and remote-server root (SSH keys, Docker group) — **critical**.
- `secret.key` / `HOSTERAX_SECRET_KEY` and everything it encrypts: project env vars, SSH keys, S3 creds, DKIM/TLS private keys, SMTP passwords, AI keys, TOTP secrets, notification URLs — **critical**.
- API tokens, user sessions, password hashes — **high**.
- Database backups and S3 copies; deployed apps' data — **high**.
- TLS certificates / domain routing integrity (domain hijack between projects) — **high**.
- Audit/event logs, metrics — **medium**.

### Attacker profiles

1. **Unauthenticated network attacker** reaching port 7777, app ports, gate, tunnels or the edge (internet if exposed, else LAN).
2. **Malicious local web page / DNS rebinding** in the operator's browser targeting loopback implicit trust.
3. **Low-privilege user** (`viewer`/`read` token, or `developer`) escalating to admin, reading secrets, or reaching host root beyond what the role allows.
4. **Malicious deployed workload / tenant app** on the same host (container or process) reaching the engine, edge admin API, other apps, or host.
5. **Malicious inputs**: crafted git repo, Dockerfile, image name, catalog entry, webhook payload, OIDC response, AI/LLM output (prompt injection into copilot/MCP).
6. **Compromised remote server** attacking the engine over SSH bridge.

### Existing controls (verified in code where cited)

Hashed scoped tokens (`security.mjs`); per-request session lookup; scrypt passwords; encrypted TOTP; lockouts and audit trail; OIDC code+PKCE with full ID-token verification (`oidc.mjs`); loopback trust with proxy-header, Host, Origin and Sec-Fetch-Site checks (`isTrustedLocalRequest`); global scope enforcement (`requiredLevel`); Docker driven by argv, validators for image refs/hostnames/container names (`security.mjs`); git URLs after `--`; path-traversal checks; AES-256-GCM secrets at rest; DNS-TXT domain verification; signed short-lived confirmation tickets for destructive AI/MCP actions (`mcp-server.mjs`); GitHub webhook HMAC with `timingSafeEqual`; pinned SSH host keys, key-only, generated ssh config; PBKDF2 password gate with HMAC cookies; outbound notifications http(s)-only, no link-local/metadata, no redirects; rate limiting (20/min auth, 600/min other).

### Deployment assumptions and scope

- **Exposure**: currently deployed on a LAN / private network; planned to be internet-facing (port 7777 and apps reachable from the internet, behind a TLS-terminating proxy). Findings are judged against the internet-facing deployment.
- **Attackers**: every profile above is in scope.
- **Accepted risk**: exactly the [Known limitations](#known-limitations) above; nothing else is out of scope.
- **Finding tags** used by security scans: Component (names in the table above), CWE, Attacker, OWASP, Owner.

---

## 🚨 Reporting a Vulnerability

If you discover a potential security vulnerability in HosteraX, please **do not report it in public GitHub issues**.

Instead, please responsibly disclose it via:

- **Private GitHub Security Advisory**: Open a draft advisory under the GitHub repository's **Security** tab.
- **Email**: Contact the security team at **security@hosterax.io** (or contact the repository maintainers directly).

### What to Include in Your Report:

- A clear description of the vulnerability.
- Steps to reproduce or proof-of-concept (PoC) code.
- Impact assessment (e.g., privilege escalation, remote execution, denial of service).
- Any proposed remediation or patch.

We will acknowledge receipt within **48 hours**, provide an estimated resolution timeline, and coordinate a fix and release advisory.

Thank you for keeping HosteraX and the open-source community secure! 🛡️
