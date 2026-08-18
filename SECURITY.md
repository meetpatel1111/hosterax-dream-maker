# 🛡️ Security Policy

The HosteraX team takes security, container isolation, and data privacy seriously. As a self-hosted cloud control plane managing production workloads and sensitive credentials, we maintain proactive vulnerability monitoring.

---

## 📋 Supported Versions

We release patches and security fixes for the following versions:

| Version | Supported | Notes |
| :--- | :---: | :--- |
| **0.2.x** |  Yes | Current active release branch |
| **0.1.x** | ⚠️ Limited | Critical security patches only |
| **< 0.1.0** | ❌ No | Please upgrade to the latest version |

---

## 🔒 Security Architecture Highlights

HosteraX is architected with defense-in-depth principles:

1. **Local-First & Self-Hosted**: All project metadata, SQLite databases, and environment keys remain on your own hardware or VPC.
2. **API Token Hashing**: API access keys and MCP tokens are securely generated using `node:crypto` CSPRNG (256-bit entropy).
3. **Multi-Tenant RBAC Isolation**: Role-Based Access Control (`Owner`, `Admin`, `Developer`, `Viewer`) isolates project actions and deployment permissions.
4. **Container Sandboxing**: Docker workloads run in isolated container namespaces with configurable CPU and memory limits.
5. **No Secret Telemetry**: HosteraX does not transmit your environment variables, source code, or private keys to external servers.

---

## 🚨 Reporting a Vulnerability

If you discover a potential security vulnerability in HosteraX, please **do not report it in public GitHub issues**.

Instead, please responsibly disclose it via:
* **Private GitHub Security Advisory**: Open a draft advisory under the GitHub repository's **Security** tab.
* **Email**: Contact the security team at **security@hosterax.io** (or contact the repository maintainers directly).

### What to Include in Your Report:
- A clear description of the vulnerability.
- Steps to reproduce or proof-of-concept (PoC) code.
- Impact assessment (e.g., privilege escalation, remote execution, denial of service).
- Any proposed remediation or patch.

We will acknowledge receipt within **48 hours**, provide an estimated resolution timeline, and coordinate a fix and release advisory.

Thank you for keeping HosteraX and the open-source community secure! 🛡️
