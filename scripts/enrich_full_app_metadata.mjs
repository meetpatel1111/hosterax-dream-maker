import fs from 'node:fs';

async function main() {
  console.log('Fetching selfh.st complete metadata (software, companions, languages, licenses, tags)...');
  const [soft, comp, langs, lics, tags] = await Promise.all([
    fetch('https://raw.githubusercontent.com/selfhst/cdn/main/directory/software.json').then(r => r.json()),
    fetch('https://raw.githubusercontent.com/selfhst/cdn/main/directory/companions.json').then(r => r.json()),
    fetch('https://raw.githubusercontent.com/selfhst/cdn/main/directory/languages.json').then(r => r.json()),
    fetch('https://raw.githubusercontent.com/selfhst/cdn/main/directory/licenses.json').then(r => r.json()),
    fetch('https://raw.githubusercontent.com/selfhst/cdn/main/directory/tags.json').then(r => r.json())
  ]);

  const tagMap = new Map();
  tags.forEach(t => tagMap.set(t[0], t[1]));

  const mainDb = JSON.parse(fs.readFileSync('src/lib/awesome-selfhosted-db.json', 'utf8'));

  const appMap = new Map();
  for (const app of mainDb.apps) {
    appMap.set(app.id.toLowerCase(), app);
    appMap.set(app.name.toLowerCase(), app);
    if (app.slug) appMap.set(app.slug.toLowerCase(), app);
  }

  let enrichedCount = 0;

  const processRow = (row) => {
    const name = row[1]?.trim();
    const slug = row[2]?.trim() || name?.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const website = row[3]?.trim() ? (row[3].startsWith('http') ? row[3] : `https://${row[3]}`) : '';
    const repo = row[4]?.trim() ? (row[4].startsWith('http') ? row[4] : `https://${row[4]}`) : '';
    const desc = row[5]?.trim();
    const licIdx = parseInt(row[7], 10);
    const langIdx = parseInt(row[8], 10);
    const license = !isNaN(licIdx) && lics[licIdx] ? lics[licIdx] : undefined;
    const language = !isNaN(langIdx) && langs[langIdx] ? langs[langIdx] : undefined;
    const stars = row[13]?.trim();
    const forks = row[14]?.trim();
    const updatedAt = row[15]?.trim();
    const tagIds = row[17] || [];
    const resolvedTags = tagIds.map(tid => tagMap.get(tid)).filter(Boolean);

    if (!name) return;

    const cleanId = slug.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const app = appMap.get(cleanId) || appMap.get(name.toLowerCase());

    if (app) {
      if (license) app.license = license;
      if (language) app.language = language;
      if (updatedAt) app.updatedAt = updatedAt;
      if (stars && (!app.stars || Number(app.stars) <= 0)) app.stars = stars;
      if (forks) app.forks = forks;
      if (website && (!app.website || app.website.includes('self-hosted.net'))) app.website = website;
      if (repo && (!app.url || !app.url.includes('github.com'))) app.url = repo;
      if (desc && (!app.desc || app.desc.includes('Self-hosted software listed on selfh.st'))) app.desc = desc;

      for (const t of resolvedTags) {
        const cleanTag = t.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        if (!app.tags.includes(cleanTag)) {
          app.tags.push(cleanTag);
        }
      }
      enrichedCount++;
    }
  };

  soft.forEach(processRow);
  comp.forEach(processRow);

  console.log(`Enriched ${enrichedCount} apps with Language, License, Updated Date, and Categories!`);

  fs.writeFileSync('src/lib/awesome-selfhosted-db.json', JSON.stringify(mainDb, null, 2), 'utf8');
  fs.writeFileSync('hosterax/engine/src/awesome-selfhosted-db.json', JSON.stringify(mainDb, null, 2), 'utf8');
  console.log('Saved synchronized database files with rich metadata!');
}

main().catch(err => console.error(err));
