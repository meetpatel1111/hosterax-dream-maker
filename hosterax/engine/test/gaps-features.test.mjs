import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  SUPPORTED_GIT_PROVIDERS,
  normalizeGitProvider,
  verifyProviderSignature,
  normalizeProviderWebhookEvent,
} from "../src/webhook-providers.mjs";
import {
  VALID_BUILD_PACKS,
  normalizeBuildPack,
  isValidBuildPack,
  planBuildPackExecution,
} from "../src/buildpacks.mjs";
import { EdgeManager } from "../src/edge-manager.mjs";
import { analyzeDependenciesFromSources } from "../src/dependency-analyzer.mjs";

test("webhook-providers supports GitHub, GitLab, Gitea/Forgejo, and Bitbucket verification & normalization", () => {
  assert.deepEqual(SUPPORTED_GIT_PROVIDERS, [
    "github",
    "gitlab",
    "gitea",
    "forgejo",
    "bitbucket",
  ]);
  assert.equal(normalizeGitProvider("  GITLAB "), "gitlab");
  assert.equal(normalizeGitProvider("svn"), null);

  const secret = "super-webhook-secret";
  const body = JSON.stringify({
    object_kind: "merge_request",
    object_attributes: {
      iid: 77,
      title: "Add billing webhook",
      source_branch: "feat/billing",
      action: "update",
      last_commit: { id: "abc1234567" },
    },
  });

  // GitHub HMAC-SHA256
  const ghSig = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(
    verifyProviderSignature({
      provider: "github",
      rawBodyText: body,
      headers: { "x-hub-signature-256": ghSig },
      secret,
    }).ok,
    true,
  );
  assert.equal(
    verifyProviderSignature({
      provider: "github",
      rawBodyText: body,
      headers: { "x-hub-signature-256": "sha256=deadbeef" },
      secret,
    }).ok,
    false,
  );

  // GitLab X-Gitlab-Token
  assert.equal(
    verifyProviderSignature({
      provider: "gitlab",
      rawBodyText: body,
      headers: { "x-gitlab-token": secret },
      secret,
    }).ok,
    true,
  );
  const glNorm = normalizeProviderWebhookEvent({
    provider: "gitlab",
    headers: { "x-gitlab-event": "Merge Request Hook" },
    payload: JSON.parse(body),
  });
  assert.equal(glNorm.eventType, "pull_request");
  assert.equal(glNorm.action, "synchronize");
  assert.equal(glNorm.prNumber, 77);
  assert.equal(glNorm.branch, "feat/billing");

  // Gitea HMAC hex digest
  const giteaHex = crypto.createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(
    verifyProviderSignature({
      provider: "gitea",
      rawBodyText: body,
      headers: { "x-gitea-signature": giteaHex },
      secret,
    }).ok,
    true,
  );

  // Bitbucket X-Event-Key + HMAC
  const bbBody = JSON.stringify({
    pullrequest: {
      id: 19,
      title: "Fix queue",
      source: { branch: { name: "fix/queue" }, commit: { hash: "99887766" } },
    },
  });
  const bbSig = `sha256=${crypto.createHmac("sha256", secret).update(bbBody).digest("hex")}`;
  assert.equal(
    verifyProviderSignature({
      provider: "bitbucket",
      rawBodyText: bbBody,
      headers: { "x-hub-signature": bbSig },
      secret,
    }).ok,
    true,
  );
  const bbNorm = normalizeProviderWebhookEvent({
    provider: "bitbucket",
    headers: { "x-event-key": "pullrequest:fulfilled" },
    payload: JSON.parse(bbBody),
  });
  assert.equal(bbNorm.eventType, "pull_request");
  assert.equal(bbNorm.action, "closed");
  assert.equal(bbNorm.prNumber, 19);
});

