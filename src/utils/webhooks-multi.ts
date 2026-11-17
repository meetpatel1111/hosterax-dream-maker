export type GitWebhookProvider = "github" | "gitlab" | "gitea" | "forgejo" | "bitbucket";

export interface WebhookProviderSpec {
  id: GitWebhookProvider;
  label: string;
  shortLabel: string;
  eventHeader: string;
  signatureHeader: string;
  signatureMethod: string;
  supportsPrPreviews: boolean;
  defaultEvents: string[];
}

export const WEBHOOK_PROVIDER_SPECS: WebhookProviderSpec[] = [
  {
    id: "github",
    label: "GitHub",
    shortLabel: "GitHub",
    eventHeader: "X-GitHub-Event",
    signatureHeader: "X-Hub-Signature-256",
    signatureMethod: "HMAC-SHA256 (sha256=<hex>)",
    supportsPrPreviews: true,
    defaultEvents: ["push", "pull_request (opened, synchronize, closed)", "delete"],
  },
  {
    id: "gitlab",
    label: "GitLab",
    shortLabel: "GitLab",
    eventHeader: "X-Gitlab-Event",
    signatureHeader: "X-Gitlab-Token",
    signatureMethod: "Secret Token Header (X-Gitlab-Token)",
    supportsPrPreviews: true,
    defaultEvents: ["Push Hook", "Merge Request Hook (open, update, merge, close)"],
  },
  {
    id: "gitea",
    label: "Gitea / Forgejo",
    shortLabel: "Gitea / Forgejo",
    eventHeader: "X-Gitea-Event",
    signatureHeader: "X-Gitea-Signature",
    signatureMethod: "HMAC-SHA256 hex digest",
    supportsPrPreviews: true,
    defaultEvents: ["push", "pull_request (opened, synchronized, closed)"],
  },
  {
    id: "bitbucket",
    label: "Bitbucket",
    shortLabel: "Bitbucket",
    eventHeader: "X-Event-Key",
    signatureHeader: "X-Hub-Signature",
    signatureMethod: "HMAC-SHA256 (sha256=<hex>)",
    supportsPrPreviews: true,
    defaultEvents: ["repo:push", "pullrequest:created / updated / fulfilled / rejected"],
  },
];

export function getWebhookProviderSpec(provider: GitWebhookProvider | string): WebhookProviderSpec {
  const norm = String(provider || "github").toLowerCase();
  if (norm === "forgejo") {
    return WEBHOOK_PROVIDER_SPECS.find((p) => p.id === "gitea")!;
  }
  return WEBHOOK_PROVIDER_SPECS.find((p) => p.id === norm) || WEBHOOK_PROVIDER_SPECS[0];
}

export function buildPublicWebhookUrl(
  baseUrl: string,
  provider: GitWebhookProvider | string,
  projectName?: string,
): string {
  const cleanBase = String(baseUrl || "").replace(/\/+$/, "");
  const norm = String(provider || "github").toLowerCase();
  const path = projectName
    ? `/webhooks/${encodeURIComponent(norm)}/${encodeURIComponent(projectName)}`
    : `/webhooks/${encodeURIComponent(norm)}`;
  return `${cleanBase}${path}`;
}

export function buildApiWebhookSimulatorPayload({
  provider,
  action,
  prNumber,
  branch,
  projectName,
}: {
  provider: GitWebhookProvider;
  action: "opened" | "synchronize" | "closed";
  prNumber: number;
  branch: string;
  projectName: string;
}): {
  endpointPath: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
} {
  const cleanProj = encodeURIComponent(projectName);
  const title = `PR #${prNumber}: ${branch}`;

  if (provider === "gitlab") {
    const state = action === "closed" ? "closed" : "opened";
    const glAction = action === "synchronize" ? "update" : action === "closed" ? "close" : "open";
    return {
      endpointPath: `/api/projects/${cleanProj}/webhooks/gitlab`,
      headers: { "x-gitlab-event": "Merge Request Hook" },
      body: {
        object_kind: "merge_request",
        event_type: "merge_request",
        project: { name: projectName, path_with_namespace: `team/${projectName}` },
        object_attributes: {
          iid: prNumber,
          title,
          source_branch: branch,
          target_branch: "main",
          state,
          action: glAction,
          last_commit: { id: "HEAD" },
        },
      },
    };
  }

  if (provider === "bitbucket") {
    const eventKey =
      action === "closed"
        ? "pullrequest:rejected"
        : action === "synchronize"
          ? "pullrequest:updated"
          : "pullrequest:created";
    return {
      endpointPath: `/api/projects/${cleanProj}/webhooks/bitbucket`,
      headers: { "x-event-key": eventKey },
      body: {
        repository: { name: projectName, full_name: `team/${projectName}` },
        pullrequest: {
          id: prNumber,
          title,
          state: action === "closed" ? "DECLINED" : "OPEN",
          source: {
            branch: { name: branch },
            commit: { hash: "HEAD" },
          },
          destination: {
            branch: { name: "main" },
          },
        },
      },
    };
  }

  const isGitea = provider === "gitea" || provider === "forgejo";
  return {
    endpointPath: `/api/projects/${cleanProj}/webhooks/${isGitea ? "gitea" : "github"}`,
    headers: isGitea ? { "x-gitea-event": "pull_request" } : { "x-github-event": "pull_request" },
    body: {
      action,
      number: prNumber,
      pull_request: {
        number: prNumber,
        title,
        head: {
          ref: branch,
          sha: "HEAD",
        },
      },
      repository: {
        name: projectName,
      },
    },
  };
}
