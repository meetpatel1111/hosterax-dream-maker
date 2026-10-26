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

test("an out-of-date inventory says which packages differ", async () => {
  const { describeDifference } = await import("../../../scripts/licenses.mjs");
  const committed = ["**MIT** (3): alpha, beta, gamma", "| better-sqlite3 | 13.0.3 | MIT |"].join(
    "\n",
  );
  const here = ["**MIT** (3): alpha, gamma, delta", "| better-sqlite3 | 13.0.4 | MIT |"].join("\n");
  const said = describeDifference(committed, here);
  assert.match(said, /only on this machine: .*delta/);
  assert.match(said, /only on this machine: .*13\.0\.4/);
  assert.match(said, /only in the committed file: .*beta/);
  assert.match(said, /only in the committed file: .*13\.0\.3/);
  assert.doesNotMatch(said, /alpha|gamma/, "what both have is not mentioned");
});

test("the inventory of one package never reads another install above it", () => {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), "hx-lic-"));
  const put = (dir, pkg) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  };
  try {
    const app = path.join(top, "app");
    put(app, { name: "app", dependencies: { a: "1", missing: "1" } });
    put(path.join(app, "node_modules", "a"), {
      name: "a",
      version: "1.0.0",
      license: "MIT",
      dependencies: { b: "1" },
    });
    put(path.join(app, "node_modules", "b"), { name: "b", version: "1.0.0", license: "ISC" });
    // installed in the directory ABOVE the app (a sibling install): must be invisible to it
    put(path.join(top, "node_modules", "missing"), {
      name: "missing",
      version: "9.9.9",
      license: "GPL-3.0",
      dependencies: { huge: "1" },
    });
    put(path.join(top, "node_modules", "huge"), { name: "huge", version: "1.0.0", license: "MIT" });
    assert.deepEqual(
      collect(app).map((p) => `${p.name}@${p.version}`),
      ["a@1.0.0", "b@1.0.0"],
    );
  } finally {
    fs.rmSync(top, { recursive: true, force: true });
  }
});
