import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateThresholdWarning,
  formatThresholdWarningMessage,
  type ThresholdTrackerState,
} from "./threshold-warning";

test("evaluateThresholdWarning returns false when metrics are below 80%", () => {
  const result = evaluateThresholdWarning({
    currentCpu: 45,
    currentMem: 60,
    now: 1000,
  });

  assert.equal(result.isTriggered, false);
  assert.equal(result.cpuTriggered, false);
  assert.equal(result.memTriggered, false);
  assert.equal(result.triggerType, null);
  assert.equal(result.nextState.cpuExceededSince, null);
  assert.equal(result.nextState.memExceededSince, null);
});

test("evaluateThresholdWarning does not trigger on initial cross at t=0s", () => {
  const t0 = 10000;
  const result = evaluateThresholdWarning({
    currentCpu: 85,
    currentMem: 50,
    now: t0,
    state: { cpuExceededSince: null, memExceededSince: null },
  });

  assert.equal(result.isTriggered, false);
  assert.equal(result.nextState.cpuExceededSince, t0);
  assert.equal(result.cpuDurationMs, 0);
});

test("evaluateThresholdWarning does not trigger during temporary spike under 5 seconds", () => {
  const t0 = 10000;
  const t3 = t0 + 3500; // 3.5 seconds later
  const state: ThresholdTrackerState = { cpuExceededSince: t0, memExceededSince: null };

  const result = evaluateThresholdWarning({
    currentCpu: 88,
    currentMem: 50,
    now: t3,
    state,
  });

  assert.equal(result.isTriggered, false);
  assert.equal(result.cpuDurationMs, 3500);
});

test("evaluateThresholdWarning triggers when CPU exceeds 80% for more than 5 seconds", () => {
  const t0 = 10000;
  const t6 = t0 + 6000; // 6 seconds later
  const state: ThresholdTrackerState = { cpuExceededSince: t0, memExceededSince: null };

  const result = evaluateThresholdWarning({
    currentCpu: 84,
    currentMem: 60,
    now: t6,
    state,
  });

  assert.equal(result.isTriggered, true);
  assert.equal(result.cpuTriggered, true);
  assert.equal(result.memTriggered, false);
  assert.equal(result.triggerType, "cpu");
  assert.equal(result.maxDurationSeconds, 6);
  assert.equal(
    formatThresholdWarningMessage("cpu", result.maxDurationSeconds),
    "Warning: CPU usage exceeded 80% for 6s",
  );
});

test("evaluateThresholdWarning triggers for RAM when RAM exceeds 80% for 5s+", () => {
  const t0 = 10000;
  const t7 = t0 + 7200;
  const state: ThresholdTrackerState = { cpuExceededSince: null, memExceededSince: t0 };

  const result = evaluateThresholdWarning({
    currentCpu: 30,
    currentMem: 82,
    now: t7,
    state,
  });

  assert.equal(result.isTriggered, true);
  assert.equal(result.cpuTriggered, false);
  assert.equal(result.memTriggered, true);
  assert.equal(result.triggerType, "mem");
  assert.equal(result.maxDurationSeconds, 7);
  assert.equal(
    formatThresholdWarningMessage("mem", result.maxDurationSeconds),
    "Warning: RAM usage exceeded 80% for 7s",
  );
});

test("evaluateThresholdWarning triggers 'both' when both exceed 80% for 5s+", () => {
  const t0 = 10000;
  const t6 = t0 + 6000;
  const state: ThresholdTrackerState = { cpuExceededSince: t0, memExceededSince: t0 };

  const result = evaluateThresholdWarning({
    currentCpu: 92,
    currentMem: 89,
    now: t6,
    state,
  });

  assert.equal(result.isTriggered, true);
  assert.equal(result.cpuTriggered, true);
  assert.equal(result.memTriggered, true);
  assert.equal(result.triggerType, "both");
});

test("evaluateThresholdWarning resets immediately when values fall back below 80%", () => {
  const t0 = 10000;
  const t8 = t0 + 8000;
  // Previously exceeded state
  const state: ThresholdTrackerState = { cpuExceededSince: t0, memExceededSince: null };

  // Metric now drops to 65%
  const result = evaluateThresholdWarning({
    currentCpu: 65,
    currentMem: 50,
    now: t8,
    state,
  });

  assert.equal(result.isTriggered, false);
  assert.equal(result.cpuTriggered, false);
  assert.equal(result.nextState.cpuExceededSince, null);
});
