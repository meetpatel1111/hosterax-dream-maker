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
3. **No Implicit Trust for Remote Clients**: Only requests that originate from the engine's own machine, over loopback, from a trusted origin and without proxy headers are accepted without a token. Set `HOSTERAX_REQUIRE_AUTH=1` to disable even that.
4. **Injection Defenses**: Docker is driven with argument vectors rather than shell strings; image references, hostnames, project names and environment keys are validated; git URLs are passed after `--`; log and upload paths are checked against traversal; secrets are masked in logs.
5. **Secrets at Rest** (and opt-in encrypted backups, see README): SSH keys, S3 credentials, DKIM and TLS private keys, SMTP relay passwords and AI keys are encrypted with AES-256-GCM. Mailbox passwords are stored only as salted scrypt hashes.
6. **Verified Domain Ownership**: A custom domain is only routed after a DNS TXT challenge succeeds, which prevents one project from claiming another's hostname.
7. **Signed Confirmation for AI Actions**: Destructive actions requested by the AI copilot or MCP clients need a short-lived, server-signed ticket.
8. **Webhooks**: GitHub push webhooks are verified with HMAC-SHA256 before anything is deployed.

### Known limitations

Please factor these into your threat model:

- **Docker socket = root.** The engine (and its container image) controls the Docker daemon. Anyone with an `admin` or `deploy` token can run containers, so guard tokens accordingly.
- **Project environment variables are stored unencrypted in SQLite.** They rely on `$HOSTERAX_HOME` permissions (0700) and disk encryption.
- **Edge proxy admin API.** The Caddy admin endpoint is bound to all interfaces inside the edge container's network. It is not published on the host, but other containers on the same Docker network can reach it.
- **No TLS on the engine itself.** Put a TLS-terminating proxy in front of port 7777 when it is reachable from other machines.
- **Roles are not enforced per user.** The Team/Organization pages are a directory; permissions come from API token scopes.
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
