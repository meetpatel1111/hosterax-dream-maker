#!/usr/bin/env node
// scripts/build-catalog.mjs
// Unified Multi-Source Catalog Ingestion & Deduplication Pipeline for HosteraX
// Ingests from: Awesome-Selfhosted, selfh.st/apps, and Awesome-Sysadmin

import fs from "node:fs";

const CANONICAL_TAGS = [
  { label: "Analytics", slug: "analytics", icon: "📊" },
  {
    label: "Archiving and Digital Preservation (DP)",
    slug: "archiving-and-digital-preservation-dp",
    icon: "🏛️",
  },
  { label: "Automation", slug: "automation", icon: "⚡" },
  { label: "Backup", slug: "backup", icon: "💾" },
  { label: "Blogging Platforms", slug: "blogging-platforms", icon: "✍️" },
  { label: "Booking and Scheduling", slug: "booking-and-scheduling", icon: "📅" },
  { label: "Bookmarks and Link Sharing", slug: "bookmarks-and-link-sharing", icon: "🔖" },
  { label: "Calendar & Contacts", slug: "calendar--contacts", icon: "📆" },
  {
    label: "Communication - Custom Systems",
    slug: "communication---custom-communication-systems",
    icon: "💬",
  },
  {
    label: "Communication - Email Solutions",
    slug: "communication---email---complete-solutions",
    icon: "✉️",
  },
  {
    label: "Communication - Email Clients",
    slug: "communication---email---webmail-clients",
    icon: "🖥️",
  },
  {
    label: "Communication - Social Networks & Forums",
    slug: "communication---social-networks-and-forums",
    icon: "👥",
  },
  {
    label: "Communication - Video Conferencing",
    slug: "communication---video-conferencing",
    icon: "📹",
  },
  { label: "Content Management Systems (CMS)", slug: "content-management-systems-cms", icon: "📦" },
  {
    label: "Customer Relationship Management (CRM)",
    slug: "customer-relationship-management-crm",
    icon: "💼",
  },
  { label: "Database Management", slug: "database-management", icon: "🗄️" },
  { label: "DNS", slug: "dns", icon: "🌐" },
  { label: "Document Management", slug: "document-management", icon: "📑" },
  { label: "Document Management - E-books", slug: "document-management---e-books", icon: "📖" },
  { label: "E-commerce", slug: "e-commerce", icon: "🛍️" },
  {
    label: "Federated Identity & Authentication",
    slug: "federated-identity--authentication",
    icon: "🔑",
  },
  { label: "Feed Readers", slug: "feed-readers", icon: "📰" },
  { label: "File Transfer & Synchronization", slug: "file-transfer--synchronization", icon: "🔄" },
  {
    label: "File Transfer - Object Storage",
    slug: "file-transfer---object-storage--file-servers",
    icon: "🪣",
  },
  {
    label: "File Transfer - Web File Managers",
    slug: "file-transfer---web-based-file-managers",
    icon: "📂",
  },
  { label: "Games & Game Servers", slug: "games", icon: "🎮" },
  { label: "Generative AI (GenAI)", slug: "generative-artificial-intelligence-genai", icon: "🤖" },
  { label: "Health and Fitness", slug: "health-and-fitness", icon: "🏃" },
  { label: "Human Resources (HRM)", slug: "human-resources-management-hrm", icon: "👔" },
  { label: "Identity Management", slug: "identity-management", icon: "🪪" },
  { label: "Internet of Things (IoT)", slug: "internet-of-things-iot", icon: "💡" },
  { label: "Inventory Management", slug: "inventory-management", icon: "📋" },
  { label: "Knowledge Management Tools", slug: "knowledge-management-tools", icon: "🧠" },
  { label: "Learning & Courses", slug: "learning-and-courses", icon: "🎓" },
  { label: "Maps & GPS Tracking", slug: "maps-and-global-positioning-system-gps", icon: "🗺️" },
  { label: "Media Management", slug: "media-management", icon: "🎬" },
  { label: "Media Streaming - Audio", slug: "media-streaming---audio-streaming", icon: "🎵" },
  { label: "Media Streaming - Video", slug: "media-streaming---video-streaming", icon: "🍿" },
  { label: "Money, Budgeting & Accounting", slug: "money-budgeting--management", icon: "💰" },
  { label: "Monitoring & Status Pages", slug: "monitoring--status-pages", icon: "📶" },
  { label: "Network Utilities", slug: "network-utilities", icon: "🔧" },
  { label: "Note-taking & Editors", slug: "note-taking--editors", icon: "📝" },
  { label: "Office Suites", slug: "office-suites", icon: "📑" },
  { label: "Password Managers", slug: "password-managers", icon: "🔒" },
  { label: "Pastebins", slug: "pastebins", icon: "📋" },
  { label: "Personal Dashboards", slug: "personal-dashboards", icon: "🏠" },
  { label: "Photo & Video Galleries", slug: "photo-galleries", icon: "🖼️" },
  { label: "Proxy & Ingress", slug: "proxy", icon: "🛡️" },
  { label: "Recipe & Meal Planning", slug: "recipe-management", icon: "🍳" },
  { label: "Remote Access & Desktop", slug: "remote-access", icon: "🖥️" },
  { label: "Search Engines", slug: "search-engines", icon: "🔍" },
  {
    label: "Software Development - CI/CD",
    slug: "software-development---continuous-integration--deployment",
    icon: "🚀",
  },
  {
    label: "Software Development - IDE & Tools",
    slug: "software-development---ide--tools",
    icon: "🛠️",
  },
  {
    label: "Software Development - Project Management",
    slug: "software-development---project-management",
    icon: "📋",
  },
  { label: "Task Management & Kanban", slug: "task-management--to-do-lists", icon: "✅" },
  { label: "URL Shorteners", slug: "url-shorteners", icon: "🔗" },
  { label: "VPN & Mesh Networking", slug: "vpn", icon: "🛡️" },
  { label: "Wikis & Documentation", slug: "wikis", icon: "📚" },
];

