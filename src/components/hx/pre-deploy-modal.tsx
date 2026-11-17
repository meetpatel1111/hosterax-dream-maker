import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Database,
  Eye,
  EyeOff,
  Globe,
  HardDrive,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useEngine, useEngineHealth } from "@/lib/engine";
import {
  applyDomainToUrlEnvRows,
  buildConnectionEnvForDb,
  buildFallbackDependencyAnalysis,
  buildMagicDomainHost,
  DependencyAnalysisResult,
  deriveProjectNameFromImage,
  EditableEnvRow,
  generateRandomSecret,
  isSecretKey,
  ManagedDbEngine,
  parseEnvPaste,
  sanitizeDatabaseName,
  sanitizeProjectSlug,
  toEditableEnvRows,
} from "@/utils/dependency-analyzer";

export interface PreDeployTarget {
  image: string;
  name: string;
  slug?: string;
  port?: number;
  env?: Record<string, string>;
  sourceUrl?: string;
  website?: string;
  imageVerified?: boolean;
  trigger?: string;
}

const DB_OPTIONS: Array<{ id: ManagedDbEngine; label: string }> = [
  { id: "postgres", label: "PostgreSQL" },
  { id: "redis", label: "Redis" },
  { id: "mysql", label: "MySQL" },
  { id: "mariadb", label: "MariaDB" },
  { id: "mongodb", label: "MongoDB" },
  { id: "clickhouse", label: "ClickHouse" },
  { id: "libsql", label: "LibSQL" },
];

const DB_LABEL_MAP = new Map<ManagedDbEngine, string>(DB_OPTIONS.map((d) => [d.id, d.label]));

const SAMPLE_PREVIEW_URIS: Record<ManagedDbEngine, string> = {
  postgres: "postgresql://hosterax:secret@host.docker.internal:5432/app",
  redis: "redis://:secret@host.docker.internal:6379",
  mysql: "mysql://hosterax:secret@host.docker.internal:3306/app",
  mariadb: "mariadb://hosterax:secret@host.docker.internal:3306/app",
  mongodb: "mongodb://hosterax:secret@host.docker.internal:27017/app",
  clickhouse: "http://hosterax:secret@host.docker.internal:8123/default",
  libsql: "http://host.docker.internal:8080",
};

