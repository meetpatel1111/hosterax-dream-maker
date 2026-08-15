import { useState, useMemo } from "react";

interface AppLogoProps {
  name: string;
  slug?: string;
  logoUrl?: string;
  svgUrl?: string;
  website?: string;
  url?: string;
  iconFallback?: string;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

export function AppLogo({
  name,
  slug,
  logoUrl,
  svgUrl,
  website,
  url,
  iconFallback = "📦",
  className = "",
  size = "md",
}: AppLogoProps) {
  const [errorIndex, setErrorIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const cleanSlug = (slug || name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const noHyphenSlug = cleanSlug.replace(/-/g, "");

  // Multi-tier fallback chain prioritizing real vector SVGs
  const candidateUrls = useMemo(() => {
    const list: string[] = [];

    // 1. Direct explicit SVG
    if (svgUrl) list.push(svgUrl);
    if (logoUrl && !list.includes(logoUrl)) list.push(logoUrl);

    // 2. High-res Dashboard-Icons SVGs
    list.push(`https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/${cleanSlug}.svg`);
    if (noHyphenSlug !== cleanSlug) {
      list.push(`https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg/${noHyphenSlug}.svg`);
    }

    // 3. SimpleIcons vector SVGs
    list.push(`https://cdn.simpleicons.org/${cleanSlug}`);
    if (noHyphenSlug !== cleanSlug) {
      list.push(`https://cdn.simpleicons.org/${noHyphenSlug}`);
    }

    // 4. Dashboard-Icons PNGs
    list.push(`https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/${cleanSlug}.png`);

    // 5. GitHub Org Avatar
    const targetUrl = website || url || "";
    const ghMatch = targetUrl.match(/github\.com\/([^/]+)/);
    if (ghMatch && !["torvalds", "awesome-selfhosted", "awesome-foss"].includes(ghMatch[1])) {
      list.push(`https://github.com/${ghMatch[1]}.png?size=128`);
    }

    // 6. High-res domain favicon / icon
    try {
      if (targetUrl.startsWith("http")) {
        const host = new URL(targetUrl).hostname;
        if (host && !host.includes("github.com") && !host.includes("gitlab.com")) {
          list.push(`https://www.google.com/s2/favicons?domain=${host}&sz=128`);
          list.push(`https://icon.horse/icon/${host}`);
        }
      }
    } catch {}

    // Deduplicate
    return Array.from(new Set(list));
  }, [svgUrl, logoUrl, cleanSlug, noHyphenSlug, website, url]);

  const currentSrc = candidateUrls[errorIndex] || null;

  const sizeClasses = {
    sm: "w-8 h-8 rounded-lg text-base",
    md: "w-11 h-11 rounded-xl text-xl",
    lg: "w-14 h-14 rounded-2xl text-2xl",
    xl: "w-20 h-20 rounded-2xl text-4xl",
  }[size];

  const imgSizeClasses = {
    sm: "w-5 h-5",
    md: "w-7 h-7",
    lg: "w-9 h-9",
    xl: "w-12 h-12",
  }[size];

  function handleError() {
    if (errorIndex < candidateUrls.length - 1) {
      setErrorIndex((prev) => prev + 1);
    } else {
      setErrorIndex(999);
    }
  }

  const showImage = errorIndex < candidateUrls.length && currentSrc;

  return (
    <div
      className={`relative flex items-center justify-center shrink-0 bg-surface-2/90 border border-border/60 shadow-sm overflow-hidden transition-all duration-200 ${sizeClasses} ${className}`}
    >
      {showImage ? (
        <>
          <img
            key={currentSrc}
            src={currentSrc}
            alt={`${name} logo`}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={handleError}
            className={`object-contain transition-all duration-200 group-hover:scale-110 ${imgSizeClasses} ${
              loaded ? "opacity-100 drop-shadow-sm" : "opacity-0"
            }`}
          />
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-2/60 animate-pulse text-[11px] font-bold text-muted-foreground/70 select-none">
              {name.slice(0, 2).toUpperCase()}
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-center w-full h-full bg-gradient-to-br from-primary/15 via-surface-2 to-surface-3 font-bold text-primary text-xs select-none">
          {iconFallback && iconFallback !== "📦" ? (
            <span>{iconFallback}</span>
          ) : (
            <span>{name.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
      )}
    </div>
  );
}
