# 📜 HosteraX Changelog

All notable changes to the **HosteraX Cloud Control Plane** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] - 2026-08-18

### 🚀 Highlights
- **Model Context Protocol (MCP) Server**: Full JSON-RPC 2.0 implementation with 34 tools for Cursor, Claude Desktop, Devin, Windsurf, and OpenAI Codex.
- **2,502+ App Store Catalog**: Consolidated multi-source catalog compiler ingesting Awesome-Selfhosted, selfh.st, and Awesome-Sysadmin with high-res vector SVG logos.
- **Native Desktop App**: Electron 34 native desktop app with embedded daemon supervisor and system tray.
- **Apache License 2.0**: Applied Apache 2.0 across the entire repository to enable open-source community contributions.

### 🌟 Added
- **Multi-Node Remote Fleet**: Manage remote Linux servers via SSH with real-time hardware telemetry and connection tests.
- **Self-Hosted Email Stack**: DNS records generator (DKIM, SPF, DMARC, MX), mailbox management, webmail client, email aliases, and outbound SMTP relays.
- **GitHub Webhooks & PR Previews**: Ephemeral preview environments automatically created on pull requests and torn down on merge.
- **Multi-Tenant RBAC Organizations**: Team switcher with Owner, Admin, Developer, and Viewer permission tiers.
- **Point-in-Time Database Snapshots**: Automated backups for Postgres, MySQL, MongoDB, and Redis with SHA-256 integrity verification and S3/Cloudflare R2 remote sync.
- **Cron Jobs Engine**: Scheduled task runner with manual execution and run history tracking.
- **AI Crash Diagnostics & Auto-Rollback**: Automated error log analysis and 1-click self-healing rollback.
- **Universal Multi-Framework Detection**: Zero-config Dockerfile generation for Next.js, Vite, React, Node, Python, Go, Rust, Ruby, and PHP.

### 🛡️ Fixed & Improved
- Rate limiter now whitelists localhost traffic (`127.0.0.1`, `::1`, `localhost`) to prevent false 429 errors during rapid UI polling.
- Throttled Docker daemon offline logs to prevent log spam when Docker Desktop is closed.
- Universal zero-install `npx -y hosterax mcp:stdio` configuration output.
- Strict TypeScript compilation (0 errors across 80+ files) and 18/18 backend test suites passing.

---

## [0.1.0] - 2026-08-14

### 🌟 Initial Release
- Core autonomous control plane engine listening on `:7777`.
- Zero-downtime blue/green deployment lifecycle.
- TanStack Start + React 19 frontend dashboard.
- Magic DNS support via `nip.io` and `sslip.io`.
- Project environment variable management and live log streaming.
