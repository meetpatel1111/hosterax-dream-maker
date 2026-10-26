import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DOCS, helpText, parseHelp, renderAll } from "../../../scripts/generate-docs.mjs";

test("the help text is read into groups of commands, with wrapped lines joined and pipes escaped", () => {
  const groups = parseHelp(`hosterax <command>

  First group:
    one <a|b> [--x]                           Does one thing
    two                                       Does two things
    long <name> --cron "0 2 * * *" [--keep 7] [--days 0]
                                              Back up on a schedule
    wrapped <x>                               First half
                                              second half

  Second group (extra words):
    three                                     Third
`);
  assert.deepEqual(
    groups.map((g) => [g.title, g.commands.map((c) => c.command)]),
    [
      [
        "First group",
        [
          "one <a|b> [--x]",
          "two",
          'long <name> --cron "0 2 * * *" [--keep 7] [--days 0]',
          "wrapped <x>",
        ],
      ],
      ["Second group (extra words)", ["three"]],
    ],
  );
  assert.equal(groups[0].commands[2].description, "Back up on a schedule");
  assert.equal(groups[0].commands[3].description, "First half second half");
});

test("the generated reference documents are up to date", async () => {
  const rendered = await renderAll();
  for (const key of Object.keys(DOCS)) {
    const have = fs.existsSync(DOCS[key])
      ? fs.readFileSync(DOCS[key], "utf8").replace(/\r\n/g, "\n")
      : "";
    assert.equal(
      have,
      rendered[key].replace(/\n*$/, "\n"),
      `${DOCS[key]} is out of date: run \`npm run docs:write\``,
    );
  }
});

test("every command the CLI answers to is listed in its help (so it is in the reference)", () => {
  const src = fs.readFileSync(new URL("../../cli/src/cli.mjs", import.meta.url), "utf8");
  const cases = [...src.matchAll(/^\s{4}case "([^"]*)":/gm)].map((m) => m[1]).filter(Boolean);
  // `a:logs|stop|start` in the help stands for a:logs, a:stop and a:start
  const text = helpText();
  const listed = new Set(text.split(/\s+/));
  for (const m of text.matchAll(/(\w+):((?:\w+\|)+\w+)/g))
    for (const part of m[2].split("|")) listed.add(`${m[1]}:${part}`);
  // aliases of commands that are listed under another name
  const aliases = new Set(["start", "server", "dashboard", "open"]);
  const missing = cases.filter((c) => !aliases.has(c) && ![...listed].some((w) => w === c));
  assert.deepEqual(missing, [], "add these to the help text in hosterax/cli/src/cli.mjs");
});

test("the API reference lists the scope each route needs, and the routes added in this release", async () => {
  const api = fs.readFileSync(DOCS.api, "utf8");
  assert.match(api, /\| POST \| `\/api\/servers\/\{id\}\/host-key` \| admin \|/);
  assert.match(api, /\| PUT \| `\/api\/projects\/\{id\}\/gate` \| deploy \|/);
  assert.match(api, /\| GET \| `\/api\/notifications` \| admin \|/);
  assert.match(api, /\| GET \| `\/api\/projects` \| read \|/);
});
