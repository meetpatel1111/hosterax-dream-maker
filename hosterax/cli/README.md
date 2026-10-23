# ⚡ hosterax

> **HosteraX CLI, Daemon Launcher & Universal Model Context Protocol (MCP) Server** for Cursor IDE, Claude Desktop, Devin, Windsurf, OpenAI, Gemini, and Ollama.

[![npm version](https://img.shields.io/npm/v/hosterax.svg?style=flat-square&color=3b82f6)](https://www.npmjs.com/package/hosterax)
[![license](https://img.shields.io/npm/l/hosterax.svg?style=flat-square&color=orange)](https://github.com/meetpatel1111/hosterax-dream-maker)

---

## 🚀 Quick Start (Zero-Install Instant Launch)

```bash
# Start the full engine daemon & open web control plane on http://localhost:7777
npx hosterax

# Or start with a custom port
npx hosterax up --port 8888
```

### Global Install:

```bash
npm install -g hosterax

# Provides both `hosterax` and the shorthand command `htx`
htx status
```

---

## 🔌 Use as MCP Server for AI IDEs

### 1. Cursor IDE (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "hosterax": {
      "url": "http://localhost:7777/api/mcp"
    }
  }
}
```

### 2. Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "hosterax": {
      "command": "npx",
      "args": ["-y", "hosterax", "mcp"]
    }
  }
}
```

### 3. Windsurf / Devin / VS Code (Cline):

```json
{
  "mcpServers": {
    "hosterax": {
      "command": "htx",
      "args": ["mcp"]
    }
  }
}
```

---

## 🌐 Connecting to Remote Self-Hosted Servers

```bash
# 1. Point CLI to your self-hosted instance and save auth token
htx target http://159.65.120.45:7777 --token <YOUR_TOKEN>

# 2. Deploy your app to the remote server
htx deploy

# 3. Stream real-time container logs
htx logs my-app

# 4. Provision remote database
htx db:create postgres my-db
```

---

## 💻 CLI Commands

```bash
# General & Deploys
htx status                            # Inspect host CPU/RAM, uptime, and engine status
htx projects                          # List all deployed projects
htx deploy <name|path>                # Trigger a blue/green deployment
htx rollback <deploymentId>           # Re-deploy a previous release
htx logs <deploymentId|name>          # Stream logs (add --follow)

# Databases & Backups
htx databases                         # List managed database containers
htx db:create <project> <name> <engine> # Provision postgres, mysql, mongodb, redis
htx backup:create <databaseId|name>   # Create a checksummed backup
htx s3:sync                           # Trigger remote AWS S3 / Cloudflare R2 backup sync

# App Store
htx catalog:search <query>            # Search 2,500+ open-source application templates

# Autonomous AI Copilot
htx ai "<prompt>"                     # Autonomous AI infrastructure assistant
htx diagnose <name>                   # Diagnose a crashing project
htx ai:model <modelName>              # Set default AI model (default: gemini-3.5-flash)
htx ai:key <apiKey>                   # Save provider API key locally

# MCP Utilities
htx mcp:tools                         # List all 46 registered MCP tools
htx mcp:config [cursor|claude|devin|windsurf] # Print IDE MCP configuration JSON
htx mcp                               # Run stdio MCP transport
```

---

## 🔑 Authentication

The engine prints a first admin API token the first time it starts. On the same machine the CLI works without one; for a remote engine save the URL and token once:

```bash
htx login <token> --url http://your-server:7777
# or per command / for MCP clients
HOSTERAX_URL=http://your-server:7777 HOSTERAX_TOKEN=<token> htx projects
```

Create further tokens with `htx token:new <label>` (or Dashboard → API tokens). Tokens carry a scope — `read`, `deploy` or `admin` — and are stored by the engine only as hashes, so copy them when they are created.

---

## 📄 License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
© 2026 HosteraX Contributors
