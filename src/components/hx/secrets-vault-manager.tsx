import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEngine } from "@/lib/engine";
import {
  parseDotEnv,
  exportToDotEnv,
  generateSecureSecret,
  isLikelySecretKey,
  detectSecretCategory,
  PRESET_SECRET_GROUPS,
  type SecretGroup,
  type VaultSecret,
} from "@/utils/secrets-vault";
import {
  KeyRound,
  ShieldCheck,
  Plus,
  Copy,
  Check,
  Download,
  Upload,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  Sparkles,
  Lock,
  Globe,
  Database,
  CreditCard,
  Mail,
  SlidersHorizontal,
  ChevronRight,
  Info,
  FolderSync,
} from "lucide-react";

const CATEGORY_ICONS: Record<string, any> = {
  database: Database,
  api_key: KeyRound,
  auth: Lock,
  payment: CreditCard,
  email: Mail,
  general: SlidersHorizontal,
};

const ENV_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  production: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/30" },
  staging: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30" },
  development: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30" },
  global: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
};

export function SecretsVaultManager() {
  const engine = useEngine();

  // Load projects to allow attaching secret groups
  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ["projects-for-vault", engine.url],
    queryFn: async () => {
      try {
        const data = await engine.call<any[]>("GET", "/api/projects");
        return data || [];
      } catch {
        return [];
      }
    },
  });

  const [groups, setGroups] = useState<SecretGroup[]>(() => {
    try {
      const saved = localStorage.getItem("hx_vault_groups");
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return [];
  });

  const saveGroups = (updated: SecretGroup[]) => {
    setGroups(updated);
    try {
      localStorage.setItem("hx_vault_groups", JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const [selectedGroupId, setSelectedGroupId] = useState<string>(groups[0]?.id || "");
  const [envFilter, setEnvFilter] = useState<string>("all");
  const [revealedSecretIds, setRevealedSecretIds] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Modals
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importDotEnvText, setImportDotEnvText] = useState("");
  const [isGenModalOpen, setIsGenModalOpen] = useState(false);
  const [genSecretType, setGenSecretType] = useState<
    "hex64" | "base64" | "alphanumeric32" | "uuid"
  >("hex64");
  const [generatedResult, setGeneratedResult] = useState<string>(() =>
    generateSecureSecret("hex64"),
  );
  const [targetSecretIdForGen, setTargetSecretIdForGen] = useState<string | null>(null);

  // Create Group Modal
  const [isCreateGroupModalOpen, setIsCreateGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [newGroupEnv, setNewGroupEnv] = useState<SecretGroup["environment"]>("production");

  const [isSyncing, setIsSyncing] = useState(false);

  const activeGroup = groups.find((g) => g.id === selectedGroupId) || groups[0];

  const filteredGroups = groups.filter((g) =>
    envFilter === "all" ? true : g.environment === envFilter,
  );

  const toggleRevealSecret = (id: string) => {
    const next = new Set(revealedSecretIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setRevealedSecretIds(next);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    toast.success(`Copied ${label} to clipboard!`);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const updateActiveGroup = (patch: Partial<SecretGroup>) => {
    if (!activeGroup) return;
    const next = groups.map((g) =>
      g.id === activeGroup.id ? { ...g, ...patch, updatedAt: Date.now() } : g,
    );
    saveGroups(next);
  };

  const addSecretRow = () => {
    if (!activeGroup) return;
    const newSecret: VaultSecret = {
      id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      key: "",
      value: "",
      isSecret: true,
      category: "general",
      updatedAt: Date.now(),
    };
    updateActiveGroup({ secrets: [...activeGroup.secrets, newSecret] });
  };

  const updateSecretRow = (secretId: string, patch: Partial<VaultSecret>) => {
    if (!activeGroup) return;
    const nextSecrets = activeGroup.secrets.map((s) => {
      if (s.id !== secretId) return s;
      const updated = { ...s, ...patch, updatedAt: Date.now() };
      if (patch.key !== undefined) {
        updated.isSecret = isLikelySecretKey(patch.key);
        updated.category = detectSecretCategory(patch.key);
      }
      return updated;
    });
    updateActiveGroup({ secrets: nextSecrets });
  };

  const removeSecretRow = (secretId: string) => {
    if (!activeGroup) return;
    updateActiveGroup({ secrets: activeGroup.secrets.filter((s) => s.id !== secretId) });
  };

  const deleteGroup = (groupId: string) => {
    if (!confirm("Are you sure you want to delete this secret group?")) return;
    const next = groups.filter((g) => g.id !== groupId);
    saveGroups(next);
    if (selectedGroupId === groupId && next.length > 0) {
      setSelectedGroupId(next[0].id);
    }
    toast.info("Secret group deleted");
  };

  const handleImportDotEnv = () => {
    if (!importDotEnvText.trim()) return toast.error("Paste your .env contents first");
    const parsed = parseDotEnv(importDotEnvText);
    if (parsed.length === 0) return toast.error("No valid KEY=VALUE pairs found");

    updateActiveGroup({ secrets: [...activeGroup.secrets, ...parsed] });
    setIsImportModalOpen(false);
    setImportDotEnvText("");
    toast.success(`Imported ${parsed.length} variables into "${activeGroup.name}"`);
  };

  const handleExportDotEnv = (masked = false) => {
    if (!activeGroup) return;
    const dotEnv = exportToDotEnv(activeGroup.secrets, masked);
    const blob = new Blob([dotEnv], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeGroup.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}${masked ? ".masked" : ""}.env`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded .env (${masked ? "Masked" : "Unmasked"})`);
  };

  const handleSyncToProjects = async () => {
    if (!activeGroup) return;
    if (activeGroup.attachedProjects.length === 0) {
      return toast.info("No projects attached to this group. Select projects below to sync.");
    }

    setIsSyncing(true);
    const toastId = toast.loading(
      `Syncing secrets to ${activeGroup.attachedProjects.length} projects...`,
    );

    const upserts = activeGroup.secrets
      .filter((s) => s.key.trim().length > 0)
      .map((s) => ({
        key: s.key.trim(),
        value: s.value,
        isSecret: s.isSecret,
      }));

    let successCount = 0;
    for (const proj of activeGroup.attachedProjects) {
      try {
        await engine.call("POST", `/api/projects/${proj}/env`, { upserts });
        successCount++;
      } catch {
        // continue
      }
    }

    setIsSyncing(false);
    toast.success(`Synced ${upserts.length} secrets to ${successCount} projects!`, { id: toastId });
  };

  const toggleProjectAttachment = (projectName: string) => {
    if (!activeGroup) return;
    const isAttached = activeGroup.attachedProjects.includes(projectName);
    const next = isAttached
      ? activeGroup.attachedProjects.filter((p) => p !== projectName)
      : [...activeGroup.attachedProjects, projectName];
    updateActiveGroup({ attachedProjects: next });
  };

  const handleCreateGroup = () => {
    if (!newGroupName.trim()) return toast.error("Enter a group name");
    const newGroup: SecretGroup = {
      id: `grp-${Date.now().toString(36)}`,
      name: newGroupName.trim(),
      description: newGroupDesc.trim() || "Encrypted environment variables group",
      environment: newGroupEnv,
      secrets: [],
      attachedProjects: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const next = [...groups, newGroup];
    saveGroups(next);
    setSelectedGroupId(newGroup.id);
    setIsCreateGroupModalOpen(false);
    setNewGroupName("");
    setNewGroupDesc("");
    toast.success(`Created secret group "${newGroup.name}"`);
  };

  const handleApplyGeneratedSecret = () => {
    if (targetSecretIdForGen) {
      updateSecretRow(targetSecretIdForGen, { value: generatedResult });
      toast.success("Injected generated secret into row");
    } else {
      copyToClipboard(generatedResult, "generated secret");
    }
    setIsGenModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl border border-border/80 bg-card/70 backdrop-blur shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              Secrets Vault & Encrypted Groups
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                AES-256 GCM
              </span>
            </h2>
            <p className="text-xs text-muted-foreground">
              Centralized secret management, shared environment groups, cryptographic generators,
              and 1-click project sync.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setTargetSecretIdForGen(null);
              setGeneratedResult(generateSecureSecret(genSecretType));
              setIsGenModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-accent text-foreground transition-all"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Generate Secret</span>
          </button>

          <button
            onClick={() => setIsCreateGroupModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.99] transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>New Secret Group</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Left Groups Sidebar (4/12) + Right Group Inspector (8/12) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Groups Catalog (4/12) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Secret Groups ({groups.length})
            </span>

            {/* Environment Filters */}
            <select
              value={envFilter}
              onChange={(e) => setEnvFilter(e.target.value)}
              className="text-xs bg-surface border border-border rounded-lg px-2 py-1 text-muted-foreground outline-none"
            >
              <option value="all">All Envs</option>
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="development">Development</option>
              <option value="global">Global</option>
            </select>
          </div>

          <div className="space-y-2.5">
            {filteredGroups.length === 0 ? (
              <div className="p-8 rounded-xl border border-dashed border-border/80 bg-card/40 text-center space-y-3">
                <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center mx-auto text-muted-foreground">
                  <KeyRound className="w-5 h-5 opacity-60" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-foreground">No secret groups found</p>
                  <p className="text-[11px] text-muted-foreground">
                    Create a group or import a .env file to organize encrypted secrets.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreateGroupModalOpen(true)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-all inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Group</span>
                </button>
              </div>
            ) : (
              filteredGroups.map((grp) => {
                const isSelected = grp.id === selectedGroupId;
                const envMeta = ENV_COLORS[grp.environment] || ENV_COLORS.global;
                const secretCount = grp.secrets.filter((s) => s.isSecret).length;

                return (
                  <div
                    key={grp.id}
                    onClick={() => setSelectedGroupId(grp.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer relative ${
                      isSelected
                        ? "bg-card border-primary shadow-md ring-1 ring-primary/40"
                        : "bg-card/50 border-border hover:bg-card hover:border-border/80"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-sm text-foreground">{grp.name}</h4>
                          <span
                            className={`text-[9px] uppercase font-bold px-1.5 py-0.2 rounded ${envMeta.bg} ${envMeta.text}`}
                          >
                            {grp.environment}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {grp.description}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteGroup(grp.id);
                        }}
                        className="text-muted-foreground/60 hover:text-rose-400 p-1 rounded hover:bg-rose-500/10 transition-all"
                        title="Delete group"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="mt-3 pt-2 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-mono text-[11px]">
                        {grp.secrets.length} vars ({secretCount} locked)
                      </span>
                      <span className="text-[11px] flex items-center gap-1 text-primary font-medium">
                        <FolderSync className="w-3 h-3" />
                        {grp.attachedProjects.length} project
                        {grp.attachedProjects.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Group Inspector & Variables Table (8/12) */}
        <div className="lg:col-span-8">
          {activeGroup ? (
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6">
              {/* Header Inspector */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-foreground">{activeGroup.name}</h3>
                    <span
                      className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                        ENV_COLORS[activeGroup.environment]?.bg
                      } ${ENV_COLORS[activeGroup.environment]?.text}`}
                    >
                      {activeGroup.environment}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{activeGroup.description}</p>
                </div>

                {/* Toolbar */}
                <div className="flex items-center flex-wrap gap-2">
                  <button
                    onClick={addSecretRow}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Variable</span>
                  </button>

                  <button
                    onClick={() => setIsImportModalOpen(true)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-accent text-foreground transition-all"
                  >
                    <Upload className="w-3.5 h-3.5 text-primary" />
                    <span>Import .env</span>
                  </button>

                  <button
                    onClick={() => handleExportDotEnv(false)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-accent text-foreground transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export</span>
                  </button>

                  <button
                    onClick={handleSyncToProjects}
                    disabled={isSyncing || activeGroup.attachedProjects.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-50 transition-all"
                  >
                    <FolderSync className="w-3.5 h-3.5" />
                    <span>{isSyncing ? "Syncing..." : "Sync Projects"}</span>
                  </button>
                </div>
              </div>

              {/* Secrets Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold px-1">
                  <span>VARIABLE NAME</span>
                  <span>VALUE & SECURITY</span>
                </div>

                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                  {activeGroup.secrets.map((secret) => {
                    const isRevealed = revealedSecretIds.has(secret.id);
                    const CatIcon =
                      CATEGORY_ICONS[secret.category || "general"] || SlidersHorizontal;

                    return (
                      <div
                        key={secret.id}
                        className="flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 rounded-xl border border-border/70 bg-surface/40 hover:bg-surface/70 transition-all"
                      >
                        {/* Key Name Input */}
                        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                          <CatIcon className="w-4 h-4 text-muted-foreground/70 flex-shrink-0" />
                          <input
                            value={secret.key}
                            onChange={(e) => updateSecretRow(secret.id, { key: e.target.value })}
                            placeholder="KEY_NAME"
                            className="w-full px-2.5 py-1 text-xs font-mono font-semibold bg-card border border-border rounded-lg outline-none focus:border-primary text-foreground"
                          />
                        </div>

                        {/* Value Input + Masking Controls */}
                        <div className="flex items-center gap-1.5 flex-[1.5]">
                          <div className="relative flex-1">
                            <input
                              type={secret.isSecret && !isRevealed ? "password" : "text"}
                              value={secret.value}
                              onChange={(e) =>
                                updateSecretRow(secret.id, { value: e.target.value })
                              }
                              placeholder="value or ${OTHER_VAR}"
                              className="w-full px-2.5 py-1 pr-14 text-xs font-mono bg-card border border-border rounded-lg outline-none focus:border-primary text-foreground"
                            />
                            {secret.isSecret && (
                              <button
                                type="button"
                                onClick={() => toggleRevealSecret(secret.id)}
                                className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground p-0.5"
                                title={isRevealed ? "Hide secret" : "Reveal secret"}
                              >
                                {isRevealed ? (
                                  <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>

                          {/* Quick Generator Trigger */}
                          <button
                            type="button"
                            onClick={() => {
                              setTargetSecretIdForGen(secret.id);
                              setGeneratedResult(generateSecureSecret("hex64"));
                              setIsGenModalOpen(true);
                            }}
                            className="p-1 rounded bg-card border border-border text-muted-foreground hover:text-amber-400"
                            title="Generate cryptographically secure value"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                          </button>

                          {/* Copy */}
                          <button
                            type="button"
                            onClick={() => copyToClipboard(secret.value, secret.key || "value")}
                            className="p-1 rounded bg-card border border-border text-muted-foreground hover:text-foreground"
                            title="Copy value"
                          >
                            {copiedKey === (secret.key || "value") ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Delete */}
                          <button
                            type="button"
                            onClick={() => removeSecretRow(secret.id)}
                            className="p-1 rounded text-muted-foreground/60 hover:text-rose-400 hover:bg-rose-500/10"
                            title="Delete secret"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {activeGroup.secrets.length === 0 && (
                    <div className="p-8 rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground">
                      No variables defined in this group yet. Click &quot;Add Variable&quot; or
                      &quot;Import .env&quot; above.
                    </div>
                  )}
                </div>
              </div>

              {/* Connected Projects Bar */}
              <div className="pt-4 border-t border-border/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground/90">
                    Sync to Projects ({activeGroup.attachedProjects.length} attached)
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Click a project to attach/detach this secret group
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {projects.map((p) => {
                    const isAttached = activeGroup.attachedProjects.includes(p.name);
                    return (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => toggleProjectAttachment(p.name)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${
                          isAttached
                            ? "bg-primary text-primary-foreground font-bold shadow-sm"
                            : "bg-surface border border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <span>{isAttached ? "✓" : "+"}</span>
                        <span>{p.name}</span>
                      </button>
                    );
                  })}
                  {projects.length === 0 && (
                    <span className="text-xs text-muted-foreground italic">
                      No deployed projects found. Variables will sync automatically once projects
                      are created.
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground">
              Select or create a secret group on the left to inspect its variables.
            </div>
          )}
        </div>
      </div>

      {/* Import .env Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Upload className="w-4 h-4 text-primary" />
                Import Variables from .env
              </h3>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              Paste standard .env file contents below. Keys containing SECRET, PASS, or KEY are
              automatically marked as encrypted secrets.
            </p>

            <textarea
              rows={8}
              value={importDotEnvText}
              onChange={(e) => setImportDotEnvText(e.target.value)}
              placeholder={`PORT=3000\nDATABASE_URL=postgres://...\nJWT_SECRET=superSecret`}
              className="w-full px-3 py-2 font-mono text-xs bg-surface border border-border rounded-xl outline-none focus:border-primary text-foreground resize-none"
            />

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportDotEnv}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-all shadow-sm"
              >
                Parse & Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generate Cryptographic Secret Modal */}
      {isGenModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Cryptographic Secret Generator
              </h3>
              <button
                onClick={() => setIsGenModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-muted-foreground block mb-1">
                  Secret Format
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setGenSecretType("hex64");
                      setGeneratedResult(generateSecureSecret("hex64"));
                    }}
                    className={`p-2 rounded-lg border text-left font-mono text-[11px] ${
                      genSecretType === "hex64"
                        ? "bg-primary/10 border-primary text-primary font-bold"
                        : "bg-surface border-border text-muted-foreground"
                    }`}
                  >
                    64-char Hex (JWT / Key)
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setGenSecretType("alphanumeric32");
                      setGeneratedResult(generateSecureSecret("alphanumeric32"));
                    }}
                    className={`p-2 rounded-lg border text-left font-mono text-[11px] ${
                      genSecretType === "alphanumeric32"
                        ? "bg-primary/10 border-primary text-primary font-bold"
                        : "bg-surface border-border text-muted-foreground"
                    }`}
                  >
                    32-char Alphanumeric (DB)
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setGenSecretType("uuid");
                      setGeneratedResult(generateSecureSecret("uuid"));
                    }}
                    className={`p-2 rounded-lg border text-left font-mono text-[11px] ${
                      genSecretType === "uuid"
                        ? "bg-primary/10 border-primary text-primary font-bold"
                        : "bg-surface border-border text-muted-foreground"
                    }`}
                  >
                    UUIDv4 RFC4122
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setGenSecretType("base64");
                      setGeneratedResult(generateSecureSecret("base64"));
                    }}
                    className={`p-2 rounded-lg border text-left font-mono text-[11px] ${
                      genSecretType === "base64"
                        ? "bg-primary/10 border-primary text-primary font-bold"
                        : "bg-surface border-border text-muted-foreground"
                    }`}
                  >
                    Base64 URL-safe
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-muted-foreground">Generated Value</label>
                  <button
                    type="button"
                    onClick={() => setGeneratedResult(generateSecureSecret(genSecretType))}
                    className="flex items-center gap-1 text-primary hover:underline text-[11px]"
                  >
                    <RefreshCw className="w-3 h-3" /> Regenerate
                  </button>
                </div>
                <div className="p-3 rounded-xl border border-border bg-[#0d1117] font-mono text-xs text-foreground/90 break-all select-all shadow-inner">
                  {generatedResult}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIsGenModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyGeneratedSecret}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-all shadow-sm"
              >
                {targetSecretIdForGen ? "Apply to Variable" : "Copy to Clipboard"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {isCreateGroupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">Create Secret Group</h3>
              <button
                onClick={() => setIsCreateGroupModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-muted-foreground block mb-1">Group Name</label>
                <input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g. Stripe & Payment Gateways"
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg outline-none focus:border-primary text-foreground text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-muted-foreground block mb-1">
                  Description
                </label>
                <input
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  placeholder="e.g. Shared billing credentials across checkout and portal"
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg outline-none focus:border-primary text-foreground text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-muted-foreground block mb-1">
                  Target Environment
                </label>
                <select
                  value={newGroupEnv}
                  onChange={(e) => setNewGroupEnv(e.target.value as any)}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg outline-none focus:border-primary text-foreground text-xs"
                >
                  <option value="production">Production</option>
                  <option value="staging">Staging</option>
                  <option value="development">Development</option>
                  <option value="global">Global (All Envs)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIsCreateGroupModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateGroup}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-all shadow-sm"
              >
                Create Group
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
