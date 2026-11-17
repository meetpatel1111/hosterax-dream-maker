// hosterax/engine/src/buildpacks.mjs
// Pure Pluggable Build Pack planner & validator for HosteraX.

export const VALID_BUILD_PACKS = [
  "auto",
  "universal",
  "nixpacks",
  "railpack",
  "buildpacks",
  "dockerfile",
  "compose",
];

export const BUILD_PACK_METADATA = {
  auto: {
    id: "auto",
    label: "Auto-Detect",
    description: "Uses repository Dockerfile if present, otherwise HosteraX Universal multi-stage build.",
  },
  universal: {
    id: "universal",
    label: "HosteraX Universal",
    description: "Zero-config multi-stage Dockerfile generator for Node, Python, Go, Rust, Ruby, PHP & Java.",
  },
  nixpacks: {
    id: "nixpacks",
    label: "Nixpacks",
    description: "Deterministic Nixpacks builder (falls back to Universal build if nixpacks CLI is absent).",
  },
  railpack: {
    id: "railpack",
    label: "Railpack",
    description: "Next-gen BuildKit Railpack builder (falls back to Universal build if railpack CLI is absent).",
  },
  buildpacks: {
    id: "buildpacks",
    label: "Cloud Native Buildpacks",
    description: "CNCF Paketo builder via `pack` CLI (falls back to Universal build if `pack` CLI is absent).",
  },
  dockerfile: {
    id: "dockerfile",
    label: "Dockerfile",
    description: "Strict repository Dockerfile build (fails explicitly if no Dockerfile exists).",
  },
  compose: {
    id: "compose",
    label: "Docker Compose",
    description: "Multi-container build & orchestration via repository docker-compose.yml.",
  },
};

export function normalizeBuildPack(raw) {
  const clean = String(raw || "auto")
    .trim()
    .toLowerCase();
  if (clean === "paketo" || clean === "cnb") return "buildpacks";
  if (clean === "docker-compose") return "compose";
  return VALID_BUILD_PACKS.includes(clean) ? clean : "auto";
}

export function isValidBuildPack(raw) {
  const clean = String(raw || "")
    .trim()
    .toLowerCase();
  return (
    VALID_BUILD_PACKS.includes(clean) ||
    clean === "paketo" ||
    clean === "cnb" ||
    clean === "docker-compose"
  );
}

/**
 * Computes how HosteraX should build a repository for the requested build pack.
 */
export function planBuildPackExecution({
  builder = "auto",
  hasDockerfile = false,
  hasCompose = false,
  tag = "hosterax/app:latest",
}) {
  const pack = normalizeBuildPack(builder);

  if (pack === "compose" || (pack === "auto" && hasCompose && !hasDockerfile)) {
    return {
      builder: pack,
      mode: "compose",
      toolBinary: null,
      toolArgs: [],
      requiresExistingDockerfile: false,
      allowFallbackToUniversal: false,
    };
  }

  if (pack === "dockerfile") {
    return {
      builder: pack,
      mode: "dockerfile",
      toolBinary: null,
      toolArgs: [],
      requiresExistingDockerfile: true,
      allowFallbackToUniversal: false,
    };
  }

  if (pack === "nixpacks") {
    return {
      builder: pack,
      mode: "external-builder",
      toolBinary: "nixpacks",
      toolArgs: ["build", ".", "--name", tag],
      requiresExistingDockerfile: false,
      allowFallbackToUniversal: true,
    };
  }

  if (pack === "railpack") {
    return {
      builder: pack,
      mode: "external-builder",
      toolBinary: "railpack",
      toolArgs: ["build", ".", "--name", tag],
      requiresExistingDockerfile: false,
      allowFallbackToUniversal: true,
    };
  }

  if (pack === "buildpacks") {
    return {
      builder: pack,
      mode: "external-builder",
      toolBinary: "pack",
      toolArgs: ["build", tag, "--builder", "paketobuildpacks/builder-jammy-base", "--path", "."],
      requiresExistingDockerfile: false,
      allowFallbackToUniversal: true,
    };
  }

  if (pack === "universal") {
    return {
      builder: pack,
      mode: "universal",
      toolBinary: null,
      toolArgs: [],
      requiresExistingDockerfile: false,
      allowFallbackToUniversal: true,
    };
  }

  // auto
  return {
    builder: "auto",
    mode: hasDockerfile ? "dockerfile" : "universal",
    toolBinary: null,
    toolArgs: [],
    requiresExistingDockerfile: false,
    allowFallbackToUniversal: true,
  };
}
