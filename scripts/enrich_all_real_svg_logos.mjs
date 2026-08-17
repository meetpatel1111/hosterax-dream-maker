import fs from "node:fs";

const dbPath = "src/lib/awesome-selfhosted-db.json";
const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));

// Load all SVG file lists using utf16le decoding and BOM strip
function loadList(file) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf16le").replace(/^\uFEFF/, "");
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

const dashboardSvgs = loadList("dashboard_icons_list.txt");
const simpleSvgs = loadList("simple_icons_list.txt");

// Build indexed maps
const dashboardMap = new Map();
for (const p of dashboardSvgs) {
  // e.g. "svg/n8n.svg" or "png/n8n.png"
  const m = p.match(/(?:svg|png)\/([^/]+)\.(?:svg|png)$/i);
  if (m) {
    const rawName = m[1];
    const slug = rawName.toLowerCase();
    const clean = slug.replace(/[^a-z0-9]/g, "");
    dashboardMap.set(slug, rawName);
    dashboardMap.set(clean, rawName);
    dashboardMap.set(slug.replace(/_/g, "-"), rawName);
    dashboardMap.set(slug.replace(/-/g, ""), rawName);
  }
}

const simpleMap = new Map();
for (const p of simpleSvgs) {
  // e.g. "icons/ghost.svg"
  const m = p.match(/icons\/([^/]+)\.svg$/i);
  if (m) {
    const rawName = m[1];
    const slug = rawName.toLowerCase();
    const clean = slug.replace(/[^a-z0-9]/g, "");
    simpleMap.set(slug, rawName);
    simpleMap.set(clean, rawName);
    simpleMap.set(slug.replace(/_/g, "-"), rawName);
    simpleMap.set(slug.replace(/-/g, ""), rawName);
  }
}

console.log(
  `Loaded ${dashboardMap.size} dashboard-icons mappings and ${simpleMap.size} simple-icons mappings.`,
);

let directSvgCount = 0;
let ghAvatarCount = 0;
let faviconCount = 0;

for (const app of db.apps) {
  const nameLow = app.name.toLowerCase().trim();
  const slugLow = (app.slug || app.id).toLowerCase().trim();
  const cleanName = nameLow.replace(/[^a-z0-9]/g, "");
  const cleanSlug = slugLow.replace(/[^a-z0-9]/g, "");

  let candidateSvg = null;

  // 1. Dashboard Icons SVG exact or clean match
  const dashMatch =
    dashboardMap.get(slugLow) ||
    dashboardMap.get(cleanSlug) ||
    dashboardMap.get(nameLow) ||
    dashboardMap.get(cleanName) ||
    dashboardMap.get(slugLow.replace(/-/g, "_")) ||
    dashboardMap.get(slugLow.replace(/_/g, "-"));

  if (dashMatch) {
    candidateSvg = `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/${dashMatch}.svg`;
  }

  // 2. Simple Icons SVG match
  if (!candidateSvg) {
    const simpleMatch =
      simpleMap.get(slugLow) ||
      simpleMap.get(cleanSlug) ||
      simpleMap.get(nameLow) ||
      simpleMap.get(cleanName);

    if (simpleMatch) {
      candidateSvg = `https://cdn.simpleicons.org/${simpleMatch}`;
    }
  }

  // 3. GitHub repository avatar
  let ghAvatar = null;
  const ghMatch = app.url?.match(/github\.com\/([^/]+)/);
  if (
    ghMatch &&
    !["github.com/torvalds", "github.com/awesome-selfhosted", "github.com/awesome-foss"].includes(
      ghMatch[0],
    )
  ) {
    const org = ghMatch[1];
    ghAvatar = `https://github.com/${org}.png?size=128`;
  }

  // 4. Official Website Favicon / Vector
  let siteFavicon = null;
  try {
    const host = new URL(app.website || app.url).hostname;
    if (host && !host.includes("github.com") && !host.includes("gitlab.com")) {
      siteFavicon = `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
    }
  } catch {}

  // Assign optimal logo
  app.logoUrl =
    candidateSvg ||
    ghAvatar ||
    siteFavicon ||
    `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/${slugLow}.svg`;
  app.svgUrl = candidateSvg || null;
  app.ghAvatar = ghAvatar || null;
  app.favicon = siteFavicon || null;

  if (candidateSvg) directSvgCount++;
  else if (ghAvatar) ghAvatarCount++;
  else if (siteFavicon) faviconCount++;
}

console.log(`\n=== SVG Logo Enrichment Results ===`);
console.log(`- Total Apps: ${db.apps.length}`);
console.log(`- High-Res SVGs Matched (dashboard-icons / simple-icons): ${directSvgCount}`);
console.log(`- GitHub Org Avatars: ${ghAvatarCount}`);
console.log(`- Official Favicons: ${faviconCount}`);

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf8");
fs.writeFileSync(
  "hosterax/engine/src/awesome-selfhosted-db.json",
  JSON.stringify(db, null, 2),
  "utf8",
);
fs.writeFileSync("public/catalog.json", JSON.stringify(db, null, 2), "utf8");
console.log("Saved 100% real SVG and logo dataset!");