test("buildpacks plans execution and enforces strict dockerfile mode", () => {
  assert.equal(VALID_BUILD_PACKS.includes("nixpacks"), true);
  assert.equal(VALID_BUILD_PACKS.includes("railpack"), true);
  assert.equal(normalizeBuildPack("paketo"), "buildpacks");
  assert.equal(isValidBuildPack("railpack"), true);
  assert.equal(isValidBuildPack("unknown-pack"), false);

  const strictDocker = planBuildPackExecution({ builder: "dockerfile", hasDockerfile: false });
  assert.equal(strictDocker.mode, "dockerfile");
  assert.equal(strictDocker.requiresExistingDockerfile, true);
  assert.equal(strictDocker.allowFallbackToUniversal, false);

  const nixPlan = planBuildPackExecution({
    builder: "nixpacks",
    tag: "hx/demo:1",
  });
  assert.equal(nixPlan.mode, "external-builder");
  assert.equal(nixPlan.toolBinary, "nixpacks");
  assert.equal(nixPlan.allowFallbackToUniversal, true);

  const railPlan = planBuildPackExecution({ builder: "railpack", tag: "hx/demo:2" });
  assert.equal(railPlan.toolBinary, "railpack");

  const cnbPlan = planBuildPackExecution({ builder: "buildpacks", tag: "hx/demo:3" });
  assert.equal(cnbPlan.toolBinary, "pack");

  const composePlan = planBuildPackExecution({
    builder: "auto",
    hasDockerfile: false,
    hasCompose: true,
  });
  assert.equal(composePlan.mode, "compose");
});

test("EdgeManager generates multi-upstream load-balanced Caddy & OpenResty configs when replicas > 1", async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "hx-edge-lb-"));
  try {
    const db = new DatabaseSync(":memory:");
    const em = new EdgeManager({ db, homeDir: tmpHome });

    const routes = [
      {
        project: "web-scaled",
        port: 4100,
        ports: [4100, 4101, 4102],
        healthPath: "/healthz",
        hostnames: ["web-scaled.localhost"],
        domains: [],
      },
      {
        project: "api-single",
        port: 4200,
        ports: [4200],
        healthPath: "/",
        hostnames: ["api-single.localhost"],
        domains: [],
      },
    ];
    const settings = em.getSettings();

    const caddyPath = await em.generateCaddyfile(routes, settings);
    const caddyConf = fs.readFileSync(caddyPath, "utf8");
    assert.match(caddyConf, /reverse_proxy 127\.0\.0\.1:4100 127\.0\.0\.1:4101 127\.0\.0\.1:4102/);
    assert.match(caddyConf, /lb_policy least_conn/);
    assert.match(caddyConf, /health_uri \/healthz/);
    assert.match(caddyConf, /reverse_proxy 127\.0\.0\.1:4200 \{/);

    await em.generateOpenRestyConfigs(routes, settings);
    const scaledNginx = fs.readFileSync(path.join(em.openrestySitesDir, "web-scaled.conf"), "utf8");
    assert.match(scaledNginx, /upstream hx_up_web_scaled/);
    assert.match(scaledNginx, /server 127\.0\.0\.1:4100 max_fails=3 fail_timeout=15s;/);
    assert.match(scaledNginx, /server 127\.0\.0\.1:4101 max_fails=3 fail_timeout=15s;/);
    assert.match(scaledNginx, /server 127\.0\.0\.1:4102 max_fails=3 fail_timeout=15s;/);
    assert.match(scaledNginx, /proxy_pass http:\/\/hx_up_web_scaled;/);

    const singleNginx = fs.readFileSync(path.join(em.openrestySitesDir, "api-single.conf"), "utf8");
    assert.doesNotMatch(singleNginx, /upstream hx_up_api_single/);
    assert.match(singleNginx, /proxy_pass http:\/\/127\.0\.0\.1:4200;/);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("dependency-analyzer detects ClickHouse, LibSQL, and new curated app blueprints", () => {
  const ch = analyzeDependenciesFromSources({
    image: "myorg/analytics-worker:latest",
    appName: "analytics-worker",
    envExample: "CLICKHOUSE_URL=http://localhost:8123/default\n",
  });
  assert.equal(
    ch.databases.some((d) => d.engine === "clickhouse"),
    true,
  );

  const lq = analyzeDependenciesFromSources({
    image: "myorg/edge-api:latest",
    appName: "edge-api",
    envExample: "LIBSQL_URL=libsql://127.0.0.1:8080\n",
  });
  assert.equal(
    lq.databases.some((d) => d.engine === "libsql"),
    true,
  );

  const authentik = analyzeDependenciesFromSources({
    image: "ghcr.io/goauthentik/server:2024.8",
    appName: "authentik",
  });
  assert.equal(authentik.detectedPort, 9000);
  assert.equal(
    authentik.databases.some((d) => d.engine === "postgres"),
    true,
  );
  assert.equal(
    authentik.databases.some((d) => d.engine === "redis"),
    true,
  );
});
