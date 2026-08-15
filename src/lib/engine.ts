import { useSyncExternalStore, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
export * from "./schema";

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

// Auto-discover local engine bootstrap token if not set
if (typeof window !== "undefined") {
  if (!state.token && state.url.includes("localhost")) {
    fetch(state.url + "/api/token")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.token) {
          setEngineConfig(state.url, d.token);
        }
      })
      .catch(() => {});
  }
}

function emit() {
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
    async <T>(method: string, path: string, body?: unknown): Promise<T> => {
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
        throw new Error(
          err?.error || (typeof err === "string" ? err : "") || `Engine error ${r.status}`,
        );
      }
      if (r.status === 204) return undefined as T;
      return r.json();
    },
    [url, token],
  );

  return { url, token, save: setEngineConfig, call };
}

export function useEngineHealth() {
  const eng = useEngine();
  return useQuery({
    queryKey: ["engine-health", eng.url],
    queryFn: async () => {
      try {
        const r = await fetch(eng.url + "/health");
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    },
    refetchInterval: 5000,
    retry: false,
  });
}

export function useEngineProjects() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery({
    queryKey: ["engine-projects", eng.url, eng.token],
    queryFn: async () => (await eng.call<any[]>("GET", "/api/projects").catch(() => [])) ?? [],
    enabled: !!health.data?.ok,
    refetchInterval: 3000,
  });
}

export function useEngineSystem() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery({
    queryKey: ["engine-system", eng.url, eng.token],
    queryFn: async () => await eng.call<any>("GET", "/api/system").catch(() => null),
    enabled: !!health.data?.ok,
    refetchInterval: 4000,
  });
}

export function useProjectMetrics(projectName: string) {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery({
    queryKey: ["project-metrics", projectName, eng.url, eng.token],
    queryFn: async () =>
      projectName
        ? await eng.call<any>("GET", `/api/projects/${projectName}/metrics`).catch(() => null)
        : null,
    enabled: !!health.data?.ok && !!projectName,
    refetchInterval: 3000,
  });
}

export type MagicDnsProviderInfo = {
  id: string;
  label: string;
  badge: string;
  description: string;
  status: "active" | "defunct";
  example: string;
  suffix: string;
  isActive: boolean;
};

export type MagicDnsSettingsResponse = {
  activeProvider: string;
  activeHostFormat: string;
  providers: MagicDnsProviderInfo[];
};

export const FALLBACK_MAGIC_DNS_PROVIDERS: MagicDnsProviderInfo[] = [
  {
    id: "sslip.io",
    label: "sslip.io",
    badge: "Recommended",
    description: "Modern & robust wildcard DNS. Supports IPv4, IPv6, and hexadecimal addresses.",
    status: "active",
    example: "my-app.127-0-0-1.sslip.io",
    suffix: "sslip.io",
    isActive: true,
  },
  {
    id: "nip.io",
    label: "nip.io",
    badge: "Popular",
    description: "Classic zero-config wildcard DNS (127.0.0.1.nip.io) for local development.",
    status: "active",
    example: "my-app.127.0.0.1.nip.io",
    suffix: "nip.io",
    isActive: false,
  },
  {
    id: "traefik.me",
    label: "traefik.me",
    badge: "Zero-Config",
    description: "Clean domain format mapping subdomains directly to 127.0.0.1.",
    status: "active",
    example: "my-app.traefik.me",
    suffix: "traefik.me",
    isActive: false,
  },
  {
    id: "ipq.co",
    label: "ipq.co",
    badge: "Alternative",
    description: "Configurable wildcard DNS mapping service pointing to your local machine.",
    status: "active",
    example: "my-app.127.0.0.1.ipq.co",
    suffix: "ipq.co",
    isActive: false,
  },
  {
    id: "fdns.uk",
    label: "fdns.uk",
    badge: "Fast",
    description: "Magic wildcard domain resolving to any target IP address.",
    status: "active",
    example: "my-app.127.0.0.1.fdns.uk",
    suffix: "fdns.uk",
    isActive: false,
  },
  {
    id: "localhost",
    label: ".localhost",
    badge: "Offline / Native",
    description: "RFC 6761 browser-native loopback domain without external DNS dependency.",
    status: "active",
    example: "my-app.localhost",
    suffix: "localhost",
    isActive: false,
  },
];

export function useMagicDnsSettings() {
  const eng = useEngine();
  const health = useEngineHealth();
  return useQuery<MagicDnsSettingsResponse>({
    queryKey: ["magic-dns-settings", eng.url, eng.token],
    queryFn: async () => {
      try {
        const res = await eng.call<MagicDnsSettingsResponse>("GET", "/api/settings/magic-dns");
        if (res && res.providers) return res;
      } catch {}
      return {
        activeProvider: "sslip.io",
        activeHostFormat: "app-name.127-0-0-1.sslip.io",
        providers: FALLBACK_MAGIC_DNS_PROVIDERS,
      };
    },
    enabled: !!health.data?.ok,
    refetchInterval: 8000,
  });
}

export function formatMagicDnsUrl(projectName: string, providerId: string = "sslip.io", port?: number) {
  const p = projectName.toLowerCase();
  let host = `${p}.127-0-0-1.sslip.io`;
  if (providerId === "nip.io") host = `${p}.127.0.0.1.nip.io`;
  else if (providerId === "traefik.me") host = `${p}.traefik.me`;
  else if (providerId === "ipq.co") host = `${p}.127.0.0.1.ipq.co`;
  else if (providerId === "fdns.uk") host = `${p}.127.0.0.1.fdns.uk`;
  else if (providerId === "localhost") host = `${p}.localhost`;
  else if (providerId === "sslip.io") host = `${p}.127-0-0-1.sslip.io`;

  return port ? `${host}:${port}` : host;
}
