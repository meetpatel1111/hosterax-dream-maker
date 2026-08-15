import fs from 'node:fs';

function normalizeKey(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/[^a-z0-9]/g, '');
}

function getRepoKey(url) {
  if (!url) return '';
  const m = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (m) {
    return `${m[1].toLowerCase()}/${m[2].toLowerCase().replace(/\.git$/, '')}`;
  }
  return '';
}

async function main() {
  console.log('Starting Unified Canonical Deduplication & Multi-Source Merging...');
  const mainDb = JSON.parse(fs.readFileSync('src/lib/awesome-selfhosted-db.json', 'utf8'));

  const canonicalMap = new Map(); // key -> app
  let duplicateCount = 0;

  for (const rawApp of mainDb.apps) {
    const normName = normalizeKey(rawApp.name);
    const normSlug = normalizeKey(rawApp.slug || rawApp.id);
    const repoKey = getRepoKey(rawApp.url) || getRepoKey(rawApp.website);

    // Find existing canonical entry by Repo Key, Slug, or Normalized Name
    let canonical = null;
    if (repoKey && canonicalMap.has(`repo:${repoKey}`)) {
      canonical = canonicalMap.get(`repo:${repoKey}`);
    } else if (normSlug && canonicalMap.has(`slug:${normSlug}`)) {
      canonical = canonicalMap.get(`slug:${normSlug}`);
    } else if (normName && canonicalMap.has(`name:${normName}`)) {
      canonical = canonicalMap.get(`name:${normName}`);
    }

    const currentSource = rawApp.source || 'awesome_selfhosted';

    if (canonical) {
      duplicateCount++;
      // Merge sources array
      if (!canonical.sources) canonical.sources = [canonical.source];
      if (!canonical.sources.includes(currentSource)) {
        canonical.sources.push(currentSource);
      }

      // Merge tags
      const tagSet = new Set([...(canonical.tags || []), ...(rawApp.tags || []), currentSource]);
      canonical.tags = Array.from(tagSet);

      // Merge stars & metrics
      if (!canonical.stars && rawApp.stars) canonical.stars = rawApp.stars;
      if (!canonical.forks && rawApp.forks) canonical.forks = rawApp.forks;

      // Merge logos (prefer SVGs)
      if (!canonical.svgUrl && rawApp.svgUrl) canonical.svgUrl = rawApp.svgUrl;
      if (!canonical.logoUrl && rawApp.logoUrl) canonical.logoUrl = rawApp.logoUrl;
      if (!canonical.webpIcon && rawApp.webpIcon) canonical.webpIcon = rawApp.webpIcon;

      // Merge URLs
      if ((!canonical.website || canonical.website.includes('awesome-selfhosted')) && rawApp.website) {
        canonical.website = rawApp.website;
      }
      if ((!canonical.url || canonical.url.includes('awesome-selfhosted')) && rawApp.url) {
        canonical.url = rawApp.url;
      }

      // Merge description if longer / better
      if (rawApp.desc && rawApp.desc.length > (canonical.desc?.length || 0)) {
        canonical.desc = rawApp.desc;
      }

      // Retain most specific docker image
      if ((!canonical.image || canonical.image.includes(':') && canonical.image.split(':')[0] === canonical.id) && rawApp.image && !rawApp.image.includes(`${rawApp.id}:${rawApp.id}`)) {
        canonical.image = rawApp.image;
      }
    } else {
      // New Canonical Record
      const newCanonical = {
        ...rawApp,
        sources: [currentSource],
        tags: Array.from(new Set([...(rawApp.tags || []), currentSource]))
      };

      if (repoKey) canonicalMap.set(`repo:${repoKey}`, newCanonical);
      if (normSlug) canonicalMap.set(`slug:${normSlug}`, newCanonical);
      if (normName) canonicalMap.set(`name:${normName}`, newCanonical);
      canonicalMap.set(`id:${newCanonical.id}`, newCanonical);
    }
  }

  // Get distinct list of canonical apps
  const uniqueApps = Array.from(new Set(canonicalMap.values()));

  console.log(`\n=== Deduplication & Canonical Merging Results ===`);
  console.log(`- Original Total Records: ${mainDb.apps.length}`);
  console.log(`- Duplicate Overlaps Merged: ${duplicateCount}`);
  console.log(`- Unique Canonical Apps Remaining: ${uniqueApps.length}`);

  // Count apps by source presence
  const selfhstCount = uniqueApps.filter(a => a.sources?.includes('selfhst') || a.tags?.includes('selfhst')).length;
  const sysadminCount = uniqueApps.filter(a => a.sources?.includes('awesome_sysadmin') || a.tags?.includes('sysadmin')).length;
  const awesomeCount = uniqueApps.filter(a => a.sources?.includes('awesome_selfhosted') || a.source === 'awesome_selfhosted').length;
  const multiSourceCount = uniqueApps.filter(a => (a.sources?.length || 1) > 1).length;

  console.log(`- Apps in selfh.st: ${selfhstCount}`);
  console.log(`- Apps in Awesome-Selfhosted: ${awesomeCount}`);
  console.log(`- Apps in SysAdmin / DevOps: ${sysadminCount}`);
  console.log(`- Apps available across MULTIPLE directories: ${multiSourceCount}`);

  // Update mainDb
  mainDb.apps = uniqueApps;
  mainDb.totalApps = uniqueApps.length;

  fs.writeFileSync('src/lib/awesome-selfhosted-db.json', JSON.stringify(mainDb, null, 2), 'utf8');
  fs.writeFileSync('hosterax/engine/src/awesome-selfhosted-db.json', JSON.stringify(mainDb, null, 2), 'utf8');
  console.log('Saved clean deduplicated canonical database!');
}

main().catch(err => console.error(err));
