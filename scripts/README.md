# 🛠️ HosteraX Catalog Builder & Sync Toolchain

This directory contains the automated data pipeline used to build, enrich, and synchronize the **2,502+ open-source application catalog** across the HosteraX Control Plane, Engine daemon, and public assets.

---

## 📜 Scripts Overview

| Script                                             | Purpose                                                                                                                                   |
| :------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| **[`sync-catalog.mjs`](./sync-catalog.mjs)**       | **Master 1-Click Pipeline**: Runs ingestion, canonical deduplication, metadata/logo enrichment, and schema validation across all targets. |
| **[`build-catalog.mjs`](./build-catalog.mjs)**     | **Ingestion & Deduplication Engine**: Scrapes and merges Awesome-Selfhosted, selfh.st/apps, and Awesome-Sysadmin.                         |
| **[`enrich-metadata.mjs`](./enrich-metadata.mjs)** | **Enrichment Engine**: Resolves verified Docker Hub images, live GitHub metrics, and high-res SVG logos (Homarr / SimpleIcons).           |

---

## 🚀 Usage

```bash
# 1-Click full catalog sync & validation
node scripts/sync-catalog.mjs

# Or run individual stages
node scripts/build-catalog.mjs
node scripts/enrich-metadata.mjs
```

---

## 🎯 Output Targets

All scripts automatically write synchronized, schema-validated JSON to:

- `public/catalog.json` (Web App UI)
- `hosterax/engine/src/awesome-selfhosted-db.json` (Backend Daemon)
- `src/lib/awesome-selfhosted-db.json` (Frontend Library)
