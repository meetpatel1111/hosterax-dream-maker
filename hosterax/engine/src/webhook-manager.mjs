// hosterax/engine/src/webhook-manager.mjs
// GitHub App Webhooks & Ephemeral PR Preview Environments Subsystem for HosteraX
// Handles Push-to-Deploy, cryptographic signature verification (HMAC-SHA256), and ephemeral preview lifecycles.

import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isSafeImageRef } from "./security.mjs";
import { normalizeGitRepoSlug } from "./enterprise-apis.mjs";

const execFileAsync = promisify(execFile);

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
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id TEXT PRIMARY KEY,
        project_name TEXT,
        provider TEXT NOT NULL DEFAULT 'github',
        event TEXT NOT NULL,
        delivery_guid TEXT,
        status_code INTEGER NOT NULL,
        ok INTEGER NOT NULL DEFAULT 0,
        action TEXT,
        message TEXT,
        payload_json TEXT,
        received_at INTEGER NOT NULL
      );
    `);
  }

  recordDelivery({
    projectName = null,
    provider = "github",
    event = "push",
    deliveryGuid = null,
    statusCode = 200,
    ok = true,
    action = null,
    message = null,
    payloadJson = null,
  }) {
    try {
      this.db
        .prepare(
          `INSERT INTO webhook_deliveries (id, project_name, provider, event, delivery_guid, status_code, ok, action, message, payload_json, received_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          "whd_" + crypto.randomBytes(6).toString("hex"),
          projectName,
          provider,
          event,
          deliveryGuid,
          statusCode,
          ok ? 1 : 0,
          action,
          message,
          payloadJson ? String(payloadJson).slice(0, 65536) : null,
          Date.now(),
        );
    } catch {}
  }

  allocatePreviewPort(prNumber, excludeProject = null) {
    const taken = new Set([7777, 8080, 3000, 5173]);
    for (const tbl of [
      ["projects", "port"],
      ["managed_dbs", "port"],
      ["pr_previews", "port"],
    ]) {
      try {
        for (const r of this.db.prepare(`SELECT ${tbl[1]} AS p FROM ${tbl[0]}`).all()) {
          if (r.p) taken.add(Number(r.p));
        }
      } catch {}
    }
    if (excludeProject) {
      try {
        const existing = this.db
          .prepare("SELECT port FROM pr_previews WHERE id=?")
          .get(`pr_${excludeProject}_${prNumber}`);
        if (existing?.port) return Number(existing.port);
      } catch {}
    }
    let port = 4100 + (Math.abs(Number(prNumber) || 1) % 4000);
    while (taken.has(port) && port < 60000) port += 1;
    return port;
  }

  getProjectWebhookConfig(projectName) {
    const row = this.db
      .prepare("SELECT * FROM webhook_secrets WHERE project_name=?")
      .get(projectName);
    if (row) return row;

    const secret = crypto.randomBytes(20).toString("hex");
    const webhookToken = `whk_${crypto.randomBytes(16).toString("hex")}`;
    const now = Date.now();

    this.db
      .prepare(
        `
      INSERT INTO webhook_secrets (project_name, secret, webhook_token, auto_deploy_push, auto_deploy_pr, tracked_branch, created_at, updated_at)
      VALUES (?, ?, ?, 1, 1, 'main', ?, ?)
    `,
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
    `,
      )
      .run(merged);

    return this.getProjectWebhookConfig(projectName);
  }

  verifyGitHubSignature(rawBodyText, signatureHeader, secret) {
    if (!signatureHeader || !secret) return false;
    const hmac = crypto.createHmac("sha256", secret);
    const digest = `sha256=${hmac.update(rawBodyText).digest("hex")}`;
    const a = Buffer.from(String(signatureHeader));
    const b = Buffer.from(digest);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async handleGitHubWebhook({
    event,
    payload,
    rawBodyText,
    signatureHeader,
    projectName = null,
    requireSignature = false,
    deliveryGuid = null,
  }) {
    if (event === "ping" && !requireSignature) {
      this.recordDelivery({
        projectName,
        event,
        deliveryGuid,
        statusCode: 200,
        ok: true,
        action: "ping",
        message: "Pong! Webhook active.",
        payloadJson: rawBodyText,
      });
      return { ok: true, message: "Pong! Webhook active.", zen: payload?.zen };
    }

    let project = null;
    if (projectName) {
      project = this.db.prepare("SELECT * FROM projects WHERE name=?").get(projectName);
    }

    if (!project && payload?.repository) {
      const targetSlug = normalizeGitRepoSlug(
        payload.repository.clone_url || payload.repository.html_url || "",
      );
      const repoFull = String(payload.repository.full_name || "").toLowerCase();
      const candidates = this.db
        .prepare("SELECT * FROM projects WHERE COALESCE(status,'') <> 'archived'")
        .all();
      project =
        candidates.find((c) => {
          const pSlug =
            c.git_owner && c.git_repo
              ? `${c.git_owner}/${c.git_repo}`.toLowerCase()
              : normalizeGitRepoSlug(c.source);
          return (repoFull && pSlug === repoFull) || (targetSlug && pSlug === targetSlug);
        }) || null;
    }

    if (!project) {
      this.recordDelivery({
        projectName,
        event,
        deliveryGuid,
        statusCode: 404,
        ok: false,
        message: "No matching project found for webhook repository.",
        payloadJson: rawBodyText,
      });
      return { ok: false, message: "No matching project found for webhook repository." };
    }

    const whConfig = this.getProjectWebhookConfig(project.name);

    if (requireSignature || signatureHeader) {
      if (!this.verifyGitHubSignature(rawBodyText, signatureHeader, whConfig.secret)) {
        this.recordDelivery({
          projectName: project.name,
          event,
          deliveryGuid,
          statusCode: 401,
          ok: false,
          message: "Invalid or missing GitHub webhook signature (HMAC-SHA256).",
          payloadJson: rawBodyText,
        });
        const err = new Error("Invalid or missing GitHub webhook signature (HMAC-SHA256).");
        err.status = 401;
        throw err;
      }
    }
    if (event === "ping") {
      this.recordDelivery({
        projectName: project.name,
        event,
        deliveryGuid,
        statusCode: 200,
        ok: true,
        action: "ping",
        message: "Pong! Webhook active.",
        payloadJson: rawBodyText,
      });
      return { ok: true, message: "Pong! Webhook active.", zen: payload?.zen };
    }

    if (event === "push") {
      if (!whConfig.auto_deploy_push) {
        this.recordDelivery({
          projectName: project.name,
          event,
          deliveryGuid,
          statusCode: 200,
          ok: true,
          action: "skipped",
          message: "Push received but auto-deploy is disabled.",
          payloadJson: rawBodyText,
        });
        return { ok: true, message: "Push received but auto-deploy is disabled for this project." };
      }

      const ref = payload.ref || "";
      const branch = ref.replace("refs/heads/", "");
      const tracked = whConfig.tracked_branch || "main";

      if (branch !== tracked && !ref.endsWith(`/${tracked}`)) {
        this.recordDelivery({
          projectName: project.name,
          event,
          deliveryGuid,
          statusCode: 200,
          ok: true,
          action: "ignored_branch",
          message: `Push ignored on branch '${branch}'`,
          payloadJson: rawBodyText,
        });
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

      this.recordDelivery({
        projectName: project.name,
        event,
        deliveryGuid,
        statusCode: 200,
        ok: true,
        action: "deploy_triggered",
        message: `Triggered push deploy on ${branch} (${commitSha.slice(0, 7)})`,
        payloadJson: rawBodyText,
      });

      return {
        ok: true,
        action: "deploy_triggered",
        project: project.name,
        branch,
        commit: commitSha.slice(0, 7),
      };
    }

    if (event === "pull_request") {
      const action = payload.action;
      const prNumber = payload.number;
      const prTitle = payload.pull_request?.title || `PR #${prNumber}`;
      const branch = payload.pull_request?.head?.ref || `pr-${prNumber}`;
      const commitSha = payload.pull_request?.head?.sha || "HEAD";

      if (action === "closed") {
        const res = await this.teardownPreview(project.name, prNumber);
        this.recordDelivery({
          projectName: project.name,
          event,
          deliveryGuid,
          statusCode: 200,
          ok: true,
          action: "preview_torn_down",
          message: `Closed PR #${prNumber} preview`,
          payloadJson: rawBodyText,
        });
        return res;
      }

      if (action === "opened" || action === "synchronize" || action === "reopened") {
        if (!whConfig.auto_deploy_pr) {
          this.recordDelivery({
            projectName: project.name,
            event,
            deliveryGuid,
            statusCode: 200,
            ok: true,
            action: "skipped",
            message: "PR preview disabled",
            payloadJson: rawBodyText,
          });
          return { ok: true, message: "PR event received but ephemeral PR previews are disabled." };
        }

        const res = await this.provisionPreview({
          project,
          prNumber,
          prTitle,
          branch,
          commitSha,
        });
        this.recordDelivery({
          projectName: project.name,
          event,
          deliveryGuid,
          statusCode: 200,
          ok: true,
          action: "preview_provisioned",
          message: `Provisioned PR #${prNumber} (${branch})`,
          payloadJson: rawBodyText,
        });
        return res;
      }
    }

    this.recordDelivery({
      projectName: project.name,
      event,
      deliveryGuid,
      statusCode: 200,
      ok: true,
      action: "acknowledged",
      message: `Event '${event}' acknowledged.`,
      payloadJson: rawBodyText,
    });
    return { ok: true, message: `Event '${event}' acknowledged.` };
  }

  async provisionPreview({ project, prNumber, prTitle, branch, commitSha }) {
    const id = `pr_${project.name}_${prNumber}`;
    const cleanProject = project.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const containerName = `hx_pr_${prNumber}_${cleanProject}`;
    const subdomain = `pr-${prNumber}-${project.name}`;
    const port = this.allocatePreviewPort(prNumber, project.name);
    const previewUrl = `http://${subdomain}.127-0-0-1.sslip.io`;
    const now = Date.now();
    const bindHost = /^[0-9.]+$|^::1?$/.test(process.env.HOSTERAX_BIND_HOST || "")
      ? process.env.HOSTERAX_BIND_HOST
      : "127.0.0.1";

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
    `,
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

    // Launch isolated preview container asynchronously only when image reference is valid
    const imageCandidate = isSafeImageRef(project.source) ? project.source : `${cleanProject}:latest`;
    if (isSafeImageRef(imageCandidate)) {
      execFileAsync("docker", ["rm", "-f", containerName], { timeout: 10000 })
        .catch(() => {})
        .then(() =>
          execFileAsync(
            "docker",
            [
              "run",
              "-d",
              "--name",
              containerName,
              "--restart",
              "unless-stopped",
              "-p",
              `${bindHost}:${port}:80`,
              "-e",
              "PORT=80",
              "-e",
              `PR_NUMBER=${Number(prNumber) || 0}`,
              imageCandidate,
            ],
            { timeout: 15000 },
          ).catch(() => {}),
        );
    }

    if (this.applyRoute) {
      this.applyRoute(subdomain, port, `${subdomain}.127-0-0-1.sslip.io`, `pr-${prNumber}`);
    }

    return {
      ok: true,
      id,
      status: "live",
      action: "preview_provisioned",
      projectName: project.name,
      prNumber,
      port,
      previewUrl,
      subdomain,
    };
  }

  async teardownPreview(projectName, prNumber) {
    const cleanProject = projectName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const containerName = `hx_pr_${prNumber}_${cleanProject}`;

    execFileAsync("docker", ["rm", "-f", containerName], { timeout: 10000 }).catch(() => {});

    this.db
      .prepare(
        "UPDATE pr_previews SET status='stopped', updated_at=? WHERE project_name=? AND pr_number=?",
      )
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

  sleepPreview(id) {
    const row = this.db.prepare("SELECT * FROM pr_previews WHERE id=?").get(id);
    if (!row) return null;
    if (row.container_name) {
      execFileAsync("docker", ["stop", row.container_name], { timeout: 10000 }).catch(() => {});
    }
    this.db
      .prepare("UPDATE pr_previews SET status='sleeping', updated_at=? WHERE id=?")
      .run(Date.now(), id);
    return this.db.prepare("SELECT * FROM pr_previews WHERE id=?").get(id);
  }

  wakePreview(id) {
    const row = this.db.prepare("SELECT * FROM pr_previews WHERE id=?").get(id);
    if (!row) return null;
    if (row.container_name) {
      execFileAsync("docker", ["start", row.container_name], { timeout: 10000 }).catch(() => {});
    }
    this.db
      .prepare("UPDATE pr_previews SET status='live', updated_at=? WHERE id=?")
      .run(Date.now(), id);
    return this.db.prepare("SELECT * FROM pr_previews WHERE id=?").get(id);
  }

  deletePreview(id) {
    const row = this.db.prepare("SELECT * FROM pr_previews WHERE id=?").get(id);
    if (!row) return false;
    void this.teardownPreview(row.project_name, row.pr_number);
    const res = this.db.prepare("DELETE FROM pr_previews WHERE id=?").run(id);
    return res.changes > 0;
  }
}
