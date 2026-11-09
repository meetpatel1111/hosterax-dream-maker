import test from "node:test";
import assert from "node:assert/strict";
import {
  calculatePreviewFleetMetrics,
  generatePrBotComment,
  evaluateAutoSleepTtl,
  generatePreviewSubdomain,
  filterPreviewEnvironments,
  formatRelativeTime,
} from "./preview-environments";
import type { PRPreview } from "../lib/engine";

const mockPreviews: PRPreview[] = [
  {
    id: "prev-1",
    project_name: "ecommerce-api",
    pr_number: 42,
    pr_title: "Add Stripe checkout webhook",
    branch: "feat/checkout-flow",
    commit_sha: "a1b2c3d4e5f6",
    subdomain: "pr-42-ecommerce-api",
    preview_url: "https://pr-42-ecommerce-api.preview.hosterax.net",
    container_name: "hx_prev_ecommerce-api_42",
    port: 3000,
    status: "live",
    created_at: Date.now() - 3600000, // 1 hour ago
    updated_at: Date.now() - 1800000, // 30 mins ago
  },
  {
    id: "prev-2",
    project_name: "ecommerce-api",
    pr_number: 45,
    pr_title: "Update product schemas",
    branch: "fix/schemas",
    commit_sha: "f9e8d7c6b5a4",
    subdomain: "pr-45-ecommerce-api",
    preview_url: "https://pr-45-ecommerce-api.preview.hosterax.net",
    container_name: "hx_prev_ecommerce-api_45",
    port: 3001,
    status: "stopped",
    created_at: Date.now() - 86400000,
    updated_at: Date.now() - 7200000,
  },
  {
    id: "prev-3",
    project_name: "analytics-worker",
    pr_number: 12,
    pr_title: "Optimized clickstream aggregator",
    branch: "perf/clickstream",
    commit_sha: "123456789abc",
    subdomain: "pr-12-analytics-worker",
    preview_url: "https://pr-12-analytics-worker.preview.hosterax.net",
    port: 8080,
    status: "deploying",
    created_at: Date.now() - 60000,
    updated_at: Date.now() - 60000,
  },
  {
    id: "prev-4",
    project_name: "landing-page",
    pr_number: 8,
    pr_title: "Broken dependency update",
    branch: "chore/deps",
    commit_sha: "badbadbadbad",
    subdomain: "pr-8-landing-page",
    preview_url: "https://pr-8-landing-page.preview.hosterax.net",
    port: 5000,
    status: "failed",
    created_at: Date.now() - 120000,
    updated_at: Date.now() - 120000,
  },
];

test("calculatePreviewFleetMetrics calculates counts, RAM and savings correctly", () => {
  const metrics = calculatePreviewFleetMetrics(mockPreviews, 256);
  assert.equal(metrics.total, 4);
  assert.equal(metrics.live, 1);
  assert.equal(metrics.deploying, 1);
  assert.equal(metrics.stopped, 1);
  assert.equal(metrics.failed, 1);
  assert.equal(metrics.activeRamMb, 512); // (1 live + 1 deploying) * 256
  assert.equal(metrics.reclaimedRamMb, 256); // 1 stopped * 256
  assert.equal(metrics.savingsPercentage, 25); // 256 / 1024
});

test("calculatePreviewFleetMetrics handles empty list gracefully", () => {
  const metrics = calculatePreviewFleetMetrics([]);
  assert.equal(metrics.total, 0);
  assert.equal(metrics.live, 0);
  assert.equal(metrics.savingsPercentage, 0);
});

test("generatePrBotComment produces expected markdown with links and status", () => {
  const comment = generatePrBotComment({
    projectName: "ecommerce-api",
    prNumber: 42,
    prTitle: "Add Stripe checkout",
    branch: "feat/checkout-flow",
    commitSha: "a1b2c3d4e5f6",
    previewUrl: "https://pr-42-ecommerce-api.preview.hosterax.net",
    status: "live",
    containerName: "hx_prev_ecommerce_42",
    port: 3000,
    sleepTimeoutMinutes: 30,
  });

  assert.ok(comment.includes("HosteraX Ephemeral Preview Environment"));
  assert.ok(comment.includes("#42"));
  assert.ok(comment.includes("https://pr-42-ecommerce-api.preview.hosterax.net"));
  assert.ok(comment.includes("Ready"));
  assert.ok(comment.includes("a1b2c3d"));
  assert.ok(comment.includes("Suspends after 30m of inactivity"));
});

test("evaluateAutoSleepTtl determines when idle container should sleep", () => {
  const now = 10000000;
  const activePreview: PRPreview = {
    ...mockPreviews[0],
    status: "live",
    updated_at: now - 35 * 60 * 1000, // 35 minutes idle
  };

  const evalSleep = evaluateAutoSleepTtl(activePreview, 30, now);
  assert.equal(evalSleep.shouldSleep, true);
  assert.equal(evalSleep.minutesInactive, 35);
  assert.equal(evalSleep.remainingMinutes, 0);

  const recentPreview: PRPreview = {
    ...mockPreviews[0],
    status: "live",
    updated_at: now - 10 * 60 * 1000, // 10 minutes idle
  };

  const evalRecent = evaluateAutoSleepTtl(recentPreview, 30, now);
  assert.equal(evalRecent.shouldSleep, false);
  assert.equal(evalRecent.minutesInactive, 10);
  assert.equal(evalRecent.remainingMinutes, 20);
});

test("generatePreviewSubdomain formats clean subdomains", () => {
  assert.equal(generatePreviewSubdomain("my-app", 10, "feature/auth"), "pr-10-feature-auth-my-app");
  assert.equal(
    generatePreviewSubdomain("My App With Spaces!", 5, "main"),
    "pr-5-my-app-with-spaces",
  );
});

test("filterPreviewEnvironments filters by project, status and search query", () => {
  const apiOnly = filterPreviewEnvironments(mockPreviews, { projectName: "ecommerce-api" });
  assert.equal(apiOnly.length, 2);

  const liveOnly = filterPreviewEnvironments(mockPreviews, { status: "live" });
  assert.equal(liveOnly.length, 1);
  assert.equal(liveOnly[0].id, "prev-1");

  const searchStripe = filterPreviewEnvironments(mockPreviews, { searchQuery: "Stripe" });
  assert.equal(searchStripe.length, 1);
  assert.equal(searchStripe[0].pr_number, 42);

  const searchBranch = filterPreviewEnvironments(mockPreviews, { searchQuery: "clickstream" });
  assert.equal(searchBranch.length, 1);
  assert.equal(searchBranch[0].project_name, "analytics-worker");
});

test("formatRelativeTime formats past durations correctly", () => {
  const now = 10000000;
  assert.equal(formatRelativeTime(now - 10000, now), "just now");
  assert.equal(formatRelativeTime(now - 5 * 60 * 1000, now), "5m ago");
  assert.equal(formatRelativeTime(now - 2 * 3600 * 1000, now), "2h ago");
  assert.equal(formatRelativeTime(now - 3 * 86400 * 1000, now), "3d ago");
});
