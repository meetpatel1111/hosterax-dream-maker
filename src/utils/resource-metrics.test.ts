import test from "node:test";
import assert from "node:assert/strict";
import {
  getUsageStatus,
  formatUptime,
  formatMegabytes,
  calculateMemoryBreakdown,
  validateMetricsResponse,
} from "./resource-metrics";

test("getUsageStatus returns correct status thresholds", () => {
  assert.equal(getUsageStatus(25), "healthy");
  assert.equal(getUsageStatus(65), "warning");
  assert.equal(getUsageStatus(75), "warning");
  assert.equal(getUsageStatus(85), "critical");
  assert.equal(getUsageStatus(99), "critical");
  assert.equal(getUsageStatus(-10), "healthy");
  assert.equal(getUsageStatus(120), "critical");
});

test("formatUptime handles various durations", () => {
  assert.equal(formatUptime(45), "45s");
  assert.equal(formatUptime(125), "2m 5s");
  assert.equal(formatUptime(3665), "1h 1m 5s");
  assert.equal(formatUptime(90000), "1d 1h 0m");
  assert.equal(formatUptime(0), "0s");
  assert.equal(formatUptime(-5), "0s");
});

test("formatMegabytes formats small and large memory correctly", () => {
  assert.equal(formatMegabytes(512), "512 MB");
  assert.equal(formatMegabytes(1024), "1.00 GB");
  assert.equal(formatMegabytes(4096), "4.00 GB");
  assert.equal(formatMegabytes(12288), "12.0 GB");
  assert.equal(formatMegabytes(0), "0 MB");
});

test("calculateMemoryBreakdown produces accurate percentages and boundaries", () => {
  const result = calculateMemoryBreakdown(12288, 841);
  assert.equal(result.totalMb, 12288);
  assert.equal(result.usedMb, 841);
  assert.equal(result.freeMb, 11447);
  assert.equal(result.usedPercent, 7);
  assert.equal(result.totalFormatted, "12.0 GB");

  // Clamped boundaries
  const zero = calculateMemoryBreakdown(0, 0);
  assert.equal(zero.usedPercent, 0);

  const overflow = calculateMemoryBreakdown(1000, 2000);
  assert.equal(overflow.usedMb, 1000);
  assert.equal(overflow.usedPercent, 100);
});

test("validateMetricsResponse confirms payload schema validity", () => {
  const valid = {
    system: {
      cpuUsagePercent: 5,
      cores: 4,
      loadAverage: { "1m": 0.1, "5m": 0.2, "15m": 0.1 },
      memory: {
        totalMb: 12288,
        usedMb: 841,
        freeMb: 11447,
        usedPercent: 7,
      },
      uptimeSeconds: 1200,
    },
  };
  assert.equal(validateMetricsResponse(valid), true);

  assert.equal(validateMetricsResponse(null), false);
  assert.equal(validateMetricsResponse({}), false);
  assert.equal(validateMetricsResponse({ system: { cpuUsagePercent: "5" } }), false);
});
