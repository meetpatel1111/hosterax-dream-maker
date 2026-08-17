import fs from "node:fs";

function parseAwesomeHtml(html) {
  const apps = [];
  const sectionRegex = /<section\s+id="([^"]+)">([\s\S]*?)<\/section>/gi;
  let match;

  while ((match = sectionRegex.exec(html)) !== null) {
    const slug = match[1];
    const content = match[2];

    const h3Match = content.match(/<h3>([^<]+)/i);
    const name = h3Match ? h3Match[1].trim() : slug;

    const pMatch = content.match(/<\/h3>\s*<p>([\s\S]*?)<\/p>/i);
    let desc = "";
    if (pMatch) {
      desc = pMatch[1].replace(/<[^>]+>/g, "").trim();
    }

    let website = null;
    let sourceCode = null;

    const webMatch = content.match(
      /<a\s+class="external-link"\s+href="([^"]+)"[^>]*>[\s\S]*?Website<\/a>/i,
    );
    if (webMatch) website = webMatch[1];

    const srcMatch = content.match(
      /<a\s+class="external-link"\s+href="([^"]+)"[^>]*>[\s\S]*?Source\s*Code<\/a>/i,
    );
    if (srcMatch) sourceCode = srcMatch[1];

    let stars = null;
    const starMatch = content.match(/class="stars">\s*★\s*(\d+)/i);
    if (starMatch) stars = starMatch[1];

    let updatedAt = null;
    const updatedMatch = content.match(/class="updated-at"[^>]*>[\s\S]*?(\d{4}-\d{2}-\d{2})/i);
    if (updatedMatch) updatedAt = updatedMatch[1];

    const platforms = [];
    const platRegex = /class="platform">\s*<a[^>]*>[\s\S]*?([A-Za-z0-9_+#. -]+)<\/a>/gi;
    let plMatch;
    while ((plMatch = platRegex.exec(content)) !== null) {
      const plName = plMatch[1].replace(/<[^>]+>/g, "").trim();
      if (plName && !platforms.includes(plName)) platforms.push(plName);
    }

    let license = null;
    const licMatch = content.match(/class="license">\s*<a[^>]*>[\s\S]*?([A-Za-z0-9_+#. -]+)<\/a>/i);
    if (licMatch) {
      license = licMatch[1].replace(/<[^>]+>/g, "").trim();
    }

    apps.push({
      slug,
      name,
      desc,
      website: website || sourceCode,
      url: sourceCode || website,
      stars,
      updatedAt,
      platforms,
      license,
    });
  }

  return apps;
}

async function test() {
  const html = await (await fetch("https://awesome-selfhosted.net/tags/analytics.html")).text();
  const parsed = parseAwesomeHtml(html);
  console.log(`Parsed ${parsed.length} apps from analytics.html:`);
  console.log(
    "Sample parsed ANALOG:",
    parsed.find((a) => a.name === "ANALOG"),
  );
}

test();
