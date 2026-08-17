import fs from "node:fs";

const mainDb = JSON.parse(fs.readFileSync("src/lib/awesome-selfhosted-db.json", "utf8"));
const sysadminMarkdown = fs.readFileSync("awesome_sysadmin_full.md", "utf8");

const SYSADMIN_TAGS = [
  { label: "Automation", slug: "automation", icon: "⚡" },
  { label: "Backups", slug: "backups", icon: "💾" },
  {
    label: "Build and software organization tools",
    slug: "build-and-software-organization-tools",
    icon: "🏗️",
  },
  { label: "ChatOps", slug: "chatops", icon: "💬" },
  { label: "Cloud Computing", slug: "cloud-computing", icon: "☁️" },
  { label: "Code Review", slug: "code-review", icon: "👀" },
  { label: "Configuration Management", slug: "configuration-management", icon: "⚙️" },
  {
    label: "Configuration Management Database",
    slug: "configuration-management-database",
    icon: "🗄️",
  },
  {
    label: "Continuous Integration & Continuous Deployment",
    slug: "continuous-integration--continuous-deployment",
    icon: "🚀",
  },
  { label: "Control Panels", slug: "control-panels", icon: "🎛️" },
  { label: "Databases", slug: "databases", icon: "🗄️" },
  { label: "Deployment Automation", slug: "deployment-automation", icon: "📦" },
  { label: "Diagramming", slug: "diagramming", icon: "📐" },
  { label: "Distributed Filesystems", slug: "distributed-filesystems", icon: "📁" },
  {
    label: "DNS - Control Panels & Domain Management",
    slug: "dns---control-panels--domain-management",
    icon: "🌐",
  },
  { label: "DNS - Servers", slug: "dns---servers", icon: "📡" },
  { label: "Editors", slug: "editors", icon: "📝" },
  { label: "Identity Management", slug: "identity-management", icon: "🪪" },
  { label: "Identity Management - LDAP", slug: "identity-management---ldap", icon: "🔑" },
  {
    label: "Identity Management - Single Sign-On (SSO)",
    slug: "identity-management---single-sign-on-sso",
    icon: "🔐",
  },
  {
    label: "Identity Management - Tools and web interfaces",
    slug: "identity-management---tools-and-web-interfaces",
    icon: "🛠️",
  },
  { label: "IT Asset Management", slug: "it-asset-management", icon: "💼" },
  { label: "Log Management", slug: "log-management", icon: "📜" },
  { label: "Mail Clients", slug: "mail-clients", icon: "📧" },
  { label: "Metrics & Metric Collection", slug: "metrics--metric-collection", icon: "📈" },
  { label: "Miscellaneous", slug: "miscellaneous", icon: "🧰" },
  { label: "Monitoring & Status Pages", slug: "monitoring--status-pages", icon: "📶" },
  {
    label: "Network Configuration Management",
    slug: "network-configuration-management",
    icon: "🌐",
  },
  { label: "PaaS", slug: "paas", icon: "🚀" },
  { label: "Packaging", slug: "packaging", icon: "📦" },
  { label: "Project Management", slug: "project-management", icon: "📋" },
  { label: "Queuing", slug: "queuing", icon: "📥" },
  { label: "Remote Desktop Clients", slug: "remote-desktop-clients", icon: "🖥️" },
  { label: "Router", slug: "router", icon: "📡" },
  { label: "Service Discovery", slug: "service-discovery", icon: "🔍" },
  { label: "Software Containers", slug: "software-containers", icon: "🐳" },
  { label: "Time Servers", slug: "time-servers", icon: "⏱️" },
  { label: "Troubleshooting", slug: "troubleshooting", icon: "🩺" },
  { label: "Version control", slug: "version-control", icon: "🌿" },
  { label: "Virtualization", slug: "virtualization", icon: "💻" },
  { label: "VPN", slug: "vpn", icon: "🛡️" },
  { label: "Web", slug: "web", icon: "🌐" },
];

const SYSADMIN_TAG_LOOKUP = new Map();
for (const t of SYSADMIN_TAGS) {
  SYSADMIN_TAG_LOOKUP.set(t.label.toLowerCase(), t);
  SYSADMIN_TAG_LOOKUP.set(t.slug.toLowerCase(), t);
  SYSADMIN_TAG_LOOKUP.set(t.label.toLowerCase().replace(/[^a-z0-9]/g, ""), t);
}

