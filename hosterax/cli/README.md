# ⚡ hosterax

> **HosteraX CLI & Universal Model Context Protocol (MCP) Client** for Cursor IDE, Claude Desktop, Devin, Windsurf, OpenAI, and Ollama.

[![npm version](https://img.shields.io/npm/v/hosterax.svg)](https://www.npmjs.com/package/hosterax)
[![license](https://img.shields.io/npm/l/hosterax.svg)](https://github.com/meetpatel1111/hosterax-dream-maker)

---

## 🚀 Quick Install

```bash
# Global installation
npm install -g hosterax

# Or run instantly via npx
npx hosterax status
```

Provides both `hosterax` and the shorthand command `htx`.

---

## 🔌 Use as MCP Server for Cursor, Claude Desktop & Devin

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
      "args": ["-y", "hosterax", "mcp:stdio"]
    }
  }
}
```

---

## 💻 CLI Commands

```bash
# General
htx status                            # Inspect host CPU/RAM, uptime, and engine status
htx projects                          # List all deployed projects
htx deploy <projectId>                # Trigger blue/green deployment
htx rollback <projectId>              # Rollback container to previous snapshot
htx logs <projectId>                  # Tail live logs

# Databases & Backups
htx dbs                               # List managed database containers
htx db:new <name> --engine postgres   # Provision postgres, mysql, mongo, redis
htx backup:new <dbId>                 # Create SHA-256 snapshot
htx s3:sync                           # Trigger remote AWS S3 / Cloudflare R2 backup sync

# App Store
htx catalog:search <query>            # Search 2,502+ open-source application templates

# Autonomous AI Copilot
htx ai "<prompt>"                     # Autonomous AI infrastructure assistant
htx ai:model <modelName>              # Set default AI model (default: gemini-3.5-flash)
htx ai:key <apiKey>                   # Save provider API key locally

# MCP Utilities
htx mcp:tools                         # List all 34 registered MCP tools
htx mcp:config [cursor|claude|devin]  # Print instant IDE MCP configuration JSON
htx mcp:stdio                         # Run stdio MCP transport
```

---

## 📄 License
MIT © HosteraX Contributors
