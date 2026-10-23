/**
 * Where the engine is, when the user has not chosen an address in Settings.
 *
 * When the engine itself served this page (Docker, `npx hosterax`, the desktop app) it says so with a
 * `Server-Timing: hosterax` header, and the engine is simply this page's origin — whatever port it
 * runs on. Anywhere else (the Vite dev server, a preview host) the conventional local address is used.
 */
export const FALLBACK_ENGINE_URL = "http://localhost:7777";

export function defaultEngineUrl(): string {
  if (typeof window === "undefined") return FALLBACK_ENGINE_URL;
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    if (nav?.serverTiming?.some((t) => t.name === "hosterax")) return window.location.origin;
  } catch {
    /* Server-Timing is unavailable — use the fallback */
  }
  return FALLBACK_ENGINE_URL;
}
