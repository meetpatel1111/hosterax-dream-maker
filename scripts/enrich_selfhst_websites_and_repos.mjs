import fs from "node:fs";

async function main() {
  console.log("Fetching full software and companion datasets from selfh.st...");
  const [softRes, compRes] = await Promise.all([
    fetch("https://cdn.jsdelivr.net/gh/selfhst/cdn@main/directory/software.json"),
    fetch("https://cdn.jsdelivr.net/gh/selfhst/cdn@main/directory/companions.json"),
  ]);

  const softwareList = await softRes.json();
  const companionsList = await compRes.json();

  const mainDb = JSON.parse(fs.readFileSync("src/lib/awesome-selfhosted-db.json", "utf8"));

  const appMap = new Map();
  for (const app of mainDb.apps) {
    appMap.set(app.id.toLowerCase(), app);
    appMap.set(app.name.toLowerCase(), app);
    if (app.slug) appMap.set(app.slug.toLowerCase(), app);
  }

  let updatedSites = 0;
  let updatedRepos = 0;

  const processRow = (row) => {
    const name = row[1]?.trim();
    const slug = row[2]?.trim() || name?.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const website = row[3]?.trim()
      ? row[3].startsWith("http")
        ? row[3]
        : `https://${row[3]}`
      : "";
    const repo = row[4]?.trim() ? (row[4].startsWith("http") ? row[4] : `https://${row[4]}`) : "";
    const desc = row[5]?.trim();
    const stars = row[13]?.trim();

    if (!name) return;

    const cleanId = slug.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const app = appMap.get(cleanId) || appMap.get(name.toLowerCase());

    if (app) {
      if (website && website !== app.website) {
        app.website = website;
        updatedSites++;
      }
      if (repo && (!app.url || !app.url.includes("github.com"))) {
        app.url = repo;
        updatedRepos++;
      }
      if (stars && (!app.stars || Number(app.stars) <= 0)) {
        app.stars = stars;
      }
      if (desc && (!app.desc || app.desc.includes("Self-hosted software listed on selfh.st"))) {
        app.desc = desc;
      }
    }
  };

  softwareList.forEach(processRow);
  companionsList.forEach(processRow);

  console.log(
    `Updated websites on ${updatedSites} apps and source repos on ${updatedRepos} apps from selfh.st.`,
  );

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
