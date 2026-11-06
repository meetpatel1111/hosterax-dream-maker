/**
 * Where the engine is, when the user has not chosen an address in Settings.
 *
 * For local operations, defaults to the current origin (proxied to the local HosteraX SQLite engine)
 * or loopback 127.0.0.1:7777 on the server.
 */
export const FALLBACK_ENGINE_URL = "";

export function defaultEngineUrl(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:7777";
  return window.location.origin;
}
