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
- **Not implemented:** SSH deployment to remote nodes (servers are registered and pinged only), an inbound mail server and an OAuth provider.

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
