import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OUTPUT,
  collect,
  gather,
  isForbidden,
  render,
  violations,
} from "../../../scripts/licenses.mjs";

test("strong copyleft and missing licences are refused; permissive and weak copyleft are fine", () => {
  for (const ok of [
    "MIT",
    "ISC",
    "Apache-2.0",
    "BSD-3-Clause",
    "MPL-2.0",
    "LGPL-3.0-or-later",
    "CC-BY-4.0",
    "Python-2.0",
    "0BSD",
    "Unlicense",
    "MIT-0",
  ])
    assert.equal(isForbidden(ok), false, ok);
  for (const bad of [
    "GPL-3.0",
    "AGPL-3.0-only",
    "GPL-2.0-or-later",
    "SSPL-1.0",
    "BUSL-1.1",
    "UNLICENSED",
    "UNKNOWN",
    "UNSPECIFIED",
    "CC-BY-NC-4.0",
  ])
    assert.equal(isForbidden(bad), true, bad);
  assert.equal(isForbidden("(MIT OR GPL-3.0)"), false, "can be taken under MIT");
  assert.equal(isForbidden("MIT AND GPL-3.0"), true, "both apply");
  assert.equal(
    violations([
      { name: "a", license: "MIT" },
      { name: "b", license: "GPL-3.0" },
    ]).length,
    1,
  );
});

test("collect follows production dependencies through nested node_modules, skips what is not installed, and reads every licence form", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hx-lic-"));
  try {
    const put = (rel, pkg) => {
      const f = path.join(dir, rel, "package.json");
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(pkg));
    };
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        dependencies: { a: "1", b: "1", missing: "1" },
        devDependencies: { dev: "1" },
      }),
    );
    put("node_modules/a", {
      name: "a",
      version: "1.0.0",
      license: "MIT",
      dependencies: { c: "1", d: "1" },
      optionalDependencies: { fsevents: "1" },
    });
    put("node_modules/b", { name: "b", version: "2.0.0", license: { type: "ISC" } });
    put("node_modules/a/node_modules/c", {
      name: "c",
      version: "3.0.0",
      licenses: [{ type: "MIT" }, { type: "Apache-2.0" }],
    });
    put("node_modules/d", { name: "d", version: "4.0.0" });
    put("node_modules/dev", { name: "dev", version: "9.9.9", license: "GPL-3.0" });
    put("node_modules/fsevents", { name: "fsevents", version: "1.0.0", license: "MIT" });
    const got = Object.fromEntries(collect(dir).map((p) => [p.name, p.license]));
    assert.deepEqual(got, { a: "MIT", b: "ISC", c: "MIT OR Apache-2.0", d: "UNSPECIFIED" });
    assert.ok(!("dev" in got), "development-only packages are not shipped");
    assert.ok(
      !("fsevents" in got),
      "optional platform binaries are left out so the file reads the same everywhere",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("everything we ship is under an allowed licence", () => {
  const { engine, dashboard } = gather();
  assert.ok(engine.length >= 3, "the engine's packages were found");
  assert.ok(dashboard.length > 100, "the dashboard's packages were found");
  assert.deepEqual(
    violations([...engine, ...dashboard]).map((p) => `${p.name}@${p.version}: ${p.license}`),
    [],
  );
});

test("docs/THIRD_PARTY.md is up to date", () => {
  const want = render(gather()).replace(/\n*$/, "\n");
  const have = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8").replace(/\r\n/g, "\n") : "";
  assert.equal(have, want, "run `npm run licenses:write`");
});
