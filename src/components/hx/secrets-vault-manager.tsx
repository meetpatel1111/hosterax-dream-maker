import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEngine, useActiveOrgId } from "@/lib/engine";
import { confirmAction } from "@/components/hx/confirm-modal";
import { appLogger } from "@/utils/app-logger";
import {
  parseDotEnv,
  exportToDotEnv,
  generateSecureSecret,
  isLikelySecretKey,
  detectSecretCategory,
} from "@/utils/secrets-vault";
import {
  KeyRound,
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
  Database,
  CreditCard,
  Mail,
  SlidersHorizontal,
  FolderSync,
  Save,
} from "lucide-react";

const CATEGORY_ICONS: Record<string, any> = {
  database: Database,
  api_key: KeyRound,
  auth: Lock,
  payment: CreditCard,
  email: Mail,
  general: SlidersHorizontal,
};

interface ApiVaultSecret {
  id: string;
  key: string;
  value: string;
  configured?: boolean;
  updatedAt: number;
}

interface ApiVaultGroup {
  id: string;
  orgId: string;
  name: string;
  description: string;
  linkedProjects: string[];
  syncMode: "manual" | "auto";
  lastSyncedAt: number | null;
  createdAt: number;
  updatedAt: number;
  secrets: ApiVaultSecret[];
}

interface EditableSecretRow {
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
  category: string;
  updatedAt: number;
  dirty?: boolean;
  masked?: boolean;
}

