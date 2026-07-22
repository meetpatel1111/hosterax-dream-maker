import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { STACKS, REGIONS, APP_TEMPLATES } from "@/lib/stacks";
import { GitBranch, Package, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_app/new")({
  head: () => ({ meta: [{ title: "New project — HosteraX" }] }),
  component: NewProject,
});

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function NewProject() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<"git" | "template">("git");
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [stack, setStack] = useState("auto");
  const [region, setRegion] = useState("local");
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
        repo_url: repo || null,
        branch,
        stack: overrides?.stack ?? stack,
        region,
        subdomain: slug,
        status: "active",
        build_command: stackDef?.build ?? null,
        start_command: stackDef?.start ?? null,
        port: stackDef?.port ?? 3000,
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
        <p className="text-sm text-muted-foreground">Deploy from a git repo or pick a one-click app.</p>
      </div>

      <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
        {[
          { id: "git", label: "From git", icon: GitBranch },
          { id: "template", label: "One-click app", icon: Package },
        ].map((t) => (
          <button
            key={t.id} onClick={() => setTab(t.id as any)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm ${tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "git" ? (
        <div className="space-y-4 rounded-lg border border-border bg-card p-6">
          <Field label="Project name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="acme-api" className={inputCls} autoFocus />
          </Field>
          <Field label="Git repository (optional)">
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/acme/api" className={inputCls} />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Branch">
              <input value={branch} onChange={(e) => setBranch(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Region">
              <select value={region} onChange={(e) => setRegion(e.target.value)} className={inputCls}>
                {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.flag} {r.name}</option>)}
              </select>
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
