import { useSyncExternalStore, useCallback } from "react";

type EngineState = { url: string; token: string };

const DEFAULT_URL = "http://localhost:7777";

function read(): EngineState {
  if (typeof window === "undefined") return { url: DEFAULT_URL, token: "" };
  return {
    url: localStorage.getItem("hx.url") || DEFAULT_URL,
    token: localStorage.getItem("hx.token") || "",
  };
}

let state: EngineState = read();
const listeners = new Set<() => void>();

function emit() {
  listeners.add;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return state;
}

const SERVER_SNAPSHOT: EngineState = { url: DEFAULT_URL, token: "" };
function getServerSnapshot() {
  return SERVER_SNAPSHOT;
}

export function setEngineConfig(url: string, token: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem("hx.url", url);
    localStorage.setItem("hx.token", token);
  }
  state = { url, token };
  emit();
}

export function useEngine() {
  const { url, token } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const call = useCallback(
    async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
      const r = await fetch(url + path, {
        method,
        headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) {
        let err: any;
        try {
          err = await r.json();
        } catch {
          err = await r.text();
        }
        throw new Error(err?.error || (typeof err === "string" ? err : "") || `Engine error ${r.status}`);
      }
      if (r.status === 204) return undefined as T;
      return r.json();
    },
    [url, token],
  );

  return { url, token, save: setEngineConfig, call };
}
