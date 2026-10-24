import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  OPENAPI_FILE,
  extractClientCalls,
  extractEngineRoutes,
  findMismatches,
  renderOpenApi,
} from "../../../scripts/api-contract.mjs";

const routes = extractEngineRoutes();
const calls = extractClientCalls();

test("the extractor finds the engine routes and the client calls", () => {
  assert.ok(routes.length > 150, `only ${routes.length} engine routes found`);
  assert.ok(calls.length > 150, `only ${calls.length} client calls found`);
  assert.ok(
    calls.some((c) => c.source.startsWith("hosterax/cli/")),
    "no CLI calls found",
  );
  assert.ok(
    calls.some((c) => c.source.startsWith("src/")),
    "no dashboard calls found",
  );
});

test("every CLI and dashboard call is served by an engine route", () => {
  const bad = findMismatches(routes, calls);
  assert.deepEqual(
    bad.map((b) => `${b.source}: ${b.method} ${b.path} — ${b.reason}`),
    [],
    "a client calls an engine route that does not exist (fix the client, or add the route and run `npm run api:write`)",
  );
});

test("the checker really flags a missing route, a wrong method and a typo under a project", () => {
  const fake = [
    { method: "GET", path: "/api/nope", source: "x" },
    { method: "DELETE", path: "/api/system", source: "x" },
    { method: "GET", path: "/api/projects/{param}/definitely-not-a-route", source: "x" },
  ];
  assert.equal(findMismatches(routes, fake).length, fake.length);
  assert.equal(
    findMismatches(routes, [{ method: "GET", path: "/api/projects/{param}/env", source: "x" }])
      .length,
    0,
  );
});

test("the committed openapi.json matches the engine source", () => {
  const committed = fs.readFileSync(OPENAPI_FILE, "utf8").replace(/\r\n/g, "\n");
  assert.equal(
    committed,
    renderOpenApi(),
    "openapi.json is stale: run `npm run api:write` and commit the result",
  );
});
