// hosterax/engine/src/webhook-providers.mjs
// Pure multi-provider webhook verification & payload normalization
// Supports GitHub, GitLab, Gitea, Forgejo, and Bitbucket.

import crypto from "node:crypto";

export const SUPPORTED_GIT_PROVIDERS = ["github", "gitlab", "gitea", "forgejo", "bitbucket"];

export function normalizeGitProvider(raw) {
  const clean = String(raw || "github")
    .trim()
    .toLowerCase();
  if (SUPPORTED_GIT_PROVIDERS.includes(clean)) return clean;
  return null;
}

function timingSafeStrEqual(a, b) {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  return bufA.length === bufB.length && bufA.length > 0 && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies cryptographic webhook signatures / tokens per Git provider.
 * Returns { ok: boolean, reason?: string }.
 */
export function verifyProviderSignature({
  provider = "github",
  rawBodyText = "",
  headers = {},
  signatureHeader = "",
  secret = "",
}) {
  const prov = normalizeGitProvider(provider);
  if (!prov) {
    return { ok: false, reason: `Unsupported Git webhook provider: ${provider}` };
  }
  if (!secret) {
    return { ok: false, reason: "Missing project webhook secret" };
  }

  const lowerHeaders = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (v !== undefined && v !== null) lowerHeaders[k.toLowerCase()] = String(v);
  }

  if (prov === "gitlab") {
    const token =
      signatureHeader || lowerHeaders["x-gitlab-token"] || "";
    if (!token) {
      return { ok: false, reason: "Missing X-Gitlab-Token header" };
    }
    return timingSafeStrEqual(token, secret)
      ? { ok: true }
      : { ok: false, reason: "Invalid GitLab webhook secret token (X-Gitlab-Token)." };
  }

  if (prov === "gitea" || prov === "forgejo") {
    const sig =
      signatureHeader ||
      lowerHeaders["x-gitea-signature"] ||
      lowerHeaders["x-forgejo-signature"] ||
      lowerHeaders["x-hub-signature-256"] ||
      "";
    if (!sig) {
      return { ok: false, reason: `Missing ${prov === "forgejo" ? "X-Forgejo-Signature" : "X-Gitea-Signature"} header` };
    }
    const hex = crypto.createHmac("sha256", secret).update(rawBodyText).digest("hex");
    if (timingSafeStrEqual(sig, hex) || timingSafeStrEqual(sig, `sha256=${hex}`)) {
      return { ok: true };
    }
    return { ok: false, reason: `Invalid ${prov} HMAC-SHA256 webhook signature.` };
  }

  if (prov === "bitbucket") {
    const sig =
      signatureHeader ||
      lowerHeaders["x-hub-signature-256"] ||
      lowerHeaders["x-hub-signature"] ||
      "";
    if (!sig) {
      return { ok: false, reason: "Missing Bitbucket X-Hub-Signature header" };
    }
    const hex = crypto.createHmac("sha256", secret).update(rawBodyText).digest("hex");
    if (timingSafeStrEqual(sig, `sha256=${hex}`) || timingSafeStrEqual(sig, hex)) {
      return { ok: true };
    }
    return { ok: false, reason: "Invalid Bitbucket HMAC-SHA256 webhook signature." };
  }

  // Default: GitHub X-Hub-Signature-256
  const sig = signatureHeader || lowerHeaders["x-hub-signature-256"] || "";
  if (!sig) {
    return { ok: false, reason: "Missing X-Hub-Signature-256 header" };
  }
  const digest = `sha256=${crypto.createHmac("sha256", secret).update(rawBodyText).digest("hex")}`;
  return timingSafeStrEqual(sig, digest)
    ? { ok: true }
    : { ok: false, reason: "Invalid GitHub webhook signature (HMAC-SHA256)." };
}

/**
 * Normalizes push, ping, and PR/MR events from GitHub, GitLab, Gitea, Forgejo, and Bitbucket
 * into a unified HosteraX webhook event descriptor.
 */
