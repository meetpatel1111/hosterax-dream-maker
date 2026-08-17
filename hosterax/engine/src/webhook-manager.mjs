// hosterax/engine/src/webhook-manager.mjs
// GitHub App Webhooks & Ephemeral PR Preview Environments Subsystem for HosteraX
// Handles Push-to-Deploy, cryptographic signature verification (HMAC-SHA256), and ephemeral preview lifecycles.

import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

export class WebhookManager {
  constructor({ db, runDeployment, applyRoute, HOME }) {
    this.db = db;
    this.runDeployment = runDeployment;
    this.applyRoute = applyRoute;
    this.HOME = HOME;

    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_secrets (
        project_name TEXT PRIMARY KEY,
        secret TEXT NOT NULL,
        webhook_token TEXT NOT NULL UNIQUE,
        auto_deploy_push INTEGER DEFAULT 1,
        auto_deploy_pr INTEGER DEFAULT 1,
        tracked_branch TEXT DEFAULT 'main',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  getProjectWebhookConfig(projectName) {
    const row = this.db.prepare("SELECT * FROM webhook_secrets WHERE project_name=?").get(projectName);
    if (row) return row;

    const secret = crypto.randomBytes(20).toString("hex");
    const webhookToken = `whk_${crypto.randomBytes(16).toString("hex")}`;
    const now = Date.now();

    this.db
      .prepare(
        `
      INSERT INTO webhook_secrets (project_name, secret, webhook_token, auto_deploy_push, auto_deploy_pr, tracked_branch, created_at, updated_at)
      VALUES (?, ?, ?, 1, 1, 'main', ?, ?)
    `
      )
      .run(projectName, secret, webhookToken, now, now);

    return this.getProjectWebhookConfig(projectName);
  }

  updateProjectWebhookConfig(projectName, updates) {
    const cur = this.getProjectWebhookConfig(projectName);
    const now = Date.now();
    const merged = { ...cur, ...updates, updated_at: now };

    this.db
      .prepare(
        `
      UPDATE webhook_secrets SET
        secret=@secret,
        auto_deploy_push=@auto_deploy_push,
        auto_deploy_pr=@auto_deploy_pr,
        tracked_branch=@tracked_branch,
        updated_at=@updated_at
      WHERE project_name=@project_name
    `
      )
      .run(merged);

    return this.getProjectWebhookConfig(projectName);
  }

  verifyGitHubSignature(rawBodyText, signatureHeader, secret) {
    if (!signatureHeader || !secret) return false;
    const hmac = crypto.createHmac("sha256", secret);
    const digest = `sha256=${hmac.update(rawBodyText).digest("hex")}`;
    try {
      return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(digest));
    } catch {
      return false;
    }
  }

  /**
   * Handle incoming GitHub Webhook event
   */
  async handleGitHubWebhook({ event, payload, rawBodyText, signatureHeader, projectName = null }) {
    if (event === "ping") {
      return { ok: true, message: "Pong! Webhook active.", zen: payload?.zen };
    }

    // Identify project either from URL or from repository full_name / clone_url
    let project = null;
    if (projectName) {
      project = this.db.prepare("SELECT * FROM projects WHERE name=?").get(projectName);
    }

    if (!project && payload?.repository) {
      const repoUrl = payload.repository.clone_url || payload.repository.html_url || "";
      const repoFullName = payload.repository.full_name || "";
      project = this.db
        .prepare("SELECT * FROM projects WHERE source LIKE ? OR source LIKE ?")
        .get(`%${repoFullName}%`, `%${repoUrl}%`);
    }

    if (!project) {
      return { ok: false, message: "No matching project found for webhook repository." };
    }

    const whConfig = this.getProjectWebhookConfig(project.name);

    // Optional signature check if signature header provided
    if (signatureHeader && !this.verifyGitHubSignature(rawBodyText, signatureHeader, whConfig.secret)) {
      throw new Error("Invalid GitHub webhook signature (HMAC-SHA256 mismatch).");
    }

    // ────────── 1. Push Event (Push-to-Deploy) ──────────
    if (event === "push") {
      if (!whConfig.auto_deploy_push) {
        return { ok: true, message: "Push received but auto-deploy is disabled for this project." };
      }

      const ref = payload.ref || "";
      const branch = ref.replace("refs/heads/", "");
      const tracked = whConfig.tracked_branch || "main";

      if (branch !== tracked && !ref.endsWith(`/${tracked}`)) {
        return {
          ok: true,
          message: `Push ignored on branch '${branch}' (project tracks '${tracked}').`,
        };
      }

      const commitSha = payload.after || payload.head_commit?.id || "HEAD";
      const commitMsg = payload.head_commit?.message || "Push-to-deploy";

      if (this.runDeployment) {
        this.runDeployment(project.name, {
          trigger: "github-webhook-push",
          commitSha,
          commitMsg,
          branch,
        }).catch((err) => {
          console.error(`[webhook-manager] Push-to-deploy error on ${project.name}:`, err.message);
        });
      }

      return {
        ok: true,
        action: "deploy_triggered",
        project: project.name,
        branch,
        commit: commitSha.slice(0, 7),
      };
    }

    // ────────── 2. Pull Request Event (Ephemeral Previews) ──────────
    if (event === "pull_request") {
      const action = payload.action; // 'opened', 'synchronize', 'reopened', 'closed'
      const prNumber = payload.number;
      const prTitle = payload.pull_request?.title || `PR #${prNumber}`;
      const branch = payload.pull_request?.head?.ref || `pr-${prNumber}`;
      const commitSha = payload.pull_request?.head?.sha || "HEAD";

      if (action === "closed") {
        // Tear down ephemeral preview
        return await this.teardownPreview(project.name, prNumber);
      }

      if (action === "opened" || action === "synchronize" || action === "reopened") {
        if (!whConfig.auto_deploy_pr) {
          return { ok: true, message: "PR event received but ephemeral PR previews are disabled." };
        }

        return await this.provisionPreview({
          project,
          prNumber,
          prTitle,
          branch,
          commitSha,
        });
      }
    }

    return { ok: true, message: `Event '${event}' acknowledged.` };
  }

  /**
   * Provision Ephemeral Pull Request Preview Environment
   */
  async provisionPreview({ project, prNumber, prTitle, branch, commitSha }) {
    const id = `pr_${project.name}_${prNumber}`;
    const cleanProject = project.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const containerName = `hx_pr_${prNumber}_${cleanProject}`;
    const subdomain = `pr-${prNumber}-${project.name}`;
    const port = 3000 + (prNumber % 1000) + Math.floor(Math.random() * 500);
    const previewUrl = `http://${subdomain}.127-0-0-1.sslip.io`;
    const now = Date.now();

    this.db
      .prepare(
        `
      INSERT INTO pr_previews (
        id, project_name, pr_number, pr_title, branch, commit_sha,
        subdomain, preview_url, container_name, port, status, created_at, updated_at
      ) VALUES (
        @id, @project_name, @pr_number, @pr_title, @branch, @commit_sha,
        @subdomain, @preview_url, @container_name, @port, 'live', @created_at, @updated_at
      ) ON CONFLICT(id) DO UPDATE SET
        pr_title=excluded.pr_title,
        branch=excluded.branch,
        commit_sha=excluded.commit_sha,
        status='live',
        updated_at=excluded.updated_at
    `
      )
      .run({
        id,
        project_name: project.name,
        pr_number: prNumber,
        pr_title: prTitle,
        branch,
        commit_sha: commitSha,
        subdomain,
        preview_url: previewUrl,
        container_name: containerName,
        port,
        created_at: now,
        updated_at: now,
      });

    // Launch isolated preview container
    try {
      spawnSync("docker", ["rm", "-f", containerName]);
      const image = project.source || `${project.name}:latest`;
      spawnSync("docker", [
        "run",
        "-d",
        "--name",
        containerName,
        "--restart",
        "unless-stopped",
        "-p",
        `0.0.0.0:${port}:80`,
        "-e",
        `PORT=80`,
        "-e",
        `PR_NUMBER=${prNumber}`,
        image,
      ]);
    } catch {}

    // Route edge proxy
    if (this.applyRoute) {
      this.applyRoute(subdomain, port, `${subdomain}.127-0-0-1.sslip.io`, `pr-${prNumber}`);
    }

    return {
      ok: true,
      action: "preview_provisioned",
      projectName: project.name,
      prNumber,
      previewUrl,
      subdomain,
    };
  }

  /**
   * Teardown Ephemeral Pull Request Preview Environment
   */
  async teardownPreview(projectName, prNumber) {
    const cleanProject = projectName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const containerName = `hx_pr_${prNumber}_${cleanProject}`;

    try {
      spawnSync("docker", ["rm", "-f", containerName]);
    } catch {}

    this.db
      .prepare("UPDATE pr_previews SET status='stopped', updated_at=? WHERE project_name=? AND pr_number=?")
      .run(Date.now(), projectName, prNumber);

    return {
      ok: true,
      action: "preview_torn_down",
      projectName,
      prNumber,
    };
  }

  listPreviews(projectName = null) {
    if (projectName) {
      return this.db
        .prepare("SELECT * FROM pr_previews WHERE project_name=? ORDER BY updated_at DESC")
        .all(projectName);
    }
    return this.db.prepare("SELECT * FROM pr_previews ORDER BY updated_at DESC").all();
  }

  deletePreview(id) {
    const row = this.db.prepare("SELECT * FROM pr_previews WHERE id=?").get(id);
    if (!row) return false;
    this.teardownPreview(row.project_name, row.pr_number);
    const res = this.db.prepare("DELETE FROM pr_previews WHERE id=?").run(id);
    return res.changes > 0;
  }
}
