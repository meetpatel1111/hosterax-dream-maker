import { useState, useMemo } from "react";
import {
  generateDockerComposeYaml,
  parseDockerComposeYaml,
  validateComposeStack,
  detectDependencyGraph,
  detectServiceCategory,
  extractMagicVariables,
  resolveStackMagicVariables,
  buildStackDeploymentPlan,
  PRESET_STACKS,
  type ComposeStack,
  type ComposeService,
  type ServiceCategory,
} from "@/utils/compose-builder";
import { toast } from "sonner";
import { useEngine, useMagicDnsSettings, formatMagicDnsUrl } from "@/lib/engine";
import { isLikelySecretEnvKey } from "@/utils/env-parser";
import { Link } from "@tanstack/react-router";
import {
  Boxes,
  Plus,
  Trash2,
  Copy,
  Check,
  Download,
  Rocket,
  Code2,
  Network,
  LayoutGrid,
  Database,
  Cpu,
  Layers,
  ArrowRight,
  Globe,
  HardDrive,
  Key,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
  RefreshCw,
  Info,
  Search,
} from "lucide-react";

interface VisualStackBuilderProps {
  initialStack?: ComposeStack;
  onDeploySuccess?: (stackName: string) => void;
}

const CATEGORY_COLORS: Record<
  ServiceCategory,
  { bg: string; text: string; border: string; icon: any }
> = {
  frontend: {
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/30",
    icon: Globe,
  },
  backend: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
    icon: Cpu,
  },
  database: {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/30",
    icon: Database,
  },
  cache: {
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    border: "border-rose-500/30",
    icon: Layers,
  },
  worker: {
    bg: "bg-purple-500/10",
    text: "text-purple-400",
    border: "border-purple-500/30",
    icon: HardDrive,
  },
  other: {
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    border: "border-slate-500/30",
    icon: Boxes,
  },
};

const COMMON_SERVICE_PRESETS = [
  { name: "web", category: "frontend" as const, image: "node:22-alpine", port: 3000 },
  { name: "api", category: "backend" as const, image: "node:22-alpine", port: 4000 },
  { name: "postgres", category: "database" as const, image: "postgres:16-alpine", port: 5432 },
  { name: "redis", category: "cache" as const, image: "redis:7-alpine", port: 6379 },
  { name: "worker", category: "worker" as const, image: "python:3.11-slim", port: 0 },
  { name: "mysql", category: "database" as const, image: "mysql:8.0", port: 3306 },
  {
    name: "meilisearch",
    category: "backend" as const,
    image: "getmeili/meilisearch:v1.11",
    port: 7700,
  },
];