function normalizeKey(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/[^a-z0-9]/g, "");
}

function getRepoKey(url) {
  if (!url) return "";
  const m = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (m) return `${m[1].toLowerCase()}/${m[2].toLowerCase().replace(/\.git$/, "")}`;
  return "";
}

export async function buildCatalog() {
  console.log("⚡ [HosteraX Builder] Starting Multi-Source Catalog Ingestion...");

  // Load existing database as base
  let db = {
    version: "2026.1",
    sources: [
      "https://awesome-selfhosted.net",
      "https://sysadmin.awesome-selfhosted.net",
      "https://selfh.st/apps",
    ],
    apps: [],
    tags: CANONICAL_TAGS,
  };
  if (fs.existsSync("public/catalog.json")) {
    db = JSON.parse(fs.readFileSync("public/catalog.json", "utf8"));
  }

  // 1. Ingest selfh.st software & companions
  try {
    console.log("📡 Fetching latest dataset from selfh.st/apps CDN...");
    const [softRes, compRes] = await Promise.all([
      fetch("https://cdn.jsdelivr.net/gh/selfhst/cdn@main/directory/software.json").catch(
        () => null,
      ),
      fetch("https://cdn.jsdelivr.net/gh/selfhst/cdn@main/directory/companions.json").catch(
        () => null,
      ),
    ]);

    if (softRes && softRes.ok) {
      const softwareList = await softRes.json();
      console.log(`   Fetched ${softwareList.length} software entries from selfh.st.`);
      for (const row of softwareList) {
        const name = row[1]?.trim();
        const slug = row[2]?.trim() || name.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
        const website = row[3]?.trim()
          ? row[3].startsWith("http")
            ? row[3]
            : `https://${row[3]}`
          : "";
        const repo = row[4]?.trim()
          ? row[4].startsWith("http")
            ? row[4]
            : `https://${row[4]}`
          : "";
        const desc = row[5]?.trim() || `${name} - Self-hosted software listed on selfh.st.`;
        const iconSlug = row[10]?.trim();
        const stars = row[13]?.trim();
        const forks = row[14]?.trim();

        if (!name) continue;
        const cleanId = slug.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
        const logoSvg = iconSlug
          ? `https://cdn.jsdelivr.net/gh/selfhst/icons@main/svg/${iconSlug}.svg`
          : null;

        db.apps.push({
          id: cleanId,
          name,
          slug: cleanId,
          category: "selfhst-software",
          categoryLabel: "selfh.st: Software Directory",
          desc,
          url: repo || website || "https://selfh.st/apps/",
          website: website || repo || "https://selfh.st/apps/",
          image: `${cleanId}:latest`,
          source: "selfhst",
          tags: ["selfhst", "self-hosted", "foss"],
          tagUrl: "https://selfh.st/apps/",
          logoUrl: logoSvg,
          svgUrl: logoSvg,
          stars: stars || undefined,
          forks: forks || undefined,
        });
      }
    }
  } catch (err) {
    console.warn("   Could not fetch selfh.st online dataset, using local cache:", err.message);
  }

  // 2. Canonical Deduplication & Multi-Source Merging
  console.log("🔄 Performing canonical deduplication and multi-source merging...");
  const canonicalMap = new Map();
  let duplicateCount = 0;

  for (const rawApp of db.apps) {
    const normName = normalizeKey(rawApp.name);
    const normSlug = normalizeKey(rawApp.slug || rawApp.id);
    const repoKey = getRepoKey(rawApp.url) || getRepoKey(rawApp.website);

    let canonical = null;
    if (repoKey && canonicalMap.has(`repo:${repoKey}`))
      canonical = canonicalMap.get(`repo:${repoKey}`);
    else if (normSlug && canonicalMap.has(`slug:${normSlug}`))
      canonical = canonicalMap.get(`slug:${normSlug}`);
    else if (normName && canonicalMap.has(`name:${normName}`))
      canonical = canonicalMap.get(`name:${normName}`);

    const currentSource = rawApp.source || "awesome_selfhosted";

    if (canonical) {
      duplicateCount++;
      if (!canonical.sources) canonical.sources = [canonical.source || "awesome_selfhosted"];
      if (!canonical.sources.includes(currentSource)) canonical.sources.push(currentSource);

      const tagSet = new Set([...(canonical.tags || []), ...(rawApp.tags || []), currentSource]);
      canonical.tags = Array.from(tagSet);

      if (!canonical.stars && rawApp.stars) canonical.stars = rawApp.stars;
      if (!canonical.forks && rawApp.forks) canonical.forks = rawApp.forks;
      if (!canonical.svgUrl && rawApp.svgUrl) canonical.svgUrl = rawApp.svgUrl;
      if (!canonical.logoUrl && rawApp.logoUrl) canonical.logoUrl = rawApp.logoUrl;
      if (!canonical.webpIcon && rawApp.webpIcon) canonical.webpIcon = rawApp.webpIcon;

      if (
        (!canonical.website || canonical.website.includes("awesome-selfhosted")) &&
        rawApp.website
      ) {
        canonical.website = rawApp.website;
      }
      if ((!canonical.url || canonical.url.includes("awesome-selfhosted")) && rawApp.url) {
        canonical.url = rawApp.url;
      }
      if (rawApp.desc && rawApp.desc.length > (canonical.desc?.length || 0)) {
        canonical.desc = rawApp.desc;
      }
    } else {
      const newCanonical = {
        ...rawApp,
        sources: [currentSource],
        tags: Array.from(new Set([...(rawApp.tags || []), currentSource])),
      };
      if (repoKey) canonicalMap.set(`repo:${repoKey}`, newCanonical);
      if (normSlug) canonicalMap.set(`slug:${normSlug}`, newCanonical);
      if (normName) canonicalMap.set(`name:${normName}`, newCanonical);
      canonicalMap.set(`id:${newCanonical.id}`, newCanonical);
    }
  }

  const uniqueApps = Array.from(new Set(canonicalMap.values()));
  db.apps = uniqueApps;
  db.totalApps = uniqueApps.length;
  db.totalTags = db.tags?.length || CANONICAL_TAGS.length;

  console.log(
    `✓ Deduplication Complete: Merged ${duplicateCount} duplicates. Total Canonical Apps: ${uniqueApps.length}`,
  );
  return db;
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("build-catalog.mjs")
) {
  buildCatalog().then((db) => {
    fs.writeFileSync("public/catalog.json", JSON.stringify(db, null, 2), "utf8");
    fs.writeFileSync("src/lib/awesome-selfhosted-db.json", JSON.stringify(db, null, 2), "utf8");
    fs.writeFileSync(
      "hosterax/engine/src/awesome-selfhosted-db.json",
      JSON.stringify(db, null, 2),
      "utf8",
    );
    console.log("✓ Catalog database files saved successfully!");
  });
}
