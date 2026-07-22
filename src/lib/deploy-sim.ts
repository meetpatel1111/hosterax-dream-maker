import { supabase } from "@/integrations/supabase/client";

const SCRIPT = [
  { level: "info" as const, msg: "$ hosterax build --project {name}", delay: 200 },
  { level: "info" as const, msg: "Cloning repository at {branch}...", delay: 400 },
  { level: "success" as const, msg: "✓ Repository fetched (commit {sha})", delay: 300 },
  { level: "info" as const, msg: "Detecting stack...", delay: 350 },
  { level: "success" as const, msg: "✓ Detected: {stack}", delay: 250 },
  { level: "info" as const, msg: "Installing dependencies...", delay: 500 },
  { level: "info" as const, msg: "  → resolving 214 packages", delay: 300 },
  { level: "info" as const, msg: "  → downloading (18.4 MB)", delay: 400 },
  { level: "success" as const, msg: "✓ Dependencies installed", delay: 250 },
  { level: "info" as const, msg: "Running build command...", delay: 400 },
  { level: "info" as const, msg: "  → compiling sources", delay: 500 },
  { level: "info" as const, msg: "  → optimizing assets", delay: 400 },
  { level: "success" as const, msg: "✓ Build succeeded (12.4s)", delay: 300 },
  { level: "info" as const, msg: "Building container image...", delay: 400 },
  { level: "info" as const, msg: "  → layer 1/6: base runtime", delay: 200 },
  { level: "info" as const, msg: "  → layer 6/6: application", delay: 250 },
  { level: "success" as const, msg: "✓ Image ready: 142 MB", delay: 200 },
  { level: "info" as const, msg: "Provisioning SSL certificate...", delay: 300 },
  { level: "success" as const, msg: "✓ SSL issued via Let's Encrypt", delay: 200 },
  { level: "info" as const, msg: "Starting container on port {port}...", delay: 350 },
  { level: "success" as const, msg: "✓ Health check passed", delay: 250 },
  { level: "success" as const, msg: "🚀 Deployment live at https://{sub}.hosterax.app", delay: 100 },
];

export async function triggerDeployment(project: {
  id: string; name: string; branch: string; stack: string; port: number | null; subdomain: string | null;
}) {
  const sha = Math.random().toString(16).slice(2, 9);
  const messages = ["Update deps", "Fix build", "New feature", "Refactor router", "Bump version"];
  const commit = messages[Math.floor(Math.random() * messages.length)];

  const { data: user } = await supabase.auth.getUser();
  const { data: dep, error } = await supabase.from("deployments").insert({
    project_id: project.id,
    commit_sha: sha,
    commit_message: commit,
    branch: project.branch,
    status: "building",
    triggered_by: user.user?.id,
    started_at: new Date().toISOString(),
  }).select().single();
  if (error || !dep) throw error ?? new Error("Failed to start deployment");

  await supabase.from("projects").update({ status: "building" }).eq("id", project.id);

  // Fire and forget log streamer
  (async () => {
    const started = Date.now();
    const shouldFail = Math.random() < 0.1;
    const failAt = shouldFail ? 8 + Math.floor(Math.random() * 6) : -1;
    for (let i = 0; i < SCRIPT.length; i++) {
      const step = SCRIPT[i];
      await new Promise((r) => setTimeout(r, step.delay));
      const message = step.msg
        .replaceAll("{name}", project.name)
        .replaceAll("{branch}", project.branch)
        .replaceAll("{sha}", sha)
        .replaceAll("{stack}", project.stack)
        .replaceAll("{port}", String(project.port ?? 3000))
        .replaceAll("{sub}", project.subdomain ?? "app");
      await supabase.from("deployment_logs").insert({ deployment_id: dep.id, level: step.level, message });
      if (i === failAt) {
        await supabase.from("deployment_logs").insert({
          deployment_id: dep.id, level: "error",
          message: "✗ Build failed: exit code 1",
        });
        await supabase.from("deployments").update({
          status: "failed", finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
        }).eq("id", dep.id);
        await supabase.from("projects").update({ status: "failed" }).eq("id", project.id);
        return;
      }
    }
    await supabase.from("deployments").update({
      status: "success", finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
    }).eq("id", dep.id);
    await supabase.from("projects").update({ status: "active" }).eq("id", project.id);
  })();

  return dep;
}
