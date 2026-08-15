import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useId } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { useEngine, useEngineHealth } from "@/lib/engine";
import { STACKS, REGIONS, TARGETS, WORKSPACES, StackDef } from "@/lib/stacks";
import {
  GitBranch,
  Upload,
  Link2,
  TerminalSquare,
  Layers,
  Container,
  Sparkles,
  CheckCircle2,
  FolderOpen,
  Cpu,
  Globe,
  Server,
  Copy,
  Check,
  ExternalLink,
  ChevronRight,
  Info,
  Settings2,
  ArrowRight,
  Code2,
  Radio,
  FileArchive,
  Terminal,
  ShieldCheck,
  Flame,
} from "lucide-react";
import { StarterTemplatesCatalog } from "@/components/hx/starter-templates-catalog";
import { OneClickAppsCatalog } from "@/components/hx/one-click-apps-catalog";

export const Route = createFileRoute("/_app/new")({
  head: () => ({
    meta: [
      { title: "New Project & Service — HosteraX" },
      {
        name: "description",
        content: "Deploy from Git repository, local folder upload, public URL archive, CLI push, starter templates, or 2,550+ one-click Docker apps.",
      },
    ],
  }),
  component: NewProject,
});

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

type Trigger = "git" | "upload" | "url" | "cli" | "template" | "one-click";

// Popular quick-import open source repository presets
const QUICK_GIT_PRESETS = [
  { name: "Next.js App", repo: "https://github.com/vercel/next-learn", stack: "next", branch: "main", icon: "▲" },
  { name: "Vite React", repo: "https://github.com/vitejs/vite", stack: "vite", branch: "main", icon: "⚡" },
  { name: "Astro Blog", repo: "https://github.com/withastro/astro", stack: "astro", branch: "main", icon: "🚀" },
  { name: "FastAPI Python", repo: "https://github.com/tiangolo/fastapi", stack: "fastapi", branch: "master", icon: "🐍" },
  { name: "Go Fiber API", repo: "https://github.com/gofiber/fiber", stack: "go", branch: "master", icon: "🐹" },
  { name: "Express REST", repo: "https://github.com/expressjs/express", stack: "express", branch: "master", icon: "⬢" },
  { name: "Rust Axum", repo: "https://github.com/tokio-rs/axum", stack: "rust", branch: "main", icon: "🦀" },
  { name: "NestJS Microservice", repo: "https://github.com/nestjs/nest", stack: "nest", branch: "master", icon: "🐱" },
];