export function VisualStackBuilder({
  initialStack = PRESET_STACKS[0].stack,
  onDeploySuccess,
}: VisualStackBuilderProps) {
  const engine = useEngine();
  const { data: magicDns } = useMagicDnsSettings();

  const [stack, setStack] = useState<ComposeStack>(initialStack);
  const [viewMode, setViewMode] = useState<"visual" | "yaml" | "dag">("visual");
  const [yamlText, setYamlText] = useState<string>(() => generateDockerComposeYaml(initialStack));
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    initialStack.services[0]?.id || null,
  );
  const [copiedYaml, setCopiedYaml] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [magicOverrides, setMagicOverrides] = useState<Record<string, string>>({});
  const [deployedProjects, setDeployedProjects] = useState<
    { projectName: string; serviceName: string; status: "queued" | "warn"; note?: string }[]
  >([]);
  const [presetCategory, setPresetCategory] = useState<string>("all");
  const [presetSearch, setPresetSearch] = useState("");
  const [showAllPresets, setShowAllPresets] = useState(false);

  const presetCategories = useMemo(
    () => Array.from(new Set(PRESET_STACKS.map((p) => p.category))),
    [],
  );

  const filteredPresets = PRESET_STACKS.filter((p) => {
    const catOk = presetCategory === "all" || p.category === presetCategory;
    if (!catOk) return false;
    const q = presetSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.tagline.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  });
  const visiblePresets =
    showAllPresets || presetSearch.trim() || presetCategory !== "all"
      ? filteredPresets
      : filteredPresets.slice(0, 8);

  const activeHostFormat = useMemo(() => {
    return formatMagicDnsUrl("{name}", magicDns?.activeProvider || "sslip.io");
  }, [magicDns?.activeProvider]);

  const magicDescriptors = useMemo(() => extractMagicVariables(stack), [stack]);
  const magicPreview = useMemo(
    () =>
      resolveStackMagicVariables(stack, {
        magicHostFormat: activeHostFormat,
        overrides: magicOverrides,
      }),
    [stack, activeHostFormat, magicOverrides],
  );

  // Sync stack changes to YAML when in visual mode
  const updateStack = (newStack: ComposeStack) => {
    setStack(newStack);
    try {
      setYamlText(generateDockerComposeYaml(newStack));
      setYamlError(null);
    } catch {
      // ignore
    }
  };

  const handleYamlChange = (text: string) => {
    setYamlText(text);
    try {
      const parsed = parseDockerComposeYaml(text, stack.name);
      setStack(parsed);
      setYamlError(null);
    } catch (err: any) {
      setYamlError(err.message);
    }
  };

  const loadPreset = (presetId: string) => {
    const found = PRESET_STACKS.find((p) => p.id === presetId);
    if (!found) return;
    const cloned = JSON.parse(JSON.stringify(found.stack));
    updateStack(cloned);
    setSelectedServiceId(cloned.services[0]?.id || null);
    toast.success(`Loaded stack template: ${found.name}`);
  };

  const copyYaml = () => {
    const current = generateDockerComposeYaml(stack);
    navigator.clipboard.writeText(current);
    setCopiedYaml(true);
    toast.success("docker-compose.yml copied to clipboard!");
    setTimeout(() => setCopiedYaml(false), 2000);
  };

  const downloadYaml = () => {
    const current = generateDockerComposeYaml(stack);
    const blob = new Blob([current], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${stack.name || "docker-compose"}.yml`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${stack.name || "docker-compose"}.yml`);
  };

  const addService = (preset?: (typeof COMMON_SERVICE_PRESETS)[0]) => {
    const baseName = preset?.name || "service";
    let name = baseName;
    let counter = 1;
    while (stack.services.some((s) => s.name === name)) {
      name = `${baseName}-${counter++}`;
    }

    const newId = `svc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newService: ComposeService = {
      id: newId,
      name,
      image: preset?.image || "alpine:latest",
      category: preset ? preset.category : detectServiceCategory(name),
      ports: preset?.port ? [{ host: preset.port, container: preset.port }] : [],
      env: [],
      volumes: [],
      dependsOn: [],
      restartPolicy: "unless-stopped",
      isPublic: Boolean(
        preset?.port && (preset.category === "frontend" || preset.category === "backend"),
      ),
      publicDomain: `${name}.localhost`,
    };

    const nextServices = [...stack.services, newService];
    updateStack({ ...stack, services: nextServices });
    setSelectedServiceId(newId);
    toast.success(`Added service "${name}" to stack`);
  };

  const deleteService = (id: string) => {
    const toDelete = stack.services.find((s) => s.id === id);
    if (!toDelete) return;
    const delName = toDelete.name;

    const nextServices = stack.services
      .filter((s) => s.id !== id)
      .map((s) => ({
        ...s,
        dependsOn: s.dependsOn.filter((d) => d !== delName),
      }));

    updateStack({ ...stack, services: nextServices });
    if (selectedServiceId === id) {
      setSelectedServiceId(nextServices[0]?.id || null);
    }
    toast.info(`Removed service "${delName}"`);
  };

  const updateSelectedService = (patch: Partial<ComposeService>) => {
    if (!selectedServiceId) return;
    const nextServices = stack.services.map((s) =>
      s.id === selectedServiceId ? { ...s, ...patch } : s,
    );
    updateStack({ ...stack, services: nextServices });
  };

  const toggleDependency = (serviceId: string, targetName: string) => {
    const svc = stack.services.find((s) => s.id === serviceId);
    if (!svc) return;

    let nextDeps = [...svc.dependsOn];
    if (nextDeps.includes(targetName)) {
      nextDeps = nextDeps.filter((d) => d !== targetName);
    } else {
      nextDeps.push(targetName);
    }

    const nextServices = stack.services.map((s) =>
      s.id === serviceId ? { ...s, dependsOn: nextDeps } : s,
    );
    updateStack({ ...stack, services: nextServices });
  };

  const regenerateMagicSecrets = () => {
    const fresh = resolveStackMagicVariables(stack, { magicHostFormat: activeHostFormat });
    setMagicOverrides(fresh.resolvedVars);
    toast.success(`Generated ${Object.keys(fresh.resolvedVars).length} cryptographic magic values`);
  };

  const deployStack = async () => {
    const validation = validateComposeStack(stack);
    if (!validation.valid) {
      toast.error(`Cannot deploy stack: ${validation.errors[0]}`);
      return;
    }

    setIsDeploying(true);
    setDeployedProjects([]);
    const { plan, resolvedVars } = buildStackDeploymentPlan(stack, {
      magicHostFormat: activeHostFormat,
      overrides: magicOverrides,
    });
    // Persist resolved secrets in overrides so consecutive deploys reuse identical DB credentials
    setMagicOverrides(resolvedVars);

    const toastId = toast.loading(
      `Deploying stack "${stack.name}" across ${plan.length} services in dependency order...`,
    );

    const results: {
      projectName: string;
      serviceName: string;
      status: "queued" | "warn";
      note?: string;
    }[] = [];

    try {
      for (const svcPlan of plan) {
        const upserts = Object.entries(svcPlan.env).map(([k, v]) => ({
          key: k,
          value: v,
          isSecret: isLikelySecretEnvKey(k, v),
        }));
        const hasSecrets = upserts.some((u) => u.isSecret);
        let projectReady = false;
        try {
          await engine.call(
            "POST",
            "/api/projects",
            {
              name: svcPlan.projectName,
              source: svcPlan.image,
              target: "docker",
              port: svcPlan.port,
              env: svcPlan.env,
            },
            { suppressStatuses: [409] },
          );
          projectReady = true;
        } catch (createErr: any) {
          if (createErr?.status === 409) {
            projectReady = true;
          } else {
            results.push({
              projectName: svcPlan.projectName,
              serviceName: svcPlan.serviceName,
              status: "warn",
              note: createErr?.message || "Project registration failed",
            });
            continue;
          }
        }

        if (projectReady && upserts.length > 0 && hasSecrets) {
          await engine
            .call("PATCH", `/api/projects/${encodeURIComponent(svcPlan.projectName)}/env`, {
              environment: "production",
              upserts,
            })
            .catch(() => {});
        }

        if (svcPlan.cpuLimit !== null || svcPlan.memoryMbLimit !== null) {
          await engine
            .call(
              "POST",
              `/api/projects/${encodeURIComponent(svcPlan.projectName)}/quotas`,
              {
                cpu_limit: svcPlan.cpuLimit,
                memory_mb_limit: svcPlan.memoryMbLimit,
              },
              { suppressStatuses: [400, 404, 500] },
            )
            .catch(() => {});
        }

        if (svcPlan.customDomainToBind) {
          await engine
            .call(
              "POST",
              `/api/projects/${encodeURIComponent(svcPlan.projectName)}/domains`,
              { hostname: svcPlan.customDomainToBind },
              { suppressStatuses: [409, 400] },
            )
            .catch(() => {});
        }

        try {
          await engine.call(
            "POST",
            `/api/projects/${encodeURIComponent(svcPlan.projectName)}/deploy`,
            { trigger: "compose-stack" },
            { suppressStatuses: [400, 500] },
          );
          results.push({
            projectName: svcPlan.projectName,
            serviceName: svcPlan.serviceName,
            status: "queued",
          });
        } catch (depErr: any) {
          results.push({
            projectName: svcPlan.projectName,
            serviceName: svcPlan.serviceName,
            status: "warn",
            note: depErr?.message || "Deploy trigger returned warning",
          });
        }
      }

      setDeployedProjects(results);
      const queuedCount = results.filter((r) => r.status === "queued").length;
      const warnCount = results.length - queuedCount;
      if (warnCount === 0) {
        toast.success(
          `Stack "${stack.name}" queued (${queuedCount}/${results.length} services in DAG order)`,
          { id: toastId },
        );
      } else if (queuedCount > 0) {
        toast.warning(`Stack "${stack.name}": ${queuedCount} queued, ${warnCount} with warnings`, {
          id: toastId,
        });
      } else {
        toast.error(
          `Stack "${stack.name}" could not queue deployments: ${results[0]?.note || "Check engine"}`,
          { id: toastId },
        );
      }

      if (onDeploySuccess && queuedCount > 0) {
        onDeploySuccess(stack.name);
      }
    } catch (err: any) {
      toast.error(`Deploy error: ${err.message || "Failed to deploy stack"}`, { id: toastId });
    } finally {
      setIsDeploying(false);
    }
  };

  const validation = validateComposeStack(stack);
  const graph = detectDependencyGraph(stack);
  const activeService = stack.services.find((s) => s.id === selectedServiceId);

  return (
    <div className="space-y-6">
      {/* Top Banner & Searchable Preset Library */}
      <div className="space-y-4 p-5 rounded-2xl border border-border/80 bg-card/70 backdrop-blur shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground flex flex-wrap items-center gap-2">
                Visual Multi-Service Docker Compose Builder
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Compose Spec v3.8
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  {PRESET_STACKS.length} Blueprints
                </span>
              </h2>
              <p className="text-xs text-muted-foreground">
                Wire multi-container stacks, internal networking, persistent volumes, and
                auto-generate clean YAML.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative min-w-[220px] flex-1 sm:flex-none">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="Search Compose preset templates"
                value={presetSearch}
                onChange={(e) => setPresetSearch(e.target.value)}
                placeholder={`Search ${PRESET_STACKS.length} Compose stacks...`}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-surface text-xs text-foreground outline-none focus:border-primary"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowAllPresets((prev) => !prev)}
              className="px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-2 text-xs font-medium text-foreground whitespace-nowrap"
            >
              {showAllPresets ? "Show Top 8" : `Browse All (${PRESET_STACKS.length})`}
            </button>
          </div>
        </div>

        {/* Category Filter Strip */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setPresetCategory("all")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
              presetCategory === "all"
                ? "bg-primary text-primary-foreground font-semibold"
                : "bg-surface text-muted-foreground hover:text-foreground border border-border/60"
            }`}
          >
            All ({PRESET_STACKS.length})
          </button>
          {presetCategories.map((cat) => {
            const count = PRESET_STACKS.filter((p) => p.category === cat).length;
            if (count === 0) return null;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setPresetCategory(cat)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                  presetCategory === cat
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "bg-surface text-muted-foreground hover:text-foreground border border-border/60"
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>

        {/* Preset Cards Grid */}
        {visiblePresets.length === 0 ? (
          <div className="text-xs text-muted-foreground py-3 px-2">
            No Compose templates match "{presetSearch}".
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 max-h-[260px] overflow-y-auto pr-1">
            {visiblePresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => loadPreset(preset.id)}
                className="flex flex-col items-start text-left gap-1 p-2.5 rounded-xl border border-border/60 bg-surface hover:bg-primary/10 hover:border-primary/40 transition-all group"
              >
                <div className="flex items-center justify-between w-full gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground group-hover:text-primary truncate">
                    <span>{preset.icon}</span>
                    <span className="truncate">{preset.name}</span>
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                    {preset.stack.services.length} svc
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground line-clamp-1 w-full">
                  {preset.tagline}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Stack Controls & View Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Stack Name:
            </label>
            <input
              value={stack.name}
              onChange={(e) =>
                updateStack({
                  ...stack,
                  name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
                })
              }
              placeholder="e.g. acme-stack"
              className="px-2.5 py-1 text-sm font-semibold text-foreground bg-surface border border-border rounded-lg outline-none focus:border-primary font-mono"
            />
          </div>
          <span className="text-xs px-2 py-0.5 rounded-md bg-surface text-muted-foreground border border-border font-mono whitespace-nowrap">
            {stack.services.length} services
          </span>
        </div>

        {/* View Switcher Tabs & Primary Actions */}
        <div className="flex items-center flex-wrap gap-2">
          <div className="flex items-center rounded-lg border border-border bg-surface p-1">
            <button
              onClick={() => setViewMode("visual")}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
                viewMode === "visual"
                  ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Visual Composer</span>
            </button>
            <button
              onClick={() => setViewMode("yaml")}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
                viewMode === "yaml"
                  ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Compose YAML</span>
            </button>
            <button
              onClick={() => setViewMode("dag")}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
                viewMode === "dag"
                  ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>Boot Order DAG</span>
            </button>
          </div>

          <button
            onClick={copyYaml}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-accent text-foreground transition-all"
          >
            {copiedYaml ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span>{copiedYaml ? "Copied" : "Copy YAML"}</span>
          </button>

          <button
            onClick={downloadYaml}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-accent text-foreground transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>

          <button
            onClick={deployStack}
            disabled={isDeploying || !validation.valid}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.99] disabled:opacity-50 transition-all shadow-sm"
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>{isDeploying ? "Deploying Stack..." : "Deploy Stack"}</span>
          </button>
        </div>
      </div>

      {/* Validation Warning Alert if invalid */}
      {!validation.valid && (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-rose-400" />
          <div className="flex-1 font-medium">{validation.errors.join(" ")}</div>
        </div>
      )}

      {/* Deployed Services Result Strip */}
      {deployedProjects.length > 0 && (
        <div
          role="status"
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" />
              Stack Services Provisioned in Boot Order ({deployedProjects.length})
            </span>
            <Link to="/dashboard" className="text-primary hover:underline font-medium">
              Open Dashboard →
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {deployedProjects.map((dp) => (
              <Link
                key={dp.projectName}
                to="/p/$slug"
                params={{ slug: dp.projectName }}
                title={dp.note || `Inspect ${dp.projectName}`}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-mono text-[11px] transition-colors ${
                  dp.status === "queued"
                    ? "bg-card/80 border-emerald-500/30 text-foreground hover:border-primary"
                    : "bg-amber-500/10 border-amber-500/30 text-amber-300"
                }`}
              >
                <span>{dp.projectName}</span>
                <span className="text-[10px] opacity-75">
                  ({dp.status === "queued" ? "queued" : "warning"})
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Coolify-Compatible Magic Compose Variables Panel */}
      {magicDescriptors.length > 0 && (
        <div className="rounded-xl border border-border/80 bg-card/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-amber-400" />
              <div>
                <h3 className="text-xs font-bold text-foreground">
                  Magic Compose Variables ({magicDescriptors.length})
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Placeholders like{" "}
                  <span className="font-mono text-foreground/80">${"{SERVICE_PASSWORD_*}"}</span>{" "}
                  and <span className="font-mono text-foreground/80">${"{SERVICE_URL_*}"}</span>{" "}
                  stay synchronized across dependent services on deploy.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={regenerateMagicSecrets}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 text-xs font-semibold transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Generate Magic Secrets</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {magicDescriptors.map((desc) => {
              const currentVal =
                magicOverrides[desc.name] ?? magicPreview.resolvedVars[desc.name] ?? "";
              return (
                <div
                  key={desc.name}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border/70 bg-surface/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] font-semibold text-primary truncate">
                        {desc.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                        [{desc.services.join(", ")}]
                      </span>
                    </div>
                    <input
                      aria-label={`Value for ${desc.name}`}
                      value={magicOverrides[desc.name] ?? ""}
                      onChange={(e) =>
                        setMagicOverrides((prev) => ({ ...prev, [desc.name]: e.target.value }))
                      }
                      placeholder={
                        desc.kind === "url" || desc.kind === "fqdn" || desc.kind === "user"
                          ? `Auto: ${currentVal}`
                          : "Auto-generated on deploy (or enter custom)"
                      }
                      className="mt-1 w-full px-2 py-1 text-[11px] font-mono bg-background/60 border border-border/70 rounded outline-none focus:border-primary text-foreground"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* View Mode 1: Visual Topology Composer */}
      {viewMode === "visual" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Service Cards Column (5/12) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Services in Stack ({stack.services.length})
              </span>
              <div className="relative group">
                <button
                  type="button"
                  onClick={() => addService()}
                  className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Service</span>
                </button>
              </div>
            </div>

            {/* Quick Add Presets Bar */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                Quick add:
              </span>
              {COMMON_SERVICE_PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => addService(p)}
                  className="px-2 py-0.5 rounded bg-surface border border-border/80 hover:border-primary/40 text-[11px] font-mono text-muted-foreground hover:text-foreground whitespace-nowrap transition-all"
                >
                  +{p.name}
                </button>
              ))}
            </div>

            {/* Cards List */}
            <div className="space-y-2.5 max-h-[640px] overflow-y-auto pr-1">
              {stack.services.map((svc) => {
                const isSelected = svc.id === selectedServiceId;
                const cat = CATEGORY_COLORS[svc.category] || CATEGORY_COLORS.other;
                const Icon = cat.icon;

                return (
                  <div
                    key={svc.id}
                    onClick={() => setSelectedServiceId(svc.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer relative ${
                      isSelected
                        ? "bg-card border-primary shadow-md ring-1 ring-primary/40"
                        : "bg-card/50 border-border hover:bg-card hover:border-border/80"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center ${cat.bg} ${cat.text} ${cat.border} border`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-foreground font-mono">
                              {svc.name}
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.2 rounded uppercase ${cat.bg} ${cat.text}`}
                            >
                              {svc.category}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground font-mono truncate max-w-[220px]">
                            {svc.image ||
                              (svc.buildContext ? `build: ${svc.buildContext}` : "custom")}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteService(svc.id);
                        }}
                        aria-label={`Delete service ${svc.name}`}
                        className="text-muted-foreground/60 hover:text-rose-400 p-1 rounded hover:bg-rose-500/10 transition-all"
                        title={`Delete service ${svc.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Metadata Badges */}
                    <div className="mt-3 flex items-center flex-wrap gap-1.5 text-[11px]">
                      {svc.ports.map((p, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 rounded bg-surface border border-border font-mono text-muted-foreground"
                        >
                          :{p.host}➔:{p.container}
                        </span>
                      ))}

                      {svc.dependsOn.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-mono text-[10px]">
                          needs [{svc.dependsOn.join(", ")}]
                        </span>
                      )}

                      {svc.volumes.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-surface border border-border text-muted-foreground text-[10px]">
                          💾 {svc.volumes.length} vol
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Service Inspector Column (7/12) */}
          <div className="lg:col-span-7">
            {activeService ? (
              <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6">
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold">
                      {activeService.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-foreground font-mono">
                        {activeService.name}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Configure container runtime & network
                      </p>
                    </div>
                  </div>

                  <select
                    value={activeService.category}
                    onChange={(e) =>
                      updateSelectedService({ category: e.target.value as ServiceCategory })
                    }
                    className="text-xs bg-surface border border-border rounded-lg px-2.5 py-1.5 font-medium text-foreground outline-none"
                  >
                    <option value="frontend">Frontend Web</option>
                    <option value="backend">Backend API</option>
                    <option value="database">Database</option>
                    <option value="cache">Cache / Key-Value</option>
                    <option value="worker">Worker / Queue</option>
                    <option value="other">Other Service</option>
                  </select>
                </div>

                {/* Name & Image Fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-foreground/90 block mb-1">
                      Service Name
                    </label>
                    <input
                      value={activeService.name}
                      onChange={(e) =>
                        updateSelectedService({
                          name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
                        })
                      }
                      placeholder="e.g. web, api, db"
                      className="w-full px-3 py-2 text-xs font-mono bg-surface border border-border rounded-lg outline-none focus:border-primary text-foreground"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-foreground/90 block mb-1">
                      Docker Image
                    </label>
                    <input
                      value={activeService.image || ""}
                      onChange={(e) => updateSelectedService({ image: e.target.value })}
                      placeholder="e.g. postgres:16-alpine"
                      className="w-full px-3 py-2 text-xs font-mono bg-surface border border-border rounded-lg outline-none focus:border-primary text-foreground"
                    />
                  </div>
                </div>

                {/* Public Exposure, Domain & Runtime Limits */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3.5 rounded-xl border border-border/70 bg-surface/40">
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-foreground/90">
                        Public Routing & Domain
                      </label>
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(activeService.isPublic)}
                          onChange={(e) => updateSelectedService({ isPublic: e.target.checked })}
                        />
                        <span>Expose via Edge</span>
                      </label>
                    </div>
                    <input
                      value={activeService.publicDomain || ""}
                      disabled={!activeService.isPublic}
                      onChange={(e) => updateSelectedService({ publicDomain: e.target.value })}
                      placeholder={
                        activeService.isPublic
                          ? activeHostFormat.replace(
                              /\{name\}/g,
                              `${stack.name}-${activeService.name}`,
                            )
                          : "Internal-only service"
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-surface border border-border rounded-lg outline-none focus:border-primary text-foreground disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground/90 block mb-1">
                      CPU Limit
                    </label>
                    <input
                      value={activeService.cpuLimit || ""}
                      onChange={(e) => updateSelectedService({ cpuLimit: e.target.value })}
                      placeholder="e.g. 1.0"
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-surface border border-border rounded-lg outline-none focus:border-primary text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground/90 block mb-1">
                      Memory Limit
                    </label>
                    <input
                      value={activeService.memoryLimit || ""}
                      onChange={(e) => updateSelectedService({ memoryLimit: e.target.value })}
                      placeholder="e.g. 512m"
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-surface border border-border rounded-lg outline-none focus:border-primary text-foreground"
                    />
                  </div>
                </div>

                {/* Port Mappings */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground/90">
                      Port Mappings (Host : Container)
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        updateSelectedService({
                          ports: [...activeService.ports, { host: 8080, container: 8080 }],
                        })
                      }
                      className="text-[11px] font-semibold text-primary hover:underline"
                    >
                      + Add Port
                    </button>
                  </div>
                  {activeService.ports.map((p, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="number"
                        value={p.host}
                        onChange={(e) => {
                          const nextPorts = [...activeService.ports];
                          nextPorts[idx].host = Number(e.target.value);
                          updateSelectedService({ ports: nextPorts });
                        }}
                        placeholder="Host"
                        className="w-28 px-3 py-1.5 text-xs font-mono bg-surface border border-border rounded-lg outline-none text-foreground"
                      />
                      <span className="text-muted-foreground text-xs">:</span>
                      <input
                        type="number"
                        value={p.container}
                        onChange={(e) => {
                          const nextPorts = [...activeService.ports];
                          nextPorts[idx].container = Number(e.target.value);
                          updateSelectedService({ ports: nextPorts });
                        }}
                        placeholder="Container"
                        className="w-28 px-3 py-1.5 text-xs font-mono bg-surface border border-border rounded-lg outline-none text-foreground"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const nextPorts = activeService.ports.filter((_, i) => i !== idx);
                          updateSelectedService({ ports: nextPorts });
                        }}
                        className="text-xs text-rose-400 hover:bg-rose-500/10 px-2 py-1 rounded"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {activeService.ports.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      No host ports exposed (internal-only network service).
                    </p>
                  )}
                </div>

                {/* Dependencies (depends_on) */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-foreground/90 block">
                    Service Dependencies (<span className="font-mono">depends_on</span>)
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    Select containers that must start before{" "}
                    <span className="font-mono">{activeService.name}</span>.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {stack.services
                      .filter((s) => s.id !== activeService.id)
                      .map((otherSvc) => {
                        const isDep = activeService.dependsOn.includes(otherSvc.name);
                        return (
                          <button
                            key={otherSvc.id}
                            type="button"
                            onClick={() => toggleDependency(activeService.id, otherSvc.name)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${
                              isDep
                                ? "bg-primary text-primary-foreground font-bold shadow-sm"
                                : "bg-surface border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                            }`}
                          >
                            <span>{isDep ? "✓" : "+"}</span>
                            <span>{otherSvc.name}</span>
                          </button>
                        );
                      })}
                    {stack.services.length <= 1 && (
                      <span className="text-xs text-muted-foreground italic">
                        Add another service to set up container dependencies.
                      </span>
                    )}
                  </div>
                </div>

                {/* Environment Variables */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground/90">
                      Environment Variables
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        updateSelectedService({
                          env: [...activeService.env, { key: "", value: "" }],
                        })
                      }
                      className="text-[11px] font-semibold text-primary hover:underline"
                    >
                      + Add Variable
                    </button>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {activeService.env.map((row, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          value={row.key}
                          onChange={(e) => {
                            const next = [...activeService.env];
                            next[idx].key = e.target.value;
                            updateSelectedService({ env: next });
                          }}
                          placeholder="KEY_NAME"
                          className="flex-1 px-3 py-1.5 text-xs font-mono bg-surface border border-border rounded-lg outline-none text-foreground"
                        />
                        <input
                          value={row.value}
                          onChange={(e) => {
                            const next = [...activeService.env];
                            next[idx].value = e.target.value;
                            updateSelectedService({ env: next });
                          }}
                          placeholder="value"
                          className="flex-1 px-3 py-1.5 text-xs font-mono bg-surface border border-border rounded-lg outline-none text-foreground"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const next = activeService.env.filter((_, i) => i !== idx);
                            updateSelectedService({ env: next });
                          }}
                          className="text-xs text-rose-400 hover:bg-rose-500/10 px-2 py-1 rounded"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {activeService.env.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        No environment variables set.
                      </p>
                    )}
                  </div>
                </div>

                {/* Persistent Volumes */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground/90">
                      Persistent Volumes
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        updateSelectedService({
                          volumes: [
                            ...activeService.volumes,
                            {
                              hostPath: `${activeService.name}_data`,
                              containerPath: "/data",
                              mode: "rw",
                            },
                          ],
                        })
                      }
                      className="text-[11px] font-semibold text-primary hover:underline"
                    >
                      + Add Volume Mount
                    </button>
                  </div>
                  {activeService.volumes.map((v, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        value={v.hostPath}
                        onChange={(e) => {
                          const next = [...activeService.volumes];
                          next[idx].hostPath = e.target.value;
                          updateSelectedService({ volumes: next });
                        }}
                        placeholder="Volume / Host Path"
                        className="flex-1 px-3 py-1.5 text-xs font-mono bg-surface border border-border rounded-lg outline-none text-foreground"
                      />
                      <span className="text-muted-foreground text-xs">:</span>
                      <input
                        value={v.containerPath}
                        onChange={(e) => {
                          const next = [...activeService.volumes];
                          next[idx].containerPath = e.target.value;
                          updateSelectedService({ volumes: next });
                        }}
                        placeholder="Container Path"
                        className="flex-1 px-3 py-1.5 text-xs font-mono bg-surface border border-border rounded-lg outline-none text-foreground"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = activeService.volumes.filter((_, i) => i !== idx);
                          updateSelectedService({ volumes: next });
                        }}
                        className="text-xs text-rose-400 hover:bg-rose-500/10 px-2 py-1 rounded"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {activeService.volumes.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Ephemeral container (no mounted volume).
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-8 rounded-xl border border-dashed border-border text-center text-muted-foreground text-xs">
                Select a service on the left to inspect and configure its settings.
              </div>
            )}
          </div>
        </div>
      )}

      {/* View Mode 2: Bidirectional Compose YAML Editor */}
      {viewMode === "yaml" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground font-mono">
              Live bidirectional editing — edits here automatically update visual cards.
            </span>
            {yamlError && (
              <span className="text-rose-400 font-medium">⚠️ Syntax Error: {yamlError}</span>
            )}
          </div>
          <div className="relative rounded-xl border border-border bg-[#0d1117] p-4 font-mono text-xs shadow-inner">
            <textarea
              value={yamlText}
              onChange={(e) => handleYamlChange(e.target.value)}
              rows={22}
              className="w-full bg-transparent text-foreground/90 outline-none resize-y leading-relaxed font-mono"
              spellCheck={false}
            />
          </div>
        </div>
      )}

      {/* View Mode 3: Dependency DAG & Boot Order */}
      {viewMode === "dag" && (
        <div className="p-6 rounded-xl border border-border bg-card space-y-6">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Network className="w-4 h-4 text-primary" />
              Container Boot Order & Dependency Flow
            </h3>
            <p className="text-xs text-muted-foreground">
              HosteraX analyzes service dependencies to ensure database and cache instances are
              completely healthy before starting APIs and web clients.
            </p>
          </div>

          {graph.hasCycle ? (
            <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400" />
              <div>
                <span className="font-bold">Circular Dependency Detected:</span> A service cannot
                depend on another service that depends back on it! Please adjust{" "}
                <span className="font-mono">depends_on</span>.
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-xs font-semibold text-muted-foreground">
                Sequential Startup Pipeline:
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {graph.topologicalOrder.map((name, idx) => {
                  const svc = stack.services.find((s) => s.name === name);
                  const cat = svc ? CATEGORY_COLORS[svc.category] : CATEGORY_COLORS.other;

                  return (
                    <div key={name} className="flex items-center gap-3">
                      <div className="flex items-center gap-2 p-3 rounded-xl border border-border bg-surface shadow-sm">
                        <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <div className="font-mono font-bold text-xs text-foreground">{name}</div>
                        {svc && (
                          <span
                            className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${cat.bg} ${cat.text}`}
                          >
                            {svc.category}
                          </span>
                        )}
                      </div>
                      {idx < graph.topologicalOrder.length - 1 && (
                        <ArrowRight className="w-4 h-4 text-muted-foreground/60" />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Edge Connections List */}
              <div className="pt-4 border-t border-border/60">
                <span className="text-xs font-semibold text-muted-foreground block mb-2">
                  Dependency Wire Connections ({graph.edges.length}):
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {graph.edges.map((e, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg border border-border/60 bg-surface/50 text-xs font-mono flex items-center justify-between"
                    >
                      <span className="text-primary font-semibold">{e.from}</span>
                      <span className="text-muted-foreground text-[10px]">starts before</span>
                      <span className="text-foreground font-semibold">{e.to}</span>
                    </div>
                  ))}
                  {graph.edges.length === 0 && (
                    <span className="text-xs text-muted-foreground italic col-span-2">
                      All services in this stack have no explicit dependency ordering and will start
                      concurrently.
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
