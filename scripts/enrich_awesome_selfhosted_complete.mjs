import fs from 'node:fs';

function parseSection(content, defaultCategory = '') {
  const h3Match = content.match(/<h3>([^<]+)/i);
  if (!h3Match) return null;
  const name = h3Match[1].trim();

  // First <p> after <h3> is the description
  const pMatch = content.match(/<\/h3>\s*<p>([\s\S]*?)<\/p>/i);
  let desc = '';
  if (pMatch) {
    desc = pMatch[1].replace(/<[^>]+>/g, '').trim();
  }

  // Links
  let website = null;
  let sourceCode = null;

  const webMatch = content.match(/<a\s+class="external-link"\s+href="([^"]+)"[^>]*>[\s\S]*?Website<\/a>/i);
  if (webMatch) website = webMatch[1];

  const srcMatch = content.match(/<a\s+class="external-link"\s+href="([^"]+)"[^>]*>[\s\S]*?Source\s*Code<\/a>/i);
  if (srcMatch) sourceCode = srcMatch[1];

  // Stars
  let stars = null;
  const starMatch = content.match(/class="stars">\s*★\s*(\d+)/i);
  if (starMatch) stars = starMatch[1];

  // Updated date
  let updatedAt = null;
  const updatedMatch = content.match(/class="updated-at"[^>]*>[\s\S]*?(\d{4}-\d{2}-\d{2})/i);
  if (updatedMatch) updatedAt = updatedMatch[1];

  // Platforms
  const platforms = [];
  const platRegex = /class="platform">\s*<a[^>]*>[\s\S]*?([A-Za-z0-9_+#. -]+)<\/a>/gi;
  let plMatch;
  while ((plMatch = platRegex.exec(content)) !== null) {
    const plName = plMatch[1].replace(/<[^>]+>/g, '').trim();
    if (plName && !platforms.includes(plName)) platforms.push(plName);
  }

  // License
  let license = null;
  const licMatch = content.match(/class="license-(?:box|link|item)"[^>]*>\s*<a[^>]*>[\s\S]*?([A-Za-z0-9_+#. -]+)<\/a>/i) ||
                    content.match(/<a\s+class="license-link"[^>]*>[\s\S]*?([A-Za-z0-9_+#. -]+)<\/a>/i);
  if (licMatch) {
    license = licMatch[1].replace(/<[^>]+>/g, '').trim();
  }

  return {
    name,
    desc,
    website: website || sourceCode,
    url: sourceCode || website,
    stars,
    updatedAt,
    platforms,
    license,
    category: defaultCategory
  };
}

async function main() {
  const mainDb = JSON.parse(fs.readFileSync('src/lib/awesome-selfhosted-db.json', 'utf8'));

  const tagUrls = new Set();
  for (const app of mainDb.apps) {
    if (app.tagUrl && app.tagUrl.includes('awesome-selfhosted.net')) {
      tagUrls.add(app.tagUrl);
    }
  }

  const urlList = Array.from(tagUrls);
  console.log(`Crawling ${urlList.length} category pages across awesome-selfhosted.net & sysadmin...`);

  const appMap = new Map();
  for (const app of mainDb.apps) {
    appMap.set(app.id.toLowerCase(), app);
    appMap.set(app.name.toLowerCase(), app);
    if (app.slug) appMap.set(app.slug.toLowerCase(), app);
  }

  let totalParsed = 0;
  let enrichedCount = 0;

  const BATCH_SIZE = 10;
  for (let i = 0; i < urlList.length; i += BATCH_SIZE) {
    const chunk = urlList.slice(i, i + BATCH_SIZE);
    await Promise.all(
      chunk.map(async (url) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const html = await res.text();

          const sectionRegex = /<section\s+id="([^"]+)">([\s\S]*?)<\/section>/gi;
          let match;
          while ((match = sectionRegex.exec(html)) !== null) {
            const slug = match[1];
            const parsed = parseSection(match[2]);
            if (parsed) {
              totalParsed++;
              const cleanId = slug.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
              const app = appMap.get(cleanId) || appMap.get(parsed.name.toLowerCase());

              if (app) {
                if (parsed.stars && (!app.stars || Number(app.stars) <= 0)) {
                  app.stars = parsed.stars;
                }
                if (parsed.updatedAt && !app.updatedAt) {
                  app.updatedAt = parsed.updatedAt;
                }
                if (parsed.license && !app.license) {
                  app.license = parsed.license;
                }
                if (parsed.platforms && parsed.platforms.length > 0 && !app.language) {
                  const langPlat = parsed.platforms.find(p => !['Docker', 'Kubernetes', 'Linux', 'BSD', 'Self-hosted'].includes(p)) || parsed.platforms[0];
                  if (langPlat) app.language = langPlat;
                }
                if (parsed.website && (!app.website || app.website.includes('awesome-selfhosted.net'))) {
                  app.website = parsed.website;
                }
                if (parsed.url && (!app.url || !app.url.includes('github.com'))) {
                  app.url = parsed.url;
                }
                if (parsed.desc && (!app.desc || app.desc.length < 15)) {
                  app.desc = parsed.desc;
                }
                enrichedCount++;
              }
            }
          }
        } catch (err) {
          console.error(`Error scraping ${url}:`, err.message);
        }
      })
    );

    console.log(`Progress: ${Math.min(i + BATCH_SIZE, urlList.length)} / ${urlList.length} pages processed.`);
  }

  console.log(`\n=== Crawling Complete ===`);
  console.log(`- Total apps parsed from HTML: ${totalParsed}`);
  console.log(`- Total app records enriched: ${enrichedCount}`);

  fs.writeFileSync('src/lib/awesome-selfhosted-db.json', JSON.stringify(mainDb, null, 2), 'utf8');
  fs.writeFileSync('hosterax/engine/src/awesome-selfhosted-db.json', JSON.stringify(mainDb, null, 2), 'utf8');
  console.log('Saved synchronized database files with complete metadata!');
}

main().catch(err => console.error(err));
