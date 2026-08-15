import fs from 'node:fs';

function extractRepo(url, desc, website) {
  const allText = `${url || ''} ${desc || ''} ${website || ''}`;
  const m = allText.match(/github\.com\/([^/)\s#"']+)\/([^/)\s#"']+)/i);
  if (m) {
    const owner = m[1].replace(/[^a-zA-Z0-9_.-]/g, '');
    const repo = m[2].replace(/\.git$/, '').replace(/[^a-zA-Z0-9_.-]/g, '');
    if (owner && repo && !['topics', 'sponsors', 'marketplace', 'features', 'trending', 'collections'].includes(owner.toLowerCase())) {
      return `${owner}/${repo}`;
    }
  }
  return null;
}

async function fetchRepoStars(repo) {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        'User-Agent': 'HosteraX-Star-Enricher/1.0',
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (res.status === 200) {
      const data = await res.json();
      return { stars: data.stargazers_count, forks: data.forks_count };
    }
    // Fallback to shields API if rate limited
    if (res.status === 403 || res.status === 429) {
      const sRes = await fetch(`https://img.shields.io/github/stars/${repo}.json`);
      if (sRes.status === 200) {
        const sData = await sRes.json();
        const raw = sData.value || sData.message || '';
        let num = 0;
        if (raw.endsWith('k')) {
          num = Math.round(parseFloat(raw) * 1000);
        } else if (raw.endsWith('M')) {
          num = Math.round(parseFloat(raw) * 1000000);
        } else {
          num = parseInt(raw, 10);
        }
        if (!isNaN(num) && num > 0) return { stars: num };
      }
    }
  } catch {}
  return null;
}

async function main() {
  console.log('Enriching real GitHub stars for all open-source apps across HosteraX catalog...');
  const mainDb = JSON.parse(fs.readFileSync('src/lib/awesome-selfhosted-db.json', 'utf8'));

  const pending = [];
  for (const app of mainDb.apps) {
    if (!app.stars || Number(app.stars) <= 0) {
      const repo = extractRepo(app.url, app.desc, app.website);
      if (repo) {
        pending.push({ app, repo });
      }
    }
  }

  console.log(`Found ${pending.length} apps missing GitHub stars to enrich.`);

  // Concurrency worker pool
  const CONCURRENCY = 10;
  let enriched = 0;

  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const chunk = pending.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async ({ app, repo }) => {
        const data = await fetchRepoStars(repo);
        if (data && data.stars) {
          app.stars = String(data.stars);
          if (data.forks) app.forks = String(data.forks);
          enriched++;
        }
      })
    );

    if ((i + CONCURRENCY) % 50 === 0 || i + CONCURRENCY >= pending.length) {
      console.log(`Progress: ${Math.min(i + CONCURRENCY, pending.length)} / ${pending.length} (enriched: ${enriched})`);
    }
  }

  console.log(`\n=== GitHub Stars Enrichment Complete ===`);
  console.log(`- Total Apps with Live Stars: ${mainDb.apps.filter(a => a.stars && Number(a.stars) > 0).length} of ${mainDb.apps.length}`);

  fs.writeFileSync('src/lib/awesome-selfhosted-db.json', JSON.stringify(mainDb, null, 2), 'utf8');
  fs.writeFileSync('hosterax/engine/src/awesome-selfhosted-db.json', JSON.stringify(mainDb, null, 2), 'utf8');
  console.log('Saved synchronized database files with real stars!');
}

main().catch(err => console.error(err));
