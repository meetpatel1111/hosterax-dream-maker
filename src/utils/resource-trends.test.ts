import test from "node:test";
import assert from "node:assert/strict";
import {
  formatRelativeMinutes,
  formatClockTime,
  calculateTrendStats,
  filterTimeWindow,
  prepare30MinTimeline,
  type TelemetryTrendPoint,
} from "./resource-trends";

test("formatRelativeMinutes formats negative offsets and Now", () => {
  const now = 1700000000000;
  assert.equal(formatRelativeMinutes(now, now), "Now");
  assert.equal(formatRelativeMinutes(now - 10000, now), "Now");
  assert.equal(formatRelativeMinutes(now - 5 * 60 * 1000, now), "-5m");
  assert.equal(formatRelativeMinutes(now - 30 * 60 * 1000, now), "-30m");
});

test("formatClockTime formats 24h timestamp", () => {
  const date = new Date(2026, 10, 7, 14, 30, 0);
  const formatted = formatClockTime(date.getTime());
  assert.equal(formatted.includes("14:30") || formatted.includes("2:30"), true);
});

test("calculateTrendStats accurately computes summary metrics", () => {
  const points: TelemetryTrendPoint[] = [
    { timestamp: 1, timeLabel: "01", relativeLabel: "-2m", cpu: 10, mem: 20 },
    { timestamp: 2, timeLabel: "02", relativeLabel: "-1m", cpu: 30, mem: 50 },
    { timestamp: 3, timeLabel: "03", relativeLabel: "Now", cpu: 20, mem: 35 },
  ];

  const stats = calculateTrendStats(points, 30);
  assert.equal(stats.avgCpu, 20); // (10+30+20)/3 = 20
  assert.equal(stats.peakCpu, 30);
  assert.equal(stats.minCpu, 10);
  assert.equal(stats.currentCpu, 20);

  assert.equal(stats.avgMem, 35); // (20+50+35)/3 = 35
  assert.equal(stats.peakMem, 50);
  assert.equal(stats.minMem, 20);
  assert.equal(stats.currentMem, 35);
  assert.equal(stats.sampleCount, 3);
});

test("calculateTrendStats gracefully handles empty points", () => {
  const empty = calculateTrendStats([]);
  assert.equal(empty.sampleCount, 0);
  assert.equal(empty.avgCpu, 0);
  assert.equal(empty.peakCpu, 0);
});

test("filterTimeWindow removes points older than 30 minutes", () => {
  const now = 1000000;
  const windowMs = 30 * 60 * 1000; // 1,800,000 ms -> cutoff = -800,000

  const points: TelemetryTrendPoint[] = [
    { timestamp: now - 35 * 60 * 1000, timeLabel: "old", relativeLabel: "-35m", cpu: 5, mem: 5 },
    { timestamp: now - 20 * 60 * 1000, timeLabel: "mid", relativeLabel: "-20m", cpu: 5, mem: 5 },
    { timestamp: now, timeLabel: "now", relativeLabel: "Now", cpu: 5, mem: 5 },
  ];

  const filtered = filterTimeWindow(points, windowMs, now);
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].relativeLabel, "-20m");
  assert.equal(filtered[1].relativeLabel, "Now");
});

test("prepare30MinTimeline synthesizes a full 30-point timeline ending at current live metrics", () => {
  const now = Date.now();
  const timeline = prepare30MinTimeline([], 8, 22, 12288, now, 30);

  assert.equal(timeline.length, 30);
  // Last point is Now
  const last = timeline[timeline.length - 1];
  assert.equal(last.relativeLabel, "Now");
  assert.equal(last.cpu, 8);
  assert.equal(last.mem, 22);

  // First point is near -30m
  const first = timeline[0];
  assert.equal(first.relativeLabel, "-30m");
});
