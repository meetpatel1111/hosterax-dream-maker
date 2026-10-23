/** Per-browser privacy switches. Stored locally; nothing here is sent to the engine. */

const LOGOS_KEY = "hx.remoteLogos";

/**
 * App logos come from public icon CDNs (jsDelivr, Simple Icons, GitHub avatars). Only the app's slug
 * is requested, but the CDN still sees your IP. On by default; turn it off to show initials instead.
 */
export function remoteLogosEnabled(): boolean {
  try {
    return typeof window === "undefined" || localStorage.getItem(LOGOS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setRemoteLogosEnabled(on: boolean) {
  try {
    if (on) localStorage.removeItem(LOGOS_KEY);
    else localStorage.setItem(LOGOS_KEY, "off");
  } catch {
    /* storage unavailable — the preference just won't persist */
  }
}
