/**
 * Ephemeral Preview Environments & PR Staging Utilities
 */

import type { PRPreview } from "../lib/engine";

export interface PreviewFleetMetrics {
  total: number;
  live: number;
  deploying: number;
  stopped: number;
  failed: number;
  activeRamMb: number;
  reclaimedRamMb: number;
  savingsPercentage: number;
}

export interface PreviewFilters {
  searchQuery?: string;
  projectName?: string;
  status?: "all" | "live" | "deploying" | "stopped" | "sleeping" | "failed";
}

export interface PrBotCommentParams {
  projectName: string;
  prNumber: number;
  prTitle: string;
  branch: string;
  commitSha: string;
  previewUrl: string;
  status: "live" | "deploying" | "failed" | "stopped" | "sleeping";
  containerName?: string;
  port?: number;
  sleepTimeoutMinutes?: number;
}

/**
 * Calculates aggregate fleet metrics for ephemeral preview environments
 */
export function calculatePreviewFleetMetrics(
  previews: PRPreview[],
  averageContainerRamMb = 256,
): PreviewFleetMetrics {
  let live = 0;
  let deploying = 0;
  let stopped = 0;
  let failed = 0;

  for (const p of previews) {
    if (p.status === "live") live++;
    else if (p.status === "deploying") deploying++;
    else if (p.status === "stopped" || p.status === "sleeping") stopped++;
    else if (p.status === "failed") failed++;
  }

  const total = previews.length;
  const activeRamMb = (live + deploying) * averageContainerRamMb;
  const reclaimedRamMb = stopped * averageContainerRamMb;
  const totalPotentialRamMb = total * averageContainerRamMb;

  const savingsPercentage =
    totalPotentialRamMb > 0 ? Math.round((reclaimedRamMb / totalPotentialRamMb) * 100) : 0;

  return {
    total,
    live,
    deploying,
    stopped,
    failed,
    activeRamMb,
    reclaimedRamMb,
    savingsPercentage,
  };
}

/**
 * Generates an automated GitHub / GitLab PR comment markdown
 */
export function generatePrBotComment(params: PrBotCommentParams): string {
  const {
    projectName,
    prNumber,
    prTitle,
    branch,
    commitSha,
    previewUrl,
    status,
    containerName,
    port = 3000,
    sleepTimeoutMinutes = 30,
  } = params;

  const shortSha = commitSha ? commitSha.substring(0, 7) : "HEAD";
  const statusEmoji =
    status === "live"
      ? "🟢 **Ready**"
      : status === "deploying"
        ? "🟡 **Deploying...**"
        : status === "stopped" || status === "sleeping"
          ? "💤 **Sleeping (Scale-to-Zero)**"
          : "🔴 **Deployment Failed**";

  const lines = [
    `### 🚀 HosteraX Ephemeral Preview Environment`,
    ``,
    `| Attribute | Value |`,
    `| :--- | :--- |`,
    `| **Project** | \`${projectName}\` |`,
    `| **Pull Request** | #${prNumber} — ${prTitle} |`,
    `| **Branch** | \`${branch}\` (\`${shortSha}\`) |`,
    `| **Status** | ${statusEmoji} |`,
    `| **Preview URL** | [${previewUrl}](${previewUrl}) |`,
  ];

  if (containerName) {
    lines.push(`| **Container** | \`${containerName}\` (Internal Port: \`${port}\`) |`);
  }

  if (sleepTimeoutMinutes > 0) {
    lines.push(
      `| **Scale-to-Zero** | Suspends after ${sleepTimeoutMinutes}m of inactivity (wakes instantly on request) |`,
    );
  }

  lines.push(
    ``,
    `*Environment automatically synchronizes with commit pushes and destroys when this PR is closed.*`,
    `*Powered by [HosteraX Self-Hosted PaaS](https://github.com/oblien/openship)*`,
  );

  return lines.join("\n");
}

/**
 * Evaluates whether an ephemeral preview should sleep or hibernate based on idle timeout
 */
export function evaluateAutoSleepTtl(
  preview: PRPreview,
  sleepTimeoutMinutes: number,
  nowMs = Date.now(),
): { shouldSleep: boolean; minutesInactive: number; remainingMinutes: number } {
  if (sleepTimeoutMinutes <= 0) {
    return { shouldSleep: false, minutesInactive: 0, remainingMinutes: Infinity };
  }

  const lastActivityMs = preview.updated_at || preview.created_at;
  const elapsedMinutes = Math.max(0, Math.floor((nowMs - lastActivityMs) / (1000 * 60)));
  const shouldSleep = preview.status === "live" && elapsedMinutes >= sleepTimeoutMinutes;
  const remainingMinutes = Math.max(0, sleepTimeoutMinutes - elapsedMinutes);

  return {
    shouldSleep,
    minutesInactive: elapsedMinutes,
    remainingMinutes,
  };
}

/**
 * Sanitizes and formats a deterministic subdomain for PR previews
 */
export function generatePreviewSubdomain(
  projectName: string,
  prNumber: number,
  branch?: string,
): string {
  const cleanProject = projectName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!branch || branch === "main" || branch === "master") {
    return `pr-${prNumber}-${cleanProject}`;
  }

  const cleanBranch = branch
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 20);

  return `pr-${prNumber}-${cleanBranch}-${cleanProject}`;
}

/**
 * Filters preview environments based on query, project, and status
 */
export function filterPreviewEnvironments(
  previews: PRPreview[],
  filters: PreviewFilters,
): PRPreview[] {
  return previews.filter((p) => {
    if (filters.projectName && filters.projectName !== "all") {
      if (p.project_name.toLowerCase() !== filters.projectName.toLowerCase()) {
        return false;
      }
    }

    if (filters.status && filters.status !== "all") {
      if (filters.status === "stopped" || filters.status === "sleeping") {
        if (p.status !== "stopped" && p.status !== "sleeping") return false;
      } else if (p.status !== filters.status) {
        return false;
      }
    }

    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase().trim();
      const match =
        p.project_name.toLowerCase().includes(q) ||
        p.branch.toLowerCase().includes(q) ||
        p.pr_title.toLowerCase().includes(q) ||
        String(p.pr_number).includes(q) ||
        p.subdomain.toLowerCase().includes(q) ||
        p.commit_sha.toLowerCase().includes(q);

      if (!match) return false;
    }

    return true;
  });
}

/**
 * Human-friendly relative time string
 */
export function formatRelativeTime(timestampMs: number, nowMs = Date.now()): string {
  if (!timestampMs) return "unknown";
  const diffSec = Math.floor((nowMs - timestampMs) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}
