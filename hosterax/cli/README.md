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
npx hosterax start --port 8888
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
htx list                              # List all deployed projects
htx deploy                            # Trigger blue/green deployment from current directory
htx rollback <projectId>              # Rollback container to previous snapshot
htx logs <projectId>                  # Tail live logs

# Databases & Backups
htx dbs                               # List managed database containers
htx db:create <name> --engine pg      # Provision postgres, mysql, mongo, redis
htx backup:create <dbId>              # Create SHA-256 snapshot
htx s3:sync                           # Trigger remote AWS S3 / Cloudflare R2 backup sync

# App Store
htx catalog:search <query>            # Search 2,502+ open-source application templates

# Autonomous AI Copilot
htx ai "<prompt>"                     # Autonomous AI infrastructure assistant
htx ask "Why is my database slow?"    # Diagnostic helper
htx ai:model <modelName>              # Set default AI model (default: gemini-3.5-flash)
htx ai:key <apiKey>                   # Save provider API key locally

# MCP Utilities
htx mcp:tools                         # List all 34 registered MCP tools
htx mcp:config [cursor|claude|devin]  # Print instant IDE MCP configuration JSON
htx mcp                               # Run stdio MCP transport
```

---

## 📄 License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
© 2026 HosteraX Contributors
