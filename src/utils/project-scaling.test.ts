import test from "node:test";
import assert from "node:assert/strict";
import { BUILD_PACK_OPTIONS, clampReplicas, normalizePlacementNodes } from "./project-scaling";

test("BUILD_PACK_OPTIONS includes auto, universal, nixpacks, railpack, buildpacks, dockerfile, compose", () => {
  const ids = BUILD_PACK_OPTIONS.map((b) => b.id);
  for (const expected of [
    "auto",
    "universal",
    "nixpacks",
    "railpack",
    "buildpacks",
    "dockerfile",
    "compose",
  ]) {
    assert.ok(ids.includes(expected as any), `Missing build pack: ${expected}`);
  }
});

test("clampReplicas clamps values to integer range 1..10", () => {
  assert.equal(clampReplicas(0), 1);
  assert.equal(clampReplicas(-5), 1);
  assert.equal(clampReplicas(Number.NaN), 1);
  assert.equal(clampReplicas(3.6), 4);
  assert.equal(clampReplicas(15), 10);
});

test("normalizePlacementNodes trims, deduplicates, and discards empty entries", () => {
  assert.deepEqual(normalizePlacementNodes([" node-a ", "", "node-b", "node-a"]), [
    "node-a",
    "node-b",
  ]);
  assert.deepEqual(normalizePlacementNodes(null), []);
});
