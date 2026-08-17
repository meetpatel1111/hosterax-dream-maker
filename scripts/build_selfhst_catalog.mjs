import fs from "node:fs";

async function main() {
  console.log("Fetching selfh.st/apps complete dataset...");
  const [softwareRes, companionsRes] = await Promise.all([
    fetch("https://cdn.jsdelivr.net/gh/selfhst/cdn@main/directory/software.json"),
    fetch("https://cdn.jsdelivr.net/gh/selfhst/cdn@main/directory/companions.json"),
  ]);

  const softwareList = await softwareRes.json();
  const companionsList = await companionsRes.json();

  console.log(
    `Fetched ${softwareList.length} software entries and ${companionsList.length} companions from selfh.st.`,
  );

  const mainDb = JSON.parse(fs.readFileSync("src/lib/awesome-selfhosted-db.json", "utf8"));
  const existingMap = new Map();
  for (const app of mainDb.apps) {
    existingMap.set(app.id.toLowerCase(), app);
    existingMap.set(app.name.toLowerCase(), app);
    if (app.slug) existingMap.set(app.slug.toLowerCase(), app);
  }

  let enrichedCount = 0;
  let addedCount = 0;

  // Process Software entries
  for (const row of softwareList) {
    const name = row[1]?.trim();
    const slug = row[2]?.trim() || name.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const website = row[3]?.trim()
      ? row[3].startsWith("http")
        ? row[3]
        : `https://${row[3]}`
      : "";
    const repo = row[4]?.trim() ? (row[4].startsWith("http") ? row[4] : `https://${row[4]}`) : "";
    const desc = row[5]?.trim() || `${name} - Self-hosted software listed on selfh.st.`;
    const iconSlug = row[10]?.trim();
    const stars = row[13]?.trim();
    const forks = row[14]?.trim();

    if (!name) continue;

    const cleanId = slug.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const existing = existingMap.get(cleanId) || existingMap.get(name.toLowerCase());

    const logoSvg = iconSlug
      ? `https://cdn.jsdelivr.net/gh/selfhst/icons@main/svg/${iconSlug}.svg`
      : `https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/${cleanId}.svg`;

    const webpIcon = iconSlug
      ? `https://cdn.jsdelivr.net/gh/selfhst/icons@main/webp/${iconSlug}.webp`
      : `https://cdn.jsdelivr.net/gh/selfhst/cdn@main/directory/icons/apps/${cleanId}.webp`;

    if (existing) {
      if (stars) existing.stars = stars;
      if (forks) existing.forks = forks;
      if (iconSlug) {
        existing.svgUrl = logoSvg;
        existing.logoUrl = logoSvg;
      }
      if (!existing.website && website) existing.website = website;
      if (!existing.tags.includes("selfhst")) existing.tags.push("selfhst");
      enrichedCount++;
    } else {
      let dockerImg = null;
      if (repo && repo.includes("github.com/")) {
        const ghParts = repo.match(/github\.com\/([^/]+)\/([^/#?]+)/);
        if (ghParts) {
          dockerImg = `${ghParts[1].toLowerCase()}/${ghParts[2].toLowerCase()}:latest`;
        }
      }
      if (!dockerImg) dockerImg = `${cleanId}:${cleanId}`;

      const newApp = {
        id: cleanId,
        name: name,
        slug: cleanId,
        category: "selfhst-software",
        categoryLabel: "selfh.st: Software Directory",
        desc: desc,
        url: repo || website || `https://selfh.st/apps/`,
        website: website || repo || `https://selfh.st/apps/`,
        image: dockerImg,
        source: "selfhst",
        tags: ["selfhst", "self-hosted", "foss"],
        tagUrl: `https://selfh.st/apps/`,
        logoUrl: logoSvg,
        svgUrl: logoSvg,
        webpIcon: webpIcon,
        stars: stars || undefined,
        forks: forks || undefined,
      };
      mainDb.apps.push(newApp);
      existingMap.set(cleanId, newApp);
      addedCount++;
    }
  }

  // Process Companions
  for (const row of companionsList) {
    const name = row[1]?.trim();
    const slug = row[2]?.trim() || name.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const website = row[3]?.trim()
      ? row[3].startsWith("http")
        ? row[3]
        : `https://${row[3]}`
      : "";
    const repo = row[4]?.trim() ? (row[4].startsWith("http") ? row[4] : `https://${row[4]}`) : "";
    const desc = row[5]?.trim() || `${name} - Companion app listed on selfh.st.`;
    const iconSlug = row[10]?.trim();
    const stars = row[13]?.trim();

    if (!name) continue;
    const cleanId = `companion-${slug.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`;
    if (!existingMap.has(cleanId)) {
      const logoSvg = iconSlug
        ? `https://cdn.jsdelivr.net/gh/selfhst/icons@main/svg/${iconSlug}.svg`
        : `https://cdn.jsdelivr.net/gh/selfhst/cdn@main/directory/icons/apps/${slug}.webp`;

      mainDb.apps.push({
        id: cleanId,
        name: name,
        slug: cleanId,
        category: "companions",
        categoryLabel: "selfh.st: Companion Apps",
        desc: desc,
        url: repo || website || `https://selfh.st/apps/`,
        website: website || repo || `https://selfh.st/apps/`,
        image: `${cleanId}:latest`,
        source: "selfhst",
        tags: ["companion", "mobile-app", "selfhst"],
        tagUrl: `https://selfh.st/apps/`,
        logoUrl: logoSvg,
        svgUrl: logoSvg,
        stars: stars || undefined,
      });
      addedCount++;
    }
  }

  // Add selfh.st tag
  const hasTag = mainDb.tags.some((t) => t.slug === "selfhst-software");
  if (!hasTag) {
    mainDb.tags.push({
      label: "selfh.st Directory",
      slug: "selfhst-software",
      icon: "🌐",
      count: addedCount,
      tagUrl: "https://selfh.st/apps/",
    });
  }

  mainDb.totalApps = mainDb.apps.length;
  mainDb.totalTags = mainDb.tags.length;
  if (!mainDb.sources.includes("https://selfh.st/apps/")) {
    mainDb.sources.push("https://selfh.st/apps/");
  }

  console.log(`\n=== selfh.st Integration Results ===`);
  console.log(`- Enriched Existing Apps with Stars & Logos: ${enrichedCount}`);
  console.log(`- Added New selfh.st Apps & Companions: ${addedCount}`);
  console.log(`- Total Combined Apps in HosteraX: ${mainDb.totalApps}`);
  console.log(`- Total Categories / Tags: ${mainDb.totalTags}`);

  fs.writeFileSync("src/lib/awesome-selfhosted-db.json", JSON.stringify(mainDb, null, 2), "utf8");
  fs.writeFileSync(
    "hosterax/engine/src/awesome-selfhosted-db.json",
    JSON.stringify(mainDb, null, 2),
    "utf8",
  );
  fs.writeFileSync("public/catalog.json", JSON.stringify(mainDb, null, 2), "utf8");
  console.log("Saved synchronized database files!");
}

main().catch((err) => console.error(err));