export function PreDeployModal({
  target,
  onClose,
  onDeployed,
}: {
  target: PreDeployTarget | null;
  onClose: () => void;
  onDeployed: (projectSlug: string) => void;
}) {
  const eng = useEngine();
  const { data: health } = useEngineHealth();

  const [projectName, setProjectName] = useState("");
  const [port, setPort] = useState<number>(3000);
  const portEditedRef = useRef(false);
  const [customDomain, setCustomDomain] = useState("");
  const customDomainRef = useRef("");
  const [magicHostFormat, setMagicHostFormat] = useState("");
  const magicHostFormatRef = useRef("");
  const lastAutoDomainRef = useRef("");

  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<DependencyAnalysisResult | null>(null);

  const [envRows, setEnvRows] = useState<EditableEnvRow[]>([]);
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [selectedDbs, setSelectedDbs] = useState<Record<ManagedDbEngine, boolean>>({
    postgres: false,
    redis: false,
    mysql: false,
    mariadb: false,
    mongodb: false,
    clickhouse: false,
    libsql: false,
  });

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [deployStage, setDeployStage] = useState<string>("");

  customDomainRef.current = customDomain;

  useEffect(() => {
    if (!target) return;

    const initialSlug = target.slug
      ? sanitizeProjectSlug(target.slug)
      : deriveProjectNameFromImage(target.image);
    setProjectName(initialSlug);
    setPort(target.port || 3000);
    portEditedRef.current = false;
    setCustomDomain("");
    customDomainRef.current = "";
    lastAutoDomainRef.current = "";
    setRevealedIds({});
    setPasteOpen(false);
    setPasteText("");
    setAnalysisError(null);

    const fallback = buildFallbackDependencyAnalysis({
      image: target.image,
      appName: target.name,
      presetEnv: target.env || {},
      presetPort: target.port || 3000,
      imageVerified: target.imageVerified !== false,
    });
    setAnalysis(fallback);
    setEnvRows(toEditableEnvRows(fallback));
    setSelectedDbs({
      postgres: false,
      redis: false,
      mysql: false,
      mariadb: false,
      mongodb: false,
      clickhouse: false,
      libsql: false,
    });

    if (!health?.ok) return;

    let cancelled = false;
    setAnalyzing(true);

    eng
      .call<{ activeHostFormat?: string }>("GET", "/api/settings/magic-dns")
      .then((dnsRes) => {
        if (cancelled) return;
        const fmt = dnsRes?.activeHostFormat || "";
        magicHostFormatRef.current = fmt;
        setMagicHostFormat(fmt);
        const host = buildMagicDomainHost(initialSlug, fmt);
        if (host) {
          const prevAutoHost = lastAutoDomainRef.current;
          lastAutoDomainRef.current = host;
          setEnvRows((prev) => applyDomainToUrlEnvRows(prev, host, prevAutoHost));
        }
      })
      .catch(() => {});

    eng
      .call<DependencyAnalysisResult>("POST", "/api/catalog/analyze-dependencies", {
        image: target.image,
        name: target.name,
        slug: target.slug,
        sourceUrl: target.sourceUrl || "",
        website: target.website || "",
        presetEnv: target.env || {},
        presetPort: target.port,
        imageVerified: target.imageVerified !== false,
      })
      .then((res) => {
        if (cancelled) return;
        setAnalysis(res);
        const baseRows = toEditableEnvRows(res);
        const effectiveHost =
          customDomainRef.current.trim() ||
          lastAutoDomainRef.current ||
          buildMagicDomainHost(initialSlug, magicHostFormatRef.current);
        setEnvRows(effectiveHost ? applyDomainToUrlEnvRows(baseRows, effectiveHost) : baseRows);
        if (res.detectedPort && !portEditedRef.current) {
          setPort(res.detectedPort);
        }
        const autoDbs: Record<ManagedDbEngine, boolean> = {
          postgres: false,
          redis: false,
          mysql: false,
          mariadb: false,
          mongodb: false,
          clickhouse: false,
          libsql: false,
        };
        for (const d of res.databases || []) {
          if (d.recommended) autoDbs[d.engine] = true;
        }
        setSelectedDbs(autoDbs);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setAnalysisError(err?.message || "Live image dependency scan unavailable");
      })
      .finally(() => {
        if (!cancelled) setAnalyzing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [target, health?.ok, eng]);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deploying) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [target, deploying, onClose]);

  const detectedDbMap = useMemo(() => {
    const map = new Map<ManagedDbEngine, { reason: string; envKey?: string; confidence: string }>();
    for (const d of analysis?.databases || []) {
      map.set(d.engine, { reason: d.reason, envKey: d.envKey, confidence: d.confidence });
    }
    return map;
  }, [analysis]);

  const autoInjectedKeyToDb = useMemo(() => {
    const map = new Map<string, ManagedDbEngine>();
    const existingKeys = envRows.map((r) => r.key.trim()).filter(Boolean);
    for (const opt of DB_OPTIONS) {
      if (!selectedDbs[opt.id]) continue;
      const preview = buildConnectionEnvForDb({
        engine: opt.id,
        internalConnectionString: SAMPLE_PREVIEW_URIS[opt.id],
        existingKeys,
        preferredEnvKey: detectedDbMap.get(opt.id)?.envKey,
        imageHint: target?.image,
      });
      for (const k of Object.keys(preview)) {
        map.set(k.toUpperCase(), opt.id);
      }
    }
    return map;
  }, [envRows, selectedDbs, detectedDbMap, target?.image]);

  const missingRequiredKeys = useMemo(() => {
    return envRows.filter((row) => {
      const k = row.key.trim();
      if (!k || !row.required || row.value.trim()) return false;
      if (autoInjectedKeyToDb.has(k.toUpperCase())) return false;
      return true;
    });
  }, [envRows, autoInjectedKeyToDb]);

  const emptySecretRows = useMemo(
    () =>
      envRows.filter(
        (row) =>
          row.key.trim() &&
          row.secret &&
          !row.value.trim() &&
          !autoInjectedKeyToDb.has(row.key.trim().toUpperCase()),
      ),
    [envRows, autoInjectedKeyToDb],
  );

  const magicPreviewHost = useMemo(
    () => buildMagicDomainHost(projectName || target?.slug || "app", magicHostFormat),
    [projectName, target?.slug, magicHostFormat],
  );

  if (!target) return null;

  async function reAnalyze() {
    if (!target || !health?.ok) return;
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await eng.call<DependencyAnalysisResult>(
        "POST",
        "/api/catalog/analyze-dependencies",
        {
          image: target.image,
          name: target.name,
          slug: target.slug,
          sourceUrl: target.sourceUrl || "",
          website: target.website || "",
          presetEnv: target.env || {},
          presetPort: target.port,
          imageVerified: target.imageVerified !== false,
        },
      );
      setAnalysis(res);
      const baseRows = toEditableEnvRows(res);
      const effectiveHost = customDomain.trim() || magicPreviewHost;
      setEnvRows(effectiveHost ? applyDomainToUrlEnvRows(baseRows, effectiveHost) : baseRows);
      if (!portEditedRef.current && res.detectedPort) setPort(res.detectedPort);
      const autoDbs: Record<ManagedDbEngine, boolean> = {
        postgres: false,
        redis: false,
        mysql: false,
        mariadb: false,
        mongodb: false,
        clickhouse: false,
        libsql: false,
      };
      for (const d of res.databases || []) {
        if (d.recommended) autoDbs[d.engine] = true;
      }
      setSelectedDbs(autoDbs);
    } catch (err: any) {
      setAnalysisError(err?.message || "Failed to re-scan image dependencies");
    } finally {
      setAnalyzing(false);
    }
  }

  function generateAllMissingSecrets() {
    if (emptySecretRows.length === 0) return;
    const revealed: Record<string, boolean> = {};
    const targetIds = new Set(emptySecretRows.map((r) => r.id));
    setEnvRows((prev) =>
      prev.map((row) => {
        if (!targetIds.has(row.id)) return row;
        revealed[row.id] = true;
        return { ...row, value: generateRandomSecret(24) };
      }),
    );
    setRevealedIds((prev) => ({ ...prev, ...revealed }));
    toast.success(`Generated ${emptySecretRows.length} cryptographic secret(s)`);
  }

  function updateEnvRow(id: string, patch: Partial<EditableEnvRow>) {
    setEnvRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const nextKey = patch.key !== undefined ? patch.key : r.key;
        return {
          ...r,
          ...patch,
          secret: patch.secret !== undefined ? patch.secret : r.secret || isSecretKey(nextKey),
        };
      }),
    );
  }

  function addEnvRow() {
    setEnvRows((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        key: "",
        value: "",
        required: false,
        secret: false,
        source: "custom",
      },
    ]);
  }

  function removeEnvRow(id: string) {
    setEnvRows((prev) => prev.filter((r) => r.id !== id));
  }

  function applyPastedEnv() {
    const parsed = parseEnvPaste(pasteText);
    if (parsed.length === 0) {
      toast.error("No valid KEY=VALUE pairs found");
      return;
    }
    setEnvRows((prev) => {
      const next = [...prev];
      for (const item of parsed) {
        const idx = next.findIndex((r) => r.key.toUpperCase() === item.key.toUpperCase());
        if (idx >= 0) {
          next[idx] = { ...next[idx], value: item.value, secret: item.secret || next[idx].secret };
        } else {
          next.push({
            id: `paste-${Date.now()}-${item.key}`,
            key: item.key,
            value: item.value,
            required: false,
            secret: item.secret,
            source: "custom",
          });
        }
      }
      return next;
    });
    setPasteText("");
    setPasteOpen(false);
    toast.success(`Imported ${parsed.length} variable(s)`);
  }

  async function handleDeploy() {
    if (!target) return;
    if (!health?.ok) {
      toast.error("HosteraX Engine must be connected to deploy");
      return;
    }
    const cleanSlug = sanitizeProjectSlug(projectName);
    if (!cleanSlug) {
      toast.error("Please enter a valid project name");
      return;
    }

    const activeEnv: Record<string, string> = {};
    const configuredKeys: string[] = [];
    for (const row of envRows) {
      const k = row.key.trim();
      if (!k) continue;
      configuredKeys.push(k);
      if (row.value !== "") {
        activeEnv[k] = row.value;
      }
    }

    const chosenDbs = DB_OPTIONS.filter((d) => selectedDbs[d.id]).map((d) => d.id);

    setDeploying(true);
    try {
      setDeployStage("Creating project…");
      try {
        await eng.call(
          "POST",
          "/api/projects",
          {
            name: cleanSlug,
            source: target.image,
            buildCmd: "",
            startCmd: "",
            target: "docker",
            port: Number(port) || 3000,
            env: activeEnv,
          },
          { suppressStatuses: [409] },
        );
      } catch (createErr: any) {
        const msg = String(createErr?.message || "");
        if (createErr?.status !== 409 && !/409|already exists/i.test(msg)) {
          throw createErr;
        }
        const envUpserts = Object.entries(activeEnv).map(([key, value]) => ({
          key,
          value,
          isSecret: isSecretKey(key),
        }));
        if (envUpserts.length > 0) {
          await eng.call("PATCH", `/api/projects/${encodeURIComponent(cleanSlug)}/env`, {
            upserts: envUpserts,
            environment: "production",
          });
        }
      }

      if (chosenDbs.length > 0) {
        const dbUpserts: Array<{ key: string; value: string; isSecret: boolean }> = [];
        for (const dbEngine of chosenDbs) {
          setDeployStage(`Provisioning ${dbEngine} database…`);
          const primaryDbName = sanitizeDatabaseName(cleanSlug, dbEngine);
          let dbRes: {
            ok?: boolean;
            internal_connection_string?: string;
            connection_string?: string;
          };
          try {
            dbRes = await eng.call(
              "POST",
              `/api/projects/${encodeURIComponent(cleanSlug)}/databases`,
              {
                name: primaryDbName,
                engine: dbEngine,
                size_mb: 1024,
              },
              { suppressStatuses: [409] },
            );
          } catch (dbErr: any) {
            const dbMsg = String(dbErr?.message || "");
            if (dbErr?.status !== 409 && !/409|already exists/i.test(dbMsg)) {
              throw dbErr;
            }
            const fallbackDbName = sanitizeDatabaseName(
              cleanSlug,
              dbEngine,
              Math.random().toString(36).slice(2, 6),
            );
            dbRes = await eng.call(
              "POST",
              `/api/projects/${encodeURIComponent(cleanSlug)}/databases`,
              {
                name: fallbackDbName,
                engine: dbEngine,
                size_mb: 1024,
              },
            );
          }
          const connUri = dbRes?.internal_connection_string || dbRes?.connection_string || "";
          if (connUri) {
            const dbMeta = detectedDbMap.get(dbEngine);
            const injected = buildConnectionEnvForDb({
              engine: dbEngine,
              internalConnectionString: connUri,
              existingKeys: configuredKeys,
              preferredEnvKey: dbMeta?.envKey,
              imageHint: target.image,
            });
            for (const [k, v] of Object.entries(injected)) {
              dbUpserts.push({ key: k, value: v, isSecret: isSecretKey(k) });
            }
          }
        }
        if (dbUpserts.length > 0) {
          setDeployStage("Injecting database credentials…");
          await eng.call("PATCH", `/api/projects/${encodeURIComponent(cleanSlug)}/env`, {
            upserts: dbUpserts,
            environment: "production",
          });
        }
      }

      const cleanCustomHost = customDomain
        .trim()
        .replace(/^https?:\/\//i, "")
        .replace(/\/+$/, "");
      if (cleanCustomHost) {
        setDeployStage("Binding custom domain…");
        try {
          await eng.call(
            "POST",
            `/api/projects/${encodeURIComponent(cleanSlug)}/domains`,
            { hostname: cleanCustomHost },
            { suppressStatuses: [409] },
          );
        } catch {}
      }

      setDeployStage("Queueing container deployment…");
      await eng.call("POST", `/api/projects/${encodeURIComponent(cleanSlug)}/deploy`, {
        trigger: target.trigger || "one-click",
      });

      toast.success(`"${target.name}" deployment queued with ${chosenDbs.length} attached DB(s)`);
      onDeployed(cleanSlug);
    } catch (err: any) {
      toast.error(err?.message || `Failed to deploy ${target.name}`);
    } finally {
      setDeploying(false);
      setDeployStage("");
    }
  }

  const sourcesLabel =
    analysis?.sourcesChecked && analysis.sourcesChecked.length > 0
      ? analysis.sourcesChecked
          .map((s) =>
            s === "curated-catalog"
              ? "Curated preset"
              : s === "curated-blueprint"
                ? "Curated blueprint"
                : s === "oci-image"
                  ? "OCI manifest"
                  : s === "dockerhub-readme"
                    ? "Docker Hub README"
                    : s === "github-compose"
                      ? "GitHub Compose"
                      : s === "github-env-example"
                        ? "GitHub .env.example"
                        : s,
          )
          .join(" · ")
      : "Default container configuration";

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pre-deploy-title"
    >
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border">
          <div className="min-w-0">
            <h2
              id="pre-deploy-title"
              className="text-base font-semibold tracking-tight text-foreground truncate"
            >
              Configure & Deploy {target.name}
            </h2>
            <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate">
              {target.image}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={deploying}
            aria-label="Close deployment configuration"
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Dependency Scan Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border/70 text-xs">
            <div className="flex items-center gap-2 text-muted-foreground min-w-0">
              {analyzing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                  <span>
                    Scanning OCI manifest, Docker Hub README, and upstream Compose / .env.example…
                  </span>
                </>
              ) : (
                <>
                  <Search className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="truncate">
                    Inspected:{" "}
                    <strong className="text-foreground font-medium">{sourcesLabel}</strong>
                  </span>
                </>
              )}
            </div>
            {health?.ok && (
              <button
                type="button"
                onClick={reAnalyze}
                disabled={analyzing || deploying}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-surface disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`h-3 w-3 ${analyzing ? "animate-spin" : ""}`} />
                <span>Re-scan</span>
              </button>
            )}
          </div>

          {/* Warnings */}
          {analysisError && (
            <div
              role="status"
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200 flex items-start gap-2"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
              <span>
                Live dependency scan skipped ({analysisError}). You can still configure variables
                and databases manually below.
              </span>
            </div>
          )}

          {analysis?.warnings && analysis.warnings.length > 0 && (
            <div className="space-y-2">
              {analysis.warnings.map((w, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200 flex items-start gap-2"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Project Name, Port & Public Domain */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label
                  htmlFor="predeploy-project-name"
                  className="block text-xs font-medium text-muted-foreground mb-1.5"
                >
                  Project Name
                </label>
                <input
                  id="predeploy-project-name"
                  type="text"
                  value={projectName}
                  onChange={(e) => {
                    const next = e.target.value;
                    setProjectName(next);
                    if (!customDomain.trim() && magicHostFormat) {
                      const nextMagic = buildMagicDomainHost(next, magicHostFormat);
                      if (nextMagic) {
                        const prevAutoHost = lastAutoDomainRef.current;
                        lastAutoDomainRef.current = nextMagic;
                        setEnvRows((prev) =>
                          applyDomainToUrlEnvRows(prev, nextMagic, prevAutoHost),
                        );
                      }
                    }
                  }}
                  placeholder="my-app"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-surface font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label
                  htmlFor="predeploy-port"
                  className="block text-xs font-medium text-muted-foreground mb-1.5"
                >
                  Container Port
                </label>
                <input
                  id="predeploy-port"
                  type="number"
                  value={port}
                  onChange={(e) => {
                    setPort(Number(e.target.value));
                    portEditedRef.current = true;
                  }}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-surface font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {analysis?.exposedPorts && analysis.exposedPorts.length > 1 && (
                  <p className="text-[11px] text-muted-foreground font-mono tabular-nums mt-1">
                    Exposed: {analysis.exposedPorts.join(", ")}
                  </p>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor="predeploy-domain"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
                >
                  <Globe className="h-3.5 w-3.5 text-primary" />
                  <span>Public Domain (optional — auto-fills URL variables)</span>
                </label>
                {magicPreviewHost && !customDomain.trim() && (
                  <span className="text-[11px] font-mono text-muted-foreground truncate max-w-[240px]">
                    Magic DNS: {magicPreviewHost}
                  </span>
                )}
              </div>
              <input
                id="predeploy-domain"
                type="text"
                value={customDomain}
                onChange={(e) => {
                  const nextDomain = e.target.value;
                  setCustomDomain(nextDomain);
                  const targetHost = nextDomain.trim() || magicPreviewHost;
                  if (targetHost) {
                    const prevAutoHost = lastAutoDomainRef.current;
                    lastAutoDomainRef.current = targetHost;
                    setEnvRows((prev) => applyDomainToUrlEnvRows(prev, targetHost, prevAutoHost));
                  }
                }}
                placeholder={magicPreviewHost || "app.example.com"}
                className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-surface font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Companion Databases */}
          <div className="space-y-2.5 pt-2 border-t border-border/70">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Companion Databases</h3>
              </div>
              <span className="text-xs text-muted-foreground">
                Auto-injects <span className="font-mono">host.docker.internal</span> connection
                strings
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DB_OPTIONS.map((opt) => {
                const detected = detectedDbMap.get(opt.id);
                const checked = selectedDbs[opt.id];
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => setSelectedDbs((prev) => ({ ...prev, [opt.id]: !prev[opt.id] }))}
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      checked
                        ? "border-primary bg-primary/15 text-foreground"
                        : detected
                          ? "border-amber-500/50 bg-amber-500/5 text-foreground hover:bg-surface"
                          : "border-border bg-surface/50 text-muted-foreground hover:text-foreground hover:bg-surface"
                    }`}
                  >
                    <span className="whitespace-nowrap">{opt.label}</span>
                    {checked ? (
                      <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                    ) : detected ? (
                      <span className="text-[10px] font-medium text-amber-400 shrink-0">
                        Detected
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {analysis?.databases && analysis.databases.length > 0 && (
              <div className="text-xs text-muted-foreground space-y-1 pt-1">
                {analysis.databases.map((d) => (
                  <div key={d.engine}>
                    <span className="font-medium text-foreground">
                      {DB_LABEL_MAP.get(d.engine) ?? d.engine}
                    </span>
                    {" — "}
                    {d.reason}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Environment Variables */}
          <div className="space-y-3 pt-2 border-t border-border/70">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">
                  Environment Variables{" "}
                  <span className="text-xs font-mono tabular-nums font-normal text-muted-foreground">
                    ({envRows.filter((r) => r.key.trim()).length})
                  </span>
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {emptySecretRows.length > 0 && (
                  <button
                    type="button"
                    onClick={generateAllMissingSecrets}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-primary/40 bg-primary/10 text-xs font-medium text-primary hover:bg-primary/20 whitespace-nowrap"
                  >
                    <Sparkles className="h-3 w-3" />
                    <span>Generate Missing Secrets ({emptySecretRows.length})</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPasteOpen((p) => !p)}
                  className="px-2.5 py-1 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-surface whitespace-nowrap"
                >
                  Paste .env
                </button>
                <button
                  type="button"
                  onClick={addEnvRow}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-xs font-medium text-foreground hover:bg-surface whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Variable</span>
                </button>
              </div>
            </div>

            {missingRequiredKeys.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Missing required value(s):{" "}
                <span className="font-mono font-semibold">
                  {missingRequiredKeys.map((k) => k.key).join(", ")}
                </span>
              </div>
            )}

            {pasteOpen && (
              <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
                <label
                  htmlFor="predeploy-paste-env"
                  className="block text-xs font-medium text-muted-foreground"
                >
                  Paste KEY=VALUE lines
                </label>
                <textarea
                  id="predeploy-paste-env"
                  rows={3}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={"JWT_SECRET=...\nAPP_URL=https://example.com"}
                  className="w-full rounded-md border border-input bg-card px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPasteOpen(false)}
                    className="px-3 py-1 text-xs rounded-md border border-border hover:bg-card"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={applyPastedEnv}
                    className="px-3 py-1 text-xs rounded-md bg-primary text-primary-foreground font-medium"
                  >
                    Import Variables
                  </button>
                </div>
              </div>
            )}

            {envRows.length === 0 ? (
              <div className="py-4 px-3 rounded-lg border border-dashed border-border text-center text-xs text-muted-foreground">
                No environment variables discovered for this image. Click{" "}
                <strong>Add Variable</strong> or <strong>Paste .env</strong> if the app expects
                custom settings.
              </div>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border bg-surface/30">
                {envRows.map((row) => {
                  const autoDb = row.key.trim()
                    ? autoInjectedKeyToDb.get(row.key.trim().toUpperCase())
                    : undefined;
                  const isMissing = row.required && !row.value.trim() && !autoDb;
                  const isHidden = row.secret && !revealedIds[row.id];
                  return (
                    <div key={row.id} className="p-2.5 space-y-1.5">
                      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                        <input
                          type="text"
                          aria-label="Variable name"
                          value={row.key}
                          onChange={(e) =>
                            updateEnvRow(row.id, {
                              key: e.target.value.replace(/[^A-Za-z0-9_.-]/g, ""),
                            })
                          }
                          placeholder="KEY_NAME"
                          className="w-full sm:w-56 px-2.5 py-1.5 text-xs font-mono rounded-md border border-input bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                        />

                        <div className="relative flex-1 min-w-[160px] flex items-center gap-1.5">
                          <input
                            type={isHidden ? "password" : "text"}
                            aria-label={`Value for ${row.key || "variable"}`}
                            value={row.value}
                            onChange={(e) => updateEnvRow(row.id, { value: e.target.value })}
                            placeholder={
                              autoDb
                                ? `Auto-injected by ${DB_LABEL_MAP.get(autoDb) ?? autoDb} (optional override)`
                                : row.required
                                  ? "Required value"
                                  : "Value (optional)"
                            }
                            className={`w-full px-2.5 py-1.5 text-xs font-mono rounded-md border bg-card focus:outline-none focus:ring-1 focus:ring-primary ${
                              isMissing
                                ? "border-amber-500/70"
                                : autoDb && !row.value.trim()
                                  ? "border-primary/40"
                                  : "border-input"
                            }`}
                          />
                          {row.secret && (
                            <button
                              type="button"
                              aria-label={
                                isHidden ? `Show value for ${row.key}` : `Hide value for ${row.key}`
                              }
                              onClick={() =>
                                setRevealedIds((prev) => ({ ...prev, [row.id]: !prev[row.id] }))
                              }
                              className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground bg-card"
                              title={isHidden ? "Show value" : "Hide value"}
                            >
                              {isHidden ? (
                                <Eye className="h-3.5 w-3.5" />
                              ) : (
                                <EyeOff className="h-3.5 w-3.5" />
                              )}
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {row.secret && (
                            <button
                              type="button"
                              aria-label={`Generate random secret for ${row.key || "variable"}`}
                              onClick={() => {
                                updateEnvRow(row.id, { value: generateRandomSecret(24) });
                                setRevealedIds((prev) => ({ ...prev, [row.id]: true }));
                              }}
                              className="px-2 py-1.5 rounded-md border border-border bg-card text-[11px] font-medium text-foreground hover:bg-surface whitespace-nowrap"
                            >
                              Generate
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={`Remove variable ${row.key || "row"}`}
                            onClick={() => removeEnvRow(row.id)}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-card"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {(row.description || isMissing || autoDb || row.source) && (
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground px-0.5">
                          {autoDb && !row.value.trim() ? (
                            <>
                              <span className="font-medium text-primary">
                                Auto-injected by {DB_LABEL_MAP.get(autoDb) ?? autoDb}
                              </span>
                              <span aria-hidden="true">·</span>
                            </>
                          ) : isMissing ? (
                            <>
                              <span className="font-medium text-amber-400">Required</span>
                              <span aria-hidden="true">·</span>
                            </>
                          ) : null}
                          <span>Source: {row.source}</span>
                          {row.description && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="truncate max-w-md">{row.description}</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Persistent Volumes */}
          {analysis?.volumes && analysis.volumes.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-border/70">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">
                  Persistent Volumes{" "}
                  <span className="text-xs font-mono tabular-nums font-normal text-muted-foreground">
                    ({analysis.volumes.length})
                  </span>
                </h3>
              </div>
              <div className="text-xs font-mono text-muted-foreground space-y-1">
                {analysis.volumes.map((v) => (
                  <div
                    key={v}
                    className="flex items-center justify-between gap-2 py-1 border-b border-border/40 last:border-0"
                  >
                    <span className="text-foreground truncate">{v}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      Auto-mounted Docker volume
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-border bg-surface/40">
          <div className="text-xs text-muted-foreground">
            {deploying && deployStage ? (
              <span className="inline-flex items-center gap-2 text-foreground font-medium">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span>{deployStage}</span>
              </span>
            ) : (
              <span>
                Will launch on{" "}
                <span className="font-mono text-foreground">
                  {sanitizeProjectSlug(projectName) || "app"}
                </span>
                {Object.values(selectedDbs).some(Boolean)
                  ? ` + ${DB_OPTIONS.filter((d) => selectedDbs[d.id])
                      .map((d) => d.label)
                      .join(", ")}`
                  : ""}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={deploying}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-border hover:bg-surface disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeploy}
              disabled={deploying || !projectName.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
            >
              {deploying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Rocket className="h-3.5 w-3.5" />
              )}
              <span>{deploying ? "Deploying…" : "Deploy Application"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
