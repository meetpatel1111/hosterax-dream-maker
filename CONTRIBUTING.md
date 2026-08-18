# 🤝 Contributing to HosteraX

Thank you for your interest in contributing to **HosteraX**! HosteraX is an open-source, autonomous cloud control plane with native Model Context Protocol (MCP) support, licensed under the [Apache License 2.0](./LICENSE).

We welcome contributions of all kinds: new features, bug fixes, template app submissions to our 2,502+ catalog, UI improvements, and documentation enhancements.

---

## 🧭 Code of Conduct

Please read our [Code of Conduct](./CODE_OF_CONDUCT.md) before contributing to ensure a welcoming and inclusive community.

---

## 🛠️ Local Development Setup

### Prerequisites
- **Node.js**: v20.x or v22.x+
- **Git**
- **Docker Desktop** (or Docker Engine on Linux) for container workloads

### 1. Clone the Repository
```bash
git clone https://github.com/meetpatel1111/hosterax-dream-maker.git
cd hosterax-dream-maker
npm install
```

### 2. Start the Backend Engine Daemon
```bash
npm run test:engine  # Run all 18 test suites to verify system integrity
node hosterax/engine/src/index.mjs
```
*The Engine Daemon boots on `http://localhost:7777` with SQLite database initialized at `~/.hosterax/hosterax.db`.*

### 3. Start the Frontend Dashboard
```bash
npm run dev
```
*The Web Dashboard will be available at `http://localhost:8080`.*

---

## 🧪 Testing & Quality Checks

Before submitting a pull request, ensure all tests and linting checks pass:

```bash
# Run backend engine test suite (18 test suites)
npm run test:engine

# Check TypeScript types
npx tsc --noEmit

# Run ESLint & code formatting checks
npm run lint
npm run format
```

---

## 📦 Project Structure & Conventions

```
hosterax-dream-maker/
├── hosterax/
│   ├── engine/           # Native Node.js ESM Backend Daemon (:7777)
│   │   ├── src/          # Zero-build .mjs managers (mcp-server, self-heal, backup, etc.)
│   │   └── test/         # Native node:test suite
│   ├── cli/              # Zero-dependency CLI package ('hosterax' & 'htx' on npm)
│   └── desktop/          # Electron 34 native desktop app with embedded engine supervisor
├── src/                  # TanStack Start + React 19 Frontend Dashboard (:8080)
│   ├── routes/           # File-based routing (_app.*.tsx)
│   ├── components/hx/    # HosteraX domain UI components
│   └── lib/              # API client, schemas, i18n, and stack definitions
└── scripts/              # Consolidated 2,502+ app catalog ingestion and sync toolchain
```

- **Backend & CLI**: Use standard Node.js native ECMAScript Modules (`.mjs`) with zero compile overhead.
- **Frontend**: Use React 19 + TypeScript (`.tsx`) with TanStack Start and Tailwind CSS.
- **Imports**: Use kebab-case for component file names and `@/` path alias in the frontend.

---

## 🏪 Adding New Templates to the App Store

To add or update open-source templates in the 2,502+ App Store catalog:
1. Run the catalog pipeline:
   ```bash
   npm run catalog:sync
   ```
2. Verify that the app has an official Docker Hub / GHCR image tag, valid tags, and high-res vector logo in `public/catalog.json`.

---

## 🚀 Submitting a Pull Request (PR)

1. **Fork** the repository and create your branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Make your changes and commit with descriptive commit messages following Conventional Commits (e.g., `feat:`, `fix:`, `docs:`, `chore:`).
3. Push to your fork:
   ```bash
   git push origin feat/your-feature-name
   ```
4. Open a Pull Request on GitHub against the `main` branch.
5. All contributions submitted are licensed under the **Apache License 2.0** as stated in Section 5 of the license.

Thank you for helping make self-hosting effortless! 🚀