const lines = sysadminMarkdown.split("\n");
let currentTagObj = null;
const sysApps = [];
const existingAppIds = new Set(mainDb.apps.map((a) => a.id.toLowerCase()));

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (line.startsWith("### ") || line.startsWith("## ")) {
    const raw = line.replace(/^#+\s+/, "").trim();
    if (
      !raw.includes("Table of contents") &&
      !raw.includes("Software") &&
      !raw.includes("Contributing") &&
      !raw.includes("License") &&
      !raw.includes("List of Licenses") &&
      !raw.includes("Anti-features") &&
      !raw.includes("External links")
    ) {
      const match = SYSADMIN_TAG_LOOKUP.get(raw.toLowerCase()) ||
        SYSADMIN_TAG_LOOKUP.get(raw.toLowerCase().replace(/[^a-z0-9]/g, "")) || {
          label: raw,
          slug: raw.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          icon: "🛠️",
        };
      currentTagObj = match;
    }
  } else if (line.startsWith("- [") || line.startsWith("* [")) {
    const match = line.match(/^[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*[-–—:]?\s*(.*)$/);
    if (match && currentTagObj) {
      const name = match[1].trim();
      const url = match[2].trim();
      let rest = match[3].trim();

      rest = rest
        .replace(/`[^`]+`/g, "")
        .replace(/\(\[Source Code\]\([^)]+\)\)/gi, "")
        .trim();
      let desc = rest
        .replace(/^[-–—:]\s*/, "")
        .replace(/\s*\([^)]*\)$/, "")
        .trim();

      const cleanId = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-");

      let image = null;
      const ghMatch = url.match(/github\.com\/([^/]+)\/([^/#?]+)/);
      if (ghMatch) {
        const org = ghMatch[1];
        const repo = ghMatch[2].replace(/\.git$/, "");
        image = `${org.toLowerCase()}/${repo.toLowerCase()}:latest`;
      } else {
        const cleanSlug = name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
        image = `${cleanSlug}:${cleanSlug}`;
      }

      const appItem = {
        id: cleanId,
        name,
        slug: cleanId,
        category: currentTagObj.slug,
        categoryLabel: `SysAdmin: ${currentTagObj.label}`,
        desc: desc || `${name} - Open source sysadmin & infrastructure tool.`,
        url,
        website: url,
        image,
        source: "awesome_sysadmin",
        tags: [currentTagObj.slug, "sysadmin", "devops", "infrastructure", "foss"],
        tagUrl: `https://sysadmin.awesome-selfhosted.net/tags/${currentTagObj.slug}.html`,
      };

      sysApps.push(appItem);
    }
  }
}

console.log(`Parsed ${sysApps.length} applications from sysadmin.awesome-selfhosted.net!`);

// Merge without duplicating IDs
const mergedAppsMap = new Map();
for (const a of mainDb.apps) {
  mergedAppsMap.set(a.id.toLowerCase(), a);
}
for (const a of sysApps) {
  if (!mergedAppsMap.has(a.id.toLowerCase())) {
    mergedAppsMap.set(a.id.toLowerCase(), a);
  } else {
    // Enrich existing app with sysadmin tag
    const existing = mergedAppsMap.get(a.id.toLowerCase());
    if (!existing.tags.includes("sysadmin")) existing.tags.push("sysadmin");
    if (!existing.tags.includes(a.category)) existing.tags.push(a.category);
  }
}

// Merge tags
const allTagsMap = new Map();
for (const t of mainDb.tags) {
  allTagsMap.set(t.slug, { ...t });
}
for (const t of SYSADMIN_TAGS) {
  const slug = `sysadmin-${t.slug}`;
  if (!allTagsMap.has(slug)) {
    const matchingCount = sysApps.filter((a) => a.category === t.slug).length;
    if (matchingCount > 0) {
      allTagsMap.set(slug, {
        label: `SysAdmin: ${t.label}`,
        slug: t.slug,
        icon: t.icon,
        count: matchingCount,
        tagUrl: `https://sysadmin.awesome-selfhosted.net/tags/${t.slug}.html`,
      });
    }
  }
}

const finalApps = Array.from(mergedAppsMap.values());
const finalTags = Array.from(allTagsMap.values());

console.log(`Combined Database:`);
console.log(`- Total Apps: ${finalApps.length}`);
console.log(`- Total Tags: ${finalTags.length}`);

const combinedData = {
  version: "2026.1",
  sources: [
    "https://awesome-selfhosted.net",
    "https://sysadmin.awesome-selfhosted.net",
    "https://selfh.st/apps",
  ],
  totalApps: finalApps.length,
  totalTags: finalTags.length,
  tags: finalTags,
  apps: finalApps,
};

fs.writeFileSync(
  "src/lib/awesome-selfhosted-db.json",
  JSON.stringify(combinedData, null, 2),
  "utf8",
);
fs.writeFileSync(
  "hosterax/engine/src/awesome-selfhosted-db.json",
  JSON.stringify(combinedData, null, 2),
  "utf8",
);
fs.writeFileSync("public/catalog.json", JSON.stringify(combinedData, null, 2), "utf8");
console.log("Saved combined awesome-selfhosted & sysadmin database!");
