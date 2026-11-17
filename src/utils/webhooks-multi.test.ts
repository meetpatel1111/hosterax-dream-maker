import test from "node:test";
import assert from "node:assert/strict";
import {
  WEBHOOK_PROVIDER_SPECS,
  getWebhookProviderSpec,
  buildPublicWebhookUrl,
  buildApiWebhookSimulatorPayload,
} from "./webhooks-multi";

test("WEBHOOK_PROVIDER_SPECS exposes all 4 primary providers and forgejo alias resolves to gitea", () => {
  assert.equal(WEBHOOK_PROVIDER_SPECS.length, 4);
  assert.equal(getWebhookProviderSpec("github").eventHeader, "X-GitHub-Event");
  assert.equal(getWebhookProviderSpec("gitlab").signatureHeader, "X-Gitlab-Token");
  assert.equal(getWebhookProviderSpec("forgejo").id, "gitea");
  assert.equal(getWebhookProviderSpec("bitbucket").eventHeader, "X-Event-Key");
});

test("buildPublicWebhookUrl encodes provider and optional project slug", () => {
  assert.equal(
    buildPublicWebhookUrl("http://localhost:7777/", "gitlab", "my app"),
    "http://localhost:7777/webhooks/gitlab/my%20app",
  );
  assert.equal(
    buildPublicWebhookUrl("https://hx.example.com", "bitbucket"),
    "https://hx.example.com/webhooks/bitbucket",
  );
});

test("buildApiWebhookSimulatorPayload builds provider-accurate headers and bodies", () => {
  const gl = buildApiWebhookSimulatorPayload({
    provider: "gitlab",
    action: "synchronize",
    prNumber: 44,
    branch: "feat/gl-mr",
    projectName: "demo-api",
  });
  assert.equal(gl.endpointPath, "/api/projects/demo-api/webhooks/gitlab");
  assert.equal(gl.headers["x-gitlab-event"], "Merge Request Hook");
  assert.equal((gl.body.object_attributes as any).action, "update");

  const bb = buildApiWebhookSimulatorPayload({
    provider: "bitbucket",
    action: "closed",
    prNumber: 9,
    branch: "fix/bb",
    projectName: "demo-api",
  });
  assert.equal(bb.headers["x-event-key"], "pullrequest:rejected");

  const gitea = buildApiWebhookSimulatorPayload({
    provider: "gitea",
    action: "opened",
    prNumber: 12,
    branch: "feat/forge",
    projectName: "demo-api",
  });
  assert.equal(gitea.headers["x-gitea-event"], "pull_request");
});
