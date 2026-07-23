import { supabase } from "@/integrations/supabase/client";

type Level = "info" | "success" | "warn" | "error" | "debug";
type Step = { level: Level; msg: string; delay: number; phase?: "queued" | "building" | "deploying" | "ready" };

// 5-step FSM: queued -> building -> deploying -> ready/failed
const SCRIPT: Step[] = [
  { level: "info", msg: "$ hosterax build --project {name} --env {env} --target {target}", delay: 150, phase: "queued" },
  { level: "info", msg: "queued (concurrency 1/1, session {session}/5)", delay: 200, phase: "queued" },
  { level: "info", msg: "→ phase: building", delay: 250, phase: "building" },
  { level: "info", msg: "Cloning repository at {branch} ({trigger})...", delay: 350 },
  { level: "success", msg: "✓ Fetched commit {sha}", delay: 250 },
  { level: "info", msg: "Detecting stack + workspace ({workspace})...", delay: 300 },
  { level: "success", msg: "✓ Detected: {stack}", delay: 200 },
  { level: "info", msg: "Installing dependencies...", delay: 400 },
  { level: "info", msg: "  → resolving 214 packages", delay: 250 },
  { level: "info", msg: "  → downloading (18.4 MB)", delay: 350 },
  { level: "success", msg: "✓ Dependencies installed", delay: 200 },
  { level: "info", msg: "Running build command: {build}", delay: 300 },
  { level: "info", msg: "  → compiling sources", delay: 400 },
  { level: "info", msg: "  → optimizing assets", delay: 350 },
  { level: "success", msg: "✓ Build succeeded (12.4s)", delay: 250 },
  { level: "info", msg: "Tagging release {version}", delay: 200 },
  { level: "info", msg: "→ phase: deploying", delay: 250, phase: "deploying" },
  { level: "info", msg: "Packaging artifact for {target}...", delay: 300 },
  { level: "info", msg: "  → layer 1/6: base runtime", delay: 200 },
  { level: "info", msg: "  → layer 6/6: application", delay: 250 },
  { level: "success", msg: "✓ Artifact ready: 142 MB", delay: 200 },
  { level: "info", msg: "Provisioning routing + TLS...", delay: 300 },
  { level: "success", msg: "✓ SSL issued via Let's Encrypt", delay: 200 },
  { level: "info", msg: "Starting service on port {port}...", delay: 350 },
  { level: "success", msg: "✓ Health check passed", delay: 250 },
  { level: "success", msg: "→ phase: ready", delay: 150, phase: "ready" },
  { level: "success", msg: "🚀 Deployment {version} live at https://{sub}.hosterax.app", delay: 100 },
];

function bumpVersion(prev: string | null | undefined): string {
  if (!prev) return "v1.0.0";
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(prev);
  if (!m) return "v1.0.0";
  const [_, maj, min, patch] = m;
  return `v${maj}.${min}.${Number(patch) + 1}`;
}

const triggerMessages: Record<string, string[]> = {
  git: ["push to main", "PR #42 merged", "check-run passed"],
  manual: ["Manual redeploy", "Configuration update", "Cache bust"],
  upload: ["Uploaded local build", "tar.gz uploaded from CLI", "Folder push"],
  url: ["Deploy from URL", "Fetched public archive", "Template import"],
  cli: ["hosteraX deploy", "CLI push from local dir", "hx run"],
  api: ["API deploy", "Automation trigger", "External webhook"],
  rollback: ["Rollback requested", "Restore snapshot", "Revert release"],
};

export async function triggerDeployment(project: {
  id: string; name: string; branch: string; stack: string; port: number | null; subdomain: string | null;
  target_type?: string | null; workspace_type?: string | null; current_version?: string | null;
  build_command?: string | null;
}, opts: {
  trigger?: "git" | "manual" | "upload" | "url" | "cli" | "api" | "rollback";
  environment?: "production" | "preview" | "development";
  rollbackOf?: string | null;
  sourceUrl?: string | null;
} = {}) {
  const trigger = opts.trigger ?? "manual";
  const environment = opts.environment ?? "production";
  const sha = Math.random().toString(16).slice(2, 9);
  const messages = triggerMessages[trigger] ?? triggerMessages.manual;
  const commit = messages[Math.floor(Math.random() * messages.length)];
  const version = bumpVersion(project.current_version);
  const session = Math.floor(Math.random() * 5) + 1;

  const { data: user } = await supabase.auth.getUser();
  const { data: dep, error } = await supabase.from("deployments").insert({
    project_id: project.id,
    commit_sha: sha,
    commit_message: commit,
    branch: project.branch,
    status: "building",
    phase: "queued",
    trigger_type: trigger,
    environment,
    version,
    rollback_of: opts.rollbackOf ?? null,
    source_url: opts.sourceUrl ?? null,
    triggered_by: user.user?.id,
    started_at: new Date().toISOString(),
  }).select().single();
  if (error || !dep) throw error ?? new Error("Failed to start deployment");

  await supabase.from("projects").update({ status: "building" }).eq("id", project.id);

  (async () => {
    const started = Date.now();
    const shouldFail = Math.random() < 0.1;
    const failAt = shouldFail ? 8 + Math.floor(Math.random() * 10) : -1;
    for (let i = 0; i < SCRIPT.length; i++) {
      const step = SCRIPT[i];
      await new Promise((r) => setTimeout(r, step.delay));
      const message = step.msg
        .replaceAll("{name}", project.name)
        .replaceAll("{branch}", project.branch)
        .replaceAll("{sha}", sha)
        .replaceAll("{stack}", project.stack)
        .replaceAll("{port}", String(project.port ?? 3000))
        .replaceAll("{sub}", project.subdomain ?? "app")
        .replaceAll("{env}", environment)
        .replaceAll("{target}", project.target_type ?? "docker")
        .replaceAll("{workspace}", project.workspace_type ?? "none")
        .replaceAll("{version}", version)
        .replaceAll("{trigger}", trigger)
        .replaceAll("{session}", String(session))
        .replaceAll("{build}", project.build_command ?? "auto");
      await supabase.from("deployment_logs").insert({ deployment_id: dep.id, level: step.level, message });
      if (step.phase) {
        await supabase.from("deployments").update({ phase: step.phase }).eq("id", dep.id);
      }
      if (i === failAt) {
        await supabase.from("deployment_logs").insert({
          deployment_id: dep.id, level: "error",
          message: "✗ Build failed: exit code 1",
        });
        await supabase.from("deployments").update({
          status: "failed", phase: "failed", finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
        }).eq("id", dep.id);
        await supabase.from("projects").update({ status: "failed" }).eq("id", project.id);
        return;
      }
    }
    await supabase.from("deployments").update({
      status: "success", phase: "ready", finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
    }).eq("id", dep.id);
    await supabase.from("projects").update({ status: "active", current_version: version }).eq("id", project.id);
  })();

  return dep;
}

export async function rollbackTo(project: { id: string; name: string; branch: string; stack: string; port: number | null; subdomain: string | null; target_type?: string | null; workspace_type?: string | null; current_version?: string | null; build_command?: string | null; }, deploymentId: string, targetVersion: string | null) {
  return triggerDeployment(
    { ...project, current_version: targetVersion ?? project.current_version },
    { trigger: "rollback", rollbackOf: deploymentId },
  );
}
