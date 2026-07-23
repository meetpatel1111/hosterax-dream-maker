import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { STACKS, REGIONS, APP_TEMPLATES, TARGETS, WORKSPACES } from "@/lib/stacks";
import { GitBranch, Package, Sparkles, Upload, Link2, TerminalSquare } from "lucide-react";

export const Route = createFileRoute("/_app/new")({
  head: () => ({
    meta: [
      { title: "New project — HosteraX" },
      { name: "description", content: "Deploy from Git, a local folder, a public URL, the CLI, or a one-click template." },
    ],
  }),
  component: NewProject,
});

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

type Trigger = "git" | "upload" | "url" | "cli" | "template";

function NewProject() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<Trigger>("git");
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [stack, setStack] = useState("auto");
  const [region, setRegion] = useState("local");
  const [target, setTarget] = useState<"docker" | "process" | "ssh" | "cloud">("docker");
  const [workspace, setWorkspace] = useState<string>("none");
  const [buildTimeout, setBuildTimeout] = useState(30);
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("root");
  const [busy, setBusy] = useState(false);

  async function create(overrides?: { name?: string; stack?: string }) {
    if (!user) return;
    const finalName = overrides?.name ?? name;
    if (!finalName) return toast.error("Give your project a name");
    setBusy(true);
    try {
      const slug = slugify(finalName) || `p-${Date.now()}`;
      const stackDef = STACKS.find((s) => s.id === (overrides?.stack ?? stack));
      const { data, error } = await supabase.from("projects").insert({
        owner_id: user.id,
        name: finalName,
        slug,
        repo_url: repo || sourceUrl || null,
        branch,
        stack: overrides?.stack ?? stack,
        region,
        subdomain: slug,
        status: "active",
        build_command: stackDef?.build ?? null,
        start_command: stackDef?.start ?? null,
        port: stackDef?.port ?? 3000,
        target_type: target as any,
        workspace_type: workspace as any,
        build_timeout_minutes: buildTimeout,
        ssh_host: target === "ssh" ? sshHost || null : null,
        ssh_user: target === "ssh" ? sshUser || null : null,
      }).select().single();
      if (error) throw error;
      toast.success("Project created");
      nav({ to: "/p/$slug", params: { slug: data.slug } });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create");
    } finally {
      setBusy(false);
    }
  }

  const TABS: { id: Trigger; label: string; icon: any }[] = [
    { id: "git", label: "Git repo", icon: GitBranch },
    { id: "upload", label: "Upload", icon: Upload },
    { id: "url", label: "From URL", icon: Link2 },
    { id: "cli", label: "CLI push", icon: TerminalSquare },
    { id: "template", label: "Template", icon: Package },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
        <p className="text-sm text-muted-foreground">Deploy from Git, folder upload, a public URL, the CLI, or a one-click app.</p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm ${tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab !== "template" ? (
        <div className="space-y-4 rounded-lg border border-border bg-card p-6">
          <Field label="Project name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="acme-api" className={inputCls} autoFocus />
          </Field>

          {tab === "git" && (
            <>
              <Field label="Git repository">
                <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/acme/api" className={inputCls} />
              </Field>
              <Field label="Branch">
                <input value={branch} onChange={(e) => setBranch(e.target.value)} className={inputCls} />
              </Field>
            </>
          )}
          {tab === "url" && (
            <Field label="Source URL (tar.gz or zip)">
              <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://example.com/build.tar.gz" className={inputCls} />
            </Field>
          )}
          {tab === "upload" && (
            <div className="rounded-md border border-dashed border-border bg-input/20 p-8 text-center text-sm text-muted-foreground">
              <Upload className="mx-auto mb-2 h-6 w-6" />
              Drag & drop a folder or tar.gz to build. In the native app, this uses the local file bridge.
            </div>
          )}
          {tab === "cli" && (
            <div className="rounded-md border border-border bg-[oklch(0.12_0.01_265)] p-4 font-mono text-xs text-foreground/80">
              <div className="text-muted-foreground"># from your project directory</div>
              <div>$ hosteraX login</div>
              <div>$ hosteraX deploy --name {name || "my-app"}</div>
              <div className="mt-2 text-muted-foreground"># the CLI zips + streams over the API</div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Deploy target">
              <div className="grid grid-cols-2 gap-2">
                {TARGETS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTarget(t.id as any)}
                    className={`rounded-md border p-2 text-left text-xs ${target === t.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40"}`}
                  >
                    <div className="flex items-center gap-1 font-medium"><span>{t.icon}</span> {t.name}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{t.desc}</div>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Region">
              <select value={region} onChange={(e) => setRegion(e.target.value)} className={inputCls}>
                {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.flag} {r.name}</option>)}
              </select>
            </Field>
          </div>

          {target === "ssh" && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="SSH host"><input value={sshHost} onChange={(e) => setSshHost(e.target.value)} placeholder="1.2.3.4" className={inputCls} /></Field>
              <Field label="SSH user"><input value={sshUser} onChange={(e) => setSshUser(e.target.value)} className={inputCls} /></Field>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Monorepo layout">
              <select value={workspace} onChange={(e) => setWorkspace(e.target.value)} className={inputCls}>
                {WORKSPACES.map((w) => <option key={w.id} value={w.id}>{w.icon} {w.name}</option>)}
              </select>
            </Field>
            <Field label="Build timeout (min)">
              <input
                type="number" min={1} max={120}
                value={buildTimeout}
                onChange={(e) => setBuildTimeout(Number(e.target.value) || 30)}
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Stack">
            <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
              {STACKS.map((s) => (
                <button
                  key={s.id} type="button" onClick={() => setStack(s.id)}
                  className={`flex flex-col items-center gap-1 rounded-md border p-3 text-xs transition-colors ${stack === s.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40"}`}
                >
                  <span className="text-lg">{s.icon}</span>
                  <span className="truncate">{s.name}</span>
                </button>
              ))}
            </div>
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => nav({ to: "/dashboard" })} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
            <button onClick={() => create()} disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              <Sparkles className="h-4 w-4" /> {busy ? "Creating..." : "Create project"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {APP_TEMPLATES.map((t) => (
            <button
              key={t.id} onClick={() => create({ name: t.name.toLowerCase(), stack: "auto" })} disabled={busy}
              className="rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{t.icon}</span>
                <div>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.desc}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
