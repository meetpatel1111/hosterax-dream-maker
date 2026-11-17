export type BuildPackId =
  "auto" | "universal" | "nixpacks" | "railpack" | "buildpacks" | "dockerfile" | "compose";

export interface BuildPackOption {
  id: BuildPackId;
  label: string;
  badge: string;
  description: string;
}

export const BUILD_PACK_OPTIONS: BuildPackOption[] = [
  {
    id: "auto",
    label: "Auto-Detect",
    badge: "Recommended",
    description: "Use Dockerfile or Compose if present, otherwise synthesize Universal image.",
  },
  {
    id: "universal",
    label: "Universal Builder",
    badge: "Built-in",
    description: "Multi-stage language detection (Node, Python, Go, Rust, Ruby, PHP, Java).",
  },
  {
    id: "nixpacks",
    label: "Nixpacks",
    badge: "Coolify/Dokploy",
    description: "Reproducible Nixpacks plan with automatic fallback to Universal if CLI absent.",
  },
  {
    id: "railpack",
    label: "Railpack",
    badge: "Next-Gen",
    description: "Fast layer-cached Railpack builder with zero-config framework detection.",
  },
  {
    id: "buildpacks",
    label: "Cloud Native Buildpacks",
    badge: "Paketo",
    description: "OCI Buildpacks via `pack` CLI for Heroku/CNCF-style builds.",
  },
  {
    id: "dockerfile",
    label: "Custom Dockerfile",
    badge: "Strict",
    description: "Build strictly from the repository's Dockerfile (fails if missing).",
  },
  {
    id: "compose",
    label: "Docker Compose",
    badge: "Multi-Container",
    description: "Orchestrate multi-service stacks from docker-compose.yml.",
  },
];

export function clampReplicas(n: unknown): number {
  const parsed = Number(n);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(10, Math.round(parsed));
}

export function normalizePlacementNodes(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of nodes) {
    const clean = String(item || "").trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}