export function normalizeProviderWebhookEvent({
  provider = "github",
  headers = {},
  event = "",
  payload = {},
}) {
  const prov = normalizeGitProvider(provider) || "github";
  const lowerHeaders = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (v !== undefined && v !== null) lowerHeaders[k.toLowerCase()] = String(v);
  }

  if (prov === "gitlab") {
    const rawEvent = String(
      event || lowerHeaders["x-gitlab-event"] || payload?.object_kind || "push",
    ).toLowerCase();
    const repoUrl = payload?.project?.git_http_url || payload?.project?.web_url || "";
    const repoFullName = payload?.project?.path_with_namespace || "";

    if (rawEvent.includes("merge request") || payload?.object_kind === "merge_request") {
      const attrs = payload?.object_attributes || {};
      const rawAct = String(attrs.action || "open").toLowerCase();
      let action = "opened";
      if (rawAct === "close" || rawAct === "merge") action = "closed";
      else if (rawAct === "update") action = "synchronize";
      else if (rawAct === "reopen") action = "reopened";
      const prNumber = Number(attrs.iid || attrs.id || payload?.number || 1);
      return {
        provider: "gitlab",
        rawEvent,
        eventType: "pull_request",
        action,
        prNumber,
        prTitle: attrs.title || `MR !${prNumber}`,
        branch: attrs.source_branch || `mr-${prNumber}`,
        commitSha: attrs.last_commit?.id || payload?.after || "HEAD",
        commitMsg: attrs.title || "Merge Request",
        repoFullName,
        repoUrl,
      };
    }

    if (rawEvent.includes("push") || payload?.object_kind === "push") {
      const ref = String(payload?.ref || "");
      return {
        provider: "gitlab",
        rawEvent,
        eventType: "push",
        action: "push",
        branch: ref.replace(/^refs\/heads\//, ""),
        commitSha: payload?.after || payload?.checkout_sha || payload?.commits?.[0]?.id || "HEAD",
        commitMsg: payload?.commits?.[0]?.message || "GitLab push-to-deploy",
        repoFullName,
        repoUrl,
      };
    }

    return {
      provider: "gitlab",
      rawEvent,
      eventType: rawEvent === "ping" ? "ping" : "other",
      action: rawEvent,
      repoFullName,
      repoUrl,
    };
  }

  if (prov === "bitbucket") {
    const rawEvent = String(event || lowerHeaders["x-event-key"] || "repo:push").toLowerCase();
    const repoFullName = payload?.repository?.full_name || "";
    const repoUrl = payload?.repository?.links?.html?.href || "";

    if (rawEvent.startsWith("pullrequest:")) {
      const pr = payload?.pullrequest || {};
      let action = "opened";
      if (rawEvent === "pullrequest:fulfilled" || rawEvent === "pullrequest:rejected") {
        action = "closed";
      } else if (rawEvent === "pullrequest:updated") {
        action = "synchronize";
      }
      const prNumber = Number(pr.id || payload?.number || 1);
      return {
        provider: "bitbucket",
        rawEvent,
        eventType: "pull_request",
        action,
        prNumber,
        prTitle: pr.title || `PR #${prNumber}`,
        branch: pr.source?.branch?.name || `pr-${prNumber}`,
        commitSha: pr.source?.commit?.hash || "HEAD",
        commitMsg: pr.title || "Pull Request",
        repoFullName,
        repoUrl,
      };
    }

    if (rawEvent === "repo:push") {
      const change = payload?.push?.changes?.[0];
      const target = change?.new;
      return {
        provider: "bitbucket",
        rawEvent,
        eventType: "push",
        action: "push",
        branch: target?.name || "main",
        commitSha: target?.target?.hash || "HEAD",
        commitMsg: target?.target?.message || "Bitbucket push-to-deploy",
        repoFullName,
        repoUrl,
      };
    }

    return {
      provider: "bitbucket",
      rawEvent,
      eventType: "other",
      action: rawEvent,
      repoFullName,
      repoUrl,
    };
  }

  // GitHub, Gitea, Forgejo all use GitHub-compatible JSON schemas
  const rawEvent = String(
    event ||
      lowerHeaders["x-github-event"] ||
      lowerHeaders["x-gitea-event"] ||
      lowerHeaders["x-forgejo-event"] ||
      "push",
  ).toLowerCase();
  const repoFullName = payload?.repository?.full_name || "";
  const repoUrl = payload?.repository?.clone_url || payload?.repository?.html_url || "";

  if (rawEvent === "ping") {
    return {
      provider: prov,
      rawEvent,
      eventType: "ping",
      action: "ping",
      zen: payload?.zen,
      repoFullName,
      repoUrl,
    };
  }

  if (rawEvent === "pull_request") {
    const rawAction = String(payload?.action || "opened").toLowerCase();
    const action = rawAction === "synchronized" ? "synchronize" : rawAction;
    const prNumber = Number(payload?.number || payload?.pull_request?.number || 1);
    return {
      provider: prov,
      rawEvent,
      eventType: "pull_request",
      action,
      prNumber,
      prTitle: payload?.pull_request?.title || `PR #${prNumber}`,
      branch: payload?.pull_request?.head?.ref || `pr-${prNumber}`,
      commitSha: payload?.pull_request?.head?.sha || "HEAD",
      commitMsg: payload?.pull_request?.title || "Pull Request",
      repoFullName,
      repoUrl,
    };
  }

  if (rawEvent === "push") {
    const ref = String(payload?.ref || "");
    return {
      provider: prov,
      rawEvent,
      eventType: "push",
      action: "push",
      branch: ref.replace(/^refs\/heads\//, ""),
      commitSha: payload?.after || payload?.head_commit?.id || "HEAD",
      commitMsg: payload?.head_commit?.message || `${prov} push-to-deploy`,
      repoFullName,
      repoUrl,
    };
  }

  return {
    provider: prov,
    rawEvent,
    eventType: "other",
    action: rawEvent,
    repoFullName,
    repoUrl,
  };
}
