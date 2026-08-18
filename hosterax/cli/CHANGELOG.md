# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-08-19

### Added

- **Full MCP & CLI Subsystem Coverage**:
  - `htx mail:domains`, `htx mail:domain:add`, `htx mail:boxes`, `htx mail:box:new`, `htx mail:aliases`, `htx mail:alias:new`.
  - `htx webhooks`, `htx previews`, `htx preview:delete`.
  - `htx orgs`, `htx org:new`, `htx org:members`, `htx org:member:add`.
  - 12 new MCP tools for Cursor IDE, Claude Desktop, and Devin.

---

## [1.0.0] - 2026-08-18

### Added

- **Universal Model Context Protocol (MCP) Support**:
  - Full JSON-RPC 2.0 stdio transport (`htx mcp:stdio`) for Cursor IDE, Claude Desktop, Devin, and Windsurf.
  - Exposes 34 DevOps tools for container deployment, database provisioning, S3 backup sync, DNS/SSL verification, self-healing diagnostics, and cron scheduling.
  - `htx mcp:config [cursor|claude|devin|windsurf]` command for instant 1-click IDE configuration generation.
- **Autonomous Multi-Provider AI Copilot (`htx ai`)**:
  - Dynamic support for Google Gemini (default: `gemini-3.5-flash`), Anthropic Claude (`claude-3-5-sonnet`), OpenAI (`gpt-4o`), and local Ollama (`llama3` / `deepseek-r1`).
  - Parallel tool execution across multi-turn infrastructure management workflows.
  - `htx ai:model <modelName>` and `htx ai:key <apiKey>` commands.
  - Automatic exponential backoff and rate-limit retry handling.
- **Enhanced CLI Commands**:
  - Short collision-free binary alias `htx` alongside official binary `hosterax`.
  - Database provisioning (`htx db:new`), point-in-time snapshots (`htx backup:new`), remote S3 sync (`htx s3:sync`), and 2,502+ app catalog search (`htx catalog:search`).

## [0.1.0] - 2026-08-15

- Initial release of HosteraX terminal interface and basic daemon communication.
