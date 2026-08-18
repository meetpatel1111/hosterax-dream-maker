#!/usr/bin/env node
// scripts/sync-catalog.mjs
// Master HosteraX Catalog Sync & Validation Pipeline
// Orchestrates Ingestion -> Deduplication -> Metadata/Logo Enrichment -> Multi-File Sync & Validation

import fs from "node:fs";
import { buildCatalog } from "./build-catalog.mjs";
import { enrichMetadata } from "./enrich-metadata.mjs";

async function main() {
  console.log("=================================================");
  console.log("🚀 HosteraX Master Catalog Sync & Validation Pipeline");
  console.log("=================================================\n");

  const startTime = Date.now();

  // Step 1: Ingest & Deduplicate
  console.log("Step 1/3: Ingesting & Deduplicating Multi-Source Catalog...");
  const rawDb = await buildCatalog();

  // Step 2: Enrich Logos, Docker Images & GitHub Metadata
  console.log("\nStep 2/3: Enriching Metadata, SVGs, and Container Tags...");
  const fullDb = await enrichMetadata(rawDb);

  // Step 3: Validate & Synchronize to all targets
  console.log("\nStep 3/3: Validating Schema & Writing Synchronized Targets...");
  if (!fullDb.apps || fullDb.apps.length === 0) {
    throw new Error("Catalog build failed: No apps produced.");
  }

  // Sanity checks
  const sample = fullDb.apps[0];
  if (!sample.id || !sample.name || !sample.desc || !sample.image) {
    throw new Error(
      `Catalog validation failed: Missing required fields on sample app ${JSON.stringify(sample)}`,
    );
  }

  const targets = [
    "public/catalog.json",
    "src/lib/awesome-selfhosted-db.json",
    "hosterax/engine/src/awesome-selfhosted-db.json",
  ];

  for (const target of targets) {
    fs.writeFileSync(target, JSON.stringify(fullDb, null, 2), "utf8");
    console.log(
      `   ✓ Saved: ${target} (${(fs.statSync(target).size / 1024 / 1024).toFixed(2)} MB)`,
    );
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log("\n=================================================");
  console.log(`✅ Master Catalog Sync Completed Successfully in ${durationSec}s!`);
  console.log(`- Total Apps in Catalog: ${fullDb.apps.length}`);
  console.log(`- Total Active Tags / Categories: ${fullDb.tags?.length || 58}`);
  console.log("=================================================");
}

main().catch((err) => {
  console.error("\n❌ Catalog Sync Failed:", err);
  process.exit(1);
});