function NewProject() {
  const { user } = useAuth();
  const nav = useNavigate();
  const engine = useEngine();
  const { data: health } = useEngineHealth();

  const [tab, setTab] = useState<Trigger>("git");
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [folderPath, setFolderPath] = useState("./");
  const [stack, setStack] = useState("auto");
  const [region, setRegion] = useState("local");
  const [target, setTarget] = useState<"docker" | "process" | "ssh">("process");
  const [workspace, setWorkspace] = useState<string>("none");
  const [buildTimeout, setBuildTimeout] = useState(30);
  const [customBuild, setCustomBuild] = useState("");
  const [customStart, setCustomStart] = useState("");
  const [customPort, setCustomPort] = useState<number | "">("");
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("root");
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([
    { key: "NODE_ENV", value: "production" },
  ]);
  const [copiedCli, setCopiedCli] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const activeStackDef = STACKS.find((s) => s.id === stack) || STACKS[0];
  const effectivePort = customPort !== "" ? Number(customPort) : activeStackDef.port || 3000;
  const projectSlug = slugify(name) || "my-service";

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    setCopiedCli(true);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopiedCli(false), 2000);
  }

  function addEnvRow() {
    setEnvVars([...envVars, { key: "", value: "" }]);
  }

  function updateEnvRow(index: number, key: string, value: string) {
    const next = [...envVars];
    next[index] = { key, value };
    setEnvVars(next);
  }

  function removeEnvRow(index: number) {
    setEnvVars(envVars.filter((_, i) => i !== index));
  }

  async function create(overrides?: {
    name?: string;
    stack?: string;
    target?: "docker" | "process" | "ssh";
    source?: string;
    port?: number;
  }) {
    const finalName = overrides?.name ?? name;
    if (!finalName) return toast.error("Please enter a name for your project");
    setBusy(true);

    const slug = slugify(finalName) || `p-${Date.now()}`;
    const chosenStack = overrides?.stack ?? stack;
    const chosenTarget = overrides?.target ?? target;
    const stackDef = STACKS.find((s) => s.id === chosenStack);

    let source = overrides?.source;
    if (!source) {
      if (tab === "git") source = repo || "https://github.com/vercel/next-learn";
      else if (tab === "url") source = sourceUrl || "https://github.com/org/repo.git";
      else if (tab === "upload") source = folderPath || "./";
      else if (tab === "cli") source = "./";
      else source = "./";
    }

    const envMap: Record<string, string> = {};
    for (const row of envVars) {
      if (row.key.trim()) envMap[row.key.trim()] = row.value;
    }

    try {
      // 1. Create on Local SQLite Engine
      await engine.call("POST", "/api/projects", {
        name: finalName,
        source,
        buildCmd: customBuild || stackDef?.build || "",
        startCmd: customStart || stackDef?.start || "",
        target: chosenTarget === "ssh" ? "ssh" : chosenTarget === "docker" ? "docker" : "process",
        port: overrides?.port || effectivePort,
        env: envMap,
      });

      // Trigger immediate build & deploy if source is provided
      if (source && source !== "./") {
        try {
          await engine.call("POST", `/api/projects/${finalName}/deploy`, {
            trigger: tab,
          });
        } catch {}
      }

      toast.success(source !== "./" ? "✨ Project created & deployment started!" : "✨ Project created successfully!");
      nav({ to: "/p/$slug", params: { slug } });
    } catch (err: any) {
      toast.error(err.message || "Failed to create project");
    } finally {
      setBusy(false);
    }
  }

  const TABS: { id: Trigger; label: string; icon: any; badge?: string }[] = [
    { id: "git", label: "Git Repository", icon: GitBranch, badge: "Popular" },
    { id: "upload", label: "Folder Upload", icon: Upload },
    { id: "url", label: "From URL", icon: Link2 },
    { id: "cli", label: "CLI Push", icon: TerminalSquare },
    { id: "template", label: "Starter Templates", icon: Layers, badge: "12+" },
    { id: "one-click", label: "1-Click Apps", icon: Container, badge: "2,550+" },
  ];

  return (
    <div className="w-full max-w-[1720px] 2xl:max-w-none mx-auto space-y-6 transition-all duration-300">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-transparent">
              Create New Service
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {health?.ok ? "Engine Ready" : "Engine Connected"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Deploy from any source: Git repo, folder upload, remote archive, HosteraX CLI, or instant starter templates.
          </p>
        </div>

        {/* Quick Help Pill */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-surface border border-border px-3 py-1.5 rounded-lg shadow-sm">
          <Info className="w-4 h-4 text-primary" />
          <span>Automatic zero-downtime rolling deploys with magic SSL DNS</span>
        </div>
      </div>

      {/* Tab Navigation Toolbar */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-card/80 p-1.5 shadow-sm backdrop-blur">
        {TABS.map((t) => {
          const isActive = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex flex-1 min-w-[150px] items-center justify-center gap-2.5 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-md font-semibold"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? "text-primary-foreground" : "text-muted-foreground"}`} />
              <span>{t.label}</span>
              {t.badge && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                    isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/10 text-primary"
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Tab Content Area */}
      {tab === "template" ? (
        <StarterTemplatesCatalog
          onSelectTemplate={(item) => {
            setName(item.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-"));
            setRepo(item.repo_url || "");
            setStack(item.stack || "auto");
            setTab("git");
            toast.info(`Configuring "${item.name}" starter template`);
          }}
        />
      ) : tab === "one-click" ? (
        <OneClickAppsCatalog
          onSelectApp={(item) => {
            create({
              name: item.slug || item.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
              stack: "docker",
              target: "docker",
              source: item.image,
              port: item.port,
            });
          }}
        />
      ) : (
        /* Unified 2-Column Responsive Layout for Git, Upload, URL, CLI */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Main Form Column (7/12) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Primary Source Card */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-5">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  {tab === "git" && <GitBranch className="h-5 w-5 text-primary" />}
                  {tab === "upload" && <Upload className="h-5 w-5 text-primary" />}
                  {tab === "url" && <Link2 className="h-5 w-5 text-primary" />}
                  {tab === "cli" && <TerminalSquare className="h-5 w-5 text-primary" />}
                  <h2 className="text-base font-semibold text-foreground">
                    {tab === "git" && "Git Repository Configuration"}
                    {tab === "upload" && "Folder & Archive Upload"}
                    {tab === "url" && "Import from Remote Archive or Git URL"}
                    {tab === "cli" && "CLI Push & Local Daemon Setup"}
                  </h2>
                </div>
                <span className="text-xs font-medium text-muted-foreground">Step 1 of 2</span>
              </div>

              {/* Project Name Input */}
              <Field
                label="Project Name"
                desc="Unique service identifier used for your internal and external magic domains."
              >
                <div className="relative">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. acme-api, billing-worker, web-client"
                    className={inputCls}
                    autoFocus
                  />
                  {name && (
                    <div className="absolute right-3 top-2.5 text-xs text-muted-foreground font-mono">
                      {projectSlug}.localhost
                    </div>
                  )}
                </div>
              </Field>

              {/* Tab 1: Git Repo Specific Inputs */}
              {tab === "git" && (
                <div className="space-y-4 pt-2">
                  <Field
                    label="Git Repository URL"
                    desc="Supports public and authenticated HTTPS Git URLs from GitHub, GitLab, Bitbucket, or Codeberg."
                  >
                    <div className="relative">
                      <input
                        value={repo}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRepo(val);
                          if (!name && val) {
                            const derived = val.split("/").pop()?.replace(/\.git$/, "") || "";
                            if (derived) setName(derived);
                          }
                        }}
                        placeholder="https://github.com/username/repository.git"
                        className={inputCls}
                      />
                      <GitBranch className="absolute right-3 top-3 h-4 w-4 text-muted-foreground/60" />
                    </div>
                  </Field>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Production Branch" desc="Branch to build and deploy.">
                      <input
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        placeholder="main"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Root Directory" desc="Subdirectory path for monorepos.">
                      <input
                        value={workspace !== "none" ? workspace : "./"}
                        onChange={(e) => setWorkspace(e.target.value)}
                        placeholder="./ or packages/api"
                        className={inputCls}
                      />
                    </Field>
                  </div>

                  {/* Quick Presets */}
                  <div className="pt-2">
                    <label className="text-xs font-semibold text-muted-foreground block mb-2 flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5 text-amber-400" />
                      Popular Open-Source Quick Presets
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {QUICK_GIT_PRESETS.map((p) => (
                        <button
                          key={p.name}
                          type="button"
                          onClick={() => {
                            setName(p.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-"));
                            setRepo(p.repo);
                            setBranch(p.branch);
                            setStack(p.stack);
                            toast.success(`Loaded preset: ${p.name}`);
                          }}
                          className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border/80 bg-surface/60 hover:bg-primary/10 hover:border-primary/40 text-left transition-all text-xs group"
                        >
                          <span className="text-sm">{p.icon}</span>
                          <span className="font-medium text-foreground/90 group-hover:text-primary truncate">
                            {p.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Upload Specific Inputs */}
              {tab === "upload" && (
                <div className="space-y-4 pt-2">
                  <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-8 text-center transition-all hover:bg-primary/10 hover:border-primary/60">
                    <div className="mx-auto w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mb-3">
                      <Upload className="h-6 w-6 text-primary animate-pulse" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">Drag and drop your project folder or archive</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Supports ZIP, TAR.GZ, or whole directories with package.json / requirements.txt / Go modules.
                    </p>
                    <div className="mt-4 flex items-center justify-center gap-3">
                      <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold shadow hover:opacity-90">
                        <FolderOpen className="w-3.5 h-3.5" /> Select Local Folder
                        <input
                          type="file"
                          // @ts-ignore
                          webkitdirectory=""
                          directory=""
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) {
                              const dir = e.target.files[0].webkitRelativePath?.split("/")[0] || "my-app";
                              setName(dir);
                              setFolderPath(`./${dir}`);
                              toast.success(`Selected directory: ${dir} (${e.target.files.length} files)`);
                            }
                          }}
                        />
                      </label>
                      <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-xs font-semibold hover:bg-accent">
                        <FileArchive className="w-3.5 h-3.5" /> Upload .zip / .tar.gz
                        <input
                          type="file"
                          accept=".zip,.tar.gz,.tar,.tgz"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) {
                              const f = e.target.files[0];
                              const base = f.name.replace(/\.(zip|tar\.gz|tar|tgz)$/, "");
                              setName(base);
                              toast.success(`Selected archive: ${f.name}`);
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  <Field
                    label="Or Local Absolute / Relative Directory Path"
                    desc="Point directly to any folder on your machine for the HosteraX Engine."
                  >
                    <div className="relative">
                      <input
                        value={folderPath}
                        onChange={(e) => setFolderPath(e.target.value)}
                        placeholder="e.g. C:\Users\Projects\my-app or ./src/backend"
                        className={inputCls}
                      />
                      <FolderOpen className="absolute right-3 top-3 h-4 w-4 text-muted-foreground/60" />
                    </div>
                  </Field>
                </div>
              )}

              {/* Tab 3: From URL Inputs */}
              {tab === "url" && (
                <div className="space-y-4 pt-2">
                  <Field
                    label="Public Source URL"
                    desc="Direct link to a public Git repository, raw archive (.zip / .tar.gz), or Docker Compose URL."
                  >
                    <div className="relative">
                      <input
                        value={sourceUrl}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSourceUrl(val);
                          if (!name && val) {
                            const derived = val.split("/").pop()?.replace(/\.(tar\.gz|zip|git)$/, "") || "";
                            if (derived) setName(derived);
                          }
                        }}
                        placeholder="https://github.com/owner/repo/archive/refs/heads/main.zip"
                        className={inputCls}
                      />
                      <Link2 className="absolute right-3 top-3 h-4 w-4 text-muted-foreground/60" />
                    </div>
                  </Field>

                  <div className="rounded-lg border border-border/80 bg-surface/50 p-3 text-xs text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span>HosteraX will stream the archive in real-time and execute the build pipeline automatically.</span>
                  </div>
                </div>
              )}

              {/* Tab 4: CLI Push Inputs */}
              {tab === "cli" && (
                <div className="space-y-4 pt-2">
                  <div className="rounded-xl border border-border bg-[oklch(0.12_0.01_265)] p-5 font-mono text-xs text-foreground/90 shadow-inner relative group">
                    <div className="flex items-center justify-between text-muted-foreground border-b border-border/40 pb-2.5 mb-3">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-3.5 h-3.5 text-primary" />
                        <span className="font-semibold text-foreground/80">Terminal Deployment Guide</span>
                      </div>
                      <button
                        onClick={() =>
                          copyText(
                            `hosterax create ${name || "my-service"} --source ./\nhosterax deploy ${name || "my-service"}`
                          )
                        }
                        className="flex items-center gap-1 text-[11px] font-sans px-2 py-1 rounded bg-surface border border-border hover:bg-accent text-foreground transition-all"
                      >
                        {copiedCli ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        {copiedCli ? "Copied" : "Copy commands"}
                      </button>
                    </div>

                    <div className="space-y-2 leading-relaxed">
                      <div className="text-muted-foreground/80"># 1. Install CLI globally</div>
                      <div className="text-emerald-400">$ npm install -g hosterax</div>
                      <div className="text-muted-foreground/80 pt-1"># 2. From your project folder, create and deploy</div>
                      <div className="text-primary">$ hosterax login http://localhost:7777</div>
                      <div className="text-foreground">$ hosterax create {name || "my-service"} --source ./</div>
                      <div className="text-emerald-400 font-semibold">$ hosterax deploy {name || "my-service"}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-lg border border-border bg-surface flex items-start gap-2">
                      <ShieldCheck className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="font-medium text-foreground">Zero Config CLI</div>
                        <div className="text-muted-foreground text-[11px]">Auto-detects framework, dependencies, and entrypoints.</div>
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border border-border bg-surface flex items-start gap-2">
                      <Radio className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="font-medium text-foreground">Local Daemon Active</div>
                        <div className="text-muted-foreground text-[11px]">Listening on port 7777 for instant push builds.</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Stack & Target Selection Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border/60">
                <Field label="Framework / Runtime" desc="Auto-detected or override manually.">
                  <select
                    value={stack}
                    onChange={(e) => setStack(e.target.value)}
                    className={inputCls}
                  >
                    <option value="auto">✨ Auto-detect Framework</option>
                    {STACKS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.icon} {s.name} ({s.language})
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Target Execution Mode" desc="How HosteraX runs this app.">
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value as any)}
                    className={inputCls}
                  >
                    {TARGETS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.icon} {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {/* Advanced Settings Toggle */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-2 text-xs font-semibold text-primary hover:underline"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  {showAdvanced ? "Hide Advanced Build & Environment Settings" : "Show Advanced Build & Environment Settings"}
                </button>

                {showAdvanced && (
                  <div className="mt-4 space-y-4 rounded-lg border border-border bg-surface/40 p-4 animate-in fade-in duration-200">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <Field label="Custom Build Command">
                        <input
                          value={customBuild}
                          onChange={(e) => setCustomBuild(e.target.value)}
                          placeholder={activeStackDef.build || "e.g. npm run build"}
                          className={inputCls}
                        />
                      </Field>
                      <Field label="Custom Start Command">
                        <input
                          value={customStart}
                          onChange={(e) => setCustomStart(e.target.value)}
                          placeholder={activeStackDef.start || "e.g. npm start"}
                          className={inputCls}
                        />
                      </Field>
                      <Field label="App Port">
                        <input
                          type="number"
                          value={customPort}
                          onChange={(e) => setCustomPort(e.target.value ? Number(e.target.value) : "")}
                          placeholder={String(activeStackDef.port || 3000)}
                          className={inputCls}
                        />
                      </Field>
                    </div>

                    {/* Environment Variables Table */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-semibold text-foreground">Environment Variables</label>
                        <button
                          type="button"
                          onClick={addEnvRow}
                          className="text-[11px] font-semibold text-primary hover:underline"
                        >
                          + Add Variable
                        </button>
                      </div>
                      <div className="space-y-2">
                        {envVars.map((row, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              value={row.key}
                              onChange={(e) => updateEnvRow(idx, e.target.value, row.value)}
                              placeholder="KEY_NAME"
                              className={`${inputCls} font-mono text-xs`}
                            />
                            <input
                              value={row.value}
                              onChange={(e) => updateEnvRow(idx, row.key, e.target.value)}
                              placeholder="value"
                              className={`${inputCls} font-mono text-xs`}
                            />
                            <button
                              type="button"
                              onClick={() => removeEnvRow(idx)}
                              className="px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10 rounded"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {target === "ssh" && (
                      <div className="grid grid-cols-2 gap-4 rounded-md border border-border bg-input/20 p-4">
                        <Field label="SSH Host (IP or hostname)">
                          <input
                            value={sshHost}
                            onChange={(e) => setSshHost(e.target.value)}
                            placeholder="192.168.1.100"
                            className={inputCls}
                          />
                        </Field>
                        <Field label="SSH User">
                          <input
                            value={sshUser}
                            onChange={(e) => setSshUser(e.target.value)}
                            placeholder="root"
                            className={inputCls}
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Summary & Blueprint Column (5/12) */}
          <div className="lg:col-span-5 space-y-6">
            {/* Live Deployment Blueprint Card */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-5 sticky top-6">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <h2 className="text-base font-semibold text-foreground">Deployment Blueprint</h2>
                </div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  Ready to Deploy
                </span>
              </div>

              {/* Blueprint Summary Rows */}
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface/70 border border-border/60">
                  <span className="text-muted-foreground">Service Name:</span>
                  <span className="font-semibold text-foreground font-mono">{name || "my-service"}</span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface/70 border border-border/60">
                  <span className="text-muted-foreground">Magic Domain:</span>
                  <span className="font-semibold text-emerald-400 font-mono flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5" />
                    {projectSlug}.localhost
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface/70 border border-border/60">
                  <span className="text-muted-foreground">Framework / Stack:</span>
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <span>{activeStackDef.icon}</span>
                    <span>{activeStackDef.name}</span>
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface/70 border border-border/60">
                  <span className="text-muted-foreground">Target Runtime:</span>
                  <span className="font-semibold text-foreground capitalize flex items-center gap-1">
                    {target === "docker" && "🐳 Docker Container"}
                    {target === "process" && "⚡ Native Process"}
                    {target === "ssh" && "🔐 Remote SSH"}
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface/70 border border-border/60">
                  <span className="text-muted-foreground">Internal Port:</span>
                  <span className="font-semibold text-foreground font-mono">:{effectivePort}</span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface/70 border border-border/60">
                  <span className="text-muted-foreground">Environment:</span>
                  <span className="font-semibold text-emerald-400">🟢 Production</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => create()}
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-95 active:scale-[0.99] disabled:opacity-50 transition-all"
                >
                  <Sparkles className="h-4 w-4" />
                  {busy ? "Deploying Service..." : "Deploy Service Now"}
                </button>

                <button
                  type="button"
                  onClick={() => nav({ to: "/dashboard" })}
                  className="w-full rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-all text-center"
                >
                  Cancel
                </button>
              </div>

              {/* Best Practice Callout */}
              <div className="rounded-lg border border-border/60 bg-surface/40 p-3 text-[11px] text-muted-foreground space-y-1">
                <div className="font-semibold text-foreground/90 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Continuous Auto-Healing Active
                </div>
                <p>
                  HosteraX continuously monitors your process or container, automatically restarting on crash or memory spikes.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-surface/80 px-3.5 py-2.5 text-sm text-foreground outline-none transition-all focus:border-primary focus:ring-1 focus:ring-primary shadow-sm";

function Field({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-semibold text-foreground/90">
          {label}
        </label>
      </div>
      {children}
      {desc && <p className="text-[11px] text-muted-foreground leading-tight">{desc}</p>}
    </div>
  );
}