export function SecretsVaultManager() {
  const engine = useEngine();
  const orgId = useActiveOrgId();
  const qc = useQueryClient();

  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ["projects-for-vault", engine.url, orgId],
    queryFn: () => engine.call<any[]>("GET", "/api/projects"),
  });

  const { data: groups = [], isLoading } = useQuery<ApiVaultGroup[]>({
    queryKey: ["vault-groups", engine.url, engine.token, orgId],
    queryFn: () => engine.call<ApiVaultGroup[]>("GET", "/api/vault/groups"),
  });

  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [draftSecrets, setDraftSecrets] = useState<EditableSecretRow[]>([]);
  const [deletedKeys, setDeletedKeys] = useState<string[]>([]);
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

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

  const [isCreateGroupModalOpen, setIsCreateGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) || groups[0] || null,
    [groups, selectedGroupId],
  );

  // Keep local editable rows synced whenever the selected group loads or updates from server
  useEffect(() => {
    if (!activeGroup) {
      setDraftSecrets([]);
      setDeletedKeys([]);
      setHasUnsavedChanges(false);
      return;
    }
    setSelectedGroupId(activeGroup.id);
    setDraftSecrets(
      (activeGroup.secrets || []).map((s) => ({
        id: s.id,
        key: s.key,
        value: s.value,
        isSecret: isLikelySecretKey(s.key),
        category: detectSecretCategory(s.key) || "general",
        updatedAt: s.updatedAt,
        dirty: false,
        masked: s.value === "••••••••",
      })),
    );
    setDeletedKeys([]);
    setRevealedValues({});
    setHasUnsavedChanges(false);
  }, [activeGroup?.id, activeGroup?.updatedAt]);

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) || (g.description || "").toLowerCase().includes(q),
    );
  }, [groups, searchQuery]);

  const toggleRevealSecret = async (row: EditableSecretRow) => {
    if (!activeGroup) return;
    if (revealedValues[row.id] !== undefined) {
      setRevealedValues((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      return;
    }

    if (!row.masked && !row.dirty) {
      setRevealedValues((prev) => ({ ...prev, [row.id]: row.value }));
      return;
    }

    try {
      const revealed = await engine.call<Array<{ id: string; key: string; value: string }>>(
        "GET",
        `/api/vault/groups/${encodeURIComponent(activeGroup.id)}/reveal?key=${encodeURIComponent(row.key)}`,
      );
      const match = revealed.find((r) => r.key === row.key);
      if (match) {
        setRevealedValues((prev) => ({ ...prev, [row.id]: match.value }));
      }
    } catch {
      // handled by useEngine
    }
  };

  const copyToClipboard = async (row: EditableSecretRow) => {
    if (!activeGroup) return;
    let valueToCopy = revealedValues[row.id] ?? row.value;
    if (valueToCopy === "••••••••" && row.key) {
      try {
        const revealed = await engine.call<Array<{ id: string; key: string; value: string }>>(
          "GET",
          `/api/vault/groups/${encodeURIComponent(activeGroup.id)}/reveal?key=${encodeURIComponent(row.key)}`,
        );
        const match = revealed.find((r) => r.key === row.key);
        if (match) valueToCopy = match.value;
      } catch {
        return;
      }
    }
    await navigator.clipboard.writeText(valueToCopy);
    setCopiedKey(row.id);
    toast.success(`Copied ${row.key || "value"} to clipboard`);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const addSecretRow = () => {
    if (!activeGroup) return;
    const rowId = `tmp-${crypto.randomUUID()}`;
    setDraftSecrets((prev) => [
      ...prev,
      {
        id: rowId,
        key: "",
        value: "",
        isSecret: true,
        category: "general",
        updatedAt: Date.now(),
        dirty: true,
        masked: false,
      },
    ]);
    setHasUnsavedChanges(true);
  };

  const updateSecretRow = (secretId: string, patch: Partial<EditableSecretRow>) => {
    setDraftSecrets((prev) =>
      prev.map((s) => {
        if (s.id !== secretId) return s;
        const next: EditableSecretRow = {
          ...s,
          ...patch,
          dirty: true,
          masked: patch.value !== undefined ? false : s.masked,
          updatedAt: Date.now(),
        };
        if (patch.key !== undefined) {
          next.isSecret = isLikelySecretKey(patch.key);
          next.category = detectSecretCategory(patch.key) || "general";
        }
        return next;
      }),
    );
    setHasUnsavedChanges(true);
  };

  const removeSecretRow = async (row: EditableSecretRow) => {
    if (!activeGroup) return;
    const confirmed = await confirmAction({
      title: `Delete Secret "${row.key || "Variable"}"`,
      description: "Are you sure you want to remove this variable from the vault group?",
      variant: "destructive",
      confirmLabel: "Delete Variable",
    });
    if (!confirmed) return;
    setDraftSecrets((prev) => prev.filter((s) => s.id !== row.id));
    if (row.key && !row.id.startsWith("tmp-")) {
      setDeletedKeys((prev) => (prev.includes(row.key) ? prev : [...prev, row.key]));
    }
    setHasUnsavedChanges(true);
  };

  const handleSaveChanges = async () => {
    if (!activeGroup) return;
    setIsSaving(true);
    try {
      const upserts = draftSecrets
        .filter((s) => s.key.trim().length > 0 && (s.dirty || s.id.startsWith("tmp-")))
        .filter((s) => s.value !== "••••••••")
        .map((s) => ({ key: s.key.trim(), value: s.value }));

      await engine.call("PATCH", `/api/vault/groups/${encodeURIComponent(activeGroup.id)}`, {
        upserts,
        deletes: deletedKeys,
      });
      await qc.invalidateQueries({ queryKey: ["vault-groups"] });
      toast.success(`Saved encrypted variables for "${activeGroup.name}"`);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteGroup = async (group: ApiVaultGroup) => {
    const confirmed = await confirmAction({
      title: `Delete Secret Group "${group.name}"`,
      description:
        "Are you sure you want to delete this secret group from the encrypted vault?",
      variant: "destructive",
      confirmLabel: "Delete Group",
    });
    if (!confirmed) return;
    await engine.call("DELETE", `/api/vault/groups/${encodeURIComponent(group.id)}`);
    appLogger.logUi("Secret Group Deleted", `Deleted secret group ${group.name}`);
    toast.success(`Deleted secret group "${group.name}"`);
    await qc.invalidateQueries({ queryKey: ["vault-groups"] });
  };

  const handleImportDotEnv = async () => {
    if (!activeGroup) return;
    if (!importDotEnvText.trim()) return toast.error("Paste your .env contents first");
    const parsed = parseDotEnv(importDotEnvText);
    if (parsed.length === 0) return toast.error("No valid KEY=VALUE pairs found");

    setIsSaving(true);
    try {
      await engine.call("PATCH", `/api/vault/groups/${encodeURIComponent(activeGroup.id)}`, {
        upserts: parsed.map((p) => ({ key: p.key, value: p.value })),
      });
      await qc.invalidateQueries({ queryKey: ["vault-groups"] });
      setIsImportModalOpen(false);
      setImportDotEnvText("");
      toast.success(`Imported ${parsed.length} encrypted variables into "${activeGroup.name}"`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportDotEnv = async (masked = false) => {
    if (!activeGroup) return;
    let exportList = draftSecrets.map((s) => ({
      id: s.id,
      key: s.key,
      value: revealedValues[s.id] ?? s.value,
      isSecret: s.isSecret,
      category: s.category as any,
      updatedAt: s.updatedAt,
    }));

    if (!masked) {
      const revealed = await engine.call<Array<{ id: string; key: string; value: string }>>(
        "GET",
        `/api/vault/groups/${encodeURIComponent(activeGroup.id)}/reveal`,
      );
      const revMap = new Map(revealed.map((r) => [r.key, r.value]));
      exportList = exportList.map((item) => ({
        ...item,
        value: revMap.get(item.key) ?? item.value,
      }));
    }

    const dotEnv = exportToDotEnv(exportList, masked);
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
    if ((activeGroup.linkedProjects || []).length === 0) {
      return toast.info("Attach at least one project below to sync secrets.");
    }
    if (hasUnsavedChanges) {
      await handleSaveChanges();
    }
    setIsSyncing(true);
    try {
      const res = await engine.call<{ ok: boolean; synced: string[]; failed: any[] }>(
        "POST",
        `/api/vault/groups/${encodeURIComponent(activeGroup.id)}/sync`,
        {},
      );
      await qc.invalidateQueries({ queryKey: ["vault-groups"] });
      toast.success(`Synced vault secrets to ${res.synced.length} project(s)`);
    } finally {
      setIsSyncing(false);
    }
  };

  const toggleProjectAttachment = async (projectName: string) => {
    if (!activeGroup) return;
    const current = activeGroup.linkedProjects || [];
    const next = current.includes(projectName)
      ? current.filter((p) => p !== projectName)
      : [...current, projectName];
    await engine.call("PATCH", `/api/vault/groups/${encodeURIComponent(activeGroup.id)}`, {
      linkedProjects: next,
    });
    await qc.invalidateQueries({ queryKey: ["vault-groups"] });
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return toast.error("Enter a group name");
    setIsCreating(true);
    try {
      const created = await engine.call<ApiVaultGroup>("POST", "/api/vault/groups", {
        name: newGroupName.trim(),
        description: newGroupDesc.trim() || "AES-256-GCM encrypted secret group",
        linkedProjects: [],
      });
      await qc.invalidateQueries({ queryKey: ["vault-groups"] });
      setSelectedGroupId(created.id);
      setIsCreateGroupModalOpen(false);
      setNewGroupName("");
      setNewGroupDesc("");
      toast.success(`Created secret group "${created.name}"`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleApplyGeneratedSecret = () => {
    if (targetSecretIdForGen) {
      updateSecretRow(targetSecretIdForGen, { value: generatedResult });
      setRevealedValues((prev) => ({ ...prev, [targetSecretIdForGen]: generatedResult }));
      toast.success("Injected generated secret — click Save Changes to encrypt & persist");
    } else {
      navigator.clipboard.writeText(generatedResult);
      toast.success("Copied generated secret to clipboard");
    }
    setIsGenModalOpen(false);
  };

  return (
    <div className="space-y-6" data-testid="secrets-vault-manager">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl border border-border/80 bg-card/70 backdrop-blur shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              Secrets Vault &amp; Encrypted Groups
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Server AES-256-GCM
              </span>
            </h2>
            <p className="text-xs text-muted-foreground">
              Secrets are encrypted at rest inside the engine database, reveal-audited, and synced to
              project environments.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
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
            type="button"
            data-testid="btn-new-vault-group"
            onClick={() => setIsCreateGroupModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.99] transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>New Secret Group</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Secret Groups ({groups.length})
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter groups..."
              className="text-xs bg-surface border border-border rounded-lg px-2.5 py-1 text-foreground outline-none focus:border-primary w-36"
            />
          </div>

          <div className="space-y-2.5">
            {isLoading ? (
              <div className="p-6 rounded-xl border border-border bg-card/40 text-xs text-muted-foreground text-center">
                Loading encrypted vault groups...
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="p-8 rounded-xl border border-dashed border-border/80 bg-card/40 text-center space-y-3">
                <div className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center mx-auto text-muted-foreground">
                  <KeyRound className="w-5 h-5 opacity-60" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-foreground">No secret groups found</p>
                  <p className="text-[11px] text-muted-foreground">
                    Create a vault group to store encrypted variables on the engine.
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
                const isSelected = grp.id === activeGroup?.id;
                const linkedCount = (grp.linkedProjects || []).length;
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
                        <h4 className="font-bold text-sm text-foreground">{grp.name}</h4>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {grp.description}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteGroup(grp);
                        }}
                        className="text-muted-foreground/60 hover:text-rose-400 p-1 rounded hover:bg-rose-500/10 transition-all"
                        title="Delete group"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="mt-3 pt-2 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-mono text-[11px]">
                        {(grp.secrets || []).length} encrypted var
                        {(grp.secrets || []).length === 1 ? "" : "s"}
                      </span>
                      <span className="text-[11px] flex items-center gap-1 text-primary font-medium">
                        <FolderSync className="w-3 h-3" />
                        {linkedCount} project{linkedCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="lg:col-span-8">
          {activeGroup ? (
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
                <div>
                  <h3 className="text-base font-bold text-foreground">{activeGroup.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{activeGroup.description}</p>
                </div>

                <div className="flex items-center flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={addSecretRow}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:opacity-90 shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Variable</span>
                  </button>

                  {hasUnsavedChanges && (
                    <button
                      type="button"
                      data-testid="btn-save-vault-secrets"
                      onClick={handleSaveChanges}
                      disabled={isSaving}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-500 text-white hover:bg-amber-600 shadow-sm disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{isSaving ? "Saving..." : "Save Changes"}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setIsImportModalOpen(true)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-accent text-foreground transition-all"
                  >
                    <Upload className="w-3.5 h-3.5 text-primary" />
                    <span>Import .env</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExportDotEnv(false)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-accent text-foreground transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSyncToProjects}
                    disabled={isSyncing || (activeGroup.linkedProjects || []).length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-50 transition-all"
                  >
                    <FolderSync className="w-3.5 h-3.5" />
                    <span>{isSyncing ? "Syncing..." : "Sync Projects"}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold px-1">
                  <span>VARIABLE NAME</span>
                  <span>VALUE &amp; ENCRYPTION</span>
                </div>

                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                  {draftSecrets.map((secret) => {
                    const isRevealed = revealedValues[secret.id] !== undefined || !secret.masked;
                    const displayValue =
                      revealedValues[secret.id] !== undefined
                        ? revealedValues[secret.id]
                        : secret.value;
                    const CatIcon =
                      CATEGORY_ICONS[secret.category || "general"] || SlidersHorizontal;

                    return (
                      <div
                        key={secret.id}
                        className="flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 rounded-xl border border-border/70 bg-surface/40 hover:bg-surface/70 transition-all"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                          <CatIcon className="w-4 h-4 text-muted-foreground/70 flex-shrink-0" />
                          <input
                            value={secret.key}
                            onChange={(e) => updateSecretRow(secret.id, { key: e.target.value })}
                            placeholder="KEY_NAME"
                            className="w-full px-2.5 py-1 text-xs font-mono font-semibold bg-card border border-border rounded-lg outline-none focus:border-primary text-foreground"
                          />
                        </div>

                        <div className="flex items-center gap-1.5 flex-[1.5]">
                          <div className="relative flex-1">
                            <input
                              type={secret.isSecret && !isRevealed ? "password" : "text"}
                              value={displayValue}
                              onChange={(e) => {
                                const val = e.target.value;
                                updateSecretRow(secret.id, { value: val });
                                setRevealedValues((prev) => ({ ...prev, [secret.id]: val }));
                              }}
                              placeholder="Enter secret value"
                              className="w-full px-2.5 py-1 pr-14 text-xs font-mono bg-card border border-border rounded-lg outline-none focus:border-primary text-foreground"
                            />
                            <button
                              type="button"
                              onClick={() => toggleRevealSecret(secret)}
                              className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground p-0.5"
                              title={isRevealed ? "Hide secret" : "Reveal secret (audited)"}
                            >
                              {isRevealed ? (
                                <EyeOff className="w-3.5 h-3.5" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>

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

                          <button
                            type="button"
                            onClick={() => copyToClipboard(secret)}
                            className="p-1 rounded bg-card border border-border text-muted-foreground hover:text-foreground"
                            title="Copy value"
                          >
                            {copiedKey === secret.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => removeSecretRow(secret)}
                            className="p-1 rounded text-muted-foreground/60 hover:text-rose-400 hover:bg-rose-500/10"
                            title="Delete secret"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {draftSecrets.length === 0 && (
                    <div className="p-8 rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground">
                      No variables defined in this group yet. Click &quot;Add Variable&quot; or
                      &quot;Import .env&quot; above.
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-border/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground/90">
                    Sync to Projects ({(activeGroup.linkedProjects || []).length} attached)
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Click a project to attach/detach this vault group
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {projects.map((p) => {
                    const isAttached = (activeGroup.linkedProjects || []).includes(p.name);
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
                      No deployed projects found yet.
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground">
              Select or create a secret group on the left to inspect its encrypted variables.
            </div>
          )}
        </div>
      </div>

      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Upload className="w-4 h-4 text-primary" />
                Import Variables from .env
              </h3>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

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
                disabled={isSaving}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-all shadow-sm"
              >
                Parse &amp; Save
              </button>
            </div>
          </div>
        </div>
      )}

      {isGenModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Cryptographic Secret Generator
              </h3>
              <button
                type="button"
                onClick={() => setIsGenModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                {(["hex64", "alphanumeric32", "uuid", "base64"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => {
                      setGenSecretType(fmt);
                      setGeneratedResult(generateSecureSecret(fmt));
                    }}
                    className={`p-2 rounded-lg border text-left font-mono text-[11px] ${
                      genSecretType === fmt
                        ? "bg-primary/10 border-primary text-primary font-bold"
                        : "bg-surface border-border text-muted-foreground"
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
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

      {isCreateGroupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">Create Secret Group</h3>
              <button
                type="button"
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
                data-testid="btn-create-vault-group"
                onClick={handleCreateGroup}
                disabled={isCreating}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-all shadow-sm disabled:opacity-50"
              >
                {isCreating ? "Creating..." : "Create Group"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
